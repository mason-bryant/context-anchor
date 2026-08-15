import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_TELEMETRY_RETENTION_SETTINGS, telemetrySchemaNameFor } from "../../src/db/config.js";
import { createAnchorRuntime } from "../../src/runtime.js";
import type { ServerConfig } from "../../src/types.js";
import { removeTempDir } from "../tempDir.js";
import { createTestSchemas, dropRegisteredSchemas, isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

/**
 * That the server actually runs retention.
 *
 * The pass, the policy and the schedule are each covered on their own, and every one of them
 * could pass while nothing ever called start() — which is precisely the state T-41 describes:
 * a window the design promises and no running code applies. This is the wire, and it is the
 * part that fails silently.
 */
describe.runIf(await isTestDatabaseReachable())("runtime telemetry retention (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;
  let tmpDir: string;

  beforeEach(async () => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    schemaName = await createTestSchemas(adminPool);
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-retention-"));
  });

  afterEach(async () => {
    await dropRegisteredSchemas(adminPool);
    await adminPool.end();
    await removeTempDir(tmpDir);
  });

  const configWith = (intervalHours: number): ServerConfig => ({
    repoPath: tmpDir,
    anchorRoot: ".",
    autoSync: false,
    pushOnWrite: false,
    syncIntervalMs: 0,
    migrationWarnOnly: false,
    staleAfterDays: 45,
    graphScoring: { enabled: false, maxBoost: 8 },
    database: {
      poolSize: 3,
      schemaName,
      storeTaskText: true,
      telemetryRetention: { ...DEFAULT_TELEMETRY_RETENTION_SETTINGS, intervalHours },
    },
  });

  const runCount = async (): Promise<number> => {
    const result = await adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${telemetrySchemaNameFor(schemaName)}".telemetry_retention_runs`,
    );
    return Number(result.rows[0]!.n);
  };

  it("runs a retention pass when the server starts its background jobs", async () => {
    const runtime = await createAnchorRuntime(configWith(6), { databaseUrl: TEST_DATABASE_URL });
    try {
      expect(runtime.telemetryRetention).toBeDefined();
      expect(await runCount()).toBe(0);

      runtime.startBackgroundJobs();

      // A row in the run table is the end of the whole chain: config resolved a policy, the
      // runtime built a job from it, the job reached the facade, and the facade wrote SQL to the
      // telemetry schema. Nothing short of this distinguishes wired from merely constructed.
      await waitFor(async () => (await runCount()) === 1);
      expect(await runCount()).toBe(1);
    } finally {
      runtime.stopBackgroundJobs();
      await runtime.knowledgeDb?.close();
    }
  });

  it("builds no retention job at all without a database", async () => {
    // Git-only mode has no telemetry schema to thin. A job constructed anyway would fail its
    // first pass and log an error on every start for a server that is behaving correctly.
    const { database: _database, ...gitOnly } = configWith(6);
    const runtime = await createAnchorRuntime(gitOnly);
    try {
      expect(runtime.telemetryRetention).toBeUndefined();
      // Still safe to call, because both transports call it unconditionally.
      runtime.startBackgroundJobs();
    } finally {
      runtime.stopBackgroundJobs();
    }
  });
});

/** Throws on timeout so a condition that flips after the wait cannot pass the assertion. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition not met within ${String(timeoutMs)}ms`);
}
