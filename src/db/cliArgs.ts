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

  // Reject anything else outright. Silently ignoring an unrecognized argument is worst
  // next to a destructive command: `reset --yes --dry-run` would read as though a safety
  // flag had been honored while the data was deleted anyway.
  const unknown = rest.filter((arg) => arg !== "--yes");
  if (unknown.length > 0) {
    throw new Error(
      `Unexpected argument(s) for "${command}": ${unknown.join(", ")}. ` +
        `Supported: \`reset --yes\`, or a bare command with no arguments.`,
    );
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

  // A file that isn't there (or can't be read) is a legitimate "nothing configured" —
  // the CLI must work in a fresh checkout. A file that IS there but malformed is not:
  // falling back to the default would migrate a different schema than the operator wrote
  // down, which is precisely the silent divergence this resolver exists to prevent.
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not parse ${configPath}: ${message}. Fix the file or set ANCHOR_MCP_DB_SCHEMA ` +
        `explicitly — refusing to fall back to the default schema, which could migrate the wrong target.`,
    );
  }

  // A config that exists but has the wrong SHAPE gets the same treatment as one that won't
  // parse: loud. The server already rejects a non-object `database` block, so staying quiet
  // here is precisely how the CLI and server end up on different schemas.
  if (!isRecord(parsed)) {
    throw new Error(`Expected ${configPath} to contain a JSON object.`);
  }

  // No `database` block at all is a legitimate "nothing configured", unlike a malformed one.
  if (parsed.database === undefined) {
    return undefined;
  }

  if (!isRecord(parsed.database)) {
    throw new Error(`Expected config field database in ${configPath} to be an object.`);
  }

  const schemaName = parsed.database.schemaName;
  if (schemaName === undefined) {
    return undefined;
  }
  if (typeof schemaName !== "string") {
    throw new Error(`Expected config field database.schemaName in ${configPath} to be a string.`);
  }
  return schemaName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
