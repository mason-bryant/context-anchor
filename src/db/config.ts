export type DatabaseConfig = {
  poolSize: number;
  schemaName: string;
};

export const DEFAULT_DATABASE_POOL_SIZE = 10;
export const DEFAULT_DATABASE_SCHEMA_NAME = "knowledge";

/**
 * Telemetry lives in its own schema so retention can thin it without ever holding write
 * access to the knowledge records themselves. Derived from the knowledge schema name rather
 * than fixed, so per-test schemas and side-by-side deployments stay isolated in both.
 */
export function telemetrySchemaNameFor(schemaName: string): string {
  return `${schemaName}_telemetry`;
}

/**
 * Schema names are interpolated directly into DDL (`CREATE SCHEMA "<name>"`,
 * `SET LOCAL search_path TO "<name>"`) because Postgres has no parameterized-identifier
 * placeholder. This is the only thing standing between a config value and SQL injection
 * into the search path, so it is deliberately strict: lowercase ASCII, digits, and
 * underscores only, not starting with a digit.
 */
const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function assertValidSchemaName(schemaName: string): void {
  if (!SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new Error(
      `Invalid database schemaName "${schemaName}": expected lowercase letters, digits, and underscores, not starting with a digit.`,
    );
  }
}

const DATABASE_URL_PATTERN = /^postgres(?:ql)?:\/\//i;

export function assertValidDatabaseUrl(databaseUrl: string): void {
  if (!DATABASE_URL_PATTERN.test(databaseUrl)) {
    throw new Error(`Invalid database URL: expected a postgres:// or postgresql:// connection string.`);
  }
}

/**
 * Query parameters whose value is a secret rather than a locator.
 *
 * Matched by substring rather than listed exactly, because the cost of the two mistakes is not
 * symmetric: over-redacting makes one log line less useful, under-redacting puts a credential in
 * CI output permanently. `sslkey` and `sslcert` are deliberately not covered — they are file
 * paths, and an operator diagnosing a TLS failure needs to see which ones were used.
 */
const SECRET_QUERY_PARAM_PATTERN = /pass|secret|token/i;

/**
 * Connection strings routinely carry a password, and `DATABASE_URL` may come from a secret
 * store, so anything that reaches a console, a log file, or CI output goes through here
 * first. Keeps host, port, database, and username — the parts an operator needs to tell
 * which target they are looking at — and drops the credentials.
 *
 * A password can arrive two ways, and for a long time this only handled one. Postgres accepts
 * any connection parameter as a query key, so `postgres://host/db?password=…` is a real
 * connection string that `pg-connection-string` honours — and it went through here untouched,
 * straight into whatever log the caller was writing.
 *
 * An unparseable value is never echoed back: it could be anything, including the secret
 * itself mistyped, so it degrades to a fixed placeholder rather than passing through.
 */
export function redactDatabaseUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return "<unparseable database url>";
  }

  if (parsed.password) {
    parsed.password = "***";
  }

  // Collected before mutating: editing searchParams while iterating it skips entries.
  const secretKeys = [...parsed.searchParams.keys()].filter((key) =>
    SECRET_QUERY_PARAM_PATTERN.test(key),
  );
  for (const key of secretKeys) {
    // set() rather than append(), so a repeated key collapses to one redacted value instead of
    // leaving the later copies intact.
    parsed.searchParams.set(key, "***");
  }

  return parsed.toString();
}

export type PartialDatabaseConfig = {
  poolSize?: number;
  schemaName?: string;
};

export function resolveDatabaseConfig(partial: PartialDatabaseConfig | undefined): DatabaseConfig {
  const poolSize = partial?.poolSize ?? DEFAULT_DATABASE_POOL_SIZE;
  if (!Number.isInteger(poolSize) || poolSize <= 0) {
    throw new Error(`Invalid database poolSize "${String(poolSize)}": expected a positive integer.`);
  }

  const schemaName = partial?.schemaName ?? DEFAULT_DATABASE_SCHEMA_NAME;
  assertValidSchemaName(schemaName);

  return { poolSize, schemaName };
}
