import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTestDatabaseReachable, TEST_DATABASE_URL, migrateAllSchemas } from "./testDatabase.js";
import { removeTempDir } from "../tempDir.js";

// Forces a throw AFTER the knowledge database is created and before the runtime is
// returned, which is the window where the pool has no owner: it is created inside
// initializeRuntime, so the caller's catch has no reference to close it.
vi.mock("../../src/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server.js")>();
  return {
    ...actual,
    createAnchorMcpServer: () => {
      throw new Error("simulated failure after knowledge database creation");
    },
  };
});

const { createAnchorRuntime } = await import("../../src/runtime.js");


describe.runIf(await isTestDatabaseReachable())("createAnchorRuntime pool cleanup (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;
  let tmpDir: string;

  beforeEach(async () => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await migrateAllSchemas(adminPool, schemaName);
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-pool-cleanup-"));
  });

  afterEach(async () => {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
    await removeTempDir(tmpDir);
  });

  it("closes the knowledge database pool when a later initialization step throws", async () => {
    // Tagged so the count is isolated from other contract files running in parallel.
    const applicationName = `anchor_pool_cleanup_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const taggedUrl = `${TEST_DATABASE_URL}${TEST_DATABASE_URL.includes("?") ? "&" : "?"}application_name=${applicationName}`;

    expect(await taggedConnectionCount(adminPool, applicationName)).toBe(0);

    await expect(
      createAnchorRuntime(
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
        { databaseUrl: taggedUrl },
      ),
    ).rejects.toThrow(/simulated failure/);

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

/** Throws on timeout so a condition that flips after the wait cannot pass the assertion. */
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
