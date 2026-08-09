import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { listScopeChanges } from "../../src/db/scopeChanges.js";
import { runMigrations } from "../../src/db/migrate.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

describe.runIf(await isTestDatabaseReachable())("listScopeChanges (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;
  let scopeGuid: string;
  let otherScopeGuid: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    bootstrap = await ensureBootstrap(pool, { schemaName });
    handler = new CommandHandler(pool, schemaName);

    scopeGuid = await createScope("subject-scope");
    otherScopeGuid = await createScope("other-scope");

    // Twelve changes to the subject scope, so "last ten" is a real truncation.
    for (let i = 1; i <= 12; i += 1) {
      await rename(scopeGuid, `Subject ${i}`, `renamed to Subject ${i}`);
    }
    await rename(otherScopeGuid, "Other Renamed", "should not leak into the subject scope");
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pool.end();
  });

  async function createScope(slug: string): Promise<string> {
    const guid = randomUUID();
    await pool.query(
      `INSERT INTO "${schemaName}".scopes (workspace_guid, scope_guid, scope_slug, scope_kind, title)
       VALUES ($1, $2, $3, 'component', $4)`,
      [bootstrap.workspaceGuid, guid, slug, slug],
    );
    return guid;
  }

  function rename(guid: string, title: string, reason: string) {
    return handler.execute({
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      commandType: "scope.rename",
      origin: "ui",
      idempotencyKey: randomUUID(),
      reason,
      entity: { entityType: "scope", entityGuid: guid, ownerScopeGuid: guid },
      apply: async (tx) => {
        const updated = await tx.query<{ title: string; version: number }>(
          `UPDATE "${schemaName}".scopes SET title = $1, version = version + 1
           WHERE workspace_guid = $2 AND scope_guid = $3 RETURNING title, version`,
          [title, bootstrap.workspaceGuid, guid],
        );
        return { resultingValue: updated.rows[0]!, entryType: "scope.renamed" };
      },
    });
  }

  it("lists the last ten changes to one scope with actor, time, reason, and batch", async () => {
    const changes = await listScopeChanges(pool, schemaName, {
      workspaceGuid: bootstrap.workspaceGuid,
      scopeGuid,
      limit: 10,
    });

    expect(changes).toHaveLength(10);
    for (const change of changes) {
      expect(change.actorPrincipalGuid).toBe(bootstrap.ownerPrincipalGuid);
      expect(change.entryType).toBe("scope.renamed");
      expect(change.occurredAt).toBeInstanceOf(Date);
      expect(change.reason).toMatch(/renamed to Subject/);
      expect(change.commandGuid).toBeTruthy();
      expect("batchGuid" in change).toBe(true);
    }
  });

  it("returns entries newest first", async () => {
    const changes = await listScopeChanges(pool, schemaName, {
      workspaceGuid: bootstrap.workspaceGuid,
      scopeGuid,
      limit: 3,
    });
    expect(changes.map((c) => (c.resultingValue as { title: string }).title)).toEqual([
      "Subject 12",
      "Subject 11",
      "Subject 10",
    ]);
  });

  it("does not include changes to other scopes", async () => {
    const changes = await listScopeChanges(pool, schemaName, {
      workspaceGuid: bootstrap.workspaceGuid,
      scopeGuid,
      limit: 100,
    });
    expect(changes).toHaveLength(12);
    for (const change of changes) {
      expect((change.resultingValue as { title: string }).title).not.toBe("Other Renamed");
    }
  });

  it("carries prior and resulting values so an entry renders without replay", async () => {
    const changes = await listScopeChanges(pool, schemaName, {
      workspaceGuid: bootstrap.workspaceGuid,
      scopeGuid,
      limit: 1,
    });
    const [latest] = changes;
    expect((latest!.priorValue as { title: string }).title).toBe("Subject 11");
    expect((latest!.resultingValue as { title: string }).title).toBe("Subject 12");
  });

  it("filters by a since window", async () => {
    const future = new Date(Date.now() + 60_000);
    const none = await listScopeChanges(pool, schemaName, {
      workspaceGuid: bootstrap.workspaceGuid,
      scopeGuid,
      since: future,
    });
    expect(none).toEqual([]);

    const past = new Date(Date.now() - 60 * 60 * 1000);
    const all = await listScopeChanges(pool, schemaName, {
      workspaceGuid: bootstrap.workspaceGuid,
      scopeGuid,
      since: past,
    });
    expect(all).toHaveLength(12);
  });

  it("never returns entries from another workspace", async () => {
    const otherWorkspace = await ensureBootstrap(pool, { schemaName, workspaceSlug: "history-isolation-workspace" });
    const changes = await listScopeChanges(pool, schemaName, {
      workspaceGuid: otherWorkspace.workspaceGuid,
      scopeGuid,
      limit: 100,
    });
    expect(changes).toEqual([]);
  });
});
