import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap } from "../../src/db/bootstrap.js";
import { AnchorRepository } from "../../src/git/repo.js";
import { startHttpServer } from "../../src/http/server.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL } from "./testDatabase.js";
import { removeTempDir } from "../tempDir.js";

const TOKEN = "test-token";

describe.runIf(await isTestDatabaseReachable())("the comparison gate's HTTP routes (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;
  let tmpDir: string;
  let server: Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    schemaName = `compare_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await migrateAllSchemas(adminPool, schemaName);
    // The routed planner needs a workspace and owner principal to plan against.
    await ensureBootstrap(adminPool, { schemaName });

    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-comparison-"));
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    // A path only resolves to a candidate project when the registry maps it, and an
    // unresolved path leaves projectResolution absent — which would make the assertion below
    // pass for the wrong reason.
    await repo.writeProjectMappingsRaw({
      projects: [{ project: "demo", repos: [{ repo: "demo-repo", paths: ["projects/demo"] }] }],
    });

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
    // dropAllSchemas, not a bare DROP: migrateAllSchemas also creates a separate telemetry
    // schema, and dropping only the knowledge one leaves it behind to accumulate across runs.
    await dropAllSchemas(adminPool, schemaName);
    await adminPool.end();
    await removeTempDir(tmpDir);
  });

  function get(query: string) {
    return fetch(`${baseUrl}/api/db/comparison${query}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }

  type Body = { legacy?: { projectResolution?: unknown }; error?: string };

  // The gate exists to decide whether routed retrieval beats the baseline, so any signal the
  // caller supplies has to reach both sides. Handing paths only to the routed planner would
  // make it win on evidence the baseline never received, and the resulting verdict would
  // describe the handicap rather than the retrieval.
  it("gives the caller's paths to the legacy baseline, not only to the routed planner", async () => {
    const response = await get(`?task=${encodeURIComponent("routing")}&paths=projects/demo/demo-context.md`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    // Only populated when the legacy planner actually received a repo or path signal.
    expect(body.legacy?.projectResolution).toBeDefined();
  });

  // Express turns a repeated key into an array, and the hand-rolled parser this replaces read
  // that as "no paths at all" — silently discarding the signal on the one endpoint whose
  // purpose is a fair comparison. Refusing is the only honest answer to an ambiguous request.
  it("refuses a repeated paths parameter instead of silently dropping it", async () => {
    const response = await get(`?task=routing&paths=projects/a.md&paths=projects/b.md`);

    expect(response.status).toBe(400);
    const body = (await response.json()) as Body;
    expect(body.error).toMatch(/paths/);
  });

  function getDiagnostics(query: string) {
    return fetch(`${baseUrl}/api/db/routing-diagnostics${query}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  }

  // Same ambiguity as a repeated `paths`, on the endpoint whose job is to report honestly:
  // serving the default window to someone who asked for a different one is a wrong answer
  // delivered as a successful one.
  it("refuses a repeated days parameter instead of defaulting the window", async () => {
    const response = await getDiagnostics("?days=7&days=90");

    expect(response.status).toBe(400);
    expect(((await response.json()) as Body).error).toMatch(/days/);
  });

  // parseInt stops at the first non-digit, so "10abc" would have been honoured as 10.
  it("refuses a partially numeric days value", async () => {
    const response = await getDiagnostics("?days=10abc");

    expect(response.status).toBe(400);
    expect(((await response.json()) as Body).error).toMatch(/days/);
  });

  // Behaviour-pinning rather than falsifying: the legacy planner already ignores blank entries,
  // so this documents that a blanks-only value resolves to no signal on both sides instead of
  // offering either planner an empty path to resolve.
  it("treats a blanks-only paths value as no paths", async () => {
    const response = await get(`?task=routing&paths=${encodeURIComponent(" , ,")}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.legacy?.projectResolution).toBeUndefined();
  });
});
