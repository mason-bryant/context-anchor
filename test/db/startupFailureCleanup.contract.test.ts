import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorRepository } from "../../src/git/repo.js";
import { startHttpServer } from "../../src/http/server.js";
import { createTestSchemas, dropRegisteredSchemas, isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";
import { removeTempDir } from "../tempDir.js";

const TOKEN = "test-token";

/**
 * Regression guard for the failed-bind cleanup path: when `app.listen` rejects (port already
 * in use), startHttpServer must close the database pool too, not just the loggers, or the
 * process leaks Postgres connections on every failed start.
 */
describe.runIf(await isTestDatabaseReachable())("startHttpServer bind-failure cleanup (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;
  let tmpDir: string;
  let blocker: Server | undefined;

  beforeEach(async () => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    // Both schemas, not knowledge alone. Startup checks telemetry too, so migrating only
    // knowledge made createKnowledgeDatabase throw MigrationsPendingError before it ever tried
    // to bind — this test asserted `.rejects.toThrow()` with no matcher and passed on that
    // error instead of the bind failure it names.
    schemaName = await createTestSchemas(adminPool);

    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-bind-fail-"));
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
  });

  afterEach(async () => {
    if (blocker) {
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = undefined;
    }
    await dropRegisteredSchemas(adminPool);
    await adminPool.end();
    await removeTempDir(tmpDir);
  });

  it("closes the knowledge database pool when the HTTP port is already bound", async () => {
    // Occupy a port so the real startHttpServer bind fails.
    const { createServer } = await import("node:http");
    blocker = createServer();
    await new Promise<void>((resolve) => blocker!.listen(0, "127.0.0.1", () => resolve()));
    const address = blocker.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the blocking server to hold a TCP port");
    }

    // vitest runs test files in parallel against this same database, so a global
    // pg_stat_activity count would drift with unrelated contract tests opening and closing
    // connections. Tag this server's connections with a unique application_name and count
    // only those, so the assertion measures exactly the pool under test.
    const applicationName = `anchor_bind_fail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const taggedUrl = `${TEST_DATABASE_URL}${TEST_DATABASE_URL.includes("?") ? "&" : "?"}application_name=${applicationName}`;

    expect(await taggedConnectionCount(adminPool, applicationName)).toBe(0);

    await expect(
      startHttpServer(
        {
          repoPath: tmpDir,
          anchorRoot: ".",
          autoSync: false,
          pushOnWrite: false,
          syncIntervalMs: 0,
          migrationWarnOnly: false,
          staleAfterDays: 45,
          graphScoring: { enabled: false, maxBoost: 8 },
          database: { poolSize: 3, schemaName, storeTaskText: true },
        },
        { host: "127.0.0.1", port: address.port, authToken: TOKEN, stateless: true },
        { databaseUrl: taggedUrl },
      ),
      // Matched, not bare: an unmatched rejection accepts any failure, which is how this test
      // spent its life proving the migrations path rather than the bind path.
    ).rejects.toThrow(/EADDRINUSE|listen/i);

    // The pool is closed in the failure path, so none of its connections may survive.
    await waitFor(async () => (await taggedConnectionCount(adminPool, applicationName)) === 0);
    expect(await taggedConnectionCount(adminPool, applicationName)).toBe(0);
  });
});

async function taggedConnectionCount(pool: Pool, applicationName: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND application_name = $1
       AND pid <> pg_backend_pid()`,
    [applicationName],
  );
  return result.rows[0]!.n;
}

/**
 * Throws on timeout rather than returning quietly. Returning would let the following
 * assertion pass on a condition that only became true after the wait gave up — which is
 * exactly the race this guard exists to catch.
 */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition did not become true within ${String(timeoutMs)}ms`);
}
