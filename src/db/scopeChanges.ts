import type { Pool } from "pg";

import { assertValidSchemaName } from "./config.js";

export type ScopeChange = {
  entryGuid: string;
  entryType: string;
  streamId: string;
  priorValue: unknown;
  resultingValue: unknown;
  commandGuid: string;
  commandType: string;
  batchGuid: string | null;
  actorPrincipalGuid: string;
  actorDisplayName: string;
  reason: string | null;
  occurredAt: Date;
  recordedAt: Date;
};

export const DEFAULT_SCOPE_CHANGE_LIMIT = 50;
const MAX_SCOPE_CHANGE_LIMIT = 500;

/**
 * Typed domain history for one scope (T4), newest first — not a file diff and not a replay.
 * Every entry carries prior and resulting values inline, so the UI renders it without
 * reconstructing anything.
 *
 * Actor display names are joined at read time rather than denormalized into the log, per
 * the design doc's PII hedge: log payloads and version rows carry principal references only.
 */
export async function listScopeChanges(
  pool: Pool,
  schemaName: string,
  input: { workspaceGuid: string; scopeGuid: string; since?: Date; limit?: number },
): Promise<ScopeChange[]> {
  assertValidSchemaName(schemaName);

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_SCOPE_CHANGE_LIMIT, 1), MAX_SCOPE_CHANGE_LIMIT);

  const result = await pool.query<{
    entry_guid: string;
    entry_type: string;
    stream_id: string;
    prior_value: unknown;
    resulting_value: unknown;
    command_guid: string;
    command_type: string;
    batch_guid: string | null;
    actor_principal_guid: string;
    actor_display_name: string;
    reason: string | null;
    occurred_at: Date;
    recorded_at: Date;
  }>(
    `SELECT l.entry_guid, l.entry_type, l.stream_id, l.prior_value, l.resulting_value,
            l.command_guid, c.command_type, l.batch_guid,
            c.actor_principal_guid, p.display_name AS actor_display_name, c.reason,
            l.occurred_at, l.recorded_at
     FROM "${schemaName}".mutation_log l
     JOIN "${schemaName}".commands c
       ON c.workspace_guid = l.workspace_guid AND c.command_guid = l.command_guid
     JOIN "${schemaName}".principals p
       ON p.workspace_guid = c.workspace_guid AND p.principal_guid = c.actor_principal_guid
     WHERE l.workspace_guid = $1
       AND l.owner_scope_guid = $2
       AND ($3::timestamptz IS NULL OR l.recorded_at >= $3)
     ORDER BY l.recorded_at DESC, l.entry_guid DESC
     LIMIT $4`,
    [input.workspaceGuid, input.scopeGuid, input.since ?? null, limit],
  );

  return result.rows.map((row) => ({
    entryGuid: row.entry_guid,
    entryType: row.entry_type,
    streamId: row.stream_id,
    priorValue: row.prior_value,
    resultingValue: row.resulting_value,
    commandGuid: row.command_guid,
    commandType: row.command_type,
    batchGuid: row.batch_guid,
    actorPrincipalGuid: row.actor_principal_guid,
    actorDisplayName: row.actor_display_name,
    reason: row.reason,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  }));
}
