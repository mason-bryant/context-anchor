import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { defaultRanker, rankWithFallback, type RankedRoute, type Ranker } from "./ranker.js";
import {
  contentFingerprint,
  loadRouteRecords,
  selectRouteCandidates,
  type RouteRecord,
} from "./selectRoutes.js";

export const PLANNER_VERSION = "routing-1.0.0";

/** Expanded routes return their records; listed routes return counts and reasons only. */
export type RouteBudget = {
  expanded: number;
  listed: number;
  /**
   * Records returned per expanded route. Without this the budget bounds routes but not
   * response size: a domain scope in a real workspace holds hundreds of sections, so
   * expanding one route can return the entire corpus.
   */
  recordsPerRoute: number;
};

export const DEFAULT_ROUTE_BUDGET: RouteBudget = { expanded: 2, listed: 10, recordsPerRoute: 25 };

export type PlanInput = {
  workspaceGuid: string;
  task: string;
  referencedPaths?: string[];
  /** Route keys the caller wants expanded regardless of position — the expandRoutes path. */
  routeKeys?: string[];
  budget?: Partial<RouteBudget>;
  principalGuid?: string;
  traceId?: string;
  consumer?: string;
  /** Opt-in: expansion is stateless and the server never reads the task back. */
  storeTaskText?: boolean;
};

export type PlannedRoute = {
  routeKey: string;
  appliesWhen: string;
  matchReasons: string[];
  contentFingerprint: string;
  recordCount: number;
  expanded: boolean;
  records?: RouteRecord[];
  /** True when the route holds more records than the budget returned, so a caller knows the slice is partial. */
  recordsTruncated?: boolean;
  /** Present only when a requested route key resolved to nothing. */
  unavailable?: string;
};

export type PlanResult = {
  requestId: string;
  plannerVersion: string;
  recomputedAt: string;
  budget: RouteBudget;
  ranker: { id: string; version: string; deterministic: boolean; fellBack: boolean; fallbackReason?: string };
  routes: PlannedRoute[];
};

export type PlanOptions = {
  ranker?: Ranker;
  /**
   * Rankers run alongside the authoritative one purely to record what they would have
   * ordered. They can never affect the response.
   */
  shadowRankers?: Ranker[];
  now?: () => Date;
};

function appliesWhen(route: RankedRoute): string {
  const article = route.scopeKind === "practice" ? "applying the" : "working on the";
  return `you are ${article} ${route.title} ${route.scopeKind}`;
}

/**
 * Plans a routed bundle: select, rank, resolve membership, expand within budget, record.
 *
 * Stateless in the strong sense — the caller resupplies the task on expansion and the
 * server retains nothing between calls. `requestId` is a telemetry correlation token only
 * and is never an input to recomputation, which is what lets task text stay opt-in and
 * makes current permissions apply automatically.
 */
export async function planRoutedBundle(
  pool: Pool,
  schemaName: string,
  telemetrySchemaName: string,
  input: PlanInput,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const now = options.now?.() ?? new Date();
  const budget: RouteBudget = { ...DEFAULT_ROUTE_BUDGET, ...input.budget };
  const candidates = await selectRouteCandidates(pool, schemaName, input);

  const outcome = await rankWithFallback(candidates, options.ranker ?? defaultRanker);
  const offered = outcome.routes.slice(0, Math.max(budget.listed, budget.expanded));

  // Records are loaded for every offered route, not only expanded ones, because every route
  // carries a fingerprint and a fingerprint is a statement about content. Expansion decides
  // what is *returned*, not what is read.
  const recordsByRoute = new Map<string, RouteRecord[]>();
  for (const route of offered) {
    recordsByRoute.set(route.routeKey, await loadRouteRecords(pool, schemaName, input.workspaceGuid, route.scopeGuid));
  }

  const requested = new Set(input.routeKeys ?? []);
  const routes: PlannedRoute[] = offered.map((route, index) => {
    const records = recordsByRoute.get(route.routeKey) ?? [];
    // An explicit request wins over position: expandRoutes exists so a caller can take a
    // route the budget listed rather than expanded.
    const expanded = requested.size > 0 ? requested.has(route.routeKey) : index < budget.expanded;
    // The fingerprint covers the whole route, not the truncated slice: it answers "did this
    // route's content move", which must not change merely because the budget shrank.
    const returned = records.slice(0, budget.recordsPerRoute);
    return {
      routeKey: route.routeKey,
      appliesWhen: appliesWhen(route),
      matchReasons: route.signals.map((signal) => signal.reason),
      contentFingerprint: contentFingerprint(records),
      recordCount: route.recordCount,
      expanded,
      ...(expanded ? { records: returned, recordsTruncated: records.length > returned.length } : {}),
    };
  });

  // A key that resolves to nothing is reported as unavailable rather than silently omitted,
  // so a caller holding a stale key learns why instead of seeing an empty answer.
  for (const routeKey of requested) {
    if (!routes.some((route) => route.routeKey === routeKey)) {
      routes.push({
        routeKey,
        appliesWhen: "",
        matchReasons: [],
        contentFingerprint: "",
        recordCount: 0,
        expanded: false,
        unavailable: "no live scope matches this route key for this task",
      });
    }
  }

  const requestId = randomUUID();
  await recordRequest(pool, telemetrySchemaName, {
    requestId,
    input,
    budget,
    outcome,
    now,
  });
  await recordImpressions(pool, telemetrySchemaName, requestId, outcome.ranker, offered, routes, false);

  // Shadow orderings are recorded after the answer is formed and can never change it. A
  // failure here must not fail a query the caller has already been served.
  for (const shadow of options.shadowRankers ?? []) {
    try {
      const shadowOutcome = await rankWithFallback(candidates, shadow);
      await recordImpressions(
        pool,
        telemetrySchemaName,
        requestId,
        shadowOutcome.ranker,
        shadowOutcome.routes.slice(0, Math.max(budget.listed, budget.expanded)),
        routes,
        true,
      );
    } catch {
      // Intentionally swallowed: shadow ranking is diagnostics, not the answer.
    }
  }

  return {
    requestId,
    plannerVersion: PLANNER_VERSION,
    recomputedAt: now.toISOString(),
    budget,
    ranker: {
      ...outcome.ranker,
      fellBack: outcome.fellBack,
      ...(outcome.fallbackReason ? { fallbackReason: outcome.fallbackReason } : {}),
    },
    routes,
  };
}

async function recordRequest(
  pool: Pool,
  telemetrySchemaName: string,
  args: {
    requestId: string;
    input: PlanInput;
    budget: RouteBudget;
    outcome: Awaited<ReturnType<typeof rankWithFallback>>;
    now: Date;
  },
): Promise<void> {
  const { requestId, input, budget, outcome, now } = args;
  await pool.query(
    `INSERT INTO "${telemetrySchemaName}".retrieval_requests
       (request_guid, workspace_guid, principal_guid, trace_id, task_text, task_hash,
        planner_version, ranker_id, ranker_version, ranker_deterministic, consumer, route_budget, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      requestId,
      input.workspaceGuid,
      input.principalGuid ?? null,
      input.traceId ?? null,
      // Opt-in, because nothing on the server ever needs to read it back.
      input.storeTaskText === true ? input.task : null,
      createHash("sha256").update(input.task).digest("hex"),
      PLANNER_VERSION,
      outcome.ranker.id,
      outcome.ranker.version,
      outcome.ranker.deterministic,
      input.consumer ?? null,
      budget.expanded,
      now,
    ],
  );
}

async function recordImpressions(
  pool: Pool,
  telemetrySchemaName: string,
  requestId: string,
  ranker: { id: string; version: string },
  ordered: RankedRoute[],
  planned: PlannedRoute[],
  isShadow: boolean,
): Promise<void> {
  if (ordered.length === 0) {
    return;
  }
  const expandedKeys = new Set(planned.filter((route) => route.expanded).map((route) => route.routeKey));

  for (const route of ordered) {
    await pool.query(
      `INSERT INTO "${telemetrySchemaName}".retrieval_route_impressions
         (impression_guid, request_guid, ranker_id, ranker_version, is_shadow, route_key,
          subject_type, subject_guid, offered_position, match_reasons, record_count, expanded_at)
       VALUES ($1,$2,$3,$4,$5,$6,'scope',$7,$8,$9::jsonb,$10,$11)
       ON CONFLICT (request_guid, ranker_id, ranker_version, route_key) DO NOTHING`,
      [
        randomUUID(),
        requestId,
        ranker.id,
        ranker.version,
        isShadow,
        route.routeKey,
        route.scopeGuid,
        route.offeredPosition,
        JSON.stringify(route.signals.map((signal) => signal.reason)),
        route.recordCount,
        // A shadow ordering never expanded anything; recording otherwise would make it look
        // like the caller saw it.
        !isShadow && expandedKeys.has(route.routeKey) ? new Date() : null,
      ],
    );
  }
}

export type RecordUse = {
  requestId: string;
  refs: Array<
    { type: "assertion"; guid: string } | { type: "section"; guid: string; stableKey: string }
  >;
  useKind: string;
};

/**
 * The outcome signal a search engine never gets: whether a served record was actually used.
 * Combined with per-ranker impressions this is what turns ranking questions into
 * measurements rather than arguments.
 */
export async function reportRecordUse(
  pool: Pool,
  telemetrySchemaName: string,
  use: RecordUse,
): Promise<{ recorded: number }> {
  let recorded = 0;
  for (const ref of use.refs) {
    const result = await pool.query(
      `INSERT INTO "${telemetrySchemaName}".retrieval_record_uses
         (use_guid, request_guid, record_type, record_guid, stable_key, use_kind)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE EXISTS (SELECT 1 FROM "${telemetrySchemaName}".retrieval_requests WHERE request_guid = $2)`,
      [
        randomUUID(),
        use.requestId,
        ref.type,
        ref.guid,
        ref.type === "section" ? ref.stableKey : null,
        use.useKind,
      ],
    );
    recorded += result.rowCount ?? 0;
  }
  return { recorded };
}
