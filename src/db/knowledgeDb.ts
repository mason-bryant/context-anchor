import path from "node:path";

import type { Pool } from "pg";

import type { AppLogger } from "../logger.js";
import { resolveScopeAccess, type WorkspaceRole } from "./access.js";
import { parseChangeWindow } from "./changeWindow.js";
import { CommandHandler } from "./commandHandler.js";
import type { ScopeDeclaration } from "./scopeRegistry.js";
import {
  importDocuments,
  type ImportFile,
  type ImportReport,
  type Person,
  type ProjectMapping,
} from "./importDocuments.js";
import { listScopeChanges, type ScopeChange } from "./scopeChanges.js";
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

/** Guarded before a guid lookup so a non-uuid slug never reaches Postgres as a uuid cast. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ScopeNotFoundError extends Error {
  constructor(scope: string) {
    super(`No scope matched ${JSON.stringify(scope)} in this workspace (looked up by slug, then by guid).`);
    this.name = "ScopeNotFoundError";
  }
}

export class MigrationsPendingError extends Error {
  constructor(schemaName: string, pendingCount: number) {
    super(
      `Database schema "${schemaName}" has ${pendingCount} pending migration(s). ` +
        `Run \`anchor-mcp db migrate\` before starting the server.`,
    );
    this.name = "MigrationsPendingError";
  }
}

export class KnowledgeDatabase {
  constructor(
    private readonly pool: Pool,
    public readonly schemaName: string,
    public readonly bootstrap: BootstrapResult,
    /**
     * Migration id applied at startup. Safe to cache: the server refuses to start with
     * pending migrations, and migrations are only applied by the `db` CLI against a
     * stopped/serving-nothing schema, so this cannot drift while the process is up.
     */
    public readonly schemaVersion: number | undefined = undefined,
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

  /** T2's write, as the bootstrapped owner. Returns the report the UI renders. */
  async importDocumentsAsOwner(input: {
    repository: string;
    commitSha: string;
    files: ImportFile[];
    projectMappings?: ProjectMapping[];
    scopes?: ScopeDeclaration[];
    people?: Person[];
  }): Promise<ImportReport> {
    return importDocuments({
      pool: this.pool,
      schemaName: this.schemaName,
      handler: new CommandHandler(this.pool, this.schemaName),
      workspaceGuid: this.bootstrap.workspaceGuid,
      actorPrincipalGuid: this.bootstrap.ownerPrincipalGuid,
      ...input,
    });
  }

  /** T4's read, as the bootstrapped owner. `scope` may be a slug or a guid. */
  async listScopeChangesForOwner(input: { scope: string; since?: string; limit?: number }): Promise<ScopeChange[]> {
    // Parse `since` before touching the database so a malformed window fails fast rather
    // than after a scope lookup that will be thrown away.
    const since = parseChangeWindow(input.since);
    const scopeGuid = await this.resolveScopeGuid(input.scope);

    return listScopeChanges(this.pool, this.schemaName, {
      workspaceGuid: this.bootstrap.workspaceGuid,
      scopeGuid,
      since,
      limit: input.limit,
    });
  }

  /**
   * Slug first, then guid. Callers hold whichever they have — a URL and an agent both carry
   * the slug, internal code carries the guid — and an unknown value is an error rather than
   * an empty result, since "no such scope" and "nothing changed" are different facts.
   */
  private async resolveScopeGuid(scope: string): Promise<string> {
    const bySlug = await this.pool.query<{ scope_guid: string }>(
      `SELECT scope_guid FROM "${this.schemaName}".scopes
       WHERE workspace_guid = $1 AND scope_slug = $2 AND retired_at IS NULL`,
      [this.bootstrap.workspaceGuid, scope],
    );
    if (bySlug.rows[0]) {
      return bySlug.rows[0].scope_guid;
    }

    if (UUID_PATTERN.test(scope)) {
      const byGuid = await this.pool.query<{ scope_guid: string }>(
        `SELECT scope_guid FROM "${this.schemaName}".scopes
         WHERE workspace_guid = $1 AND scope_guid = $2 AND retired_at IS NULL`,
        [this.bootstrap.workspaceGuid, scope],
      );
      if (byGuid.rows[0]) {
        return byGuid.rows[0].scope_guid;
      }
    }

    throw new ScopeNotFoundError(scope);
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
    // Retired grants are excluded in SQL, not just in application code. They accumulate as
    // history, so without this predicate the query scales with total grants ever issued
    // rather than with live ones. Measured against 20k retired grants and one live grant:
    // without it, a Seq Scan over all 20,001 rows (cost 669.81); with it, a 1-row Nested
    // Loop (cost 16.32).
    //
    // PERMISSION semantics still belong to resolveScopeAccess — the single tested source of
    // truth for deny-by-default and "write implies read". The filter below therefore stays:
    // SQL narrows to live candidate rows, application code decides what they entitle. The
    // retiredAt check there is now redundant by construction, and kept deliberately so the
    // policy remains complete on its own rather than depending on its caller's WHERE clause.
    const result = await this.pool.query<ScopeRow & { grant_permission: "read" | "write"; grant_retired_at: Date | null }>(
      `SELECT s.scope_guid, s.scope_slug, s.scope_kind, s.title, s.summary, s.aliases,
              g.permission AS grant_permission, g.retired_at AS grant_retired_at
       FROM "${this.schemaName}".scopes s
       JOIN "${this.schemaName}".scope_grants g
         ON g.workspace_guid = s.workspace_guid AND g.scope_guid = s.scope_guid
       WHERE s.workspace_guid = $1
         AND g.principal_guid = $2
         AND g.retired_at IS NULL
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
      schemaVersion: status.currentVersion,
      workspaceGuid: bootstrap.workspaceGuid,
    });

    return new KnowledgeDatabase(pool, resolvedConfig.schemaName, bootstrap, status.currentVersion);
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}
