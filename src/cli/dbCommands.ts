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
      log(`schema: ${status.schemaName}`);
      log(`  applied: ${String(status.appliedCount)}  pending: ${String(status.pendingCount)}  version: ${status.currentVersion ?? "none"}`);
      for (const file of status.pending) {
        log(`  pending: ${file.filename}`);
      }
    }
  } finally {
    await pool.end();
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
