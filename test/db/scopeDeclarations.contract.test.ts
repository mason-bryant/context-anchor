import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { runMigrations } from "../../src/db/migrate.js";
import type { ScopeDeclaration } from "../../src/db/scopeRegistry.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- A claim.
`;

describe.runIf(await isTestDatabaseReachable())("scope declarations (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `scopes_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    bootstrap = await ensureBootstrap(pool, { schemaName });
    handler = new CommandHandler(pool, schemaName);
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pool.end();
  });

  const runImport = (scopes: ScopeDeclaration[], commitSha = "a".repeat(40)) =>
    importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha,
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      scopes,
    });

  const scopeRow = async (slug: string) =>
    (
      await pool.query<{ scope_guid: string; scope_kind: string; title: string; aliases: string[] }>(
        `SELECT scope_guid, scope_kind, title, aliases FROM "${schemaName}".scopes WHERE scope_slug = $1`,
        [slug],
      )
    ).rows[0];

  // The failure A1 exists to fix: one repository under two names produced two unrelated
  // component scopes, and their content could never route together.
  it("points many locators at one scope", async () => {
    await runImport([
      {
        scope: "anchor-mcp",
        title: "Anchor MCP",
        kind: "domain",
        locators: [
          { repository: "context-anchor", pathPrefix: "" },
          { repository: "context-conductor", pathPrefix: "" },
        ],
      },
    ]);

    const scope = await scopeRow("anchor-mcp");
    expect(scope).toBeDefined();

    const mappings = await pool.query<{ repository: string }>(
      `SELECT repository FROM "${schemaName}".repository_mappings WHERE scope_guid = $1 ORDER BY repository`,
      [scope!.scope_guid],
    );
    expect(mappings.rows.map((row) => row.repository)).toEqual(["context-anchor", "context-conductor"]);
  });

  it("uses the declared name as the slug, with no project prefix", async () => {
    await runImport([{ scope: "object-graph", title: "Object Graph", kind: "practice", locators: [] }]);

    expect(await scopeRow("object-graph")).toMatchObject({ scope_kind: "practice", title: "Object Graph" });
  });

  it("creates a scope that has no locators at all", async () => {
    await runImport([{ scope: "security", title: "Security", kind: "practice", locators: [] }]);

    const scope = await scopeRow("security");
    expect(scope).toBeDefined();
    const mappings = await pool.query(
      `SELECT 1 FROM "${schemaName}".repository_mappings WHERE scope_guid = $1`,
      [scope!.scope_guid],
    );
    expect(mappings.rowCount).toBe(0);
  });

  it("stores declared aliases so one subject spelled several ways stays one scope", async () => {
    await runImport([
      { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", aliases: ["context-conductor", "og"], locators: [] },
    ]);

    expect((await scopeRow("anchor-mcp"))?.aliases).toEqual(["context-conductor", "og"]);
  });

  // Flat slugs cannot carry a parent as a prefix, so the relation has to be declared.
  it("relates a scope to its declared parent, regardless of declaration order", async () => {
    await runImport([
      { scope: "routing", title: "Routing", kind: "practice", partOf: "anchor-mcp", locators: [] },
      { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] },
    ]);

    const relation = await pool.query<{ relation_type: string; derived_from_signal: string }>(
      `SELECT r.relation_type, r.derived_from_signal
         FROM "${schemaName}".scope_relations r
         JOIN "${schemaName}".scopes f ON f.scope_guid = r.from_scope_guid
         JOIN "${schemaName}".scopes t ON t.scope_guid = r.to_scope_guid
        WHERE f.scope_slug = 'routing' AND t.scope_slug = 'anchor-mcp'`,
    );
    expect(relation.rows[0]).toMatchObject({
      relation_type: "part_of",
      derived_from_signal: "declared:project-mappings.json",
    });
  });

  // deriveAllScopes runs first and creates `anchor-mcp` from the file path with its own
  // derived title, and ensureScope returns early for a slug that already exists. Without an
  // explicit write, every hand-written title is discarded for exactly the scopes derivation
  // also produces — which is most of them.
  it("lets a declared title override one derivation already created", async () => {
    await runImport([{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }]);

    expect((await scopeRow("anchor-mcp"))?.title).toBe("Anchor MCP");
  });

  // The registry is authoritative, so removing an alias from it has to remove it here.
  it("clears aliases when the declaration no longer lists any", async () => {
    await runImport([
      { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", aliases: ["context-conductor"], locators: [] },
    ]);
    expect((await scopeRow("anchor-mcp"))?.aliases).toEqual(["context-conductor"]);

    await runImport([{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }], "b".repeat(40));

    expect((await scopeRow("anchor-mcp"))?.aliases).toEqual([]);
  });

  // An empty array means "the scope model is nothing", which is a mistake worth reporting
  // rather than quietly falling back to deriving scopes from paths.
  it("refuses an explicitly empty scopes array instead of falling back", async () => {
    await expect(runImport([])).rejects.toThrow(/provided but empty/);
  });

  // The declaration allows exactly one parent, so a changed or removed partOf has to
  // retire the edge it replaced — otherwise the scope accumulates parents the model
  // cannot express but the table can hold.
  it("retires a declared part_of when the parent changes", async () => {
    await runImport([
      { scope: "one", title: "One", kind: "domain", locators: [] },
      { scope: "two", title: "Two", kind: "domain", locators: [] },
      { scope: "child", title: "Child", kind: "practice", partOf: "one", locators: [] },
    ]);

    await runImport(
      [
        { scope: "one", title: "One", kind: "domain", locators: [] },
        { scope: "two", title: "Two", kind: "domain", locators: [] },
        { scope: "child", title: "Child", kind: "practice", partOf: "two", locators: [] },
      ],
      "b".repeat(40),
    );

    const live = await pool.query<{ scope_slug: string }>(
      `SELECT t.scope_slug FROM "${schemaName}".scope_relations r
         JOIN "${schemaName}".scopes f ON f.scope_guid = r.from_scope_guid
         JOIN "${schemaName}".scopes t ON t.scope_guid = r.to_scope_guid
        WHERE f.scope_slug = 'child' AND r.relation_type = 'part_of' AND r.retired_at IS NULL`,
    );
    expect(live.rows.map((row) => row.scope_slug)).toEqual(["two"]);
  });

  it("retires a declared part_of when the parent is removed entirely", async () => {
    await runImport([
      { scope: "one", title: "One", kind: "domain", locators: [] },
      { scope: "child", title: "Child", kind: "practice", partOf: "one", locators: [] },
    ]);

    await runImport(
      [
        { scope: "one", title: "One", kind: "domain", locators: [] },
        { scope: "child", title: "Child", kind: "practice", locators: [] },
      ],
      "b".repeat(40),
    );

    const live = await pool.query(
      `SELECT 1 FROM "${schemaName}".scope_relations r
         JOIN "${schemaName}".scopes f ON f.scope_guid = r.from_scope_guid
        WHERE f.scope_slug = 'child' AND r.relation_type = 'part_of' AND r.retired_at IS NULL`,
    );
    expect(live.rowCount).toBe(0);
  });

  it("re-importing the same commit writes nothing", async () => {
    const declarations: ScopeDeclaration[] = [
      { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [{ repository: "r", pathPrefix: "" }] },
    ];
    await runImport(declarations);

    const second = await runImport(declarations);

    expect(second.scopesCreated).toBe(0);
    expect(second.mappingsImported).toBe(0);
    expect(second.relationsCreated).toBe(0);
  });

  // A locator moving between scopes is a legitimate edit, and the database must describe
  // the commit that was imported rather than the one before it.
  it("repoints a locator when a later commit moves it to another scope", async () => {
    await runImport([
      { scope: "first", title: "First", kind: "component", locators: [{ repository: "r", pathPrefix: "app" }] },
    ]);

    // `first` is omitted rather than declared with no locators: parseScopeDeclarations
    // rejects a component without one, so declaring that here would exercise a state the
    // real pipeline cannot produce and quietly overstate coverage.
    const second = await runImport(
      [{ scope: "second", title: "Second", kind: "component", locators: [{ repository: "r", pathPrefix: "app" }] }],
      "b".repeat(40),
    );

    expect(second.mappingsUpdated).toBe(1);
    const owner = await pool.query<{ scope_slug: string }>(
      `SELECT s.scope_slug FROM "${schemaName}".repository_mappings m
         JOIN "${schemaName}".scopes s ON s.scope_guid = m.scope_guid
        WHERE m.repository = 'r' AND m.path_prefix = 'app'`,
    );
    expect(owner.rows[0]?.scope_slug).toBe("second");
  });

  // Two command types sharing an idempotency key is indistinguishable from a duplicate
  // submission, so the second silently does nothing — which is how this feature first ran
  // as a no-op with a report full of zeros. Note the collision does NOT show up as a
  // duplicate key: the skipped command writes no row at all, so uniqueness of
  // idempotency_key stays true while the work is silently missing. The command type has to
  // be asserted present instead.
  it("actually records a scopes.import command, not just a plausible-looking report", async () => {
    await runImport([
      { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [{ repository: "r", pathPrefix: "" }] },
    ]);

    const commands = await pool.query<{ command_type: string }>(
      `SELECT command_type FROM "${schemaName}".commands`,
    );
    const types = commands.rows.map((row) => row.command_type);
    expect(types).toContain("scopes.import");
    expect(types).toContain("scopes.derive");
  });

  // scope_slug is unique per workspace, so one slug must never mean two kinds.
  it("refuses to change the kind of an existing scope", async () => {
    await runImport([{ scope: "thing", title: "Thing", kind: "practice", locators: [] }]);

    await expect(
      runImport(
        [{ scope: "thing", title: "Thing", kind: "component", locators: [{ repository: "r", pathPrefix: "x" }] }],
        "c".repeat(40),
      ),
    ).rejects.toThrow(/Refusing to merge two scope kinds/);
  });
});
