import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertComposeManagedTarget, COMPOSE_MANAGED_DATABASE_URL, type DbCliArgs } from "../db/cliArgs.js";
import { createKnowledgeDatabase } from "../db/knowledgeDb.js";
import { CliUsageError } from "./errors.js";
import { collectRepositorySnapshot } from "./repositorySnapshot.js";
import { redactDatabaseUrl, telemetrySchemaNameFor } from "../db/config.js";
import { getMigrationStatus, runMigrations } from "../db/migrate.js";
import {
  DEFAULT_TELEMETRY_RETENTION,
  telemetryRetentionStatus,
  type TelemetryRetentionPolicy,
  type TelemetryRetentionStatus,
} from "../db/telemetryRetention.js";

/**
 * Package root, resolving correctly both from `src/` under tsx and from `dist/` in an
 * installed package — `migrations/` ships at the package root in both cases.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "migrations", "knowledge");
const TELEMETRY_MIGRATIONS_DIR = path.join(PACKAGE_ROOT, "migrations", "telemetry");
const DATA_DIR = path.join(PACKAGE_ROOT, ".data", "postgres");
const COMPOSE_FILE = path.join(PACKAGE_ROOT, "docker-compose.yml");

/** Commands that drive the compose container rather than talking to whatever DATABASE_URL points at. */
const COMPOSE_COMMANDS = new Set<DbCliArgs["command"]>(["up", "down", "psql", "reset"]);

export type DbCommandContext = {
  databaseUrl: string;
  schemaName: string;
  /** Anchor repository to import from; only `db import` reads it. */
  repoPath?: string;
  /** The server's retention windows, so `db thin` and `db status` apply the configured policy. */
  telemetryRetention?: TelemetryRetentionPolicy;
  log?: (message: string) => void;
};

function requireComposeFile(command: string): void {
  if (existsSync(COMPOSE_FILE)) {
    return;
  }
  // An installed package ships migrations/ but not docker-compose.yml, so these commands
  // have no container to act on. Say that, rather than failing inside `docker compose`.
  throw new CliUsageError(
    `"db ${command}" manages the Postgres container declared in this repository's docker-compose.yml, ` +
      `which is not part of the installed package. Point DATABASE_URL at your own Postgres and use ` +
      `"anchor-mcp db migrate" and "anchor-mcp db status" instead.`,
  );
}

function dockerCompose(args: string[]): void {
  const result = spawnSync("docker", ["compose", ...args], { cwd: PACKAGE_ROOT, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} exited with code ${String(result.status)}`);
  }
}

async function waitForReady(databaseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    // Bound each attempt, or one hung connect outlives the wall-clock deadline and the
    // command hangs instead of failing.
    const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `Postgres did not become ready within ${String(timeoutMs)}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function migrate(context: DbCommandContext): Promise<void> {
  const log = context.log ?? console.log;
  const pool = new pg.Pool({ connectionString: context.databaseUrl, max: 2 });
  try {
    // Two schemas, migrated together: telemetry is separated for retention, not because it
    // has an independent lifecycle, and letting them drift apart would mean the server
    // could start against a knowledge schema whose telemetry tables do not exist yet.
    const targets = [
      { schemaName: context.schemaName, migrationsDir: MIGRATIONS_DIR },
      { schemaName: telemetrySchemaNameFor(context.schemaName), migrationsDir: TELEMETRY_MIGRATIONS_DIR },
    ];

    let total = 0;
    for (const target of targets) {
      const { applied } = await runMigrations(pool, target);
      total += applied.length;
      for (const file of applied) {
        log(`Applied ${target.schemaName}/${file.filename}`);
      }
    }
    if (total === 0) {
      log("No pending migrations.");
    }
  } finally {
    await pool.end();
  }
}

async function printStatus(context: DbCommandContext): Promise<void> {
  const log = context.log ?? console.log;
  const pool = new pg.Pool({ connectionString: context.databaseUrl, max: 2 });
  try {
    for (const target of [
      { schemaName: context.schemaName, migrationsDir: MIGRATIONS_DIR },
      { schemaName: telemetrySchemaNameFor(context.schemaName), migrationsDir: TELEMETRY_MIGRATIONS_DIR },
    ]) {
      const status = await getMigrationStatus(pool, target);
      // Said plainly, because this command used to create whatever schema it was pointed at and
      // then report it as merely unmigrated — so a mistyped `--schema` produced a plausible
      // "0 applied, N pending" instead of telling the operator the name does not exist.
      log(`schema: ${status.schemaName}${status.schemaPresent ? "" : "  (does not exist)"}`);
      log(`  applied: ${String(status.appliedCount)}  pending: ${String(status.pendingCount)}  version: ${status.currentVersion ?? "none"}`);
      for (const file of status.pending) {
        log(`  pending: ${file.filename}`);
      }
    }

    await printRetentionStatus(pool, context, log);
  } finally {
    await pool.end();
  }
}

/**
 * Postgres codes for "that schema or table does not exist": 3F000 invalid_schema_name and
 * 42P01 undefined_table.
 *
 * Matched on the code rather than the message, which is localized and reworded between server
 * versions -- a substring check would start swallowing nothing, or everything, on an upgrade.
 */
function isMissingRelationError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "3F000" || code === "42P01";
}

/**
 * The half of T-41 that is not the deleting: making the absence of retention visible.
 *
 * For as long as nothing ran the pass, nothing said so. An operator reading the telemetry tables
 * saw rows, which is also what a working retention pass leaves behind, so "never thinned" and
 * "thinned on schedule" looked identical from outside.
 *
 * Both lines are needed. The last run alone cannot tell a job that is keeping up from one that
 * ran once at boot and stopped; the backlog alone cannot tell a job that has never run from one
 * that ran a minute ago against a quiet workspace.
 */
async function printRetentionStatus(
  pool: pg.Pool,
  context: DbCommandContext,
  log: (message: string) => void,
): Promise<void> {
  const telemetrySchema = telemetrySchemaNameFor(context.schemaName);
  const policy = context.telemetryRetention ?? DEFAULT_TELEMETRY_RETENTION;

  let status: TelemetryRetentionStatus;
  try {
    status = await telemetryRetentionStatus(pool, telemetrySchema, policy);
  } catch (error) {
    // Only the two errors that mean "the schema is not there yet", which the migration lines
    // above already report plainly — repeating that as a retention failure would describe a
    // migration problem as a retention problem and send the operator after the wrong thing.
    //
    // Everything else is said out loud. This began as a bare `catch {}`, which also swallowed
    // permission errors, a dropped connection, and any bug in the query itself: `db status` would
    // print no retention line at all, and the one command an operator runs to find out whether
    // retention is happening would answer by omission.
    if (!isMissingRelationError(error)) {
      log(`retention: status unavailable — ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  log(`retention: task text ${String(policy.taskTextDays)}d, requests ${String(policy.requestDays)}d`);
  log(
    status.lastRanAt
      ? `  last run: ${status.lastRanAt}  (redacted ${String(status.lastTaskTextRedacted ?? 0)}, deleted ${String(status.lastRequestsDeleted ?? 0)})`
      : `  last run: never`,
  );
  log(
    `  past window now: ${String(status.taskTextPastWindow)} task text, ${String(status.requestsPastWindow)} request(s)`,
  );
}

/**
 * Runs the telemetry retention pass once and reports what it removed (T-41).
 *
 * The server schedules this itself, so the command is not how retention normally happens. It
 * exists for the operator who set `intervalHours: 0` to drive it from cron, and for the one who
 * wants to see the windows applied now rather than take the schedule on trust.
 *
 * Reads the policy from config rather than accepting flags. A one-off pass with a hand-typed
 * window would delete rows by a rule the running server does not share, and "how long is
 * telemetry kept" would have two answers.
 */
async function thinTelemetryNow(context: DbCommandContext): Promise<void> {
  const log = context.log ?? console.log;
  const db = await createKnowledgeDatabase(context.databaseUrl, { schemaName: context.schemaName });
  try {
    const policy = context.telemetryRetention ?? DEFAULT_TELEMETRY_RETENTION;
    const report = await db.thinTelemetry(policy);
    log(`policy: task text ${String(policy.taskTextDays)}d, requests ${String(policy.requestDays)}d`);
    log(`redacted: ${String(report.taskTextRedacted)} task text  deleted: ${String(report.requestsDeleted)} request(s)`);
    // Said explicitly. Zero is the expected result on a workspace inside its window, and it is
    // also what a pass pointed at the wrong schema returns -- so the two need telling apart.
    if (report.taskTextRedacted === 0 && report.requestsDeleted === 0) {
      log(`Nothing was past its window: no telemetry in ${db.telemetrySchemaName} is old enough to thin.`);
    }
    log(`took ${String(report.durationMs)}ms`);
  } finally {
    await db.close();
  }
}

/**
 * Drives T2 bootstrap import over a whole anchor repository. `importDocuments` takes an
 * assembled `files` payload, which is fine for a caller that already has the content and
 * useless from a shell; this reads the repository, pins the commit, and reports what landed.
 */
async function importRepository(allowDirty: boolean, context: DbCommandContext): Promise<void> {
  const log = context.log ?? console.log;
  if (!context.repoPath) {
    throw new CliUsageError(
      "No anchor repository resolved to import from; set repo in the config file or pass --repo.",
    );
  }

  const snapshot = await collectRepositorySnapshot(context.repoPath, { allowDirty });
  log(`Importing ${String(snapshot.files.length)} file(s) from ${snapshot.repository} at ${snapshot.commitSha}`);
  if (snapshot.dirty) {
    // Loud, because the recorded provenance is now knowingly inaccurate.
    log(`WARNING: the working tree is dirty, so the imported content does not match ${snapshot.commitSha}.`);
  }

  const db = await createKnowledgeDatabase(context.databaseUrl, { schemaName: context.schemaName });
  try {
    const report = await db.importDocumentsAsOwner({
      repository: snapshot.repository,
      commitSha: snapshot.commitSha,
      files: snapshot.files,
      projectMappings: snapshot.projectMappings,
      scopes: snapshot.scopes,
      people: snapshot.people,
      // db import always reads the whole repository at one commit, so it can honestly claim
      // to cover all of it — which is what lets a deleted file actually disappear.
      retireAbsentUnder: [""],
    });

    log(`batch: ${report.batchGuid}`);
    log(`documents: ${String(report.documentsImported)}  revisions: ${String(report.revisionsCreated)}`);
    log(`sections: ${String(report.sectionsCreated)}  blocks: ${String(report.blocksCreated)}`);
    log(`scopes: ${String(report.scopesCreated)}  relations: ${String(report.relationsCreated)}`);
    if (snapshot.scopes) {
      log(`  (${String(snapshot.scopes.length)} declared in project-mappings.json)`);
    }
    log(`associations: ${String(report.associationsDerived)}`);
    log(`mappings: ${String(report.mappingsImported)} imported, ${String(report.mappingsUpdated)} updated`);
    log(`people: ${String(report.peopleImported)}`);
    if (report.documentsRetired > 0) {
      log(`retired: ${String(report.documentsRetired)} document(s) no longer in the commit`);
    }
    log(`unchanged: ${String(report.unchanged.length)} file(s)`);

    // An all-zero report is the expected result of re-importing a commit, but it is
    // indistinguishable from an import that found nothing — and `unchanged` does not
    // disambiguate it, because the idempotency key short-circuits each command before
    // any content is compared. Say which one it was.
    if (report.documentsImported === 0 && report.unchanged.length === 0) {
      log(`Nothing was written: commit ${snapshot.commitSha} has already been imported into this schema.`);
    }
  } finally {
    await db.close();
  }
}

export async function runDbCommand(args: DbCliArgs, context: DbCommandContext): Promise<void> {
  const log = context.log ?? console.log;

  if (COMPOSE_COMMANDS.has(args.command)) {
    requireComposeFile(args.command);
    // Refuse rather than act on one database while migrating another.
    assertComposeManagedTarget(args.command, context.databaseUrl);
  }

  switch (args.command) {
    case "up": {
      dockerCompose(["up", "-d", "postgres"]);
      await waitForReady(context.databaseUrl);
      await migrate(context);
      log(`Postgres ready at ${redactDatabaseUrl(context.databaseUrl)}`);
      break;
    }
    case "down": {
      dockerCompose(["down"]);
      break;
    }
    case "status": {
      await printStatus(context);
      break;
    }
    case "migrate": {
      await migrate(context);
      break;
    }
    case "psql": {
      dockerCompose(["exec", "postgres", "psql", "-U", "anchor", "-d", "anchor_mcp"]);
      break;
    }
    case "import": {
      await importRepository(args.allowDirty, context);
      break;
    }
    case "thin": {
      await thinTelemetryNow(context);
      break;
    }
    case "reset": {
      dockerCompose(["down"]);
      if (existsSync(DATA_DIR)) {
        await rm(DATA_DIR, { recursive: true, force: true });
      }
      dockerCompose(["up", "-d", "postgres"]);
      await waitForReady(context.databaseUrl);
      await migrate(context);
      log(`Postgres reset and ready at ${redactDatabaseUrl(context.databaseUrl)}`);
      break;
    }
  }
}

export { COMPOSE_MANAGED_DATABASE_URL, MIGRATIONS_DIR };
