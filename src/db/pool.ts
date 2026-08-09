import pg from "pg";

import { assertValidDatabaseUrl, assertValidSchemaName, type DatabaseConfig } from "./config.js";

export function createDatabasePool(databaseUrl: string, config: DatabaseConfig): pg.Pool {
  assertValidDatabaseUrl(databaseUrl);
  assertValidSchemaName(config.schemaName);
  return new pg.Pool({ connectionString: databaseUrl, max: config.poolSize });
}
