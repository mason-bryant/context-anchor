import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { planRoutedBundle, reportRecordUse } from "../../src/db/routing/plan.js";
import { defaultRanker, type Ranker } from "../../src/db/routing/ranker.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL } from "./testDatabase.js";

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

describe.runIf(await isTestDatabaseReachable())("planRoutedBundle (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `route_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
        { scope: "rate-limiting", title: "Rate Limiting", kind: "practice", locators: [] },
      ],
    });
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const plan = (task: string, extra: Record<string, unknown> = {}) =>
    planRoutedBundle(pool, schemaName, telemetrySchema, {
      workspaceGuid: bootstrap.workspaceGuid,
      task,
      ...extra,
    });

  it("routes lexically and explains why", async () => {
    const result = await plan("add rate limiting");

    const route = result.routes.find((r) => r.routeKey === "scope:practice:rate-limiting");
    expect(route).toBeDefined();
    expect(route?.matchReasons.join(" ")).toMatch(/task term .* matched scope/);
  });

  it("routes a referenced path to its component", async () => {
    const result = await plan("change something", { referencedPaths: ["src/http/server.ts"] });

    const route = result.routes.find((r) => r.routeKey === "scope:component:http-transport");
    expect(route?.matchReasons.join(" ")).toMatch(/src\/http/);
  });

  // One hop only: a matched component offers its domain, and nothing offers a grandparent.
  it("offers the parent of a matched scope through one relation hop", async () => {
    const result = await plan("nothing lexical here", { referencedPaths: ["src/http/server.ts"] });

    const parent = result.routes.find((r) => r.routeKey === "scope:domain:anchor-mcp");
    expect(parent?.matchReasons.join(" ")).toMatch(/part of this scope/);
  });

  it("returns no routes when nothing matches", async () => {
    expect((await plan("kubernetes helm chart")).routes).toEqual([]);
  });

  it("expands within budget and lists the rest", async () => {
    const result = await plan("anchor mcp http transport rate limiting", { budget: { expanded: 1, listed: 10 } });

    expect(result.routes.filter((route) => route.expanded)).toHaveLength(1);
    expect(result.routes[0]?.expanded).toBe(true);
    expect(result.routes[0]?.records).toBeDefined();
    expect(result.routes[1]?.records).toBeUndefined();
  });

  // Expansion is stateless: the caller resupplies the task and names the routes it wants,
  // and an explicit request beats position.
  it("expands an explicitly requested route the budget would have listed", async () => {
    const first = await plan("anchor mcp http transport rate limiting", { budget: { expanded: 1, listed: 10 } });
    const listed = first.routes.find((route) => !route.expanded);
    expect(listed).toBeDefined();

    const second = await plan("anchor mcp http transport rate limiting", { routeKeys: [listed!.routeKey] });

    expect(second.routes.find((route) => route.routeKey === listed!.routeKey)?.expanded).toBe(true);
  });

  it("reports an unresolvable route key rather than returning it empty", async () => {
    const result = await plan("anchor mcp", { routeKeys: ["scope:domain:does-not-exist"] });

    const missing = result.routes.find((route) => route.routeKey === "scope:domain:does-not-exist");
    expect(missing?.unavailable).toMatch(/no live scope/);
  });

  it("expands records with typed section references and real content", async () => {
    const result = await plan("anchor mcp", { budget: { expanded: 5, listed: 10 } });

    const records = result.routes.flatMap((route) => route.records ?? []);
    expect(records.length).toBeGreaterThan(0);
    const record = records[0]!;
    expect(record.ref.type).toBe("section");
    if (record.ref.type === "section") {
      expect(record.ref.stableKey).toContain("#");
      expect(record.ref.documentGuid).toBeTruthy();
      expect(record.ref.revisionGuid).toBeTruthy();
    }
    expect(records.map((r) => r.content).join("")).toContain("bearer token");
  });

  // The budget bounds routes AND response size. A domain scope in a real workspace holds
  // hundreds of sections, so without a per-route cap one expanded route returns the whole
  // corpus — measured at 270 records for a single domain on a real anchor repository.
  it("caps records per expanded route and says the slice is partial", async () => {
    const result = await plan("anchor mcp", { budget: { expanded: 5, listed: 10, recordsPerRoute: 1 } });

    const expandedRoutes = result.routes.filter((route) => route.expanded);
    expect(expandedRoutes.length).toBeGreaterThan(0);
    for (const route of expandedRoutes) {
      expect(route.records?.length ?? 0).toBeLessThanOrEqual(1);
      if (route.recordCount > 1) {
        expect(route.recordsTruncated).toBe(true);
      }
    }
  });

  // The fingerprint answers "did this route's content move", so it must not change merely
  // because the caller asked for fewer records.
  it("fingerprints the whole route, not the truncated slice", async () => {
    const full = await plan("anchor mcp", { budget: { expanded: 5, listed: 10, recordsPerRoute: 50 } });
    const clipped = await plan("anchor mcp", { budget: { expanded: 5, listed: 10, recordsPerRoute: 1 } });

    expect(clipped.routes.map((r) => r.contentFingerprint)).toEqual(full.routes.map((r) => r.contentFingerprint));
  });

  // expanded greater than listed would offer more routes than the response and the stored
  // budget claim were offered, so a later reading of an impression disagrees with the
  // budget recorded beside it.
  it("normalizes a budget whose expanded exceeds listed", async () => {
    const result = await plan("anchor mcp http transport rate limiting", {
      budget: { expanded: 5, listed: 1, recordsPerRoute: 5 },
    });

    expect(result.budget.listed).toBeGreaterThanOrEqual(result.budget.expanded);
    expect(result.routes.length).toBeLessThanOrEqual(result.budget.listed);
  });

  it("is recomputed rather than cached, so two identical calls agree", async () => {
    const a = await plan("add rate limiting");
    const b = await plan("add rate limiting");

    expect(a.routes.map((r) => r.routeKey)).toEqual(b.routes.map((r) => r.routeKey));
    expect(a.routes.map((r) => r.contentFingerprint)).toEqual(b.routes.map((r) => r.contentFingerprint));
    // A fresh request id every time: it correlates telemetry and is never an input.
    expect(a.requestId).not.toBe(b.requestId);
  });

  describe("telemetry", () => {
    it("records one request and one impression per offered route", async () => {
      const result = await plan("anchor mcp http transport rate limiting");

      const requests = await pool.query(
        `SELECT task_text, task_hash, ranker_id, ranker_deterministic FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
        [result.requestId],
      );
      expect(requests.rows[0]).toMatchObject({ ranker_id: "precedence", ranker_deterministic: true });
      // Opt-in, because expansion is stateless and nothing reads the task back.
      expect(requests.rows[0]?.task_text).toBeNull();
      expect(requests.rows[0]?.task_hash).toHaveLength(64);

      const impressions = await pool.query<{ route_key: string; offered_position: number }>(
        `SELECT route_key, offered_position FROM "${telemetrySchema}".retrieval_route_impressions
          WHERE request_guid = $1 AND is_shadow = false ORDER BY offered_position`,
        [result.requestId],
      );
      expect(impressions.rows.map((row) => row.route_key)).toEqual(result.routes.map((route) => route.routeKey));
    });

    // Storing only `expanded` left later analysis unable to say which response-size cap was
    // in effect, which is exactly what an impression has to be interpreted against.
    it("stores the whole budget, not just the expanded count", async () => {
      const result = await plan("anchor mcp", { budget: { expanded: 3, listed: 7, recordsPerRoute: 4 } });

      const stored = await pool.query<{ route_budget: unknown }>(
        `SELECT route_budget FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
        [result.requestId],
      );
      expect(stored.rows[0]?.route_budget).toEqual({ expanded: 3, listed: 7, recordsPerRoute: 4 });
    });

    // Every timestamp for one request should agree; a fresh Date inside the impression write
    // also defeats a fixed clock in tests.
    it("timestamps impressions with the request's clock", async () => {
      const fixed = new Date("2026-01-02T03:04:05.000Z");
      const result = await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        { workspaceGuid: bootstrap.workspaceGuid, task: "anchor mcp" },
        { now: () => fixed },
      );

      const rows = await pool.query<{ created_at: Date; expanded_at: Date | null }>(
        `SELECT r.created_at, i.expanded_at
           FROM "${telemetrySchema}".retrieval_requests r
           JOIN "${telemetrySchema}".retrieval_route_impressions i ON i.request_guid = r.request_guid
          WHERE r.request_guid = $1 AND i.expanded_at IS NOT NULL`,
        [result.requestId],
      );
      expect(rows.rowCount).toBeGreaterThan(0);
      for (const row of rows.rows) {
        expect(row.created_at.toISOString()).toBe(fixed.toISOString());
        expect(row.expanded_at?.toISOString()).toBe(fixed.toISOString());
      }
    });

    it("stores the task text only when asked", async () => {
      const result = await plan("add rate limiting", { storeTaskText: true });

      const stored = await pool.query<{ task_text: string }>(
        `SELECT task_text FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
        [result.requestId],
      );
      expect(stored.rows[0]?.task_text).toBe("add rate limiting");
    });

    // The mechanism that turns the count-versus-strength question into a measurement.
    it("records a shadow ranker's ordering without letting it change the answer", async () => {
      const reversed: Ranker = {
        id: "reversed",
        version: "9.9.9",
        deterministic: true,
        rank: (candidates) =>
          Promise.resolve([...candidates].reverse().map((c, index) => ({ ...c, offeredPosition: index }))),
      };

      const result = await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        { workspaceGuid: bootstrap.workspaceGuid, task: "anchor mcp http transport rate limiting" },
        { ranker: defaultRanker, shadowRankers: [reversed] },
      );

      const live = await pool.query<{ route_key: string }>(
        `SELECT route_key FROM "${telemetrySchema}".retrieval_route_impressions
          WHERE request_guid = $1 AND is_shadow = false ORDER BY offered_position`,
        [result.requestId],
      );
      const shadow = await pool.query<{ route_key: string; expanded_at: string | null }>(
        `SELECT route_key, expanded_at FROM "${telemetrySchema}".retrieval_route_impressions
          WHERE request_guid = $1 AND is_shadow = true ORDER BY offered_position`,
        [result.requestId],
      );

      expect(live.rows.map((r) => r.route_key)).toEqual(result.routes.map((r) => r.routeKey));
      expect(shadow.rows.map((r) => r.route_key)).toEqual([...live.rows.map((r) => r.route_key)].reverse());
      // A shadow ordering expanded nothing; recording otherwise would make it look like the
      // caller saw it.
      expect(shadow.rows.every((row) => row.expanded_at === null)).toBe(true);
    });

    // A shadow ranker that fails falls back to the default, so it reports the *same*
    // ranker id and version as the live ordering. Without is_shadow in the uniqueness key
    // those rows collide with the live ones and vanish — losing shadow telemetry precisely
    // when a shadow ranker misbehaved, which is when it is most worth having.
    it("records a shadow ordering even when the shadow ranker fell back to the default", async () => {
      const failing: Ranker = {
        id: "flaky",
        version: "1.0.0",
        deterministic: false,
        rank: () => Promise.reject(new Error("model unavailable")),
      };

      const result = await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        { workspaceGuid: bootstrap.workspaceGuid, task: "anchor mcp http transport rate limiting" },
        { ranker: defaultRanker, shadowRankers: [failing] },
      );

      const shadow = await pool.query(
        `SELECT 1 FROM "${telemetrySchema}".retrieval_route_impressions
          WHERE request_guid = $1 AND is_shadow = true`,
        [result.requestId],
      );
      expect(shadow.rowCount).toBeGreaterThan(0);
    });

    it("records record uses against the request", async () => {
      const result = await plan("anchor mcp", { budget: { expanded: 5, listed: 10 } });
      const usedRoute = result.routes.find((route) => (route.records?.length ?? 0) > 0)!;
      const record = usedRoute.records![0]!;
      if (record.ref.type !== "section") {
        throw new Error("expected a section record");
      }

      const { recorded } = await reportRecordUse(pool, telemetrySchema, {
        requestId: result.requestId,
        refs: [
          { type: "section", guid: record.ref.guid, stableKey: record.ref.stableKey, routeKey: usedRoute.routeKey },
        ],
        useKind: "cited",
      });

      expect(recorded).toBe(1);
      const uses = await pool.query<{ stable_key: string; use_kind: string }>(
        `SELECT stable_key, use_kind FROM "${telemetrySchema}".retrieval_record_uses WHERE request_guid = $1`,
        [result.requestId],
      );
      expect(uses.rows[0]).toMatchObject({ stable_key: record.ref.stableKey, use_kind: "cited" });
    });

    // Without an impression, a use cannot be attributed to the route that served it — and
    // a record can belong to several offered routes at once, so the attribution is not
    // recoverable afterwards. This is what makes "where would another ranker have placed
    // the records the caller used" answerable at all.
    it("attributes a record use to the live impression that served it", async () => {
      const result = await plan("anchor mcp", { budget: { expanded: 5, listed: 10 } });
      const usedRoute = result.routes.find((route) => (route.records?.length ?? 0) > 0)!;
      const record = usedRoute.records![0]!;
      if (record.ref.type !== "section") {
        throw new Error("expected a section record");
      }

      await reportRecordUse(pool, telemetrySchema, {
        requestId: result.requestId,
        refs: [
          { type: "section", guid: record.ref.guid, stableKey: record.ref.stableKey, routeKey: usedRoute.routeKey },
        ],
        useKind: "cited",
      });

      const attributed = await pool.query<{ route_key: string; is_shadow: boolean }>(
        `SELECT i.route_key, i.is_shadow
           FROM "${telemetrySchema}".retrieval_record_uses u
           JOIN "${telemetrySchema}".retrieval_route_impressions i ON i.impression_guid = u.impression_guid
          WHERE u.request_guid = $1`,
        [result.requestId],
      );
      expect(attributed.rows[0]).toMatchObject({ route_key: usedRoute.routeKey, is_shadow: false });
    });

    // "recorded: 1" that means "recorded, but unattributable" is the quiet wrongness this
    // whole mechanism exists to avoid: the row is useless for the one question uses are
    // recorded to answer, and the caller is told it succeeded.
    it("refuses a use whose routeKey was never offered, rather than storing it unattributed", async () => {
      const result = await plan("anchor mcp", { budget: { expanded: 5, listed: 10 } });
      const usedRoute = result.routes.find((route) => (route.records?.length ?? 0) > 0)!;
      const record = usedRoute.records![0]!;
      if (record.ref.type !== "section") {
        throw new Error("expected a section record");
      }

      const outcome = await reportRecordUse(pool, telemetrySchema, {
        requestId: result.requestId,
        refs: [
          {
            type: "section",
            guid: record.ref.guid,
            stableKey: record.ref.stableKey,
            routeKey: "scope:domain:never-offered",
          },
        ],
        useKind: "cited",
      });

      expect(outcome.recorded).toBe(0);
      expect(outcome.rejected).toEqual([
        { routeKey: "scope:domain:never-offered", reason: "route was not offered on this request" },
      ]);
      const stored = await pool.query(
        `SELECT 1 FROM "${telemetrySchema}".retrieval_record_uses WHERE request_guid = $1`,
        [result.requestId],
      );
      expect(stored.rowCount).toBe(0);
    });

    // Two live rankers on one request is what A3 is designed to allow, and the uniqueness
    // key permits it. An unguarded scalar subquery would throw "more than one row returned
    // by a subquery" at that point — in a telemetry path, at runtime.
    it("attributes to the authoritative ranker when several live orderings exist", async () => {
      const result = await plan("anchor mcp", { budget: { expanded: 5, listed: 10 } });
      const usedRoute = result.routes.find((route) => (route.records?.length ?? 0) > 0)!;
      const record = usedRoute.records![0]!;
      if (record.ref.type !== "section") {
        throw new Error("expected a section record");
      }

      // A second non-shadow impression for the same route, as a different ranker.
      await pool.query(
        `INSERT INTO "${telemetrySchema}".retrieval_route_impressions
           (impression_guid, request_guid, ranker_id, ranker_version, is_shadow, route_key,
            subject_type, offered_position, record_count)
         VALUES (gen_random_uuid(), $1, 'other', '1.0.0', false, $2, 'scope', 0, 0)`,
        [result.requestId, usedRoute.routeKey],
      );

      const outcome = await reportRecordUse(pool, telemetrySchema, {
        requestId: result.requestId,
        refs: [
          { type: "section", guid: record.ref.guid, stableKey: record.ref.stableKey, routeKey: usedRoute.routeKey },
        ],
        useKind: "cited",
      });

      expect(outcome.recorded).toBe(1);
      const attributed = await pool.query<{ ranker_id: string }>(
        `SELECT i.ranker_id FROM "${telemetrySchema}".retrieval_record_uses u
           JOIN "${telemetrySchema}".retrieval_route_impressions i ON i.impression_guid = u.impression_guid
          WHERE u.request_guid = $1`,
        [result.requestId],
      );
      expect(attributed.rows[0]?.ranker_id).toBe("precedence");
    });

    // A use for a request that never happened is a caller mistake, not a row worth keeping.
    it("ignores a record use for an unknown request", async () => {
      const { recorded } = await reportRecordUse(pool, telemetrySchema, {
        requestId: randomUUID(),
        refs: [{ type: "section", guid: randomUUID(), stableKey: "doc#x", routeKey: "scope:domain:anchor-mcp" }],
        useKind: "cited",
      });

      expect(recorded).toBe(0);
    });

    // An unknown request and an unofferred route are different answers. Reporting the
    // former as "route was not offered" blames a route that may have been perfectly valid,
    // and would return one such rejection per ref.
    it("ignores an unknown request without inventing route rejections", async () => {
      const outcome = await reportRecordUse(pool, telemetrySchema, {
        requestId: randomUUID(),
        refs: [
          { type: "section", guid: randomUUID(), stableKey: "doc#a", routeKey: "scope:domain:anchor-mcp" },
          { type: "section", guid: randomUUID(), stableKey: "doc#b", routeKey: "scope:domain:anchor-mcp" },
        ],
        useKind: "cited",
      });

      expect(outcome).toEqual({ recorded: 0, rejected: [] });
    });
  });
});
