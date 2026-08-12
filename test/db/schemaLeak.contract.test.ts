import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getMigrationStatus, runMigrations } from "../../src/db/migrate.js";
import { createKnowledgeDatabase, MigrationsPendingError } from "../../src/db/knowledgeDb.js";
import {
  dropRegisteredSchemas,
  isTestDatabaseReachable,
  testSchemaName,
  TEST_DATABASE_URL,
} from "./testDatabase.js";

const KNOWLEDGE_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

/**
 * Guards the two ways this repository accumulated a thousand orphan schemas in its development
 * database, both of which passed every test at the time.
 *
 * The leak was invisible because nothing ever asserted on schemas a test did not name. A suite
 * can be entirely green while leaving fifteen schemas behind per run, and the only symptom is a
 * database that slowly fills with names nobody recognises.
 */
describe.runIf(await isTestDatabaseReachable())("schema creation is confined to migrations", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
  });

  afterAll(async () => {
    await dropRegisteredSchemas(pool);
    await pool.end();
  });

  async function schemaExists(schemaName: string): Promise<boolean> {
    const result = await pool.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS present`,
      [schemaName],
    );
    return result.rows[0]?.present === true;
  }

  it("reports status for a schema that does not exist without bringing it into being", async () => {
    const schemaName = testSchemaName();
    expect(await schemaExists(schemaName)).toBe(false);

    const status = await getMigrationStatus(pool, {
      schemaName,
      migrationsDir: KNOWLEDGE_MIGRATIONS_DIR,
    });

    expect(status.schemaPresent).toBe(false);
    expect(status.appliedCount).toBe(0);
    expect(status.pendingCount).toBeGreaterThan(0);
    // The whole point: asking the question left nothing behind.
    expect(await schemaExists(schemaName)).toBe(false);
  });

  it("distinguishes an absent schema from one that exists with nothing applied", async () => {
    const schemaName = testSchemaName();
    await pool.query(`CREATE SCHEMA "${schemaName}"`);

    const status = await getMigrationStatus(pool, {
      schemaName,
      migrationsDir: KNOWLEDGE_MIGRATIONS_DIR,
    });

    // Same counts as the absent case, different diagnosis — which is why the flag exists.
    expect(status.schemaPresent).toBe(true);
    expect(status.appliedCount).toBe(0);
  });

  it("creates no telemetry schema when startup refuses because telemetry is unmigrated", async () => {
    const schemaName = testSchemaName();
    const telemetryName = `${schemaName}_telemetry`;
    // Knowledge migrated, telemetry deliberately not. Without this the refusal comes from the
    // knowledge check and returns before telemetry is ever probed — so the leak this test exists
    // for would not be reachable, and the test would pass against the bug.
    await runMigrations(pool, { schemaName, migrationsDir: KNOWLEDGE_MIGRATIONS_DIR });

    await expect(
      createKnowledgeDatabase(TEST_DATABASE_URL, { poolSize: 2, schemaName }),
    ).rejects.toThrow(MigrationsPendingError);

    // Startup probes telemetry as well as knowledge. While that probe created what it measured,
    // every refused startup left a telemetry schema behind — including for callers that never
    // mentioned telemetry at all. That is precisely how startupFailureCleanup, a test with no
    // interest in telemetry, leaked a schema on every run.
    expect(await schemaExists(telemetryName)).toBe(false);
  });

  it("still creates the schema when migrations are actually run", async () => {
    const schemaName = testSchemaName();
    await runMigrations(pool, { schemaName, migrationsDir: KNOWLEDGE_MIGRATIONS_DIR });

    expect(await schemaExists(schemaName)).toBe(true);
    const status = await getMigrationStatus(pool, {
      schemaName,
      migrationsDir: KNOWLEDGE_MIGRATIONS_DIR,
    });
    expect(status.schemaPresent).toBe(true);
    expect(status.pendingCount).toBe(0);
  });

  it("names the absent schema in the startup refusal, rather than only saying migrations are pending", async () => {
    const schemaName = testSchemaName();

    await expect(
      createKnowledgeDatabase(TEST_DATABASE_URL, { poolSize: 2, schemaName }),
    ).rejects.toThrow(/does not exist/);
  });
});
