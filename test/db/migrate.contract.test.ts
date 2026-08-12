import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getMigrationStatus, runMigrations, MigrationChecksumMismatchError } from "../../src/db/migrate.js";
import { dropRegisteredSchemas, isTestDatabaseReachable, TEST_DATABASE_URL, testSchemaName } from "./testDatabase.js";
import { removeTempDir } from "../tempDir.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

describe.runIf(await isTestDatabaseReachable())("runMigrations / getMigrationStatus (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    // Unconditional: the registry holds every name this file took, not just the one the first
    // test assigns. Gating on `schemaName` would skip the backstop entirely under a filtered run
    // where that test never executed.
    await dropRegisteredSchemas(pool);
    await pool.end();
  });

  it("applies every committed migration to a fresh schema and reports it applied", async () => {
    schemaName = testSchemaName();

    const before = await getMigrationStatus(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    expect(before.pendingCount).toBeGreaterThan(0);
    expect(before.appliedCount).toBe(0);

    const { applied } = await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    expect(applied.length).toBeGreaterThan(0);

    const after = await getMigrationStatus(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    expect(after.pendingCount).toBe(0);
    expect(after.appliedCount).toBe(applied.length);
    expect(after.currentVersion).toBe(applied[applied.length - 1]!.id);

    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [schemaName],
    );
    const tableNames = tables.rows.map((row) => row.table_name);
    for (const expected of ["workspaces", "users", "principals", "workspace_memberships", "scope_grants", "scopes"]) {
      expect(tableNames).toContain(expected);
    }
  });

  it("re-running migrations against an already-migrated schema is a no-op", async () => {
    const localSchema = testSchemaName();
    try {
      const first = await runMigrations(pool, { schemaName: localSchema, migrationsDir: REAL_MIGRATIONS_DIR });
      expect(first.applied.length).toBeGreaterThan(0);

      const second = await runMigrations(pool, { schemaName: localSchema, migrationsDir: REAL_MIGRATIONS_DIR });
      expect(second.applied).toEqual([]);

      const status = await getMigrationStatus(pool, { schemaName: localSchema, migrationsDir: REAL_MIGRATIONS_DIR });
      expect(status.pendingCount).toBe(0);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${localSchema}" CASCADE`);
    }
  });

  it("throws if an already-applied migration file's content changes on disk", async () => {
    const localSchema = testSchemaName();
    const tmpMigrationsDir = await mkdtemp(path.join(os.tmpdir(), "knowledge-migrations-"));
    await writeFile(
      path.join(tmpMigrationsDir, "0001_widgets.sql"),
      "CREATE TABLE widgets (widget_guid uuid PRIMARY KEY);",
      "utf8",
    );

    try {
      await runMigrations(pool, { schemaName: localSchema, migrationsDir: tmpMigrationsDir });

      await writeFile(
        path.join(tmpMigrationsDir, "0001_widgets.sql"),
        "CREATE TABLE widgets (widget_guid uuid PRIMARY KEY, extra text);",
        "utf8",
      );

      await expect(
        runMigrations(pool, { schemaName: localSchema, migrationsDir: tmpMigrationsDir }),
      ).rejects.toThrow(MigrationChecksumMismatchError);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${localSchema}" CASCADE`);
      await removeTempDir(tmpMigrationsDir);
    }
  });

  it("rolls back a failing migration file so a retry starts clean", async () => {
    const localSchema = testSchemaName();
    const tmpMigrationsDir = await mkdtemp(path.join(os.tmpdir(), "knowledge-migrations-"));
    await writeFile(
      path.join(tmpMigrationsDir, "0001_ok.sql"),
      "CREATE TABLE ok_table (ok_guid uuid PRIMARY KEY);",
      "utf8",
    );
    await writeFile(path.join(tmpMigrationsDir, "0002_broken.sql"), "THIS IS NOT VALID SQL;", "utf8");

    try {
      await expect(runMigrations(pool, { schemaName: localSchema, migrationsDir: tmpMigrationsDir })).rejects.toThrow();

      const status = await getMigrationStatus(pool, { schemaName: localSchema, migrationsDir: tmpMigrationsDir });
      expect(status.appliedCount).toBe(1);
      expect(status.pendingCount).toBe(1);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${localSchema}" CASCADE`);
      await removeTempDir(tmpMigrationsDir);
    }
  });
});
