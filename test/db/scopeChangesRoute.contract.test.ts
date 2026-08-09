import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { runMigrations } from "../../src/db/migrate.js";
import { AnchorRepository } from "../../src/git/repo.js";
import { startHttpServer } from "../../src/http/server.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";
import { removeTempDir } from "../tempDir.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");
const TOKEN = "test-token";

describe.runIf(await isTestDatabaseReachable())("GET /api/db/scope-changes (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let tmpDir: string;
  let server: Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(adminPool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    bootstrap = await ensureBootstrap(adminPool, { schemaName });

    const handler = new CommandHandler(adminPool, schemaName);
    await handler.execute({
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      commandType: "scope.rename",
      origin: "ui",
      idempotencyKey: randomUUID(),
      reason: "renamed through the route test",
      entity: {
        entityType: "scope",
        entityGuid: bootstrap.defaultScopeGuid,
        ownerScopeGuid: bootstrap.defaultScopeGuid,
      },
      apply: async (tx) => {
        const updated = await tx.query<{ title: string }>(
          `UPDATE "${schemaName}".scopes SET title = 'Route Renamed', version = version + 1
           WHERE workspace_guid = $1 AND scope_guid = $2 RETURNING title`,
          [bootstrap.workspaceGuid, bootstrap.defaultScopeGuid],
        );
        return { resultingValue: updated.rows[0]!, entryType: "scope.renamed" };
      },
    });

    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-scope-changes-"));
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();

    server = await startHttpServer(
      {
        repoPath: tmpDir,
        anchorRoot: ".",
        autoSync: false,
        pushOnWrite: false,
        syncIntervalMs: 0,
        migrationWarnOnly: false,
        staleAfterDays: 45,
        graphScoring: { enabled: false, maxBoost: 8 },
        database: { poolSize: 3, schemaName },
      },
      { host: "127.0.0.1", port: 0, authToken: TOKEN, stateless: true },
      { databaseUrl: TEST_DATABASE_URL },
    );

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the HTTP server to listen on a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
      server = undefined;
    }
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
    await removeTempDir(tmpDir);
  });

  function get(query: string) {
    return fetch(`${baseUrl}/api/db/scope-changes${query}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }

  it("returns typed change entries for a scope named by slug", async () => {
    const response = await get("?scope=workspace");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { scope: string; changes: Array<Record<string, unknown>> };
    expect(body.scope).toBe("workspace");
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]).toMatchObject({
      entryType: "scope.renamed",
      commandType: "scope.rename",
      reason: "renamed through the route test",
    });
    expect((body.changes[0]!.resultingValue as { title: string }).title).toBe("Route Renamed");
  });

  it("rejects an unknown scope with 400, not an empty 200", async () => {
    const response = await get("?scope=no-such-scope");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/no scope matched/i);
  });

  it("rejects a malformed since window with 400", async () => {
    const response = await get("?scope=workspace&since=last%20week");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/since/i);
  });

  it("rejects a request with no scope", async () => {
    const response = await get("");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/scope is required/i);
  });

  it("rejects a non-numeric or non-positive limit with 400 rather than failing in SQL", async () => {
    for (const bad of ["abc", "-1", "0", "1.5", ""]) {
      const response = await get(`?scope=workspace&limit=${encodeURIComponent(bad)}`);
      expect(response.status, `limit=${JSON.stringify(bad)}`).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(/limit/i);
    }
  });

  it("honors a valid limit", async () => {
    const response = await get("?scope=workspace&limit=1");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { changes: unknown[] }).changes).toHaveLength(1);
  });

  it("rejects repeated query parameters instead of silently ignoring them", async () => {
    // Express surfaces a repeated key as an array. Treating that as "absent" would let an
    // ambiguous `since` widen to all history — the exact silent-widening this route 400s to
    // prevent — and would let `limit` skip validation entirely.
    const ambiguous = await get("?scope=workspace&since=7d&since=24h");
    expect(ambiguous.status).toBe(400);
    expect(((await ambiguous.json()) as { error: string }).error).toMatch(/since/i);

    const twoLimits = await get("?scope=workspace&limit=1&limit=2");
    expect(twoLimits.status).toBe(400);
    expect(((await twoLimits.json()) as { error: string }).error).toMatch(/limit/i);

    const twoScopes = await get("?scope=workspace&scope=other");
    expect(twoScopes.status).toBe(400);
    expect(((await twoScopes.json()) as { error: string }).error).toMatch(/scope/i);
  });

  it("honors a since window that excludes the change", async () => {
    const response = await get("?scope=workspace&since=2099-01-01");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { changes: unknown[] }).changes).toEqual([]);
  });
});
