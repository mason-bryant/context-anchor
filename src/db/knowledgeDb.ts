import path from "node:path";

import type { Pool } from "pg";

import type { AppLogger } from "../logger.js";
import { resolveScopeAccess, type WorkspaceRole } from "./access.js";
import { parseChangeWindow } from "./changeWindow.js";
import { recordedQuestions, type QuestionsQuery, type RecordedQuestion } from "./questions.js";
import {
  DEFAULT_TELEMETRY_RETENTION,
  telemetryRetentionStatus,
  thinTelemetry,
  type TelemetryRetentionPolicy,
  type TelemetryRetentionReport,
  type TelemetryRetentionStatus,
} from "./telemetryRetention.js";
import { CommandHandler } from "./commandHandler.js";
import { isGuid } from "./guids.js";
import type { ScopeDeclaration } from "./scopeRegistry.js";
import { routingDiagnostics, type RoutingDiagnostics } from "./comparison.js";
import {
  planRoutedBundle,
  reportRecordUse,
  type PlanRequest,
  type PlanOptions,
  type PlanResult,
  type RecordUse,
  type RecordUseResult,
} from "./routing/plan.js";
import {
  importDocuments,
  type ImportFile,
  type ImportReport,
  type Person,
  type ProjectMapping,
} from "./importDocuments.js";
import { addCitation, type AddCitationInput, type AddCitationResult } from "./addCitation.js";
import { retireAssertion, type RetireAssertionInput, type RetireAssertionResult } from "./retireAssertion.js";
import { updateAssertion, type UpdateAssertionInput, type UpdateAssertionResult } from "./updateAssertion.js";
import { createAssertion, type CreateAssertionInput, type CreateAssertionResult } from "./createAssertion.js";
import {
  createAssertionRelation,
  type CreateAssertionRelationInput,
  type CreateAssertionRelationResult,
} from "./createAssertionRelation.js";
import { setAssertionStatus, type SetAssertionStatusInput, type SetAssertionStatusResult } from "./setAssertionStatus.js";
import { setRecordScopes, type SetRecordScopesInput, type SetRecordScopesResult } from "./setRecordScopes.js";
import { listScopeChanges, type ScopeChange } from "./scopeChanges.js";
import {
  DEFAULT_STORE_TASK_TEXT,
  resolveDatabaseConfig,
  telemetrySchemaNameFor,
  type PartialDatabaseConfig,
} from "./config.js";
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

export class ScopeNotFoundError extends Error {
  constructor(scope: string) {
    super(`No scope matched ${JSON.stringify(scope)} in this workspace (looked up by slug, then by guid).`);
    this.name = "ScopeNotFoundError";
  }
}

export class MigrationsPendingError extends Error {
  constructor(schemaName: string, pendingCount: number, schemaPresent = true) {
    super(
      // An absent schema and an unmigrated one both leave every migration pending, but they call
      // for different actions: one is "migrate", the other is usually "you named the wrong
      // schema". Startup used to create the schema while checking it, which made the difference
      // unobservable — now that the check is read-only, it is worth saying out loud.
      (schemaPresent
        ? `Database schema "${schemaName}" has ${pendingCount} pending migration(s). `
        : `Database schema "${schemaName}" does not exist, so all ${pendingCount} migration(s) are pending. ` +
          `If that name is unexpected, check the configured schema before migrating. `) +
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
    /** Sibling schema holding retrieval telemetry; separated for retention, migrated in lockstep. */
    public readonly telemetrySchemaName: string = telemetrySchemaNameFor(schemaName),
    /**
     * Whether this workspace retains task text at all. An operator's answer, and it overrides
     * a caller's — a per-request flag cannot express "this workspace does not keep questions",
     * because every client would have to agree and traffic you do not control never will.
     */
    public readonly storeTaskText: boolean = DEFAULT_STORE_TASK_TEXT,
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
  /** Routed retrieval (T1), always as the workspace owner in this single-operator release. */
  async planRoutedBundleAsOwner(
    input: PlanRequest,
    options?: PlanOptions,
  ): Promise<PlanResult> {
    return planRoutedBundle(
      this.pool,
      this.schemaName,
      this.telemetrySchemaName,
      {
        ...input,
        // The operator's setting can only ever withhold. Off for the workspace means off
        // whatever a caller asks; on leaves the choice with the caller, who may still refuse
        // to have one particular question kept.
        storeTaskText: this.storeTaskText === false ? false : input.storeTaskText,
        workspaceGuid: this.bootstrap.workspaceGuid,
        principalGuid: this.bootstrap.ownerPrincipalGuid,
        // Single-operator release: the authenticated caller is the workspace owner, who is
        // entitled to every scope without a grant row. Decided here rather than accepted
        // from the caller — PlanRequest omits it — so that when a second principal exists
        // this becomes a resolution step rather than an assumption baked into the query.
        role: "owner",
      },
      options,
    );
  }

  /** T8 diagnostics: what callers were actually offered, read from telemetry rather than replayed. */
  async routingDiagnosticsAsOwner(options?: { sinceDays?: number }): Promise<RoutingDiagnostics> {
    return routingDiagnostics(this.pool, this.telemetrySchemaName, this.bootstrap.workspaceGuid, options ?? {});
  }

  async reportRecordUseAsOwner(use: RecordUse): Promise<RecordUseResult> {
    return reportRecordUse(this.pool, this.telemetrySchemaName, use);
  }

  async importDocumentsAsOwner(input: {
    repository: string;
    commitSha: string;
    files: ImportFile[];
    projectMappings?: ProjectMapping[];
    scopes?: ScopeDeclaration[];
    people?: Person[];
    retireAbsentUnder?: string[];
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

  /**
   * T3's writes, as the bootstrapped owner. Each takes a fresh CommandHandler for the same
   * reason import does: a handler holds no state between commands, and sharing one would only
   * couple unrelated calls.
   */
  private writeContext() {
    return {
      pool: this.pool,
      schemaName: this.schemaName,
      handler: new CommandHandler(this.pool, this.schemaName),
      workspaceGuid: this.bootstrap.workspaceGuid,
      actorPrincipalGuid: this.bootstrap.ownerPrincipalGuid,
    };
  }

  async createAssertionAsOwner(
    input: Omit<CreateAssertionInput, "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid">,
  ): Promise<CreateAssertionResult> {
    return createAssertion({ ...this.writeContext(), ...input });
  }

  async setAssertionStatusAsOwner(
    input: Omit<SetAssertionStatusInput, "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid">,
  ): Promise<SetAssertionStatusResult> {
    return setAssertionStatus({ ...this.writeContext(), ...input });
  }

  async updateAssertionAsOwner(
    input: Omit<UpdateAssertionInput, "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid">,
  ): Promise<UpdateAssertionResult> {
    return updateAssertion({ ...this.writeContext(), ...input });
  }

  async retireAssertionAsOwner(
    input: Omit<RetireAssertionInput, "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid">,
  ): Promise<RetireAssertionResult> {
    return retireAssertion({ ...this.writeContext(), ...input });
  }

  async addCitationAsOwner(
    input: Omit<AddCitationInput, "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid">,
  ): Promise<AddCitationResult> {
    return addCitation({ ...this.writeContext(), ...input });
  }

  async createAssertionRelationAsOwner(
    input: Omit<
      CreateAssertionRelationInput,
      "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid"
    >,
  ): Promise<CreateAssertionRelationResult> {
    return createAssertionRelation({ ...this.writeContext(), ...input });
  }

  async setRecordScopesAsOwner(
    input: Omit<SetRecordScopesInput, "pool" | "schemaName" | "handler" | "workspaceGuid" | "actorPrincipalGuid">,
  ): Promise<SetRecordScopesResult> {
    return setRecordScopes({ ...this.writeContext(), ...input });
  }

  /**
   * Applies the telemetry retention windows (T-41).
   *
   * On the facade rather than reached through a pool from outside, so retention goes through the
   * same boundary as every other database operation and cannot quietly grow into a caller that
   * writes to the knowledge schema -- the separation the two-schema split exists to enforce.
   */
  async thinTelemetry(
    policy: TelemetryRetentionPolicy = DEFAULT_TELEMETRY_RETENTION,
  ): Promise<TelemetryRetentionReport> {
    return thinTelemetry(this.pool, this.telemetrySchemaName, policy);
  }

  /** Whether retention is actually happening: when it last ran, and what is past its window. */
  async telemetryRetentionStatus(
    policy: TelemetryRetentionPolicy = DEFAULT_TELEMETRY_RETENTION,
  ): Promise<TelemetryRetentionStatus> {
    return telemetryRetentionStatus(this.pool, this.telemetrySchemaName, policy);
  }

  /**
   * The questions this workspace was asked, as the bootstrapped owner.
   *
   * Reads telemetry rather than knowledge, so it can never affect what routing returns — the
   * design keeps usage data diagnostic until a ranker deliberately reads a named snapshot.
   */
  async recordedQuestionsForOwner(
    query: Omit<QuestionsQuery, "workspaceGuid">,
  ): Promise<RecordedQuestion[]> {
    return recordedQuestions(this.pool, this.telemetrySchemaName, {
      ...query,
      workspaceGuid: this.bootstrap.workspaceGuid,
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

    // Guarded before the guid lookup so a non-uuid slug never reaches Postgres as a uuid cast.
    if (isGuid(scope)) {
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
const TELEMETRY_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/telemetry");

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
      throw new MigrationsPendingError(resolvedConfig.schemaName, status.pendingCount, status.schemaPresent);
    }

    // Checked with the same refusal as knowledge: retrieval writes telemetry on every
    // request, so starting against a schema whose telemetry tables are missing would fail
    // at the first query rather than at startup, where it is diagnosable.
    const telemetrySchemaName = telemetrySchemaNameFor(resolvedConfig.schemaName);
    const telemetryStatus = await getMigrationStatus(pool, {
      schemaName: telemetrySchemaName,
      migrationsDir: TELEMETRY_MIGRATIONS_DIR,
    });
    if (telemetryStatus.pendingCount > 0) {
      throw new MigrationsPendingError(
        telemetrySchemaName,
        telemetryStatus.pendingCount,
        telemetryStatus.schemaPresent,
      );
    }

    const bootstrap = await ensureBootstrap(pool, { schemaName: resolvedConfig.schemaName });
    logger?.info("knowledge database ready", {
      schemaName: resolvedConfig.schemaName,
      schemaVersion: status.currentVersion,
      workspaceGuid: bootstrap.workspaceGuid,
    });

    return new KnowledgeDatabase(
      pool,
      resolvedConfig.schemaName,
      bootstrap,
      status.currentVersion,
      telemetrySchemaName,
      resolvedConfig.storeTaskText,
    );
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}
