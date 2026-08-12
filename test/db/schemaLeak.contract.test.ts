import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getMigrationStatus, runMigrations } from "../../src/db/migrate.js";
import { createKnowledgeDatabase, MigrationsPendingError } from "../../src/db/knowledgeDb.js";
import {
  dropRegisteredSchemas,
  isTestDatabaseReachable,
  TEST_SCHEMA_PATTERN,
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

/**
 * These need no database, so they run everywhere the suite does — including wherever the contract
 * tests above skip themselves. The invariant they protect is the one that makes registration
 * meaningful: a registered name that the guard cannot recognise is not protected by anything.
 */
describe("test schema names stay recognisable to the leak tooling", () => {
  it("refuses a prefix that would produce an unrecognisable name", () => {
    // Each of these registers nothing and throws, so no schema is created and none can leak.
    expect(() => testSchemaName("scratch")).toThrow(/would not recognise/);
    expect(() => testSchemaName("my_test_")).toThrow(/would not recognise/);
    expect(() => testSchemaName("Knowledge_Test")).toThrow(/would not recognise/);
  });

  it("accepts single and multi-word prefixes, and the names it mints match the guard", () => {
    for (const prefix of [undefined, "diag_test", "my_feature_test"]) {
      const name = prefix === undefined ? testSchemaName() : testSchemaName(prefix);
      expect(name).toMatch(TEST_SCHEMA_PATTERN);
      // The telemetry sibling is a separate schema that teardown drops and the guard must also
      // recognise; the base name matching is not enough on its own.
      expect(`${name}_telemetry`).toMatch(TEST_SCHEMA_PATTERN);
    }
  });

  it("keeps the cleanup script's copy of the pattern identical to the canonical one", async () => {
    // The script is a standalone .mjs that opens a pool at import, so it cannot be imported here
    // to compare the value directly — read the literal instead. A pattern the guard flags but the
    // script will not sweep means a leak reported on every run and cleaned by nothing.
    const source = await readFile(
      path.resolve(import.meta.dirname, "../../scripts/drop-orphan-test-schemas.mjs"),
      "utf8",
    );
    const match = /^const TEST_SCHEMA_PATTERN = (.+);$/m.exec(source);
    expect(match, "the cleanup script must declare TEST_SCHEMA_PATTERN on one line").not.toBeNull();
    expect(match?.[1]).toBe(TEST_SCHEMA_PATTERN.toString());
  });
});
