import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { planRoutedBundle } from "../../src/db/routing/plan.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL, testSchemaName } from "./testDatabase.js";

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token.
`;

describe.runIf(await isTestDatabaseReachable())("routed retrieval access control (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;
  let memberGuid: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("access_test");
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
        {
          scope: "http-transport",
          title: "HTTP Transport",
          kind: "component",
          partOf: "anchor-mcp",
          locators: [{ repository: "context-anchor", pathPrefix: "src/http" }],
        },
      ],
    });

    memberGuid = randomUUID();
    await pool.query(
      // A service principal, because principal_identity_shape requires a 'user' principal to
      // resolve to a users row. A scoped service account is a realistic member anyway.
      `INSERT INTO "${schemaName}".principals (workspace_guid, principal_guid, principal_type, display_name)
       VALUES ($1, $2, 'service', 'Scoped service account')`,
      [bootstrap.workspaceGuid, memberGuid],
    );
    await pool.query(
      `INSERT INTO "${schemaName}".workspace_memberships (workspace_guid, principal_guid, role)
       VALUES ($1, $2, 'member')`,
      [bootstrap.workspaceGuid, memberGuid],
    );
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const scopeGuid = async (slug: string): Promise<string> =>
    (
      await pool.query<{ scope_guid: string }>(
        `SELECT scope_guid FROM "${schemaName}".scopes WHERE scope_slug = $1`,
        [slug],
      )
    ).rows[0]!.scope_guid;

  const grant = async (slug: string, permission: "read" | "write", retired = false) => {
    await pool.query(
      `INSERT INTO "${schemaName}".scope_grants
         (grant_guid, workspace_guid, scope_guid, principal_guid, permission, granted_by_principal_guid, retired_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        bootstrap.workspaceGuid,
        await scopeGuid(slug),
        memberGuid,
        permission,
        bootstrap.ownerPrincipalGuid,
        retired ? new Date() : null,
      ],
    );
  };

  // `extra` is spread first, deliberately: identity is the thing under test here, and a
  // stray key in `extra` overriding principalGuid or role would silently exercise a
  // different caller while still passing.
  const planAs = (role: "owner" | "member", principalGuid: string, extra: Record<string, unknown> = {}) =>
    planRoutedBundle(pool, schemaName, telemetrySchema, {
      task: "anchor mcp http transport",
      ...extra,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid,
      role,
    });

  const keys = (result: Awaited<ReturnType<typeof planRoutedBundle>>) => result.routes.map((r) => r.routeKey).sort();

  // An owner is entitled to every scope with no grant row at all, so an inner join here
  // would return nothing for the role that should see everything.
  it("offers every scope to the owner, who has no grants", async () => {
    expect(keys(await planAs("owner", bootstrap.ownerPrincipalGuid))).toEqual([
      "scope:component:http-transport",
      "scope:domain:anchor-mcp",
    ]);
  });

  it("offers nothing to a member with no grants", async () => {
    expect(keys(await planAs("member", memberGuid))).toEqual([]);
  });

  // Selection routes every producer through add(), which drops scopes the caller cannot read,
  // so a caller with no grants can never yield a candidate. Without an early return, producers
  // whose own preconditions are met still query to fill a map guaranteed to stay empty.
  //
  // Measured rather than assumed: this scenario runs 3 queries without the early return and 2
  // with it. Only one producer is reached here — the record-lexical scan over every assertion
  // title and current section heading in the workspace — because path mapping needs
  // referencedPaths and the relation hop needs a prior match, and neither is present. One query
  // is the floor of the saving, not the ceiling.
  it("runs no selection queries for a caller who can read nothing", async () => {
    let queries = 0;
    const counting = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === "query") {
          return (...args: unknown[]) => {
            queries += 1;
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    // The scope read itself is unavoidable — readability cannot be known without it — so this
    // counts what happens after, with the record-lexical signal on to make the skipped work as
    // large as it gets.
    const before = queries;
    const result = await planRoutedBundle(counting, schemaName, telemetrySchema, {
      task: "anchor mcp http transport",
      recordLexical: true,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: memberGuid,
      role: "member",
    });
    const used = queries - before;

    expect(result.routes).toEqual([]);
    // Exact, not a bound. A bound of 4 was the first attempt and it did not discriminate: the
    // test passed with the early return removed, which is a test that looks like coverage and
    // is not. Two queries are the scope readability lookup and telemetry's record of the
    // request. If a deliberate change makes it three, this should be read and updated rather
    // than loosened.
    expect(used).toBe(2);
  });

  it("offers only the granted scope to a member", async () => {
    await grant("anchor-mcp", "read");

    expect(keys(await planAs("member", memberGuid))).toEqual(["scope:domain:anchor-mcp"]);
  });

  it("treats a write grant as conferring read", async () => {
    await grant("anchor-mcp", "write");

    expect(keys(await planAs("member", memberGuid))).toEqual(["scope:domain:anchor-mcp"]);
  });

  it("ignores a retired grant", async () => {
    await grant("anchor-mcp", "read", true);

    expect(keys(await planAs("member", memberGuid))).toEqual([]);
  });

  // The subtle leak: the relation hop adds scopes by traversal rather than by matching, so
  // filtering only the lexical and path stages would let a granted child hand back an
  // ungranted parent.
  it("does not offer an ungranted parent through the relation hop", async () => {
    await grant("http-transport", "read");

    const result = await planAs("member", memberGuid, { referencedPaths: ["src/http/server.ts"] });

    expect(keys(result)).toEqual(["scope:component:http-transport"]);
    expect(keys(result)).not.toContain("scope:domain:anchor-mcp");
  });

  // A referenced path is evidence about where the caller is working, not an entitlement to
  // whatever scope happens to be mapped there.
  it("does not offer an ungranted scope a referenced path maps to", async () => {
    const result = await planAs("member", memberGuid, {
      task: "nothing lexical",
      referencedPaths: ["src/http/server.ts"],
    });

    expect(keys(result)).toEqual([]);
  });

  // Why the path stage filters rather than relying on the final lookup: an unreadable scope
  // that matched by path would still seed the relation hop, so its readable parent would be
  // offered on the strength of a match the caller cannot see. The route would be authorized
  // and the reason would not name the child — it falls back to "a matched scope" — but the
  // caller would still learn that something hidden under this parent matched their path.
  it("does not offer a readable parent on the strength of an unreadable child's path match", async () => {
    await grant("anchor-mcp", "read");

    const result = await planAs("member", memberGuid, {
      task: "nothing lexical",
      referencedPaths: ["src/http/server.ts"],
    });

    expect(keys(result)).toEqual([]);
    expect(result.routes.flatMap((route) => route.matchReasons).join(" ")).not.toContain("http-transport");
  });

  it("does not expand records from a scope the caller cannot read", async () => {
    const result = await planAs("member", memberGuid, { budget: { expanded: 5, listed: 10 } });

    expect(result.routes.flatMap((route) => route.records ?? [])).toEqual([]);
  });
});
