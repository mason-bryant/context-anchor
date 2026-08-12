import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { Pool, PoolClient } from "pg";

import type { AppLogger } from "../logger.js";
import { assertValidSchemaName } from "./config.js";

export type MigrationFile = {
  id: number;
  name: string;
  filename: string;
};

const MIGRATION_FILENAME_PATTERN = /^(\d{4,})_([a-z0-9_]+)\.sql$/;

/** Pure filename parser: no I/O, so it is unit-testable without a migrations directory. */
export function parseMigrationFilename(filename: string): MigrationFile | undefined {
  const match = MIGRATION_FILENAME_PATTERN.exec(filename);
  if (!match) {
    return undefined;
  }
  return { id: Number(match[1]), name: match[2]!, filename };
}

/** Pure diff: which available migrations are not yet in the applied set, sorted ascending by id. */
export function planPendingMigrations(available: MigrationFile[], appliedIds: Iterable<number>): MigrationFile[] {
  const applied = new Set(appliedIds);
  return [...available].sort((a, b) => a.id - b.id).filter((file) => !applied.has(file.id));
}

export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir);
  const files: MigrationFile[] = [];
  const seenIds = new Map<number, string>();

  for (const entry of entries) {
    const parsed = parseMigrationFilename(entry);
    if (!parsed) {
      continue;
    }
    const existing = seenIds.get(parsed.id);
    if (existing) {
      throw new Error(`Duplicate migration id ${parsed.id}: "${existing}" and "${parsed.filename}"`);
    }
    seenIds.set(parsed.id, parsed.filename);
    files.push(parsed);
  }

  return files.sort((a, b) => a.id - b.id);
}

type AppliedMigrationRow = {
  id: number;
  name: string;
  checksum: string;
  appliedAt: Date;
};

export class MigrationChecksumMismatchError extends Error {
  constructor(
    public readonly migration: MigrationFile,
    public readonly expectedChecksum: string,
    public readonly actualChecksum: string,
  ) {
    super(
      `Migration ${migration.filename} has already been applied but its content on disk no longer matches ` +
        `what was recorded (expected checksum ${expectedChecksum}, found ${actualChecksum}). Applied migrations ` +
        `must never be edited; add a new migration file instead.`,
    );
    this.name = "MigrationChecksumMismatchError";
  }
}

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * Creates the schema and its bookkeeping table. Only `runMigrations` may call this.
 *
 * Kept separate from the status read on purpose. When both shared one helper, asking whether a
 * schema was migrated *created* it, so every status probe against a name that did not exist left
 * an empty schema behind — including probes on paths that then refused to proceed. That silently
 * grew a thousand orphan schemas in the development database, and it made `db status` against a
 * mistyped schema name answer "0 applied, N pending" (which reads as "run the migrations")
 * instead of "no such schema".
 */
async function ensureMigrationsTable(pool: Pool, schemaName: string): Promise<void> {
  assertValidSchemaName(schemaName);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".schema_migrations (
      id integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * The read half: reports what is there without bringing any of it into being.
 *
 * A schema can also exist without the bookkeeping table — something else created the namespace,
 * or a migration run died between the two statements above. That reads the same as an unmigrated
 * schema, which is the truthful answer: nothing has been applied.
 */
async function readAppliedMigrations(
  pool: Pool,
  schemaName: string,
): Promise<{ schemaPresent: boolean; applied: AppliedMigrationRow[] }> {
  assertValidSchemaName(schemaName);

  const present = await pool.query<{ schema_present: boolean; table_present: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS schema_present,
       to_regclass(format('%I.schema_migrations', $1::text)) IS NOT NULL AS table_present`,
    [schemaName],
  );
  const row = present.rows[0];
  if (!row?.schema_present) {
    return { schemaPresent: false, applied: [] };
  }
  if (!row.table_present) {
    return { schemaPresent: true, applied: [] };
  }

  return { schemaPresent: true, applied: await getAppliedMigrations(pool, schemaName) };
}

async function getAppliedMigrations(pool: Pool, schemaName: string): Promise<AppliedMigrationRow[]> {
  const result = await pool.query<{ id: number; name: string; checksum: string; applied_at: Date }>(
    `SELECT id, name, checksum, applied_at FROM "${schemaName}".schema_migrations ORDER BY id`,
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, checksum: row.checksum, appliedAt: row.applied_at }));
}

async function assertNoChecksumDrift(
  files: MigrationFile[],
  applied: AppliedMigrationRow[],
  migrationsDir: string,
): Promise<void> {
  const appliedById = new Map(applied.map((row) => [row.id, row]));
  for (const file of files) {
    const appliedRow = appliedById.get(file.id);
    if (!appliedRow) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file.filename), "utf8");
    const actualChecksum = checksumOf(sql);
    if (actualChecksum !== appliedRow.checksum) {
      throw new MigrationChecksumMismatchError(file, appliedRow.checksum, actualChecksum);
    }
  }
}

export type MigrationStatus = {
  schemaName: string;
  /**
   * False when the schema does not exist at all, which is different from existing with nothing
   * applied. Both report every migration as pending, but only one of them means the caller is
   * probably looking at the wrong schema name.
   */
  schemaPresent: boolean;
  appliedCount: number;
  pendingCount: number;
  currentVersion: number | undefined;
  pending: MigrationFile[];
};

/** Read-only: never creates the schema it is asked about. See `ensureMigrationsTable`. */
export async function getMigrationStatus(
  pool: Pool,
  options: { schemaName: string; migrationsDir: string },
): Promise<MigrationStatus> {
  assertValidSchemaName(options.schemaName);

  const files = await loadMigrationFiles(options.migrationsDir);
  const { schemaPresent, applied } = await readAppliedMigrations(pool, options.schemaName);
  await assertNoChecksumDrift(files, applied, options.migrationsDir);

  const pending = planPendingMigrations(files, applied.map((row) => row.id));

  return {
    schemaName: options.schemaName,
    schemaPresent,
    appliedCount: applied.length,
    pendingCount: pending.length,
    currentVersion: applied.length > 0 ? Math.max(...applied.map((row) => row.id)) : undefined,
    pending,
  };
}

async function applyOneMigration(
  client: PoolClient,
  schemaName: string,
  migrationsDir: string,
  file: MigrationFile,
): Promise<void> {
  const sql = await readFile(path.join(migrationsDir, file.filename), "utf8");
  const checksum = checksumOf(sql);

  await client.query("BEGIN");
  try {
    // SET LOCAL is transaction-scoped, so a pooled connection's search_path never leaks
    // across migrations or to whichever caller borrows the connection next.
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    await client.query(sql);
    await client.query(
      `INSERT INTO "${schemaName}".schema_migrations (id, name, checksum) VALUES ($1, $2, $3)`,
      [file.id, file.name, checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(
  pool: Pool,
  options: { schemaName: string; migrationsDir: string; logger?: AppLogger },
): Promise<{ applied: MigrationFile[] }> {
  assertValidSchemaName(options.schemaName);
  await ensureMigrationsTable(pool, options.schemaName);

  const files = await loadMigrationFiles(options.migrationsDir);
  const appliedRows = await getAppliedMigrations(pool, options.schemaName);
  await assertNoChecksumDrift(files, appliedRows, options.migrationsDir);

  const pending = planPendingMigrations(files, appliedRows.map((row) => row.id));
  const applied: MigrationFile[] = [];

  const client = await pool.connect();
  try {
    for (const file of pending) {
      options.logger?.info("applying database migration", { schemaName: options.schemaName, migration: file.filename });
      await applyOneMigration(client, options.schemaName, options.migrationsDir, file);
      applied.push(file);
    }
  } finally {
    client.release();
  }

  return { applied };
}
