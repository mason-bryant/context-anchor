import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureBootstrap } from "../../src/db/bootstrap.js";
import { KnowledgeDatabase } from "../../src/db/knowledgeDb.js";
import { runMigrations } from "../../src/db/migrate.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

describe.runIf(await isTestDatabaseReachable())("bootstrap + KnowledgeDatabase.listScopes (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pool.end();
  });

  it("ensureBootstrap creates a workspace, an owner principal, and the default scope", async () => {
    const result = await ensureBootstrap(pool, { schemaName, workspaceSlug: "default" });

    expect(result.workspaceGuid).toBeTruthy();
    expect(result.ownerPrincipalGuid).toBeTruthy();
    expect(result.defaultScopeGuid).toBeTruthy();

    const scope = await pool.query(`SELECT scope_kind, scope_slug FROM "${schemaName}".scopes WHERE scope_guid = $1`, [
      result.defaultScopeGuid,
    ]);
    expect(scope.rows[0]).toEqual({ scope_kind: "workspace", scope_slug: "workspace" });

    const membership = await pool.query(
      `SELECT role FROM "${schemaName}".workspace_memberships WHERE workspace_guid = $1 AND principal_guid = $2`,
      [result.workspaceGuid, result.ownerPrincipalGuid],
    );
    expect(membership.rows[0]).toEqual({ role: "owner" });
  });

  it("ensureBootstrap is idempotent: calling it again returns the same ids and creates no duplicates", async () => {
    const first = await ensureBootstrap(pool, { schemaName, workspaceSlug: "default" });
    const second = await ensureBootstrap(pool, { schemaName, workspaceSlug: "default" });

    expect(second).toEqual(first);

    const workspaceCount = await pool.query(`SELECT count(*)::int AS n FROM "${schemaName}".workspaces WHERE workspace_slug = 'default'`);
    expect(workspaceCount.rows[0]!.n).toBe(1);

    const scopeCount = await pool.query(
      `SELECT count(*)::int AS n FROM "${schemaName}".scopes WHERE workspace_guid = $1 AND scope_slug = 'workspace'`,
      [first.workspaceGuid],
    );
    expect(scopeCount.rows[0]!.n).toBe(1);
  });

  it("owner sees the default scope with no grant row needed", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "owner-read-workspace" });
    const db = new KnowledgeDatabase(pool, schemaName, bootstrap);

    const scopes = await db.listScopes({
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
    });

    expect(scopes.map((s) => s.scopeSlug)).toContain("workspace");
  });

  it("listScopesForOwner uses the bootstrapped owner and workspace automatically", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "owner-convenience-workspace" });
    const db = new KnowledgeDatabase(pool, schemaName, bootstrap);

    const scopes = await db.listScopesForOwner();
    expect(scopes.map((s) => s.scopeSlug)).toContain("workspace");
  });

  it("a member with no grant row sees no scopes (deny by default)", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "member-denied-workspace" });
    const memberPrincipalGuid = await insertMemberPrincipal(pool, schemaName, bootstrap.workspaceGuid, "denied-member");
    const db = new KnowledgeDatabase(pool, schemaName, bootstrap);

    const scopes = await db.listScopes({
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: memberPrincipalGuid,
      role: "member",
    });

    expect(scopes).toEqual([]);
  });

  it("a member with a live read grant sees the granted scope", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "member-granted-workspace" });
    const memberPrincipalGuid = await insertMemberPrincipal(pool, schemaName, bootstrap.workspaceGuid, "granted-member");

    await pool.query(
      `INSERT INTO "${schemaName}".scope_grants (grant_guid, workspace_guid, scope_guid, principal_guid, permission, granted_by_principal_guid)
       VALUES ($1, $2, $3, $4, 'read', $5)`,
      [randomUUID(), bootstrap.workspaceGuid, bootstrap.defaultScopeGuid, memberPrincipalGuid, bootstrap.ownerPrincipalGuid],
    );

    const db = new KnowledgeDatabase(pool, schemaName, bootstrap);
    const scopes = await db.listScopes({
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: memberPrincipalGuid,
      role: "member",
    });

    expect(scopes.map((s) => s.scopeSlug)).toEqual(["workspace"]);
  });

  it("a member with a retired grant sees no scopes", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "member-retired-workspace" });
    const memberPrincipalGuid = await insertMemberPrincipal(pool, schemaName, bootstrap.workspaceGuid, "retired-member");

    await pool.query(
      `INSERT INTO "${schemaName}".scope_grants (grant_guid, workspace_guid, scope_guid, principal_guid, permission, granted_by_principal_guid, retired_at)
       VALUES ($1, $2, $3, $4, 'read', $5, now())`,
      [randomUUID(), bootstrap.workspaceGuid, bootstrap.defaultScopeGuid, memberPrincipalGuid, bootstrap.ownerPrincipalGuid],
    );

    const db = new KnowledgeDatabase(pool, schemaName, bootstrap);
    const scopes = await db.listScopes({
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: memberPrincipalGuid,
      role: "member",
    });

    expect(scopes).toEqual([]);
  });

  it("rejects a 'user' principal with no user_guid, and a 'service' principal that carries one", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "principal-shape-workspace" });

    await expect(
      pool.query(
        `INSERT INTO "${schemaName}".principals (workspace_guid, principal_guid, principal_type, user_guid, display_name)
         VALUES ($1, $2, 'user', NULL, 'user principal with no identity')`,
        [bootstrap.workspaceGuid, randomUUID()],
      ),
    ).rejects.toThrow(/principal_identity_shape/);

    const someUser = await pool.query<{ user_guid: string }>(`SELECT user_guid FROM "${schemaName}".users LIMIT 1`);

    await expect(
      pool.query(
        `INSERT INTO "${schemaName}".principals (workspace_guid, principal_guid, principal_type, user_guid, display_name)
         VALUES ($1, $2, 'service', $3, 'service principal with a user')`,
        [bootstrap.workspaceGuid, randomUUID(), someUser.rows[0]!.user_guid],
      ),
    ).rejects.toThrow(/principal_identity_shape/);

    // A service principal with no user_guid is the valid shape and must still be accepted.
    await expect(
      pool.query(
        `INSERT INTO "${schemaName}".principals (workspace_guid, principal_guid, principal_type, user_guid, display_name)
         VALUES ($1, $2, 'service', NULL, 'valid service principal')`,
        [bootstrap.workspaceGuid, randomUUID()],
      ),
    ).resolves.toBeDefined();
  });

  it("allows only one live grant per (workspace, principal, scope) but any number of retired ones", async () => {
    const bootstrap = await ensureBootstrap(pool, { schemaName, workspaceSlug: "grant-uniqueness-workspace" });
    const memberPrincipalGuid = await insertMemberPrincipal(pool, schemaName, bootstrap.workspaceGuid, "dup-grant-member");

    const insertGrant = (retired: boolean) =>
      pool.query(
        `INSERT INTO "${schemaName}".scope_grants
           (grant_guid, workspace_guid, scope_guid, principal_guid, permission, granted_by_principal_guid, retired_at)
         VALUES ($1, $2, $3, $4, 'read', $5, ${retired ? "now()" : "NULL"})`,
        [
          randomUUID(),
          bootstrap.workspaceGuid,
          bootstrap.defaultScopeGuid,
          memberPrincipalGuid,
          bootstrap.ownerPrincipalGuid,
        ],
      );

    await expect(insertGrant(false)).resolves.toBeDefined();
    await expect(insertGrant(false)).rejects.toThrow(/scope_grants_live_unique_idx/);

    // Retired rows are history and may pile up freely.
    await expect(insertGrant(true)).resolves.toBeDefined();
    await expect(insertGrant(true)).resolves.toBeDefined();

    // The single live grant still resolves to exactly one scope, not a duplicate listing.
    const db = new KnowledgeDatabase(pool, schemaName, bootstrap);
    const scopes = await db.listScopes({
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: memberPrincipalGuid,
      role: "member",
    });
    expect(scopes.map((s) => s.scopeSlug)).toEqual(["workspace"]);
  });

  it("rejects a scope_grants row whose scope belongs to a different workspace (composite FK isolation)", async () => {
    const workspaceA = await ensureBootstrap(pool, { schemaName, workspaceSlug: "isolation-workspace-a" });
    const workspaceB = await ensureBootstrap(pool, { schemaName, workspaceSlug: "isolation-workspace-b" });
    const memberInB = await insertMemberPrincipal(pool, schemaName, workspaceB.workspaceGuid, "cross-workspace-member");

    await expect(
      pool.query(
        `INSERT INTO "${schemaName}".scope_grants (grant_guid, workspace_guid, scope_guid, principal_guid, permission, granted_by_principal_guid)
         VALUES ($1, $2, $3, $4, 'read', $5)`,
        [
          randomUUID(),
          workspaceB.workspaceGuid,
          workspaceA.defaultScopeGuid, // scope belongs to workspace A, workspace_guid column says B
          memberInB,
          workspaceB.ownerPrincipalGuid,
        ],
      ),
    ).rejects.toThrow();
  });
});

async function insertMemberPrincipal(
  pool: Pool,
  schemaName: string,
  workspaceGuid: string,
  slug: string,
): Promise<string> {
  // A 'user' principal must resolve to a real users row (principal_identity_shape), so mint
  // the backing identity alongside it rather than leaving user_guid null.
  const userGuid = randomUUID();
  await pool.query(
    `INSERT INTO "${schemaName}".users (user_guid, identity_issuer, identity_subject, display_name)
     VALUES ($1, 'test', $2, $3)`,
    [userGuid, `${slug}-${userGuid}`, slug],
  );

  const principalGuid = randomUUID();
  await pool.query(
    `INSERT INTO "${schemaName}".principals (workspace_guid, principal_guid, principal_type, user_guid, display_name)
     VALUES ($1, $2, 'user', $3, $4)`,
    [workspaceGuid, principalGuid, userGuid, slug],
  );
  await pool.query(
    `INSERT INTO "${schemaName}".workspace_memberships (workspace_guid, principal_guid, role, status)
     VALUES ($1, $2, 'member', 'active')`,
    [workspaceGuid, principalGuid],
  );
  return principalGuid;
}
