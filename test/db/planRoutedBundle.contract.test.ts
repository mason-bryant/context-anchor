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
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL, testSchemaName } from "./testDatabase.js";

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

/**
 * Record-lexical reasons only. Scope-name matching emits `task term "x" matched scope slug`
 * (or `title`/`alias` — the field that matched, not its value),
 * which shares the "task term" prefix, so filtering on that alone mixes two signals — and
 * `anchor-mcp` carries the alias `context-conductor`, so a task containing "context" really can
 * produce both. A test asserting a term is absent from record-lexical evidence would then pass
 * or fail on the wrong signal.
 */
const recordLexicalReasons = (routes: Array<{ matchReasons: string[] }>): string[] =>
  routes.flatMap((route) => route.matchReasons).filter((reason) => / title[s]?[ :]/.test(reason));

describe.runIf(await isTestDatabaseReachable())("planRoutedBundle (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("route_test");
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
    // Identity last, so a stray key in `extra` cannot quietly change who is planning; the
    // helper's whole claim is "as the owner".
    planRoutedBundle(pool, schemaName, telemetrySchema, {
      ...extra,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      task,
    });

  it("routes lexically and explains why", async () => {
    const result = await plan("add rate limiting");

    const route = result.routes.find((r) => r.routeKey === "scope:practice:rate-limiting");
    expect(route).toBeDefined();
    expect(route?.matchReasons.join(" ")).toMatch(/task term .* matched scope/);
  });

  /**
   * T-46. Lexical selection saw only a scope's slug, title and aliases, so a task phrased the way
   * people actually phrase tasks reached nothing at all (T-45). This widens the entry point to
   * the titles of records inside a scope — and deliberately no further.
   */
  describe("record-lexical signal", () => {
    it("is off unless asked for, so a heading match alone routes nowhere", async () => {
      expect((await plan("decisions")).routes).toEqual([]);
    });

    it("routes a task that names no scope, once enabled", async () => {
      const result = await plan("decisions", { recordLexical: true });

      expect(result.routes.length).toBeGreaterThan(0);
      // Pinned to the whole sentence, not a prefix. `/matched section title/` matched both the
      // reason that named no heading and the one that names it, so it could not have noticed
      // either change to this string.
      expect(result.routes.flatMap((r) => r.matchReasons).join(" ")).toContain(
        'task term "decisions" matched section title "Decisions" in this scope',
      );
    });

    // stable_key is revision-stable, so every revision of a document contributes its sections
    // unless the query says otherwise. loadRouteRecords already takes the highest revision per
    // stable key for exactly this reason; without the same treatment a heading that a later
    // commit deleted keeps routing forever, and the workspace can never be corrected by editing.
    it("reads the current revision only, not headings a later commit removed", async () => {
      await importDocuments({
        pool,
        schemaName,
        handler: new CommandHandler(pool, schemaName),
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        repository: "agent-context",
        commitSha: "b".repeat(40),
        files: [
          {
            path: "projects/anchor-mcp/anchor-mcp-project-context.md",
            content: HTTP_DOC.replace("## Decisions", "## Tradeoffs"),
          },
        ],
      });

      expect((await plan("decisions", { recordLexical: true })).routes).toEqual([]);
      // The replacement heading routes, so the document is still indexed — this is about which
      // revision is read, not about the document having dropped out entirely.
      expect((await plan("tradeoffs", { recordLexical: true })).routes.length).toBeGreaterThan(0);
    });

    it("emits one reason per scope however many titles matched, with the count in it", async () => {
      // Four distinct headings in one document, all containing the term.
      //
      // Grouping is a constraint the reason text imposes, not a bug fix: `add` deduplicates on
      // the reason string, so a reason that quotes its own title is unique by construction and
      // slips past it. Quote titles without grouping and one scope emits one signal per heading.
      // Note this was never main's behaviour — main's reason names no title, so its signals are
      // byte-identical and collapse on their own. What grouping buys is the ability to say more
      // in the sentence without giving that up.
      await importDocuments({
        pool,
        schemaName,
        handler: new CommandHandler(pool, schemaName),
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        repository: "agent-context",
        commitSha: "f".repeat(40),
        files: [
          {
            path: "projects/anchor-mcp/anchor-mcp-project-context.md",
            content:
              "---\nproject: anchor-mcp\ntype: context-anchor\n---\n\n# Anchor MCP\n\n" +
              "## Decisions on logging\n\nText.\n\n## Decisions on ranking\n\nText.\n\n" +
              "## Decisions on retention\n\nText.\n\n## Decisions on routing\n\nText.\n",
          },
        ],
      });

      const result = await plan("decisions", { recordLexical: true });
      const reasons = recordLexicalReasons(result.routes);

      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain("matched 4 distinct section titles");
      expect(reasons[0]).toContain("(+1 more)");
    });

    it("credits every task term a heading matched, not just the first", async () => {
      // The reason builder is unit-tested, but nothing covered the code that BUILDS its input:
      // reverting the multi-term collection to "first term wins", or dropping source from the
      // group key, left every suite green.
      await importDocuments({
        pool,
        schemaName,
        handler: new CommandHandler(pool, schemaName),
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        repository: "agent-context",
        commitSha: "c".repeat(40),
        files: [
          {
            path: "projects/anchor-mcp/anchor-mcp-project-context.md",
            content:
              "---\nproject: anchor-mcp\ntype: context-anchor\n---\n\n# Anchor MCP\n\n" +
              // ONE heading carrying BOTH terms. Two headings each carrying one term cannot
              // distinguish "collect every match" from "take the first": the group spans rows,
              // so both terms accumulate either way.
              "## Decisions about logging\n\nText.\n",
          },
        ],
      });

      const result = await plan("decisions logging", { recordLexical: true });
      const reason = recordLexicalReasons(result.routes)[0]!;

      expect(reason).toBeDefined();
      // A single heading matched by both terms, so the count is one either way — what changes is
      // whether both terms are credited.
      // Both terms named. Taking only the first match per heading split one scope's evidence by
      // word order inside the heading and reported two partial matches instead of one full one.
      expect(reason).toContain('"decisions"');
      expect(reason).toContain('"logging"');
      expect(reason).toContain("task terms");
    });

    it("ignores stopwords, which otherwise route on function words alone", async () => {
      // A corpus run found 50 of 118 added routes came from a single stopword, with "and" alone
      // reaching 15 of 23 scopes. The heading has to CONTAIN the stopwords or the assertion holds
      // whether or not they are filtered -- the default fixture headings contain none, so the
      // first version of this test passed with the filter removed.
      await importDocuments({
        pool,
        schemaName,
        handler: new CommandHandler(pool, schemaName),
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        repository: "agent-context",
        commitSha: "d".repeat(40),
        files: [
          {
            path: "projects/anchor-mcp/anchor-mcp-project-context.md",
            content:
              "---\nproject: anchor-mcp\ntype: context-anchor\n---\n\n# Anchor MCP\n\n" +
              "## Rate limiting and the transport\n\nText.\n\n## Notes on the migration\n\nText.\n",
          },
        ],
      });

      const result = await plan("the and of to", { recordLexical: true });
      const reasons = recordLexicalReasons(result.routes);

      expect(reasons).toEqual([]);
    });

    // The restriction the whole signal rests on. Body matching would put most scopes in most
    // answers, which reads like working and is far harder to notice than returning nothing —
    // so a word that appears only in prose must still route nowhere.
    it("matches titles and headings only, never body text", async () => {
      // "bearer" appears in a section body ("The HTTP transport requires a bearer token") and in
      // no heading, scope slug, title or alias anywhere in the workspace.
      expect((await plan("bearer", { recordLexical: true })).routes).toEqual([]);
    });
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

  it("does not expand a section a later commit deleted", async () => {
    // Expansion dedupes with DISTINCT ON (stable_key) ORDER BY revision_number DESC, which
    // takes the newest row per key but cannot drop a key absent from the current revision --
    // a deleted heading leaves a section whose stable_key exists in no newer revision, so it
    // is the only row for that key and survives. The same defect was fixed in the
    // record-lexical signal, where the dedupe alone was demonstrably insufficient.
    const baseline = await plan("anchor mcp", { budget: { expanded: 5, listed: 10, recordsPerRoute: 25 } });
    const before = baseline.routes.map((r) => r.contentFingerprint);

    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "9".repeat(40),
      files: [
        {
          path: "projects/anchor-mcp/anchor-mcp-project-context.md",
          content: HTTP_DOC.replace("## Decisions", "## Retired heading"),
        },
      ],
    });

    const expanded = await plan("anchor mcp", { budget: { expanded: 5, listed: 10, recordsPerRoute: 25 } });
    const headings = expanded.routes.flatMap((route) => (route.records ?? []).map((r) => r.heading ?? ""));

    expect(headings).toContain("Retired heading");
    expect(headings).not.toContain("Decisions");

    // The fingerprint has to move, because it is the caller's only "did this route change"
    // signal and a caller skips re-reading on the strength of it.
    //
    // Corroborating, not discriminating: contentFingerprint hashes stable keys and content, and
    // the pre-fix answer differed from the baseline too -- it carried four sections rather than
    // three, the stale one alongside its replacement -- so this assertion passes with the fix
    // removed. Verified by isolating it. The heading assertions above are what catch the
    // defect; this one states the invariant a future change must not break.
    expect(expanded.routes.map((r) => r.contentFingerprint)).not.toEqual(before);
  });

  it("returns no routes when nothing matches", async () => {
    expect((await plan("kubernetes helm chart")).routes).toEqual([]);
  });

  it("reports the candidates the budget discarded, not only the ones it kept", async () => {
    // Clipping is the whole reason this field exists, so it has to be tested where clipping
    // happens. An assertion that candidateCount >= routes.length passes by construction --
    // routes IS the truncation of the candidates -- and would hold even if the field were
    // hardwired to routes.length, which is exactly the failure it is meant to detect.
    const clipped = await plan("anchor mcp http transport rate limiting", { budget: { expanded: 1, listed: 1 } });

    expect(clipped.routes).toHaveLength(1);
    expect(clipped.candidateCount).toBeGreaterThan(1);

    // And unclipped, the two agree — so the field is reporting selection rather than a constant.
    const whole = await plan("anchor mcp http transport rate limiting", { budget: { expanded: 1, listed: 10 } });
    expect(whole.candidateCount).toBe(whole.routes.length);
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

  /**
   * The invariant this whole disclosure model rests on, and nothing pinned it.
   *
   * A link that carries record text is not a link — it is the payload the caller declined,
   * arriving under a name that says it did not. Citations matter as much as content here: a
   * citation quotes the exact source the claim was drawn from, so shipping them with a link
   * would hand over the evidence while pretending to withhold the claim.
   */
  it("never puts record content or citations in a link, at any expansion", async () => {
    let seenLinks = 0;
    for (const expanded of [0, 1, 2]) {
      const result = await plan("anchor mcp http transport rate limiting", {
        budget: { expanded, listed: 10, recordsPerRoute: 5, linksPerRoute: 3 },
      });

      // Counted across settings rather than demanded at each: this fixture is small enough that
      // a high `expanded` can leave no route unexpanded, and a per-setting demand would fail on
      // the fixture's size rather than on the property.
      const links = result.routes.flatMap((route) => route.recordLinks ?? []);
      seenLinks += links.length;

      // Every unexpanded route that HOLDS records carries links -- the absence of a payload must
      // not be the absence of an answer, which is what a bare recordCount used to be. A route
      // matching on its scope name while holding nothing is a real and different case, and it
      // has nothing to link to.
      for (const route of result.routes.filter((each) => !each.expanded && each.recordCount > 0)) {
        expect((route.recordLinks ?? []).length, `${route.routeKey} holds ${String(route.recordCount)} records and listed none`).toBeGreaterThan(0);
      }

      for (const link of links) {
        const keys = Object.keys(link);
        expect(keys, `a link leaked content at expanded ${String(expanded)}`).not.toContain("content");
        expect(keys, `a link leaked citations at expanded ${String(expanded)}`).not.toContain("citations");
      }

      // And the other half of the same claim: a route that WAS expanded still carries content,
      // so a passing test cannot mean "links are clean because nothing has anything".
      const expandedRoutes = result.routes.filter((route) => route.expanded);
      expect(expandedRoutes).toHaveLength(Math.min(expanded, result.routes.length));
      for (const route of expandedRoutes) {
        // Same caveat as above: a route can match on its scope name and hold nothing, and
        // expanding it correctly returns an empty list rather than links.
        if (route.recordCount > 0) {
          expect(route.records ?? []).not.toHaveLength(0);
        }
        expect(route.recordLinks, `${route.routeKey} was expanded and still sent links`).toBeUndefined();
      }
    }

    // Not vacuous: some setting above must actually have produced links to inspect.
    expect(seenLinks, "no links were produced at any setting, so nothing was checked").toBeGreaterThan(0);
  });

  it("bounds links by linksPerRoute, not by recordsPerRoute", async () => {
    // These are separate numbers on purpose, and were the same one for a while. Set far apart so
    // a regression to the old behaviour is unambiguous rather than a coincidence of defaults.
    const result = await plan("anchor mcp http transport rate limiting", {
      budget: { expanded: 0, listed: 10, recordsPerRoute: 25, linksPerRoute: 2 },
    });

    for (const route of result.routes) {
      expect((route.recordLinks ?? []).length).toBeLessThanOrEqual(2);
      // Truncation is reported against the bound that actually applied.
      if (route.recordCount > 2) {
        expect(route.recordsTruncated, `${route.routeKey} hid records without saying so`).toBe(true);
      }
    }
    expect(result.routes.some((route) => (route.recordLinks ?? []).length === 2)).toBe(true);
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
    // "Unknown" and "empty" are different answers, and only one of them means the other
    // ranker found nothing worth offering.
    it("records an unknown record count as null for a shadow-only route", async () => {
      // Sorted by slug rather than reversing the input: reversing makes the shadow-only
      // route depend on candidate iteration order, which is not part of anything's
      // contract and has already produced one order-dependent test in this suite.
      const reversed: Ranker = {
        id: "reverser",
        version: "1.0.0",
        deterministic: true,
        rank: (candidates) =>
          Promise.resolve(
            [...candidates]
              .sort((left, right) => right.scopeSlug.localeCompare(left.scopeSlug))
              .map((c, index) => ({ ...c, offeredPosition: index })),
          ),
      };

      const result = await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        {
          workspaceGuid: bootstrap.workspaceGuid,
          principalGuid: bootstrap.ownerPrincipalGuid,
          role: "owner",
          task: "anchor mcp http transport rate limiting",
          budget: { expanded: 1, listed: 1, recordsPerRoute: 5 },
        },
        { ranker: defaultRanker, shadowRankers: [reversed] },
      );

      const offered = new Set(result.routes.map((route) => route.routeKey));
      const shadow = await pool.query<{ route_key: string; record_count: number | null }>(
        `SELECT route_key, record_count FROM "${telemetrySchema}".retrieval_route_impressions
          WHERE request_guid = $1 AND is_shadow = true`,
        [result.requestId],
      );

      for (const row of shadow.rows) {
        if (offered.has(row.route_key)) {
          expect(row.record_count).not.toBeNull();
        } else {
          expect(row.record_count).toBeNull();
        }
      }
    });

    it("stores the whole budget, not just the expanded count", async () => {
      const result = await plan("anchor mcp", { budget: { expanded: 3, listed: 7, recordsPerRoute: 4 } });

      const stored = await pool.query<{ route_budget: unknown }>(
        `SELECT route_budget FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
        [result.requestId],
      );
      // linksPerRoute included: the test's whole claim is that the *whole* budget is stored, so
      // a new field that governs response size has to appear here or the assertion quietly stops
      // meaning what its name says.
      expect(stored.rows[0]?.route_budget).toEqual({
        expanded: 3,
        listed: 7,
        recordsPerRoute: 4,
        linksPerRoute: 5,
      });
    });

    // Every timestamp for one request should agree; a fresh Date inside the impression write
    // also defeats a fixed clock in tests.
    it("timestamps impressions with the request's clock", async () => {
      const fixed = new Date("2026-01-02T03:04:05.000Z");
      const result = await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        { workspaceGuid: bootstrap.workspaceGuid, principalGuid: bootstrap.ownerPrincipalGuid, role: "owner", task: "anchor mcp" },
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
      // Sorted by slug descending rather than "reverse the input": a ranker sees candidates,
      // not the live ranked order, so reversing the input only coincidentally differs from
      // the live ordering — and that coincidence made this test depend on candidate
      // insertion order, which is not part of anything's contract.
      const bySlugDescending: Ranker = {
        id: "slug-desc",
        version: "9.9.9",
        deterministic: true,
        rank: (candidates) =>
          Promise.resolve(
            [...candidates]
              .sort((left, right) => right.scopeSlug.localeCompare(left.scopeSlug))
              .map((c, index) => ({ ...c, offeredPosition: index })),
          ),
      };

      const result = await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        {
          workspaceGuid: bootstrap.workspaceGuid,
          principalGuid: bootstrap.ownerPrincipalGuid,
          role: "owner",
          task: "anchor mcp http transport rate limiting",
        },
        { ranker: defaultRanker, shadowRankers: [bySlugDescending] },
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
      // The same routes, ordered by the shadow ranker's own rule — recorded separately from
      // what the caller saw, which is the whole point of a shadow ordering.
      const shadowKeys = shadow.rows.map((r) => r.route_key);
      expect([...shadowKeys].sort()).toEqual([...live.rows.map((r) => r.route_key)].sort());
      // Ordered by slug, which is the shadow ranker's rule — not by route key, which embeds
      // the scope kind and therefore sorts differently.
      const slugOf = (routeKey: string) => routeKey.slice(routeKey.lastIndexOf(":") + 1);
      expect(shadowKeys).toEqual(
        [...shadowKeys].sort((left, right) => slugOf(right).localeCompare(slugOf(left))),
      );
      expect(shadowKeys).not.toEqual(live.rows.map((r) => r.route_key));
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
        {
          workspaceGuid: bootstrap.workspaceGuid,
          principalGuid: bootstrap.ownerPrincipalGuid,
          role: "owner",
          task: "anchor mcp http transport rate limiting",
        },
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

    // An unknown request and an unoffered route are different answers. Reporting the
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
