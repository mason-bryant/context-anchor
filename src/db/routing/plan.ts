import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { WorkspaceRole } from "../access.js";
import { defaultRanker, rankWithFallback, type RankedRoute, type Ranker } from "./ranker.js";
import {
  contentFingerprint,
  loadRouteRecords,
  selectRouteCandidates,
  type RouteRecord,
} from "./selectRoutes.js";

// Bumped because selection changed, not because the code did. This string is written into every
// retrieval_requests row and is the only thing making impressions comparable across runs. The
// record-lexical stopword filter changes which routes selection produces, so leaving the version
// alone would claim two materially different planners were the same — on the one field the
// evaluation of this signal rests on. Deliberately no figure here: the measurement belongs beside
// the code that produces it, and a number copied to a second place is a number that goes stale.
export const PLANNER_VERSION = "routing-1.1.0";

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
  /**
   * Links returned per listed route, bounded separately from records.
   *
   * Bounding links by recordsPerRoute was wrong and measurably so: 25 is a reasonable slice of
   * content for a route the caller asked to expand, and a terrible one for every route it did
   * not. At expanded 0 across 23 scopes that is 575 links and 139KB — a listing that costs more
   * than the two expanded records it replaced.
   *
   * Low by default because a link list is for choosing, not for reading. `recordsTruncated`
   * says when there are more, and the route's own recordCount says how many.
   */
  linksPerRoute: number;
};

export const DEFAULT_ROUTE_BUDGET: RouteBudget = {
  expanded: 2,
  listed: 10,
  recordsPerRoute: 25,
  linksPerRoute: 5,
};

export type PlanInput = {
  workspaceGuid: string;
  /** Whose permissions apply to route selection. Supplied by the facade, never by the caller — see PlanRequest. */
  principalGuid: string;
  /** Resolved with principalGuid from the authenticated session, not caller-supplied. */
  role: WorkspaceRole;
  task: string;
  referencedPaths?: string[];
  /** Route keys the caller wants expanded regardless of position — the expandRoutes path. */
  routeKeys?: string[];
  budget?: Partial<RouteBudget>;
  traceId?: string;
  consumer?: string;
  /** Opt-in: expansion is stateless and the server never reads the task back. */
  storeTaskText?: boolean;
  /**
   * Match task terms against assertion titles and section headings as well as scope names.
   *
   * Off unless asked for. It is the fix for tasks that name no scope reaching nothing at all
   * (T-45), but it widens answers sharply on the same workspace — "proposals and review" goes
   * from 2 routes to 15 of 23 — and 15 of 23 scopes is not a route, it is the workspace with
   * extra steps. Which trade is right is settled by judging the routes it adds, not by a
   * default chosen here.
   *
   * This comment used to name the shadow ranker as the way to settle it. That was wrong:
   * selection runs once and every shadow ranker receives that same candidate array, so a
   * shadow ordering can only permute scopes that already matched. This flag changes which
   * scopes become candidates at all, which is upstream of anything a ranker sees. The
   * comparison surface asks the question properly, because it runs selection twice.
   */
  recordLexical?: boolean;
};

/** What a caller supplies; identity and role are the facade's to decide, never the caller's. */
export type PlanRequest = Omit<PlanInput, "workspaceGuid" | "principalGuid" | "role">;

/**
 * A record a route holds, addressable but not delivered.
 *
 * This is the "reachable rather than present" half of progressive disclosure. Everything here
 * is already loaded to compute the route's fingerprint, so a link costs nothing extra to send
 * and 158 times less than the record it points at — measured on a real domain scope: 663
 * characters of labels against 104,521 of content across 25 records.
 *
 * `heading` carries the assertion's title for an assertion, and the section heading for a
 * section. Both are written to be read out of context, which is what makes them enough to
 * decide on: "A pending proposal is not project truth" tells a caller whether to fetch the
 * claim without spending the claim.
 *
 * A distinct type rather than RouteRecord with an optional `content`, because an absent field
 * reads as an empty record, and the one thing a link must never look like is a record that
 * turned out to have nothing in it.
 */
export type RouteRecordLink = {
  ref: RouteRecord["ref"];
  documentName?: string;
  heading?: string;
  headingLevel?: number;
  kind?: string;
  status?: string;
};

export type PlannedRoute = {
  routeKey: string;
  appliesWhen: string;
  matchReasons: string[];
  contentFingerprint: string;
  recordCount: number;
  expanded: boolean;
  records?: RouteRecord[];
  /**
   * The records this route holds, as links, when it was listed rather than expanded.
   *
   * Present when a route was listed rather than expanded *and* resolved to a real scope. A
   * route reported `unavailable` — a stale key the caller asked to expand — also carries
   * `expanded: false` and has nothing to link to, so "exactly when expanded is false" was
   * wrong, and wrong in the direction that makes a consumer trust an absent field.
   *
   * Expanding costs a round trip through expandRoutes, which is stateless — the caller supplies
   * the task again — so a link is a real address rather than a promise the server has to
   * remember.
   */
  recordLinks?: RouteRecordLink[];
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
  /**
   * Candidates the ranker returned, before `budget.listed` truncated them.
   *
   * Counted after ranking rather than after selection, deliberately: A3 permits a ranker to drop
   * candidates as well as reorder them, and a route the ranker discarded was never offerable, so
   * counting it would overstate what the budget hid. The distinction only matters for a ranker
   * that drops — the default one does not — but the field is named for what it counts.
   *
   * Equal to `routes.length` unless the budget clipped the answer, and that difference is the
   * point: without it a caller cannot distinguish "ten scopes matched" from "forty matched and
   * you are seeing a quarter of them". A comparison surface reading route counts to judge how
   * far a signal widens the answer would silently saturate at the budget and report every
   * blowout as the same size.
   */
  candidateCount: number;
  /**
   * Which optional selection inputs were actually applied.
   *
   * Echoed rather than assumed because a caller cannot otherwise tell a flag that did nothing
   * from a flag that never arrived. Two panes rendering identical answers is a meaningful
   * result if the flag was on and a broken instrument if it was not, and nothing else in this
   * response distinguishes them — `plannerVersion` and `ranker` are the same constants either
   * way.
   */
  appliedSignals: { recordLexical: boolean };
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
 * A record reduced to what a caller needs in order to decide whether to fetch it.
 *
 * Citations are dropped with the content they cite: a quote is evidence for a claim, and
 * sending the evidence while withholding the claim is the wrong half.
 */
function toLink(record: RouteRecord): RouteRecordLink {
  return {
    ref: record.ref,
    ...(record.documentName === undefined ? {} : { documentName: record.documentName }),
    ...(record.heading === undefined ? {} : { heading: record.heading }),
    ...(record.headingLevel === undefined ? {} : { headingLevel: record.headingLevel }),
    ...(record.kind === undefined ? {} : { kind: record.kind }),
    ...(record.status === undefined ? {} : { status: record.status }),
  };
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
  // Normalized rather than merged as given: `expanded` greater than `listed` would offer
  // more routes than the response and the telemetry claim were offered, so a later reading
  // of an impression would disagree with the budget stored beside it.
  const merged = { ...DEFAULT_ROUTE_BUDGET, ...input.budget };
  // listed is raised to expanded, never the reverse: expanded 0 is a legitimate and now
  // supported request — nothing delivered, and as many routes listed as `listed` allows — and
  // clamping it upward would silently refuse the one setting that asks for pure disclosure.
  // `expanded` bounds delivery only; how many routes are offered stays `listed`'s business.
  const budget: RouteBudget = { ...merged, listed: Math.max(merged.listed, merged.expanded) };
  const candidates = await selectRouteCandidates(pool, schemaName, input);

  const outcome = await rankWithFallback(candidates, options.ranker ?? defaultRanker);
  const offered = outcome.routes.slice(0, budget.listed);

  // Records are loaded for every offered route, not only expanded ones, because every route
  // carries a fingerprint and a fingerprint is a statement about content. Expansion decides
  // what is *returned*, not what is read.
  // Loaded concurrently: each route's records are independent, and awaiting them in turn
  // made latency scale with the number of offered routes when nothing required ordering.
  const recordsByRoute = new Map<string, RouteRecord[]>(
    await Promise.all(
      offered.map(
        async (route) =>
          [route.routeKey, await loadRouteRecords(pool, schemaName, input.workspaceGuid, route.scopeGuid)] as const,
      ),
    ),
  );

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
      // The count IS the records, not a separately computed number that agrees with them by
      // luck. Three divergences (assertions vs sections, assertion-only scopes, associations
      // orphaned by a heading rename) all came from asking the same question with two
      // queries, so there is now only one.
      recordCount: records.length,
      expanded,
      // Content for the routes the caller chose to expand; addresses for the rest. A listed
      // route used to carry a count and nothing else, which made the count the only thing a
      // caller could reason about and left expanding a route a guess about what was inside it.
      //
      // Each slice honours its own bound: records by recordsPerRoute, links by linksPerRoute.
      // Not the same number, and the difference is the whole reason linksPerRoute exists -- 25
      // is a reasonable slice of content for a route the caller asked to expand and a terrible
      // one for every route it did not. This comment previously said both honoured
      // recordsPerRoute, which would have led a reader to "fix" the code toward the bug.
      ...(expanded
        ? { records: returned, recordsTruncated: records.length > returned.length }
        : {
            recordLinks: records.slice(0, budget.linksPerRoute).map(toLink),
            recordsTruncated: records.length > budget.linksPerRoute,
          }),
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
  const recordCountByRoute = new Map(routes.map((route) => [route.routeKey, route.recordCount]));
  await recordImpressions(pool, telemetrySchemaName, requestId, outcome.ranker, offered, routes, false, now, recordCountByRoute);

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
        shadowOutcome.routes.slice(0, budget.listed),
        routes,
        true,
        now,
        recordCountByRoute,
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
    // Counted from the ranked outcome rather than from `candidates`, so a ranker that drops
    // candidates (A3 permits dropping, only not inventing) is reported as having dropped them
    // instead of inflating the count with routes that were never offerable.
    candidateCount: outcome.routes.length,
    appliedSignals: { recordLexical: input.recordLexical === true },
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
      input.principalGuid,
      input.traceId ?? null,
      // Opt-in, because nothing on the server ever needs to read it back.
      input.storeTaskText === true ? input.task : null,
      createHash("sha256").update(input.task).digest("hex"),
      PLANNER_VERSION,
      outcome.ranker.id,
      outcome.ranker.version,
      outcome.ranker.deterministic,
      input.consumer ?? null,
      JSON.stringify(budget),
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
  // The request's clock, not a fresh one: every timestamp for a single request should agree,
  // and a fresh Date here defeats a fixed clock in tests.
  now: Date,
  // The counts as reported, so an impression cannot claim a route held a different number of
  // records than the response said it did.
  recordCountByRoute: Map<string, number>,
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
       ON CONFLICT (request_guid, ranker_id, ranker_version, is_shadow, route_key) DO NOTHING`,
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
        // Null, not zero, when this route was never in the answer: a shadow ordering can
        // offer a route the authoritative response did not, and nothing was loaded for it.
        // Zero would read as "the route was empty", which is the opposite conclusion.
        recordCountByRoute.get(route.routeKey) ?? null,
        // A shadow ordering never expanded anything; recording otherwise would make it look
        // like the caller saw it.
        !isShadow && expandedKeys.has(route.routeKey) ? now : null,
      ],
    );
  }
}

export type UsedRef = (
  | { type: "assertion"; guid: string }
  | { type: "section"; guid: string; stableKey: string }
) & {
  /**
   * Which offered route served this record. Required, because `record_scopes` is
   * many-to-many — a section can belong to several scopes, and several of them can be
   * offered at once — so a use recorded without its route cannot be attributed to an
   * impression, and "where would another ranker have placed the records the caller used"
   * becomes unanswerable. That question is the entire point of recording uses.
   */
  routeKey: string;
};

/** Refusals are part of the contract: a use that could not be attributed is not a use. */
export type RecordUseResult = { recorded: number; rejected: Array<{ routeKey: string; reason: string }> };

export type RecordUse = {
  requestId: string;
  refs: UsedRef[];
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
): Promise<RecordUseResult> {
  let recorded = 0;
  const rejected: Array<{ routeKey: string; reason: string }> = [];

  // Checked once, up front, because a missing request and an unoffered route are different
  // answers that a per-ref rowCount cannot tell apart. An unknown request is ignored — the
  // caller is reporting against something that never happened — whereas a known request
  // with an unoffered route is a rejection worth naming. Conflating them would return a
  // rejection per ref, each blaming a route that may well have been fine.
  const known = await pool.query(
    `SELECT 1 FROM "${telemetrySchemaName}".retrieval_requests WHERE request_guid = $1`,
    [use.requestId],
  );
  if (known.rowCount === 0) {
    return { recorded: 0, rejected: [] };
  }

  for (const ref of use.refs) {
    // The impression is resolved here rather than trusted from the caller, and narrowed to
    // the ranker that actually produced the answer by joining the request's own ranker id
    // and version. Live rows for one route are not unique on their own — several
    // non-shadow rankers per request is what the ranking boundary is designed to allow, and
    // the uniqueness key permits it — so an unqualified scalar subquery throws "more than
    // one row returned by a subquery" the moment a second live ordering exists.
    const result = await pool.query(
      `INSERT INTO "${telemetrySchemaName}".retrieval_record_uses
         (use_guid, request_guid, impression_guid, record_type, record_guid, stable_key, use_kind)
       SELECT $1, r.request_guid, i.impression_guid, $3, $4, $5, $6
         FROM "${telemetrySchemaName}".retrieval_requests r
         JOIN "${telemetrySchemaName}".retrieval_route_impressions i
           ON i.request_guid = r.request_guid
          AND i.ranker_id = r.ranker_id
          AND i.ranker_version = r.ranker_version
          AND i.is_shadow = false
          AND i.route_key = $7
        WHERE r.request_guid = $2
        LIMIT 1`,
      [
        randomUUID(),
        use.requestId,
        ref.type,
        ref.guid,
        ref.type === "section" ? ref.stableKey : null,
        use.useKind,
        ref.routeKey,
      ],
    );

    if (result.rowCount && result.rowCount > 0) {
      recorded += result.rowCount;
    } else {
      // Refused rather than stored unattributed. A row whose impression is null cannot
      // answer the one question uses are recorded to answer, and reporting it as recorded
      // would tell the caller their signal landed when it did not.
      rejected.push({ routeKey: ref.routeKey, reason: "route was not offered on this request" });
    }
  }

  return { recorded, rejected };
}
