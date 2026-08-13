import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { AnchorRepository } from "../../src/git/repo.js";
import { startHttpServer } from "../../src/http/server.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL, testSchemaName } from "./testDatabase.js";
import { removeTempDir } from "../tempDir.js";

const TOKEN = "test-token";

// "Decisions" is a section heading and names no scope, which is the shape of task the
// record-lexical signal exists for: without it the routed planner reaches nothing at all.
const HTTP_DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token.

## Decisions

- Rate limiting belongs in the transport.
`;

describe.runIf(await isTestDatabaseReachable())("the comparison gate's HTTP routes (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let tmpDir: string;
  let server: Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    schemaName = testSchemaName("compare_test");
    telemetrySchema = telemetrySchemaNameFor(schemaName);
    await migrateAllSchemas(adminPool, schemaName);
    // The routed planner needs a workspace and owner principal to plan against.
    const bootstrap = await ensureBootstrap(adminPool, { schemaName });

    // Scopes and a document, because an empty workspace routes nowhere either way: the two
    // routed answers would agree trivially and every assertion about the signal would pass
    // without the signal existing.
    await importDocuments({
      pool: adminPool,
      schemaName,
      handler: new CommandHandler(adminPool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "a".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: HTTP_DOC }],
      scopes: [
        { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] },
        {
          scope: "http-transport",
          title: "HTTP Transport",
          kind: "component",
          partOf: "anchor-mcp",
          locators: [{ repository: "context-anchor", pathPrefix: "src/http" }],
        },
      ],
    });

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

  type Routed = {
    requestId: string;
    candidateCount: number;
    appliedSignals: { recordLexical: boolean };
    budget: { expanded: number; listed: number; recordsPerRoute: number };
    routes: Array<{ routeKey: string; matchReasons: string[] }>;
  };
  type Body = {
    routed?: Routed | null;
    routedRecordLexical?: Routed | null;
    legacy?: { projectResolution?: unknown } | null;
    failures?: Record<string, { error: string } | null>;
    error?: string;
  };

  /**
   * The record-lexical signal is the open question T8 has to answer: it rescues tasks that name
   * no scope from reaching nothing at all, but widens one real task from 2 routes to 15 of 23
   * scopes, and nobody has judged whether the added routes are relevant. Only a person reading
   * signal-on beside signal-off for the same task can say, so the gate has to serve both.
   */
  describe("the record-lexical variant", () => {
    it("answers the same task a second time with the signal on, and reaches what the baseline could not", async () => {
      // Matches a section heading and no scope name, which is precisely the case the signal
      // exists for — so signal-off and signal-on cannot agree by accident here.
      const response = await get("?task=decisions");

      expect(response.status).toBe(200);
      const body = (await response.json()) as Body;
      // The existing key keeps its existing meaning: still the signal-off answer, which for
      // this task is nothing at all.
      expect(body.routed?.routes).toEqual([]);
      expect(body.routedRecordLexical).toBeDefined();
      expect(body.routedRecordLexical!.routes.length).toBeGreaterThan(0);
      // Matched on a heading rather than on a scope name, which is what proves the signal was
      // actually enabled rather than the two calls differing for some other reason.
      expect(body.routedRecordLexical!.routes.flatMap((route) => route.matchReasons).join(" ")).toMatch(
        /matched section title/,
      );
    });

    /**
     * Every routed call writes a live retrieval request and one impression per offered route.
     * Under one tag the two populations blend, and because the signal-on routes are offered but
     * seldom expanded they would drag expansionByPosition down with routes nobody could have
     * expanded — the very number T8 is judged on. `consumer` is the only column that can tell
     * the rows apart afterwards.
     */
    it("records the two routed calls under different consumer tags", async () => {
      const body = (await (await get("?task=decisions")).json()) as Body;
      const signalOff = body.routed!.requestId;
      const signalOn = body.routedRecordLexical!.requestId;

      // Two planner calls, not one answer echoed twice; the tags below would be meaningless
      // if both keys named the same telemetry request.
      expect(signalOn).not.toBe(signalOff);
      const rows = await adminPool.query<{ request_guid: string; consumer: string | null }>(
        `SELECT request_guid, consumer FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = ANY($1)`,
        [[signalOff, signalOn]],
      );
      const consumerOf = new Map(rows.rows.map((row) => [row.request_guid, row.consumer]));
      expect(consumerOf.get(signalOff)).toBe("comparison-gate");
      expect(consumerOf.get(signalOn)).toBe("comparison-gate-record-lexical");
    });

    // The UI reads `routed` and `legacy`, and the point of adding a third answer is that the
    // first two keep meaning what they meant.
    it("leaves the routed and legacy answers unchanged", async () => {
      const response = await get(`?task=${encodeURIComponent("anchor mcp")}&paths=projects/demo/demo-context.md`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Body;
      // Asserted before the routes are read: the UI reads this key by name, so a renamed or
      // missing `routed` has to fail as itself rather than as an odd matcher error further down.
      expect(body.routed).toBeDefined();
      // A task that names a scope routes without any signal at all.
      expect(body.routed!.routes.map((route) => route.routeKey)).toContain("scope:domain:anchor-mcp");
      expect(body.legacy?.projectResolution).toBeDefined();
    });
  });

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

  // The same fairness argument as the legacy baseline above, applied between the two routed
  // panes — and it matters more here, because these two are read as differing in exactly one
  // thing. Path mapping is the strongest signal kind, so a pane quietly denied referencedPaths
  // would produce a worse answer for a reason that has nothing to do with recordLexical, and a
  // person judging the difference would attribute it to the signal.
  it("gives the record-lexical pane the same evidence as the routed baseline", async () => {
    // Deliberately a task whose words match no scope name, so the ONLY way either pane reaches
    // the scope is the path. With "anchor mcp" the scope is reachable lexically too, and the
    // assertion below passes whether or not the record-lexical pane was given the paths --
    // which is exactly the vacuous shape this test exists to rule out.
    const response = await get(`?task=${encodeURIComponent("qqzz unrelated")}&paths=src/http/server.ts`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.routed).toBeDefined();
    expect(body.routedRecordLexical).toBeDefined();

    // The path-mapped scope has to appear on both sides. recordLexical only ever adds routes,
    // so anything the baseline reached on path evidence must still be reachable with it on.
    const routedKeys = (body.routed?.routes ?? []).map((route) => route.routeKey);
    const lexicalKeys = (body.routedRecordLexical?.routes ?? []).map((route) => route.routeKey);
    expect(routedKeys.length).toBeGreaterThan(0);
    for (const key of routedKeys) {
      expect(lexicalKeys).toContain(key);
    }
  });

  // A flag that silently stopped being applied is the worst failure this surface has, because it
  // does not look like a failure: both panes render the same answer, the diff reports nothing
  // added, and a reader records "the signal changes nothing" for every task they try.
  it("reports which signals were actually applied, on both panes", async () => {
    const response = await get(`?task=${encodeURIComponent("decisions")}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(body.routed?.appliedSignals).toEqual({ recordLexical: false });
    expect(body.routedRecordLexical?.appliedSignals).toEqual({ recordLexical: true });
  });

  // Route counts saturate at the budget, and the widening this gate exists to measure is exactly
  // the case that saturates: without the candidate count, a signal that matched fourteen scopes
  // and one that matched forty are indistinguishable on screen.
  it("reports how many candidates selection produced, not only how many survived the budget", async () => {
    const response = await get(`?task=${encodeURIComponent("decisions")}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Body;
    expect(typeof body.routedRecordLexical?.candidateCount).toBe("number");

    // Both panes must be given the same budget, for the same reason they must be given the same
    // paths: a difference in what they were allowed to return would read as a difference the
    // signal caused. Asserted on the echoed budget rather than trusting the call site.
    expect(body.routed?.budget.listed).toBe(body.routedRecordLexical?.budget.listed);
    // Above the default, because at the default the pane saturates: the widening this gate
    // exists to measure is exactly the case that hits the cap.
    expect(body.routed?.budget.listed).toBeGreaterThan(10);

    // Raised with it. Only expanded routes carry records, and a route the signal adds carries
    // only the weakest signal kind, so it sorts below every baseline route: at the default of
    // two, both slots go to routes that did not change and every route actually under judgment
    // renders with no records at all.
    expect(body.routed?.budget.expanded).toBeGreaterThan(2);
    expect(body.routed?.budget.expanded).toBe(body.routedRecordLexical?.budget.expanded);
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
