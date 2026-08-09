import { randomUUID } from "node:crypto";
import os from "node:os";

import type { Pool } from "pg";

import { assertValidSchemaName } from "./config.js";

export type BootstrapResult = {
  workspaceGuid: string;
  workspaceSlug: string;
  ownerPrincipalGuid: string;
  defaultScopeGuid: string;
};

const DEFAULT_WORKSPACE_SLUG = "default";
const DEFAULT_SCOPE_SLUG = "workspace";
const LOCAL_IDENTITY_ISSUER = "local";

function defaultOwnerDisplayName(): string {
  try {
    return os.userInfo().username || "Operator";
  } catch {
    return "Operator";
  }
}

/**
 * Idempotent: safe to call on every server start. A single operator, one workspace, no
 * sharing surface for this release (goal 7) — `scope_grants` is intentionally left empty
 * by bootstrap; the owner role is what makes the workspace usable, not a grant row.
 */
export async function ensureBootstrap(
  pool: Pool,
  options: { schemaName: string; workspaceSlug?: string; ownerDisplayName?: string },
): Promise<BootstrapResult> {
  assertValidSchemaName(options.schemaName);
  const schema = options.schemaName;
  const workspaceSlug = options.workspaceSlug ?? DEFAULT_WORKSPACE_SLUG;
  const ownerDisplayName = options.ownerDisplayName ?? defaultOwnerDisplayName();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const workspaceGuid = await upsertBySlug(client, schema, "workspaces", "workspace_guid", "workspace_slug", workspaceSlug);

    const userGuid = await upsertUser(client, schema, ownerDisplayName);

    const ownerPrincipalGuid = await upsertOwnerPrincipal(client, schema, workspaceGuid, userGuid, ownerDisplayName);

    const defaultScopeGuid = await upsertDefaultScope(client, schema, workspaceGuid);

    await client.query("COMMIT");

    return { workspaceGuid, workspaceSlug, ownerPrincipalGuid, defaultScopeGuid };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertBySlug(
  client: Pick<Pool, "query">,
  schema: string,
  table: string,
  guidColumn: string,
  slugColumn: string,
  slug: string,
): Promise<string> {
  const existing = await client.query<{ guid: string }>(
    `SELECT "${guidColumn}" AS guid FROM "${schema}"."${table}" WHERE "${slugColumn}" = $1`,
    [slug],
  );
  if (existing.rows[0]) {
    return existing.rows[0].guid;
  }

  const guid = randomUUID();
  await client.query(
    `INSERT INTO "${schema}"."${table}" ("${guidColumn}", "${slugColumn}") VALUES ($1, $2)`,
    [guid, slug],
  );
  return guid;
}

async function upsertUser(client: Pick<Pool, "query">, schema: string, displayName: string): Promise<string> {
  const identitySubject = displayName;
  const existing = await client.query<{ user_guid: string }>(
    `SELECT user_guid FROM "${schema}".users WHERE identity_issuer = $1 AND identity_subject = $2`,
    [LOCAL_IDENTITY_ISSUER, identitySubject],
  );
  if (existing.rows[0]) {
    return existing.rows[0].user_guid;
  }

  const userGuid = randomUUID();
  await client.query(
    `INSERT INTO "${schema}".users (user_guid, identity_issuer, identity_subject, display_name) VALUES ($1, $2, $3, $4)`,
    [userGuid, LOCAL_IDENTITY_ISSUER, identitySubject, displayName],
  );
  return userGuid;
}

async function upsertOwnerPrincipal(
  client: Pick<Pool, "query">,
  schema: string,
  workspaceGuid: string,
  userGuid: string,
  displayName: string,
): Promise<string> {
  const existing = await client.query<{ principal_guid: string }>(
    `SELECT p.principal_guid
     FROM "${schema}".principals p
     JOIN "${schema}".workspace_memberships m
       ON m.workspace_guid = p.workspace_guid AND m.principal_guid = p.principal_guid
     WHERE p.workspace_guid = $1 AND p.user_guid = $2 AND m.role = 'owner'`,
    [workspaceGuid, userGuid],
  );
  if (existing.rows[0]) {
    return existing.rows[0].principal_guid;
  }

  const principalGuid = randomUUID();
  await client.query(
    `INSERT INTO "${schema}".principals (workspace_guid, principal_guid, principal_type, user_guid, display_name)
     VALUES ($1, $2, 'user', $3, $4)`,
    [workspaceGuid, principalGuid, userGuid, displayName],
  );
  await client.query(
    `INSERT INTO "${schema}".workspace_memberships (workspace_guid, principal_guid, role, status)
     VALUES ($1, $2, 'owner', 'active')`,
    [workspaceGuid, principalGuid],
  );
  return principalGuid;
}

async function upsertDefaultScope(client: Pick<Pool, "query">, schema: string, workspaceGuid: string): Promise<string> {
  const existing = await client.query<{ scope_guid: string }>(
    `SELECT scope_guid FROM "${schema}".scopes WHERE workspace_guid = $1 AND scope_slug = $2`,
    [workspaceGuid, DEFAULT_SCOPE_SLUG],
  );
  if (existing.rows[0]) {
    return existing.rows[0].scope_guid;
  }

  const scopeGuid = randomUUID();
  await client.query(
    `INSERT INTO "${schema}".scopes (workspace_guid, scope_guid, scope_slug, scope_kind, title)
     VALUES ($1, $2, $3, 'workspace', 'Workspace')`,
    [workspaceGuid, scopeGuid, DEFAULT_SCOPE_SLUG],
  );
  return scopeGuid;
}
