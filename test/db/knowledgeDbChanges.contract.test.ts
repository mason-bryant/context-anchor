import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { KnowledgeDatabase, ScopeNotFoundError } from "../../src/db/knowledgeDb.js";
import { runMigrations } from "../../src/db/migrate.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

describe.runIf(await isTestDatabaseReachable())("KnowledgeDatabase.listScopeChangesForOwner (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let db: KnowledgeDatabase;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    bootstrap = await ensureBootstrap(pool, { schemaName });
    db = new KnowledgeDatabase(pool, schemaName, bootstrap);

    const handler = new CommandHandler(pool, schemaName);
    await handler.execute({
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      commandType: "scope.rename",
      origin: "mcp",
      idempotencyKey: randomUUID(),
      reason: "renamed for the history test",
      entity: {
        entityType: "scope",
        entityGuid: bootstrap.defaultScopeGuid,
        ownerScopeGuid: bootstrap.defaultScopeGuid,
      },
      apply: async (tx) => {
        const updated = await tx.query<{ title: string }>(
          `UPDATE "${schemaName}".scopes SET title = 'Renamed Workspace', version = version + 1
           WHERE workspace_guid = $1 AND scope_guid = $2 RETURNING title`,
          [bootstrap.workspaceGuid, bootstrap.defaultScopeGuid],
        );
        return { resultingValue: updated.rows[0]!, entryType: "scope.renamed" };
      },
    });
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pool.end();
  });

  it("resolves a scope by slug, which is what an agent or a URL actually has", async () => {
    const changes = await db.listScopeChangesForOwner({ scope: "workspace" });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.entryType).toBe("scope.renamed");
    expect(changes[0]!.reason).toBe("renamed for the history test");
    expect(changes[0]!.actorDisplayName).toBeTruthy();
  });

  it("resolves a scope by guid as well", async () => {
    const changes = await db.listScopeChangesForOwner({ scope: bootstrap.defaultScopeGuid });
    expect(changes).toHaveLength(1);
  });

  it("throws a named error for an unknown scope rather than returning an empty history", async () => {
    // An empty list would read as "nothing changed here", which is a different fact from
    // "that scope does not exist" — and the second is usually a typo worth surfacing.
    await expect(db.listScopeChangesForOwner({ scope: "no-such-scope" })).rejects.toThrow(ScopeNotFoundError);
  });

  it("accepts a relative since window", async () => {
    await expect(db.listScopeChangesForOwner({ scope: "workspace", since: "7d" })).resolves.toHaveLength(1);
    await expect(db.listScopeChangesForOwner({ scope: "workspace", since: "1m" })).resolves.toHaveLength(1);
  });

  it("surfaces a malformed since rather than silently listing all history", async () => {
    await expect(db.listScopeChangesForOwner({ scope: "workspace", since: "last week" })).rejects.toThrow(/since/i);
  });
});
