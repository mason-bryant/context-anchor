import type { Pool } from "pg";

import { assertValidSchemaName } from "./config.js";
import { INSTRUMENT_CONSUMERS } from "./instrumentConsumers.js";

/**
 * The questions agents actually asked, and what came back (T-50 follow-on).
 *
 * The diagnostics that already existed answer "which routes are dead weight" across all traffic.
 * This answers a different question — "what was asked, and did we answer it well" — and it is
 * the one a person needs in order to judge routing on real use rather than on a corpus someone
 * wrote. A route that is never expanded looks the same in aggregate whether it was irrelevant or
 * merely ranked eighth; reading the question tells you which.
 *
 * Task text is retained by default from 2026-08-15 and was opt-in before it, so early rows carry
 * only a hash. Those are reported as `taskText: null` rather than omitted: a question that was
 * asked and not recorded is a different thing from no question, and hiding it would misrepresent
 * how much traffic this view covers.
 */

export type RecordedQuestion = {
  requestId: string;
  /** Null when this request predates retention, or when the caller withheld it. */
  taskText: string | null;
  /** Always present. Identical questions share one, which is what makes them groupable without text. */
  taskHash: string;
  consumer: string | null;
  plannerVersion: string;
  ranker: { id: string; version: string; deterministic: boolean };
  routeBudget: Record<string, unknown> | null;
  askedAt: string;
  /** Routes offered, expanded, and the records a caller reported using. */
  routesOffered: number;
  routesExpanded: number;
  recordUses: number;
  /**
   * The routes offered, best position first, so a reader sees the answer beside the question.
   *
   * `recordCount` is a number and not `number | null`, though the column is nullable: NULL means
   * "a shadow ordering offered this route and the authoritative answer did not, so nothing was
   * loaded for it" (telemetry migration 0002), and this query returns only non-shadow rows. Every
   * non-shadow impression is written from the planned routes, each of which carries its own count.
   * Pinned by a test, because that is a claim about a different file and would otherwise rot into
   * a UI rendering "null record(s)".
   */
  routes: Array<{ routeKey: string; position: number; expanded: boolean; recordCount: number }>;
};

export type QuestionsQuery = {
  workspaceGuid: string;
  /** Most recent first. */
  limit?: number;
  /** Exclude the instruments — the gate and the corpus — which are not anybody's questions. */
  includeInstruments?: boolean;
  /** Only questions whose text was recorded, for a reader who wants to skip the hash-only rows. */
  withTextOnly?: boolean;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function recordedQuestions(
  pool: Pool,
  telemetrySchemaName: string,
  query: QuestionsQuery,
): Promise<RecordedQuestion[]> {
  assertValidSchemaName(telemetrySchemaName);

  // Bounded, and bounded here rather than trusted from a caller: this reads a table that only
  // grows and has no retention job behind it yet (T-41).
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const rows = await pool.query<{
    request_guid: string;
    task_text: string | null;
    task_hash: string;
    consumer: string | null;
    planner_version: string;
    ranker_id: string;
    ranker_version: string;
    ranker_deterministic: boolean;
    route_budget: Record<string, unknown> | null;
    created_at: Date;
    routes_offered: string;
    routes_expanded: string;
    record_uses: string;
    routes: Array<{ routeKey: string; position: number; expanded: boolean; recordCount: number }> | null;
  }>(
    `SELECT r.request_guid, r.task_text, r.task_hash, r.consumer, r.planner_version,
            r.ranker_id, r.ranker_version, r.ranker_deterministic, r.route_budget, r.created_at,
            count(i.impression_guid) FILTER (WHERE i.is_shadow = false) AS routes_offered,
            count(i.impression_guid) FILTER (WHERE i.is_shadow = false AND i.expanded_at IS NOT NULL)
              AS routes_expanded,
            (SELECT count(*) FROM "${telemetrySchemaName}".retrieval_record_uses u
              WHERE u.request_guid = r.request_guid) AS record_uses,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'routeKey', i.route_key,
                  'position', i.offered_position,
                  'expanded', i.expanded_at IS NOT NULL,
                  'recordCount', i.record_count
                )
                -- Offered position, so the reader sees the answer in the order the caller did.
                ORDER BY i.offered_position
              ) FILTER (WHERE i.impression_guid IS NOT NULL AND i.is_shadow = false),
              '[]'::jsonb
            ) AS routes
       FROM "${telemetrySchemaName}".retrieval_requests r
       -- LEFT, because a request that offered no routes at all is the most interesting row on
       -- this screen: it is the zero-route failure, with the question still attached.
       LEFT JOIN "${telemetrySchemaName}".retrieval_route_impressions i
         ON i.request_guid = r.request_guid
      WHERE r.workspace_guid = $1
        AND ($2::boolean OR r.consumer IS NULL OR r.consumer <> ALL($3::text[]))
        AND (NOT $4::boolean OR r.task_text IS NOT NULL)
      GROUP BY r.request_guid
      -- Newest first, with the guid breaking ties: created_at is not unique under load, and a
      -- list that reorders between reads cannot be paged or compared.
      ORDER BY r.created_at DESC, r.request_guid DESC
      LIMIT $5`,
    [
      query.workspaceGuid,
      query.includeInstruments ?? false,
      INSTRUMENT_CONSUMERS,
      query.withTextOnly ?? false,
      limit,
    ],
  );

  return rows.rows.map((row) => ({
    requestId: row.request_guid,
    taskText: row.task_text,
    taskHash: row.task_hash,
    consumer: row.consumer,
    plannerVersion: row.planner_version,
    ranker: {
      id: row.ranker_id,
      version: row.ranker_version,
      deterministic: row.ranker_deterministic,
    },
    routeBudget: row.route_budget,
    askedAt: row.created_at.toISOString(),
    routesOffered: Number(row.routes_offered),
    routesExpanded: Number(row.routes_expanded),
    recordUses: Number(row.record_uses),
    routes: row.routes ?? [],
  }));
}
