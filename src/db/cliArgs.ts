import { readFileSync } from "node:fs";

import { assertValidSchemaName, DEFAULT_DATABASE_SCHEMA_NAME } from "./config.js";

export type DbCliCommand = "up" | "down" | "status" | "migrate" | "psql" | "reset";

const KNOWN_COMMANDS: readonly DbCliCommand[] = ["up", "down", "status", "migrate", "psql", "reset"];

export type DbCliArgs =
  | { command: Exclude<DbCliCommand, "reset"> }
  | { command: "reset"; yes: true };

export function parseDbCliArgs(argv: string[]): DbCliArgs {
  const [command, ...rest] = argv;

  if (!command) {
    throw new Error(`Missing command. Expected one of: ${KNOWN_COMMANDS.join(", ")}`);
  }

  if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`Unknown command "${command}". Expected one of: ${KNOWN_COMMANDS.join(", ")}`);
  }

  const hasYes = rest.includes("--yes");

  if (command !== "reset" && hasYes) {
    throw new Error(`--yes is only accepted with the "reset" command`);
  }

  if (command === "reset") {
    if (!hasYes) {
      throw new Error(`"reset" is destructive and requires an explicit --yes flag`);
    }
    return { command: "reset", yes: true };
  }

  return { command: command as Exclude<DbCliCommand, "reset"> };
}

/**
 * Resolve which schema the `db` CLI migrates. This deliberately reads the SAME
 * `database.schemaName` the server reads, because the two diverging is a nasty footgun:
 * migrating one schema while the server points at another surfaces only as a confusing
 * "pending migrations" refusal at startup. `ANCHOR_MCP_DB_SCHEMA` stays as an explicit
 * override for one-off targets (a scratch schema, a diagnostic copy).
 *
 * A missing or unreadable config file is not an error — the CLI must keep working in a
 * checkout that has never had one — but a config file that names an invalid schema is,
 * since silently migrating a different schema than requested is exactly the confusion
 * this function exists to prevent.
 */
export function resolveDbCliSchemaName(options: {
  env: NodeJS.ProcessEnv;
  configPath: string | undefined;
}): string {
  const fromEnv = options.env.ANCHOR_MCP_DB_SCHEMA?.trim();
  if (fromEnv) {
    assertValidSchemaName(fromEnv);
    return fromEnv;
  }

  const fromConfig = readSchemaNameFromConfig(options.configPath);
  if (fromConfig !== undefined) {
    assertValidSchemaName(fromConfig);
    return fromConfig;
  }

  return DEFAULT_DATABASE_SCHEMA_NAME;
}

function readSchemaNameFromConfig(configPath: string | undefined): string | undefined {
  if (!configPath) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !isRecord(parsed.database)) {
    return undefined;
  }

  const schemaName = parsed.database.schemaName;
  if (schemaName === undefined) {
    return undefined;
  }
  if (typeof schemaName !== "string") {
    throw new Error(`Expected config field database.schemaName to be a string`);
  }
  return schemaName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
