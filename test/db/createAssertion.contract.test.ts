import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import {
  BlockNotFoundError,
  createAssertion,
  QuoteNotFoundError,
  ScopeNotFoundForAssertionError,
} from "../../src/db/createAssertion.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { planRoutedBundle } from "../../src/db/routing/plan.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL } from "./testDatabase.js";

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token even on localhost.
`;

describe.runIf(await isTestDatabaseReachable())("createAssertion (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;
  let blockGuid: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `assert_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    telemetrySchema = telemetrySchemaNameFor(schemaName);
    await migrateAllSchemas(pool, schemaName);
    bootstrap = await ensureBootstrap(pool, { schemaName });
    handler = new CommandHandler(pool, schemaName);

    await importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "a".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      scopes: [{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }],
    });

    blockGuid = (
      await pool.query<{ block_guid: string }>(
        `SELECT block_guid FROM "${schemaName}".content_blocks WHERE raw_content LIKE '%bearer token%' LIMIT 1`,
      )
    ).rows[0]!.block_guid;
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const author = (overrides: Record<string, unknown> = {}) =>
    createAssertion({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      scopeSlug: "anchor-mcp",
      kind: "decision",
      title: "HTTP always requires a token",
      content: "Bearer auth is mandatory on the HTTP transport, including on localhost.",
      citation: { blockGuid, exactQuote: "requires a bearer token" },
      ...overrides,
    });

  it("writes the assertion, its citation, and its routing association in one command", async () => {
    const result = await author();

    const assertion = await pool.query<{ kind: string; status: string; version: number }>(
      `SELECT kind, status, version FROM "${schemaName}".assertions
        WHERE workspace_guid = $1 AND assertion_guid = $2`,
      [bootstrap.workspaceGuid, result.assertionGuid],
    );
    expect(assertion.rows[0]).toMatchObject({ kind: "decision", status: "active", version: 1 });

    const citation = await pool.query<{ exact_quote: string; start_offset: number; selected_content_hash: string }>(
      `SELECT exact_quote, start_offset, selected_content_hash FROM "${schemaName}".source_citations
        WHERE workspace_guid = $1 AND assertion_guid = $2`,
      [bootstrap.workspaceGuid, result.assertionGuid],
    );
    // Exactly one: asserting only on the first row would ignore a duplicate-citation bug.
    expect(citation.rowCount).toBe(1);
    expect(citation.rows[0]?.exact_quote).toBe("requires a bearer token");
    // Offsets are captured, not typed: they locate the quote cheaply while the quote itself
    // re-finds it after the source moves.
    expect(citation.rows[0]?.start_offset).toBeGreaterThanOrEqual(0);
    expect(citation.rows[0]?.selected_content_hash).toHaveLength(64);

    const association = await pool.query(
      `SELECT 1 FROM "${schemaName}".record_scopes
        WHERE workspace_guid = $1 AND record_type = 'assertion' AND record_guid = $2 AND retired_at IS NULL`,
      [bootstrap.workspaceGuid, result.assertionGuid],
    );
    expect(association.rowCount).toBe(1);
  });

  it("snapshots the first version and logs the mutation", async () => {
    const result = await author();

    const version = await pool.query<{ version: number; payload: { assertionGuid: string } }>(
      `SELECT version, payload FROM "${schemaName}".record_versions
        WHERE entity_type = 'assertion' AND entity_guid = $1`,
      [result.assertionGuid],
    );
    expect(version.rows[0]?.version).toBe(1);
    expect(version.rows[0]?.payload.assertionGuid).toBe(result.assertionGuid);

    const log = await pool.query<{ entry_type: string }>(
      `SELECT entry_type FROM "${schemaName}".mutation_log WHERE entry_type = 'assertion.created'`,
    );
    expect(log.rowCount).toBe(1);
  });

  // An assertion without its citation is precisely the unprovenanced claim this system
  // exists to avoid, so a failure must leave nothing behind rather than a bare claim.
  it("writes nothing when the quote is not in the cited block", async () => {
    await expect(author({ citation: { blockGuid, exactQuote: "text that is not there" } })).rejects.toThrow(
      QuoteNotFoundError,
    );

    const assertions = await pool.query(`SELECT 1 FROM "${schemaName}".assertions`);
    const citations = await pool.query(`SELECT 1 FROM "${schemaName}".source_citations`);
    expect(assertions.rowCount).toBe(0);
    expect(citations.rowCount).toBe(0);
  });

  it("refuses an unknown block and an unknown scope, writing nothing", async () => {
    await expect(
      author({ citation: { blockGuid: randomUUID(), exactQuote: "anything" } }),
    ).rejects.toThrow(BlockNotFoundError);
    await expect(author({ scopeSlug: "no-such-scope" })).rejects.toThrow(ScopeNotFoundForAssertionError);

    expect((await pool.query(`SELECT 1 FROM "${schemaName}".assertions`)).rowCount).toBe(0);
  });

  // Authoring the same claim citing the same text twice is a retry, not two claims — and a
  // retry must hand back the assertion that exists. Asserting only that nothing new was
  // written would pass while the caller received a GUID for a record that was never
  // created: success-shaped, and broken the moment anything tried to use it.
  it("returns the original assertion on a retry rather than a fresh identifier", async () => {
    const first = await author();
    const second = await author();

    expect(second.replayed).toBe(true);
    expect(second.assertionGuid).toBe(first.assertionGuid);
    expect(second.citationGuid).toBe(first.citationGuid);
    expect(second.scopeGuid).toBe(first.scopeGuid);
    expect((await pool.query(`SELECT 1 FROM "${schemaName}".assertions`)).rowCount).toBe(1);

    // The identifier handed back must resolve to a real row, which is the property the
    // previous non-equality assertion could not establish.
    const exists = await pool.query(
      `SELECT 1 FROM "${schemaName}".assertions WHERE assertion_guid = $1`,
      [second.assertionGuid],
    );
    expect(exists.rowCount).toBe(1);
    expect(first.replayed).toBe(false);
  });

  describe("routing", () => {
    const plan = () =>
      planRoutedBundle(pool, schemaName, telemetrySchema, {
        workspaceGuid: bootstrap.workspaceGuid,
        principalGuid: bootstrap.ownerPrincipalGuid,
        role: "owner",
        task: "anchor mcp",
        budget: { expanded: 5, listed: 10, recordsPerRoute: 50 },
      });

    it("returns the assertion through T1 with its kind, status, and citation", async () => {
      await author();

      const records = (await plan()).routes.flatMap((route) => route.records ?? []);
      const assertion = records.find((record) => record.ref.type === "assertion");

      expect(assertion).toBeDefined();
      expect(assertion).toMatchObject({ kind: "decision", status: "active" });
      expect(assertion?.citations?.[0]?.quote).toBe("requires a bearer token");
    });

    // Serving a retracted claim as though it were live is the failure the standing model
    // exists to prevent.
    it("excludes a retracted assertion from routes", async () => {
      const result = await author();
      await pool.query(`UPDATE "${schemaName}".assertions SET status = 'retracted' WHERE assertion_guid = $1`, [
        result.assertionGuid,
      ]);

      const records = (await plan()).routes.flatMap((route) => route.records ?? []);
      expect(records.some((record) => record.ref.type === "assertion")).toBe(false);
    });

    // T-38: recordCount and expansion must answer the same question, or a route advertises
    // records expansion cannot produce and a reader sees it as missing data.
    it("counts what expansion returns, before and after retraction", async () => {
      const before = await plan();
      const beforeRoute = before.routes.find((r) => r.routeKey === "scope:domain:anchor-mcp")!;
      expect(beforeRoute.recordCount).toBe(beforeRoute.records!.length);

      const result = await author();
      const withAssertion = await plan();
      const withRoute = withAssertion.routes.find((r) => r.routeKey === "scope:domain:anchor-mcp")!;
      expect(withRoute.recordCount).toBe(withRoute.records!.length);
      expect(withRoute.recordCount).toBe(beforeRoute.recordCount + 1);

      await pool.query(`UPDATE "${schemaName}".assertions SET status = 'retracted' WHERE assertion_guid = $1`, [
        result.assertionGuid,
      ]);
      const after = await plan();
      const afterRoute = after.routes.find((r) => r.routeKey === "scope:domain:anchor-mcp")!;
      expect(afterRoute.recordCount).toBe(afterRoute.records!.length);
      expect(afterRoute.recordCount).toBe(beforeRoute.recordCount);
    });

    // loadRouteRecords used to return early when a scope had no section associations, so a
    // scope holding only assertions returned nothing while recordCount still counted them —
    // the exact divergence this slice closed, reintroduced from the other side.
    it("returns assertions from a scope that has no sections at all", async () => {
      await pool.query(
        `INSERT INTO "${schemaName}".scopes (workspace_guid, scope_guid, scope_slug, scope_kind, title)
         VALUES ($1, gen_random_uuid(), 'claims-only', 'practice', 'Claims Only')`,
        [bootstrap.workspaceGuid],
      );
      await author({ scopeSlug: "claims-only", title: "A claim with no document behind it" });

      const result = await planRoutedBundle(pool, schemaName, telemetrySchema, {
        workspaceGuid: bootstrap.workspaceGuid,
        principalGuid: bootstrap.ownerPrincipalGuid,
        role: "owner",
        task: "claims only",
        budget: { expanded: 5, listed: 10, recordsPerRoute: 50 },
      });

      const route = result.routes.find((r) => r.routeKey === "scope:practice:claims-only");
      expect(route).toBeDefined();
      expect(route?.records?.length).toBe(1);
      expect(route?.recordCount).toBe(route?.records?.length);
    });

    it("moves the route fingerprint when a claim is authored", async () => {
      const before = (await plan()).routes.find((r) => r.routeKey === "scope:domain:anchor-mcp")!.contentFingerprint;

      await author();

      const after = (await plan()).routes.find((r) => r.routeKey === "scope:domain:anchor-mcp")!.contentFingerprint;
      expect(after).not.toBe(before);
    });
  });
});
