import type { Pool } from "pg";

/**
 * The comparison gate (T8).
 *
 * This thread exists to answer one question — do routed answers beat the legacy planner —
 * and it deliberately has no MCP surface. An agent cannot judge whether its own context was
 * well chosen, because it never sees what it was not given. Only a person reading both
 * answers to the same real task can say.
 */

export type RoutingDiagnostics = {
  /** Routes offered but never expanded, worst first. A condition nobody acts on is a condition that reads wrong. */
  neverExpanded: Array<{ routeKey: string; offered: number; lastOfferedAt: string | null }>;
  /** Expansion rate by offered position, which is what shows whether ordering is carrying its weight. */
  expansionByPosition: Array<{ position: number; offered: number; expanded: number; rate: number }>;
  /**
   * Records served and never used. A scope full of these is dead weight in every bundle it
   * appears in. Counted over expansions, not offers — an unexpanded route served no records,
   * so it cannot be said to have gone unused.
   */
  neverUsed: Array<{ routeKey: string; expanded: number; used: number }>;
  totals: { requests: number; routesOffered: number; routesExpanded: number; recordUses: number };
};

/**
 * Read straight from the telemetry schema rather than recomputed, so the diagnostics
 * describe what callers were actually offered rather than what a replay would produce now.
 */
export async function routingDiagnostics(
  pool: Pool,
  telemetrySchemaName: string,
  workspaceGuid: string,
  options: { sinceDays?: number } = {},
): Promise<RoutingDiagnostics> {
  const since = options.sinceDays ?? 30;
  // Validated here rather than trusting the one caller that happens to check today. A negative
  // value would make `now() - interval` reach into the future and return an empty report, which
  // reads as "nothing was retrieved" — the same answer a healthy-but-unused workspace gives.
  // Failing loudly is the only way that stays distinguishable.
  if (!Number.isInteger(since) || since <= 0) {
    // String rather than JSON.stringify, which renders NaN as "null" — the one input most
    // likely to arrive here would have been reported as the one value it is not.
    throw new Error(`sinceDays must be a positive integer, received ${String(options.sinceDays)}`);
  }

  const totals = await pool.query<{
    requests: string;
    routes_offered: string;
    routes_expanded: string;
    record_uses: string;
  }>(
    `SELECT
       (SELECT count(*) FROM "${telemetrySchemaName}".retrieval_requests r
         WHERE r.workspace_guid = $1 AND r.created_at > now() - ($2 || ' days')::interval) AS requests,
       (SELECT count(*) FROM "${telemetrySchemaName}".retrieval_route_impressions i
          JOIN "${telemetrySchemaName}".retrieval_requests r USING (request_guid)
         WHERE r.workspace_guid = $1 AND i.is_shadow = false
           AND r.created_at > now() - ($2 || ' days')::interval) AS routes_offered,
       (SELECT count(*) FROM "${telemetrySchemaName}".retrieval_route_impressions i
          JOIN "${telemetrySchemaName}".retrieval_requests r USING (request_guid)
         WHERE r.workspace_guid = $1 AND i.is_shadow = false AND i.expanded_at IS NOT NULL
           AND r.created_at > now() - ($2 || ' days')::interval) AS routes_expanded,
       (SELECT count(*) FROM "${telemetrySchemaName}".retrieval_record_uses u
          JOIN "${telemetrySchemaName}".retrieval_requests r USING (request_guid)
         WHERE r.workspace_guid = $1
           AND r.created_at > now() - ($2 || ' days')::interval) AS record_uses`,
    [workspaceGuid, String(since)],
  );

  // Shadow impressions are excluded everywhere here: a shadow ordering was never shown to
  // anyone, so counting it as "offered and not expanded" would blame a route for a choice
  // no caller ever saw.
  const neverExpanded = await pool.query<{ route_key: string; offered: string; last_offered_at: Date | null }>(
    `SELECT i.route_key, count(*) AS offered, max(r.created_at) AS last_offered_at
       FROM "${telemetrySchemaName}".retrieval_route_impressions i
       JOIN "${telemetrySchemaName}".retrieval_requests r USING (request_guid)
      WHERE r.workspace_guid = $1 AND i.is_shadow = false
        AND r.created_at > now() - ($2 || ' days')::interval
      GROUP BY i.route_key
     HAVING count(*) FILTER (WHERE i.expanded_at IS NOT NULL) = 0
      ORDER BY count(*) DESC, i.route_key
      LIMIT 50`,
    [workspaceGuid, String(since)],
  );

  const byPosition = await pool.query<{ position: number; offered: string; expanded: string }>(
    `SELECT i.offered_position AS position,
            count(*) AS offered,
            count(*) FILTER (WHERE i.expanded_at IS NOT NULL) AS expanded
       FROM "${telemetrySchemaName}".retrieval_route_impressions i
       JOIN "${telemetrySchemaName}".retrieval_requests r USING (request_guid)
      WHERE r.workspace_guid = $1 AND i.is_shadow = false
        AND r.created_at > now() - ($2 || ' days')::interval
      GROUP BY i.offered_position
      ORDER BY i.offered_position`,
    [workspaceGuid, String(since)],
  );

  const neverUsed = await pool.query<{ route_key: string; expanded: string; used: string }>(
    `SELECT i.route_key,
            count(DISTINCT i.impression_guid) AS expanded,
            count(u.use_guid) AS used
       FROM "${telemetrySchemaName}".retrieval_route_impressions i
       JOIN "${telemetrySchemaName}".retrieval_requests r USING (request_guid)
       LEFT JOIN "${telemetrySchemaName}".retrieval_record_uses u ON u.impression_guid = i.impression_guid
      WHERE r.workspace_guid = $1 AND i.is_shadow = false AND i.expanded_at IS NOT NULL
        AND r.created_at > now() - ($2 || ' days')::interval
      GROUP BY i.route_key
     HAVING count(u.use_guid) = 0
      ORDER BY count(DISTINCT i.impression_guid) DESC, i.route_key
      LIMIT 50`,
    [workspaceGuid, String(since)],
  );

  return {
    neverExpanded: neverExpanded.rows.map((row) => ({
      routeKey: row.route_key,
      offered: Number(row.offered),
      lastOfferedAt: row.last_offered_at ? row.last_offered_at.toISOString() : null,
    })),
    expansionByPosition: byPosition.rows.map((row) => {
      const offered = Number(row.offered);
      const expanded = Number(row.expanded);
      return { position: row.position, offered, expanded, rate: offered === 0 ? 0 : expanded / offered };
    }),
    neverUsed: neverUsed.rows.map((row) => ({
      routeKey: row.route_key,
      expanded: Number(row.expanded),
      used: Number(row.used),
    })),
    totals: {
      requests: Number(totals.rows[0]?.requests ?? 0),
      routesOffered: Number(totals.rows[0]?.routes_offered ?? 0),
      routesExpanded: Number(totals.rows[0]?.routes_expanded ?? 0),
      recordUses: Number(totals.rows[0]?.record_uses ?? 0),
    },
  };
}
