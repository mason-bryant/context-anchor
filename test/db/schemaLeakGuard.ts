import pg from "pg";

import { TEST_DATABASE_URL, TEST_SCHEMA_PATTERN } from "./testDatabase.js";

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

/**
 * The pattern is imported, not restated. It began as an enumerated list of the two prefixes that
 * had already leaked, missing the six others in use (`assert_test_`, `route_test_`,
 * `access_test_`, `t3s2_test_`, `diag_test_`, `compare_test_`) and blind by construction to
 * whatever the next test file invents; then it missed multi-word prefixes. Each time, the fix's
 * own coverage was narrower than the thing it covered. Keeping one definition, enforced where
 * names are minted, is what ends that sequence — see `testSchemaName`.
 *
 * False positives are bounded twice over: the name must carry a 12-hex-digit suffix, and the
 * guard only ever considers schemas that appeared during the run.
 */

let before: Set<string> | undefined;

async function listSchemas(): Promise<Set<string>> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    const result = await pool.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata`,
    );
    return new Set(result.rows.map((row) => row.schema_name));
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function setup(): Promise<void> {
  try {
    before = await listSchemas();
  } catch {
    // No database here — the contract tests skip themselves for the same reason, and a guard
    // that failed the run in that case would make the suite unrunnable without Postgres.
    before = undefined;
  }
}

export async function teardown(): Promise<void> {
  // Captured before the await: the narrowing on the module-level `before` does not survive it,
  // because anything could reassign it while the query is in flight.
  const baseline = before;
  if (!baseline) {
    return;
  }

  // Deliberately not caught. Reaching here means setup already listed the schemas, so the
  // database was there when the run started; a failure now is a real fault, not an absent
  // Postgres. Swallowing it would turn the guard off silently and leave a green run that
  // checked nothing — the exact shape of the bug this file exists to prevent.
  const after = await listSchemas();

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
