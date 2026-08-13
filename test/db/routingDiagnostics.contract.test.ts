
import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { routingDiagnostics } from "../../src/db/comparison.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { planRoutedBundle, reportRecordUse } from "../../src/db/routing/plan.js";
import { defaultRanker, type Ranker } from "../../src/db/routing/ranker.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL, testSchemaName } from "./testDatabase.js";

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token.

## Decisions

- Rate limiting belongs in the transport.
`;

describe.runIf(await isTestDatabaseReachable())("routing diagnostics (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("diag_test");
    telemetrySchema = telemetrySchemaNameFor(schemaName);
    await migrateAllSchemas(pool, schemaName);
    bootstrap = await ensureBootstrap(pool, { schemaName });

    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "a".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      scopes: [
        { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] },
        { scope: "rate-limiting", title: "Rate Limiting", kind: "practice", locators: [] },
      ],
    });
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const plan = (task: string, extra: Record<string, unknown> = {}, options = {}) =>
    planRoutedBundle(
      pool,
      schemaName,
      telemetrySchema,
      {
        task,
        ...extra,
        workspaceGuid: bootstrap.workspaceGuid,
        principalGuid: bootstrap.ownerPrincipalGuid,
        role: "owner",
      },
      options,
    );

  const diagnostics = () => routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid);

  it("reports nothing rather than failing on an empty workspace", async () => {
    const result = await diagnostics();

    expect(result.totals).toEqual({ requests: 0, routesOffered: 0, routesExpanded: 0, recordUses: 0 });
    expect(result.neverExpanded).toEqual([]);
    expect(result.expansionByPosition).toEqual([]);
  });

  it("counts requests, offers, and expansions", async () => {
    await plan("anchor mcp rate limiting", { budget: { expanded: 1, listed: 10, recordsPerRoute: 5 } });

    const result = await diagnostics();

    expect(result.totals.requests).toBe(1);
    expect(result.totals.routesOffered).toBeGreaterThan(1);
    expect(result.totals.routesExpanded).toBe(1);
  });

  // A condition nobody ever acts on is a condition that reads wrong, which is exactly what
  // the gate is meant to make visible rather than leave to be inferred.
  it("names routes offered but never expanded", async () => {
    await plan("anchor mcp rate limiting", { budget: { expanded: 1, listed: 10, recordsPerRoute: 5 } });

    const result = await diagnostics();

    expect(result.neverExpanded.length).toBeGreaterThan(0);
    expect(result.neverExpanded.every((row) => row.offered > 0)).toBe(true);
    expect(result.neverExpanded[0]?.lastOfferedAt).not.toBeNull();
  });

  it("reports expansion rate by offered position", async () => {
    await plan("anchor mcp rate limiting", { budget: { expanded: 1, listed: 10, recordsPerRoute: 5 } });

    const result = await diagnostics();

    const first = result.expansionByPosition.find((row) => row.position === 0);
    expect(first?.expanded).toBe(1);
    expect(first?.rate).toBe(1);
    const second = result.expansionByPosition.find((row) => row.position === 1);
    expect(second?.expanded).toBe(0);
    expect(second?.rate).toBe(0);
  });

  // A shadow ordering was never shown to anyone, so counting it as offered-and-not-expanded
  // would blame a route for a choice no caller ever saw.
  it("ignores shadow orderings entirely", async () => {
    const shadow: Ranker = {
      id: "shadow",
      version: "1.0.0",
      deterministic: true,
      rank: (candidates) =>
        Promise.resolve(
          [...candidates]
            .sort((left, right) => right.scopeSlug.localeCompare(left.scopeSlug))
            .map((c, index) => ({ ...c, offeredPosition: index })),
        ),
    };

    await plan(
      "anchor mcp rate limiting",
      { budget: { expanded: 1, listed: 10, recordsPerRoute: 5 } },
      { ranker: defaultRanker, shadowRankers: [shadow] },
    );

    const withShadow = await diagnostics();
    const live = await pool.query<{ count: string }>(
      `SELECT count(*) FROM "${telemetrySchema}".retrieval_route_impressions WHERE is_shadow = false`,
    );

    expect(withShadow.totals.routesOffered).toBe(Number(live.rows[0]!.count));
  });

  // A route whose records are served and never used is dead weight in every bundle it
  // appears in, which is the second thing a reader needs the gate to surface.
  it("names expanded routes whose records were never used, and drops them once used", async () => {
    const first = await plan("anchor mcp", { budget: { expanded: 5, listed: 10, recordsPerRoute: 5 } });

    const before = await diagnostics();
    expect(before.neverUsed.length).toBeGreaterThan(0);
    // Counted over expansions, not offers: a route that was never expanded served no records,
    // so calling it "unused" would blame it for records it never had the chance to supply.
    expect(before.neverUsed.every((row) => row.expanded > 0)).toBe(true);

    const route = first.routes.find((r) => (r.records?.length ?? 0) > 0)!;
    const record = route.records![0]!;
    await reportRecordUse(pool, telemetrySchema, {
      requestId: first.requestId,
      refs: [
        record.ref.type === "section"
          ? { type: "section", guid: record.ref.guid, stableKey: record.ref.stableKey, routeKey: route.routeKey }
          : { type: "assertion", guid: record.ref.guid, routeKey: route.routeKey },
      ],
      useKind: "cited",
    });

    const after = await diagnostics();
    expect(after.totals.recordUses).toBe(1);
    expect(after.neverUsed.map((row) => row.routeKey)).not.toContain(route.routeKey);
  });

  // A negative window makes `now() - interval` reach into the future, so the report comes back
  // empty — indistinguishable from a workspace where nothing was ever retrieved. The HTTP route
  // validates today, but this is the function every future caller reaches for.
  // The comparison gate plans a task purely to show a person two answers. Nobody acts on those
  // routes, and the gate renders these diagnostics on the same screen — so without this the
  // reader is watching numbers they are themselves generating, and "which routes are dead
  // weight" answers with routes only the panel ever offered. Twenty-five judged tasks produce
  // over a thousand such impressions, which is more traffic than the workspace sees in normal
  // use.
  it("excludes the comparison gate's own traffic, which is the instrument and not the retrieval", async () => {
    await plan("anchor mcp", { consumer: "comparison-gate" });
    await plan("anchor mcp", { consumer: "comparison-gate-record-lexical" });

    expect((await diagnostics()).totals.requests).toBe(0);

    // A real caller on the same workspace is still counted, so this excludes the instrument
    // rather than simply reporting nothing.
    await plan("anchor mcp", { consumer: "agent" });
    const after = await diagnostics();
    expect(after.totals.requests).toBe(1);
    expect(after.totals.routesOffered).toBeGreaterThan(0);
  });

  // The exclusion has to hold on every query, not most of them. Stripping it from six of the
  // seven left the suite green, because the only assertion was on totals.requests -- so the
  // stated invariant, that the totals and the per-route tables describe the same population,
  // had no test at all. That disagreement would read as a fault in the retrieval rather than in
  // the report.
  it("excludes gate traffic from every diagnostic, not only the request count", async () => {
    await plan("anchor mcp", { consumer: "comparison-gate" });
    await plan("anchor mcp", { consumer: "comparison-gate-record-lexical" });

    // Every table has to be reachable for this to test all seven predicates. record_uses needs a
    // reported use, and neverExpanded needs a route offered beyond the expanded budget -- without
    // both, those two exclusions could be deleted with the suite still green, which is exactly
    // the partial-exclusion failure the shared constant exists to prevent.
    // Two gate plans, because no single one reaches every table: neverExpanded needs a route
    // offered and not expanded, while record_uses needs an expanded route that carried records.
    // Without both, those two exclusions could be deleted with the suite still green -- the
    // partial-exclusion failure the shared constant exists to prevent.
    // A task whose routes do not overlap the one below: neverExpanded groups by route key with
    // HAVING "never expanded", so a route left unexpanded here but expanded there disappears from
    // that table entirely and the predicate goes untested.
    await plan("rate limiting", {
      consumer: "comparison-gate",
      budget: { expanded: 0, listed: 10, recordsPerRoute: 5 },
    });

    const gate = await plan("anchor mcp", {
      consumer: "comparison-gate-record-lexical",
      budget: { expanded: 5, listed: 10, recordsPerRoute: 5 },
    });
    const route = gate.routes.find((r) => (r.records?.length ?? 0) > 0)!;
    expect(route).toBeDefined();
    const record = route.records![0]!;
    await reportRecordUse(pool, telemetrySchema, {
      requestId: gate.requestId,
      refs: [
        record.ref.type === "section"
          ? { type: "section", guid: record.ref.guid, stableKey: record.ref.stableKey, routeKey: route.routeKey }
          : { type: "assertion", guid: record.ref.guid, routeKey: route.routeKey },
      ],
      useKind: "cited",
    });

    const diag = await diagnostics();
    expect(diag.totals).toEqual({ requests: 0, routesOffered: 0, routesExpanded: 0, recordUses: 0 });
    expect(diag.neverExpanded).toEqual([]);
    expect(diag.expansionByPosition).toEqual([]);
    expect(diag.neverUsed).toEqual([]);
  });

  it("refuses a window that is not a positive integer", async () => {
    await expect(
      routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid, { sinceDays: -5 }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid, { sinceDays: 1.5 }),
    ).rejects.toThrow(/positive integer/);
  });

  // JSON.stringify renders NaN as "null", so the likeliest bad input would have been reported
  // as the one value it is not — and "received null" sends a reader looking for a missing field.
  it("names NaN as NaN when refusing a window", async () => {
    await expect(
      routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid, { sinceDays: Number.NaN }),
    ).rejects.toThrow(/received NaN/);
  });

  it("excludes activity outside the window", async () => {
    await plan("anchor mcp", { budget: { expanded: 1, listed: 10, recordsPerRoute: 5 } });
    await pool.query(`UPDATE "${telemetrySchema}".retrieval_requests SET created_at = now() - interval '90 days'`);

    const recent = await routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid, { sinceDays: 30 });
    const wide = await routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid, { sinceDays: 365 });

    expect(recent.totals.requests).toBe(0);
    expect(wide.totals.requests).toBe(1);
  });
});
