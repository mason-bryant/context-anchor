#!/usr/bin/env node
/**
 * Thin wrapper kept so `npm run db:*` keeps working for anyone with the muscle memory.
 * The implementation lives in src/cli/dbCommands.ts and ships with the package, reachable
 * as `anchor-mcp db <command>`; this file only forwards to it.
 */
import { parseCliArgs } from "../src/cli/args.js";
import { runDbCommand } from "../src/cli/dbCommands.js";
import { COMPOSE_MANAGED_DATABASE_URL } from "../src/db/cliArgs.js";
import { DEFAULT_DATABASE_SCHEMA_NAME } from "../src/db/config.js";

async function main(): Promise<void> {
  // Routed through the server's own parser so the schema resolved here is by construction
  // the one the server resolves — the whole reason `db migrate` and the server share it.
  const options = parseCliArgs(["db", ...process.argv.slice(2)]);
  if (!options.db) {
    throw new Error("Missing db command.");
  }

  await runDbCommand(options.db, {
    databaseUrl: options.databaseUrl ?? COMPOSE_MANAGED_DATABASE_URL,
    schemaName: options.config.database?.schemaName ?? DEFAULT_DATABASE_SCHEMA_NAME,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
