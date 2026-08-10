import path from "node:path";
import { runMigrations } from "../../src/db/migrate.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import type { Pool } from "pg";
import pg from "pg";

import { redactDatabaseUrl } from "../../src/db/config.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://anchor:anchor@127.0.0.1:55432/anchor_mcp";

/**
 * Only a SUCCESSFUL probe is memoized. Caching a failure would mean a Postgres that came
 * up slowly (a CI service still starting when the first file probed) leaves every later
 * contract file skipping against a database that is now perfectly usable. Later callers
 * re-probe on a short window so re-checking stays cheap when it really is absent.
 */
let reachable: true | undefined;
let hasProbedOnce = false;

const FIRST_PROBE_TIMEOUT_MS = 10_000;
const REPROBE_TIMEOUT_MS = 1_500;
const PROBE_RETRY_DELAY_MS = 500;

/**
 * Contract tests need a real Postgres. Locally that's `npm run db:up`; in CI it's a
 * service container bound to the same default port so no extra env wiring is needed.
 * Neither is available in every environment this suite runs in, so probe once and skip
 * the whole describe block (with a clear reason) rather than failing `npm test` outright.
 *
 * The probe performs a real connect + `SELECT 1` rather than a bare TCP dial: a socket can
 * accept connections while Postgres is still starting up or while credentials are wrong,
 * and treating that as "reachable" would run the contract tests straight into failures —
 * the exact opposite of the intended skip. Retries for a short window so a container that
 * is still coming up is waited for rather than skipped.
 */
export async function isTestDatabaseReachable(): Promise<boolean> {
  if (reachable) {
    return true;
  }

  const window = hasProbedOnce ? REPROBE_TIMEOUT_MS : FIRST_PROBE_TIMEOUT_MS;
  hasProbedOnce = true;
  const deadline = Date.now() + window;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      reachable = true;
      return true;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
    }
  }

  // Deliberately not memoized as false — see the `reachable` declaration above.
  // Redacted: TEST_DATABASE_URL can come from a CI secret, and this line lands in build logs.
  console.warn(
    `[db contract tests] Postgres not usable at ${redactDatabaseUrl(TEST_DATABASE_URL)}; skipping. ` +
      `Run \`npm run db:up\` to enable these tests locally. Last error: ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
  return false;
}

/**
 * Applies both migration sets. Telemetry lives in its own schema for retention reasons, but
 * `createKnowledgeDatabase` refuses to start unless both are current — so any test that
 * boots the database has to migrate both, and doing it in one place keeps the next contract
 * test from rediscovering that as a MigrationsPendingError.
 */
export async function migrateAllSchemas(pool: Pool, schemaName: string): Promise<void> {
  const root = path.resolve(import.meta.dirname, "../..");
  await runMigrations(pool, {
    schemaName,
    migrationsDir: path.join(root, "migrations", "knowledge"),
  });
  await runMigrations(pool, {
    schemaName: telemetrySchemaNameFor(schemaName),
    migrationsDir: path.join(root, "migrations", "telemetry"),
  });
}

/** Drops both schemas a test created, so a leftover telemetry schema cannot accumulate. */
export async function dropAllSchemas(pool: Pool, schemaName: string): Promise<void> {
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.query(`DROP SCHEMA IF EXISTS "${telemetrySchemaNameFor(schemaName)}" CASCADE`);
}

/** Telemetry only, for tests that assert on the knowledge migration result itself. */
export async function migrateTelemetrySchema(pool: Pool, schemaName: string): Promise<void> {
  await runMigrations(pool, {
    schemaName: telemetrySchemaNameFor(schemaName),
    migrationsDir: path.resolve(import.meta.dirname, "../../migrations/telemetry"),
  });
}
