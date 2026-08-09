export type DatabaseConfig = {
  poolSize: number;
  schemaName: string;
};

export const DEFAULT_DATABASE_POOL_SIZE = 10;
export const DEFAULT_DATABASE_SCHEMA_NAME = "knowledge";

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
