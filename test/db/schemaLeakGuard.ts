import pg from "pg";

import { TEST_DATABASE_URL } from "./testDatabase.js";

/**
 * Fails the run if the suite leaves schemas behind in the test database.
 *
 * Per-file teardown is the right place to clean up, but it is also the place that silently
 * stopped happening: four contract files created a telemetry schema and dropped only its
 * knowledge counterpart, leaking fifteen schemas per run and roughly a thousand over the life of
 * the development database. Every one of those runs was green, because no test asserted about
 * schemas it had not itself created.
 *
 * This checks the one thing a per-file `afterEach` structurally cannot: the state of the database
 * after everything has finished. It compares a before/after snapshot rather than matching names,
 * so it catches a leak from a file that has not been written yet.
 */

const TEST_SCHEMA_PATTERN = /^(knowledge|compare)_test_/;

let before: Set<string> | undefined;

async function listSchemas(): Promise<Set<string> | undefined> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    const result = await pool.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata`,
    );
    return new Set(result.rows.map((row) => row.schema_name));
  } catch {
    // No database here — the contract tests skip themselves for the same reason, and a guard
    // that failed the run in that case would make the suite unrunnable without Postgres.
    return undefined;
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function setup(): Promise<void> {
  before = await listSchemas();
}

export async function teardown(): Promise<void> {
  // Captured before the await: the narrowing on the module-level `before` does not survive it,
  // because anything could reassign it while the query is in flight.
  const baseline = before;
  if (!baseline) {
    return;
  }
  const after = await listSchemas();
  if (!after) {
    return;
  }

  const leaked = [...after].filter((name) => !baseline.has(name) && TEST_SCHEMA_PATTERN.test(name)).sort();
  if (leaked.length === 0) {
    return;
  }

  throw new Error(
    `${String(leaked.length)} test schema(s) survived the run, so some test created a schema it ` +
      `did not drop. Use createTestSchemas/testSchemaName from test/db/testDatabase.ts, which ` +
      `register the name for dropRegisteredSchemas, rather than building a schema name locally.` +
      `\nLeaked: ${leaked.join(", ")}`,
  );
}
