import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { loadRouteRecords } from "../../src/db/routing/selectRoutes.js";
import {
  dropAllSchemas,
  isTestDatabaseReachable,
  migrateAllSchemas,
  TEST_DATABASE_URL,
  testSchemaName,
} from "./testDatabase.js";

/**
 * Five levels, and prose directly under a parent heading — the shape that produced the defect.
 * `Current State` holds a sentence of its own before `Architecture` begins, so a rule that kept
 * only childless sections would drop it.
 */
const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

Everything about the server lives here.

## Current State

The server runs over two transports.

### Architecture

A command handler fronts every mutation.

#### Invariants

Idempotency keys are matched per workspace.

## Decisions

Rate limiting belongs in the transport.
`;

describe.runIf(await isTestDatabaseReachable())("route records never overlap (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let scopeGuid: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("overlap_test");
    await migrateAllSchemas(pool, schemaName);
    bootstrap = await ensureBootstrap(pool, { schemaName });

    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "o".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      scopes: [{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }],
    });

    const scope = await pool.query<{ scope_guid: string }>(
      `SELECT scope_guid FROM "${schemaName}".scopes WHERE scope_slug = 'anchor-mcp'`,
    );
    scopeGuid = scope.rows[0]!.scope_guid;
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const records = () => loadRouteRecords(pool, schemaName, bootstrap.workspaceGuid, scopeGuid);

  it("returns no record whose content contains another's", async () => {
    // The property the change exists for. Before it, a route offered the document, then one of
    // its chapters again, then that chapter's sections again -- on the real workspace, 104,521
    // characters of which only 46,875 was text not already elsewhere in the same response.
    const loaded = await records();
    expect(loaded.length).toBeGreaterThan(3);

    for (const outer of loaded) {
      for (const inner of loaded) {
        if (outer === inner || !outer.content || !inner.content) {
          continue;
        }
        expect(outer.content.includes(inner.content)).toBe(false);
      }
    }
  });

  it("keeps the prose a parent holds before its first subheading", async () => {
    // Trimming rather than dropping containers. `Current State` has a sentence of its own and
    // children; keeping only childless sections would discard it silently.
    const loaded = await records();
    const currentState = loaded.find((record) => record.heading === "Current State");

    expect(currentState?.content).toContain("The server runs over two transports.");
    // And only its own: its children's text belongs to their records.
    expect(currentState?.content).not.toContain("A command handler fronts every mutation.");
  });

  it("drops a heading that carries nothing but itself", async () => {
    // Its span begins at its own heading line, so once descendants are excluded its content is
    // that line and nothing more -- the title repeated, which `heading` already carries. It would
    // spend a slot in recordsPerRoute that a record with something to say could have had.
    // Re-imported at a new commit rather than edited in place: offsets and content_hash are the
    // importer's to derive, and an UPDATE that rewrote the text without them would build a row
    // production cannot produce -- then test the reader against a state that never occurs.
    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "p".repeat(40),
      files: [
        {
          path: "projects/anchor-mcp/anchor-mcp-project-context.md",
          content: DOC.replace("## Current State\n\nThe server runs over two transports.\n", "## Current State\n"),
        },
      ],
      scopes: [{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }],
    });

    const loaded = await records();
    expect(loaded.map((record) => record.heading)).not.toContain("Current State");
    // Its children are still there, so nothing became unreachable by dropping it.
    expect(loaded.map((record) => record.heading)).toContain("Architecture");
  });

  it("drops a bare heading written with a tab, which the parser accepts as a heading", async () => {
    // The parser matches `#{1,6}\s+`, so a tab separates a heading just as a space does. A
    // second pattern written with a literal space made this a heading everywhere except in the
    // emptiness test, so the record survived holding nothing but its own title. Raised in review
    // on baca485; there is one pattern now, exported from the parser.
    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "t".repeat(40),
      files: [
        {
          path: "projects/anchor-mcp/anchor-mcp-project-context.md",
          content: DOC.replace(
            "## Current State\n\nThe server runs over two transports.\n",
            "##\tCurrent State\n",
          ),
        },
      ],
      scopes: [{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }],
    });

    const loaded = await records();
    expect(loaded.map((record) => record.heading)).toContain("Architecture");
    expect(loaded.map((record) => record.heading)).not.toContain("Current State");
  });

  it("covers the document's prose exactly once across the route", async () => {
    // The two halves together: no duplication, and no loss. A rule that satisfied only the first
    // could pass the overlap test by returning almost nothing.
    const loaded = await records();
    const joined = loaded.map((record) => record.content).join("\n");

    for (const sentence of [
      "Everything about the server lives here.",
      "The server runs over two transports.",
      "A command handler fronts every mutation.",
      "Idempotency keys are matched per workspace.",
      "Rate limiting belongs in the transport.",
    ]) {
      expect(joined.split(sentence).length - 1).toBe(1);
    }
  });
});
