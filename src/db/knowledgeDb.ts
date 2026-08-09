import path from "node:path";

import type { Pool } from "pg";

import type { AppLogger } from "../logger.js";
import { resolveScopeAccess, type WorkspaceRole } from "./access.js";
import { resolveDatabaseConfig, type PartialDatabaseConfig } from "./config.js";
import { type BootstrapResult, ensureBootstrap } from "./bootstrap.js";
import { getMigrationStatus } from "./migrate.js";
import { createDatabasePool } from "./pool.js";

export type ScopeSummary = {
  scopeGuid: string;
  scopeSlug: string;
  scopeKind: string;
  title: string;
  summary: string | null;
  aliases: string[];
};

export class MigrationsPendingError extends Error {
  constructor(schemaName: string, pendingCount: number) {
    super(
      `Database schema "${schemaName}" has ${pendingCount} pending migration(s). ` +
        `Run \`npm run db:migrate\` (or \`db migrate\`) before starting the server.`,
    );
    this.name = "MigrationsPendingError";
  }
}

export class KnowledgeDatabase {
  constructor(
    private readonly pool: Pool,
    public readonly schemaName: string,
    public readonly bootstrap: BootstrapResult,
  ) {}

  async listScopes(input: { workspaceGuid: string; principalGuid: string; role: WorkspaceRole }): Promise<ScopeSummary[]> {
    if (input.role === "owner") {
      return this.listAllScopes(input.workspaceGuid);
    }
    return this.listGrantedScopes(input.workspaceGuid, input.principalGuid);
  }

  /** Convenience for the single-operator MCP surface: always acts as the bootstrapped owner. */
  async listScopesForOwner(): Promise<ScopeSummary[]> {
    return this.listScopes({
      workspaceGuid: this.bootstrap.workspaceGuid,
      principalGuid: this.bootstrap.ownerPrincipalGuid,
      role: "owner",
    });
  }

  private async listAllScopes(workspaceGuid: string): Promise<ScopeSummary[]> {
    const result = await this.pool.query<ScopeRow>(
      `SELECT scope_guid, scope_slug, scope_kind, title, summary, aliases
       FROM "${this.schemaName}".scopes
       WHERE workspace_guid = $1 AND retired_at IS NULL
       ORDER BY scope_slug`,
      [workspaceGuid],
    );
    return result.rows.map(toScopeSummary);
  }

  private async listGrantedScopes(workspaceGuid: string, principalGuid: string): Promise<ScopeSummary[]> {
    // Only the grant's permission/retired_at are evaluated in application code, through
    // resolveScopeAccess — the single tested source of truth for deny-by-default and "write
    // implies read." SQL narrows to candidate rows only; it must not re-decide access itself.
    const result = await this.pool.query<ScopeRow & { grant_permission: "read" | "write"; grant_retired_at: Date | null }>(
      `SELECT s.scope_guid, s.scope_slug, s.scope_kind, s.title, s.summary, s.aliases,
              g.permission AS grant_permission, g.retired_at AS grant_retired_at
       FROM "${this.schemaName}".scopes s
       JOIN "${this.schemaName}".scope_grants g
         ON g.workspace_guid = s.workspace_guid AND g.scope_guid = s.scope_guid
       WHERE s.workspace_guid = $1
         AND g.principal_guid = $2
         AND s.retired_at IS NULL
       ORDER BY s.scope_slug`,
      [workspaceGuid, principalGuid],
    );
    return result.rows
      .filter((row) =>
        resolveScopeAccess({
          role: "member",
          grant: { permission: row.grant_permission, retiredAt: row.grant_retired_at },
          permission: "read",
        }),
      )
      .map(toScopeSummary);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

type ScopeRow = {
  scope_guid: string;
  scope_slug: string;
  scope_kind: string;
  title: string;
  summary: string | null;
  aliases: string[] | null;
};

function toScopeSummary(row: ScopeRow): ScopeSummary {
  return {
    scopeGuid: row.scope_guid,
    scopeSlug: row.scope_slug,
    scopeKind: row.scope_kind,
    title: row.title,
    summary: row.summary,
    aliases: row.aliases ?? [],
  };
}

const KNOWLEDGE_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

export async function createKnowledgeDatabase(
  databaseUrl: string,
  config: PartialDatabaseConfig | undefined,
  logger?: AppLogger,
): Promise<KnowledgeDatabase> {
  const resolvedConfig = resolveDatabaseConfig(config);
  const pool = createDatabasePool(databaseUrl, resolvedConfig);

  try {
    const status = await getMigrationStatus(pool, {
      schemaName: resolvedConfig.schemaName,
      migrationsDir: KNOWLEDGE_MIGRATIONS_DIR,
    });
    if (status.pendingCount > 0) {
      throw new MigrationsPendingError(resolvedConfig.schemaName, status.pendingCount);
    }

    const bootstrap = await ensureBootstrap(pool, { schemaName: resolvedConfig.schemaName });
    logger?.info("knowledge database ready", {
      schemaName: resolvedConfig.schemaName,
      workspaceGuid: bootstrap.workspaceGuid,
    });

    return new KnowledgeDatabase(pool, resolvedConfig.schemaName, bootstrap);
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}
