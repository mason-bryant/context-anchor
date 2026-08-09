import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { assertValidSchemaName } from "./config.js";

/** The transaction a command's `apply` runs inside. Narrow on purpose: no commit/rollback. */
export type CommandTransaction = Pick<PoolClient, "query">;

export type CommandEntity = {
  entityType: string;
  entityGuid: string;
  /** The scope whose history this change belongs to — what T4 reads by. */
  ownerScopeGuid: string;
};

export type ApplyResult = {
  /** Full row snapshot after the change; stored verbatim as the version payload. */
  resultingValue: Record<string, unknown>;
  /** Domain-shaped log entry type, e.g. `scope.renamed` — not a table name. */
  entryType: string;
};

export type CommandInput = {
  workspaceGuid: string;
  actorPrincipalGuid: string;
  commandType: string;
  origin: "ui" | "mcp";
  idempotencyKey: string;
  batchGuid?: string;
  reason?: string;
  entity: CommandEntity;
  /** Current version the caller believes it is editing. Omit to skip the check. */
  expectedVersion?: number;
  apply: (tx: CommandTransaction) => Promise<ApplyResult>;
};

export type CommandResult = {
  commandGuid: string;
  version: number;
  /** True when the idempotency key had already been accepted, so nothing was applied. */
  replayed: boolean;
};

export class ConcurrentModificationError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly entityGuid: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      `Concurrent modification of ${entityType} ${entityGuid}: expected version ${String(expectedVersion)}, ` +
        `found ${String(actualVersion)}. Re-read the record and retry.`,
    );
    this.name = "ConcurrentModificationError";
  }
}

/**
 * The single place durable knowledge mutates (design doc: "nothing mutates outside a command
 * handler"). Every accepted mutation writes, in one transaction:
 *
 *   1. a `commands` row — the actor, type, origin, batch, and idempotency key
 *   2. a `record_versions` snapshot — the full row after the change
 *   3. a `mutation_log` entry — prior and resulting values, self-describing enough to render
 *
 * Either all of that commits or none of it does, so history can never disagree with the
 * record it describes.
 */
export class CommandHandler {
  constructor(
    private readonly pool: Pool,
    private readonly schemaName: string,
  ) {
    assertValidSchemaName(schemaName);
  }

  async execute(input: CommandInput): Promise<CommandResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const replay = await this.findAcceptedCommand(client, input);
      if (replay) {
        // Already accepted under this key: commit the empty transaction and report the
        // original outcome rather than applying a second time.
        await client.query("COMMIT");
        return { ...replay, replayed: true };
      }

      const priorVersionRow = await this.currentVersion(client, input);
      const priorVersion = priorVersionRow?.version ?? 0;

      if (input.expectedVersion !== undefined && input.expectedVersion !== priorVersion) {
        throw new ConcurrentModificationError(
          input.entity.entityType,
          input.entity.entityGuid,
          input.expectedVersion,
          priorVersion,
        );
      }

      const commandGuid = randomUUID();
      await client.query(
        `INSERT INTO "${this.schemaName}".commands
           (workspace_guid, command_guid, actor_principal_guid, command_type, idempotency_key, batch_guid, origin, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.workspaceGuid,
          commandGuid,
          input.actorPrincipalGuid,
          input.commandType,
          input.idempotencyKey,
          input.batchGuid ?? null,
          input.origin,
          input.reason ?? null,
        ],
      );

      const applied = await input.apply(client);
      const version = priorVersion + 1;

      await client.query(
        `INSERT INTO "${this.schemaName}".record_versions
           (workspace_guid, entity_type, entity_guid, version, payload, changed_by_principal_guid, command_guid)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.workspaceGuid,
          input.entity.entityType,
          input.entity.entityGuid,
          version,
          JSON.stringify(applied.resultingValue),
          input.actorPrincipalGuid,
          commandGuid,
        ],
      );

      await client.query(
        `INSERT INTO "${this.schemaName}".mutation_log
           (workspace_guid, entry_guid, owner_scope_guid, stream_id, entry_type, prior_value, resulting_value,
            command_guid, batch_guid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.workspaceGuid,
          randomUUID(),
          input.entity.ownerScopeGuid,
          `${input.entity.entityType}:${input.entity.entityGuid}`,
          applied.entryType,
          priorVersionRow ? JSON.stringify(priorVersionRow.payload) : null,
          JSON.stringify(applied.resultingValue),
          commandGuid,
          input.batchGuid ?? null,
        ],
      );

      await client.query("COMMIT");
      return { commandGuid, version, replayed: false };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async findAcceptedCommand(
    client: CommandTransaction,
    input: CommandInput,
  ): Promise<{ commandGuid: string; version: number } | undefined> {
    const existing = await client.query<{ command_guid: string; version: number | null }>(
      `SELECT c.command_guid,
              (SELECT max(v.version) FROM "${this.schemaName}".record_versions v
                WHERE v.workspace_guid = c.workspace_guid AND v.command_guid = c.command_guid) AS version
       FROM "${this.schemaName}".commands c
       WHERE c.workspace_guid = $1 AND c.idempotency_key = $2`,
      [input.workspaceGuid, input.idempotencyKey],
    );

    const row = existing.rows[0];
    return row ? { commandGuid: row.command_guid, version: row.version ?? 0 } : undefined;
  }

  private async currentVersion(
    client: CommandTransaction,
    input: CommandInput,
  ): Promise<{ version: number; payload: Record<string, unknown> } | undefined> {
    const result = await client.query<{ version: number; payload: Record<string, unknown> }>(
      `SELECT version, payload FROM "${this.schemaName}".record_versions
       WHERE workspace_guid = $1 AND entity_type = $2 AND entity_guid = $3
       ORDER BY version DESC LIMIT 1`,
      [input.workspaceGuid, input.entity.entityType, input.entity.entityGuid],
    );
    return result.rows[0];
  }
}
