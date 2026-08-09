import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler, ConcurrentModificationError } from "../../src/db/commandHandler.js";
import { runMigrations } from "../../src/db/migrate.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

describe.runIf(await isTestDatabaseReachable())("CommandHandler (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    bootstrap = await ensureBootstrap(pool, { schemaName });
    handler = new CommandHandler(pool, schemaName);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pool.end();
  });

  /** A scope rename is the smallest real mutation available before assertions exist (PR6). */
  function renameScope(input: {
    scopeGuid: string;
    title: string;
    expectedVersion?: number;
    idempotencyKey?: string;
    batchGuid?: string;
    reason?: string;
  }) {
    return handler.execute({
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      commandType: "scope.rename",
      origin: "mcp" as const,
      idempotencyKey: input.idempotencyKey ?? randomUUID(),
      batchGuid: input.batchGuid,
      reason: input.reason,
      entity: { entityType: "scope", entityGuid: input.scopeGuid, ownerScopeGuid: input.scopeGuid },
      expectedVersion: input.expectedVersion,
      apply: async (tx) => {
        const updated = await tx.query<{ title: string; version: number }>(
          `UPDATE "${schemaName}".scopes SET title = $1, version = version + 1
           WHERE workspace_guid = $2 AND scope_guid = $3
           RETURNING title, version`,
          [input.title, bootstrap.workspaceGuid, input.scopeGuid],
        );
        return { resultingValue: updated.rows[0]!, entryType: "scope.renamed" };
      },
    });
  }

  async function createScope(slug: string): Promise<string> {
    const scopeGuid = randomUUID();
    await pool.query(
      `INSERT INTO "${schemaName}".scopes (workspace_guid, scope_guid, scope_slug, scope_kind, title)
       VALUES ($1, $2, $3, 'component', $4)`,
      [bootstrap.workspaceGuid, scopeGuid, slug, slug],
    );
    return scopeGuid;
  }

  it("writes a command row, a version snapshot, and a log entry in one transaction", async () => {
    const scopeGuid = await createScope(`atomic-${randomUUID().slice(0, 8)}`);
    const result = await renameScope({ scopeGuid, title: "Renamed Once", reason: "test rename" });

    const command = await pool.query(
      `SELECT actor_principal_guid, command_type, origin FROM "${schemaName}".commands WHERE command_guid = $1`,
      [result.commandGuid],
    );
    expect(command.rows[0]).toMatchObject({
      actor_principal_guid: bootstrap.ownerPrincipalGuid,
      command_type: "scope.rename",
      origin: "mcp",
    });

    const versions = await pool.query(
      `SELECT version, payload, command_guid FROM "${schemaName}".record_versions
       WHERE entity_type = 'scope' AND entity_guid = $1 ORDER BY version`,
      [scopeGuid],
    );
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0]!.command_guid).toBe(result.commandGuid);

    const entries = await pool.query(
      `SELECT entry_type, prior_value, resulting_value, command_guid, stream_id
       FROM "${schemaName}".mutation_log WHERE owner_scope_guid = $1`,
      [scopeGuid],
    );
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0]).toMatchObject({
      entry_type: "scope.renamed",
      command_guid: result.commandGuid,
      stream_id: `scope:${scopeGuid}`,
    });
  });

  it("rolls the whole command back when apply throws — nothing partially written", async () => {
    const scopeGuid = await createScope(`rollback-${randomUUID().slice(0, 8)}`);

    await expect(
      handler.execute({
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        commandType: "scope.rename",
        origin: "mcp",
        idempotencyKey: randomUUID(),
        entity: { entityType: "scope", entityGuid: scopeGuid, ownerScopeGuid: scopeGuid },
        apply: async (tx) => {
          await tx.query(`UPDATE "${schemaName}".scopes SET title = 'half written' WHERE scope_guid = $1`, [scopeGuid]);
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow(/boom/);

    const scope = await pool.query(`SELECT title FROM "${schemaName}".scopes WHERE scope_guid = $1`, [scopeGuid]);
    expect(scope.rows[0]!.title).not.toBe("half written");

    for (const table of ["commands", "record_versions", "mutation_log"]) {
      const column = table === "commands" ? "command_type" : table === "record_versions" ? "entity_guid" : "owner_scope_guid";
      const where = table === "commands" ? `command_type = 'scope.rename'` : `${column} = '${scopeGuid}'`;
      const rows = await pool.query(`SELECT count(*)::int AS n FROM "${schemaName}".${table} WHERE ${where}`);
      if (table !== "commands") {
        expect(rows.rows[0]!.n, `${table} must have no rows for a rolled-back command`).toBe(0);
      }
    }
  });

  it("is idempotent: replaying the same idempotency key does not apply twice", async () => {
    const scopeGuid = await createScope(`idem-${randomUUID().slice(0, 8)}`);
    const key = randomUUID();

    const first = await renameScope({ scopeGuid, title: "First Title", idempotencyKey: key });
    const second = await renameScope({ scopeGuid, title: "Second Title", idempotencyKey: key });

    expect(second.commandGuid).toBe(first.commandGuid);
    expect(second.replayed).toBe(true);

    const scope = await pool.query(`SELECT title, version FROM "${schemaName}".scopes WHERE scope_guid = $1`, [scopeGuid]);
    expect(scope.rows[0]!.title).toBe("First Title");
    expect(scope.rows[0]!.version).toBe(1);

    const entries = await pool.query(
      `SELECT count(*)::int AS n FROM "${schemaName}".mutation_log WHERE owner_scope_guid = $1`,
      [scopeGuid],
    );
    expect(entries.rows[0]!.n).toBe(1);
  });

  it("rejects a stale expectedVersion so concurrent writers cannot both win", async () => {
    const scopeGuid = await createScope(`concurrency-${randomUUID().slice(0, 8)}`);

    await renameScope({ scopeGuid, title: "Winner", expectedVersion: 0 });

    await expect(renameScope({ scopeGuid, title: "Loser", expectedVersion: 0 })).rejects.toThrow(
      ConcurrentModificationError,
    );

    const scope = await pool.query(`SELECT title FROM "${schemaName}".scopes WHERE scope_guid = $1`, [scopeGuid]);
    expect(scope.rows[0]!.title).toBe("Winner");
  });

  it("increments version per mutation and keeps every snapshot", async () => {
    const scopeGuid = await createScope(`versions-${randomUUID().slice(0, 8)}`);

    await renameScope({ scopeGuid, title: "V1" });
    await renameScope({ scopeGuid, title: "V2" });
    await renameScope({ scopeGuid, title: "V3" });

    const versions = await pool.query<{ version: number; payload: { title: string } }>(
      `SELECT version, payload FROM "${schemaName}".record_versions
       WHERE entity_type = 'scope' AND entity_guid = $1 ORDER BY version`,
      [scopeGuid],
    );
    expect(versions.rows.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(versions.rows.map((r) => r.payload.title)).toEqual(["V1", "V2", "V3"]);
  });

  it("groups commands under one batch when a batchGuid is supplied", async () => {
    const scopeA = await createScope(`batch-a-${randomUUID().slice(0, 8)}`);
    const scopeB = await createScope(`batch-b-${randomUUID().slice(0, 8)}`);
    const batchGuid = randomUUID();

    await renameScope({ scopeGuid: scopeA, title: "Batched A", batchGuid });
    await renameScope({ scopeGuid: scopeB, title: "Batched B", batchGuid });

    const batched = await pool.query(
      `SELECT count(*)::int AS n FROM "${schemaName}".commands WHERE batch_guid = $1`,
      [batchGuid],
    );
    expect(batched.rows[0]!.n).toBe(2);
  });
});
