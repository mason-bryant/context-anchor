import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AnchorSchemaMode, FileLoggingConfig, LoggingConfig, RequestLoggingConfig, ServerConfig, TraceLoggingConfig } from "../types.js";
import { ANCHOR_SCHEMA_MODES } from "../types.js";
import { assertValidDatabaseUrl, resolveDatabaseConfig, type DatabaseConfig, type TelemetryRetentionSettings } from "../db/config.js";
import { parseDbCliArgs, type DbCliArgs } from "../db/cliArgs.js";
import { expandHome } from "../utils/path.js";
import { DEFAULT_GRAPH_SCORING_ENABLED, DEFAULT_GRAPH_SCORING_MAX_BOOST, clampGraphScoringMaxBoost } from "../graph/proximity.js";

export const HELP_TEXT = `anchor-mcp — Git-backed MCP server for context anchors

Usage: anchor-mcp [command] [options]

Commands (default: serve)
  serve                         Run the server in the foreground (what MCP clients launch)
  start                         Run the HTTP server detached, logging to a file
  stop                          Stop the detached HTTP server started by \`start\`
  restart                       stop, wait for the port, then start
  status                        Report resolved config, database, and whether a server is up
  db <command>                  Manage the database (see below)

Database commands
  db start                      Start the local Postgres container and apply migrations
  db stop                       Stop the local Postgres container (data is preserved)
  db status                     Show schema, applied and pending migrations
  db migrate                    Apply pending migrations only
  db import [--allow-dirty]     Import the anchor repository at its current commit
  db psql                       Open a psql shell in the container
  db reset --yes                Destroy the local database and recreate it

\`db import\` refuses a dirty working tree: the import is pinned to a commit, so importing
uncommitted content would record a sha that does not describe it. \`--allow-dirty\` overrides
this and warns. Re-importing the same commit writes nothing.

\`db start\`, \`db stop\`, \`db psql\`, and \`db reset\` manage the container declared in this
repository's docker-compose.yml and are unavailable from an installed package; \`db migrate\`
and \`db status\` work against any DATABASE_URL.

Anchor store
  --repo <path>                 Anchor repository (default ~/agent-context, created if missing)
  --anchor-root <path>          Subdirectory within the repo holding anchors (default .)
  --config <path>               JSON config file for non-secret settings
  --no-auto-sync                Do not pull --rebase in the background
  --no-push-on-write            Commit without pushing
  --sync-interval-ms <ms>       Background sync interval (default 45000)
  --stale-after-days <days>     Flag anchors older than this in planner output (default 45)
  --migration-warn-only         Report migration issues without blocking writes
  --anchor-schema-mode <mode>   legacy | warn | enforce (default legacy)

Transport
  --transport <stdio|http>      Transport to serve on (default stdio)
  --host <host>                 HTTP bind address (default 127.0.0.1)
  --port <port>                 HTTP port (default 3000)
  --allowed-hosts <list>        Comma-separated extra Host headers to accept
  --auth-token <token>          Bearer token; required for HTTP
  --stateful                    Keep per-session HTTP transports (default stateless)

Retrieval
  --graph-scoring-enabled       Enable graph-proximity scoring (on by default)
  --no-graph-scoring-enabled    Disable graph-proximity scoring
  --graph-scoring-max-boost <n> Ceiling on any single anchor's graph boost

Database (optional; absent means Git-backed tools only)
  --database-url <url>          Postgres connection string; DATABASE_URL is equivalent

Other
  -h, --help                    Show this message

Config file
  Read from --config, else ANCHOR_MCP_CONFIG, else ./anchor-mcp.config.json if present.
  The server and the db commands resolve it identically, so \`db migrate\` cannot target a
  different schema than the one the server starts against.

Config-file only (no flag or variable)
  logging                       file, requests, and traces blocks
  database                      poolSize, schemaName, storeTaskText, telemetryRetention

Every flag above has an environment equivalent except --no-auto-sync,
--no-push-on-write, and --migration-warn-only, which are flags only:
  ANCHOR_MCP_REPO, ANCHOR_MCP_ANCHOR_ROOT, ANCHOR_MCP_CONFIG, ANCHOR_MCP_TRANSPORT,
  ANCHOR_MCP_HOST, ANCHOR_MCP_PORT, ANCHOR_MCP_ALLOWED_HOSTS, ANCHOR_MCP_AUTH_TOKEN,
  ANCHOR_MCP_STATEFUL, ANCHOR_MCP_SYNC_INTERVAL_MS, ANCHOR_MCP_STALE_AFTER_DAYS,
  ANCHOR_MCP_ANCHOR_SCHEMA_MODE, ANCHOR_MCP_GRAPH_SCORING_ENABLED,
  ANCHOR_MCP_NO_GRAPH_SCORING_ENABLED, ANCHOR_MCP_GRAPH_SCORING_MAX_BOOST, DATABASE_URL.

Precedence is flag, then environment, then config file — but only these are readable
from all three: allowedHosts, authToken, stateful, transport, host, port, repo.
Everything else is either flag-and-environment or config-file-only, as marked above.
The database connection string is deliberately never read from the config file.`;

/** The keys the help text claims are readable from flag, environment, and config file alike. Asserted against real resolution in test/cli/commandParsing.test.ts so the promise cannot drift from the parser. */
export const THREE_SOURCE_KEYS = [
  "allowedHosts",
  "authToken",
  "stateful",
  "transport",
  "host",
  "port",
  "repo",
] as const;

export const CLI_COMMANDS = ["serve", "start", "stop", "restart", "status", "db"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export type CliOptions = {
  config: ServerConfig;
  /** Subcommand to run. Absent on the command line means `serve`, which is what every MCP client stanza relies on. */
  command: CliCommand;
  /** Set only when command is `db`. */
  db?: DbCliArgs;
  /** Config file actually used, after --config / ANCHOR_MCP_CONFIG / discovery; undefined when none was found. */
  configPath?: string;
  /** True when the caller asked for usage; nothing else in this object is meaningful. */
  help: boolean;
  transport: "stdio" | "http";
  /** False when `transport` is the stdio default rather than a choice, letting `start` pick http without overriding an explicit setting. */
  transportExplicit: boolean;
  host: string;
  port: number;
  allowedHosts?: string[];
  authToken?: string;
  stateless: boolean;
  /** `--database-url` / `DATABASE_URL` only — never the config file; see ServerConfig.database for the non-secret settings that do live there. */
  databaseUrl?: string;
};

export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string } = {},
): CliOptions {
  // Checked against argv directly, before the flag loop: that loop only recognizes `--`
  // arguments, so `-h` would never reach it. Resolving help first also means asking a tool
  // how to use it never depends on being correctly configured — including not depending on
  // the default anchor repository existing, which on a fresh machine it does not.
  if (argv.includes("--help") || argv.includes("-h")) {
    return helpOnlyOptions();
  }

  const { command, rest } = takeSubcommand(argv);
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) {
      // Anything reaching here was not consumed as a flag value below, so it is a true
      // positional rather than, say, the `db` in `--anchor-root db`.
      if (arg !== undefined) {
        positionals.push(arg);
      }
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
      continue;
    }

    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--") && takesValue(rawKey, next)) {
      flags.set(rawKey, next);
      index += 1;
    } else {
      flags.set(rawKey, true);
    }
  }

  const db = command === "db" ? parseDbCliArgs(dbArgv(positionals, flags)) : undefined;
  if (command !== "db") {
    assertNoStraySubcommand(positionals);
  }

  const configPath = resolveConfigPath(flags, env, options.cwd ?? process.cwd());
  const fileConfig = readConfigFile(configPath);
  const repo =
    stringFlag(flags, "repo") ??
    env.ANCHOR_MCP_REPO ??
    stringConfigValue(fileConfig.repo, "repo") ??
    "~/agent-context";
  const chosenTransport =
    stringFlag(flags, "transport") ??
    env.ANCHOR_MCP_TRANSPORT ??
    stringConfigValue(fileConfig.transport, "transport");
  const transport = (chosenTransport ?? "stdio") as "stdio" | "http";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`Unsupported transport ${transport}; expected stdio or http`);
  }

  const allowedHosts =
    listFlag(flags, "allowed-hosts") ??
    listEnv(env.ANCHOR_MCP_ALLOWED_HOSTS) ??
    listConfigValue(fileConfig.allowedHosts, "allowedHosts");

  // `|| undefined` rather than `??`: an exported-but-empty DATABASE_URL="" must read as
  // "no database configured" (server boots Git-only), not as a connection string.
  const databaseUrl = stringFlag(flags, "database-url")?.trim() || env.DATABASE_URL?.trim() || undefined;
  if (databaseUrl) {
    assertValidDatabaseUrl(databaseUrl);
  }

  return {
    help: false,
    command,
    ...(db ? { db } : {}),
    ...(configPath ? { configPath } : {}),
    transport,
    transportExplicit: chosenTransport !== undefined,
    host:
      stringFlag(flags, "host") ??
      env.ANCHOR_MCP_HOST ??
      stringConfigValue(fileConfig.host, "host") ??
      "127.0.0.1",
    port:
      numberFlag(flags, "port") ??
      numberEnv(env.ANCHOR_MCP_PORT) ??
      numberConfigValue(fileConfig.port, "port") ??
      3000,
    allowedHosts,
    authToken:
      stringFlag(flags, "auth-token") ??
      env.ANCHOR_MCP_AUTH_TOKEN ??
      stringConfigValue(fileConfig.authToken, "authToken"),
    databaseUrl,
    stateless: !(
      booleanFlag(flags, "stateful") ||
      booleanEnv(env.ANCHOR_MCP_STATEFUL) ||
      (booleanConfigValue(fileConfig.stateful, "stateful") ?? false)
    ),
    config: {
      repoPath: path.resolve(expandHome(repo)),
      anchorRoot: stringFlag(flags, "anchor-root") ?? env.ANCHOR_MCP_ANCHOR_ROOT ?? ".",
      autoSync: !booleanFlag(flags, "no-auto-sync"),
      pushOnWrite: !booleanFlag(flags, "no-push-on-write"),
      syncIntervalMs:
        numberFlag(flags, "sync-interval-ms") ?? numberEnv(env.ANCHOR_MCP_SYNC_INTERVAL_MS) ?? 45_000,
      migrationWarnOnly: booleanFlag(flags, "migration-warn-only"),
      staleAfterDays: numberFlag(flags, "stale-after-days") ?? numberEnv(env.ANCHOR_MCP_STALE_AFTER_DAYS) ?? 45,
      graphScoring: {
        enabled: resolveGraphScoringEnabled(flags, env),
        maxBoost: clampGraphScoringMaxBoost(
          numberFlag(flags, "graph-scoring-max-boost") ??
            numberEnv(env.ANCHOR_MCP_GRAPH_SCORING_MAX_BOOST) ??
            DEFAULT_GRAPH_SCORING_MAX_BOOST,
        ),
      },
      anchorSchema: {
        mode:
          anchorSchemaModeValue(stringFlag(flags, "anchor-schema-mode") ?? env.ANCHOR_MCP_ANCHOR_SCHEMA_MODE) ??
          "legacy",
      },
      logging: loggingConfigValue(fileConfig.logging, "logging"),
      database: databaseConfigValue(fileConfig.database, "database"),
    },
  };
}

/**
 * A structurally valid CliOptions for the help path. None of it is used — the caller prints
 * usage and exits — but returning a complete object keeps CliOptions free of optional fields
 * that every other consumer would then have to narrow.
 */
function helpOnlyOptions(): CliOptions {
  return {
    help: true,
    command: "serve",
    transport: "stdio",
    transportExplicit: false,
    host: "127.0.0.1",
    port: 3000,
    stateless: true,
    config: {
      repoPath: "",
      anchorRoot: ".",
      autoSync: false,
      pushOnWrite: false,
      syncIntervalMs: 0,
      migrationWarnOnly: false,
      staleAfterDays: 45,
      graphScoring: { enabled: DEFAULT_GRAPH_SCORING_ENABLED, maxBoost: DEFAULT_GRAPH_SCORING_MAX_BOOST },
    },
  };
}

function booleanEnv(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/**
 * `graphScoring.enabled` resolution. Unlike `autoSync`/`pushOnWrite` (which
 * only ever have a `--no-X` opt-out, no positive flag), this field already
 * shipped an explicit `--graph-scoring-enabled` / `ANCHOR_MCP_GRAPH_SCORING_ENABLED`
 * opt-in flag from when the CLI/server default was off — kept working here so
 * an existing invocation that sets it stays a harmless no-op now that the
 * default is on. `--no-graph-scoring-enabled` / `ANCHOR_MCP_NO_GRAPH_SCORING_ENABLED`
 * is the new opt-out, and takes precedence if both are somehow set (fail
 * toward the more conservative, ranking-unaffecting state).
 */
function resolveGraphScoringEnabled(flags: Map<string, string | boolean>, env: NodeJS.ProcessEnv): boolean {
  if (booleanFlag(flags, "no-graph-scoring-enabled") || booleanEnv(env.ANCHOR_MCP_NO_GRAPH_SCORING_ENABLED)) {
    return false;
  }
  if (booleanFlag(flags, "graph-scoring-enabled") || booleanEnv(env.ANCHOR_MCP_GRAPH_SCORING_ENABLED)) {
    return true;
  }
  return DEFAULT_GRAPH_SCORING_ENABLED;
}

/** Parse `--anchor-schema-mode` / `ANCHOR_MCP_ANCHOR_SCHEMA_MODE` against the tri-state enum; an unrecognized value throws so a typo fails fast rather than silently defaulting. Returns undefined only when unset (caller defaults to `legacy`). */
function anchorSchemaModeValue(value: string | undefined): AnchorSchemaMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!(ANCHOR_SCHEMA_MODES as readonly string[]).includes(trimmed)) {
    throw new Error(
      `Invalid anchorSchema.mode "${value}": expected one of ${ANCHOR_SCHEMA_MODES.join(", ")}.`,
    );
  }
  return trimmed as AnchorSchemaMode;
}

type CliConfigFile = {
  allowedHosts?: unknown;
  authToken?: unknown;
  /** Transport/bind settings; needed in the file so `stop` can find the same host:port `start` bound. */
  transport?: unknown;
  host?: unknown;
  port?: unknown;
  /** Anchor repository path. In the file so `status`, `serve`, and `start` cannot disagree about which repo is being served. */
  repo?: unknown;
  /** HTTP transport session mode; CLI --stateful and ANCHOR_MCP_STATEFUL take precedence. */
  stateful?: unknown;
  logging?: unknown;
  /** Non-secret only (poolSize, schemaName) — never a connection string; see databaseUrl. */
  database?: unknown;
};

export const CONFIG_FILE_NAME = "anchor-mcp.config.json";

/** Flags that take a separate value token. Everything else is a switch. */
const VALUE_FLAGS = new Set([
  "repo",
  "anchor-root",
  "config",
  "sync-interval-ms",
  "stale-after-days",
  "anchor-schema-mode",
  "transport",
  "host",
  "port",
  "allowed-hosts",
  "auth-token",
  "graph-scoring-max-boost",
  "database-url",
]);

/**
 * Switches must not swallow the following token, or `--no-auto-sync start` parses as
 * `autoSync="start"` — which is falsy, so sync stays on — and the `start` is lost. They
 * still accept an explicit `--stateful true|false`, which previously worked and is the only
 * value a switch has ever meaningfully taken.
 */
function takesValue(key: string, next: string): boolean {
  return VALUE_FLAGS.has(key) || next === "true" || next === "false";
}

/**
 * Only a bare first argument is a subcommand. The flag loop consumes the word after a
 * valueless flag as that flag's value, so `--no-auto-sync start` would otherwise parse as
 * `autoSync="start"` — falsy, leaving sync ON — and then quietly serve. Requiring the
 * subcommand first turns that into an error instead of a wrong-but-running server.
 */
function takeSubcommand(argv: string[]): { command: CliCommand; rest: string[] } {
  const first = argv[0];
  if (first === undefined || first.startsWith("-")) {
    return { command: "serve", rest: argv };
  }

  if (!(CLI_COMMANDS as readonly string[]).includes(first)) {
    throw new Error(`Unknown command "${first}". Expected one of: ${CLI_COMMANDS.join(", ")}`);
  }

  return { command: first as CliCommand, rest: argv.slice(1) };
}

function assertNoStraySubcommand(positionals: string[]): void {
  const stray = positionals.find((value) => (CLI_COMMANDS as readonly string[]).includes(value));
  if (stray) {
    throw new Error(
      `The "${stray}" subcommand must come first, before any flags (anchor-mcp ${stray} [options]).`,
    );
  }
  if (positionals.length > 0) {
    throw new Error(`Unexpected argument(s): ${positionals.join(", ")}`);
  }
}

/**
 * Rebuilds the argv slice the db parser expects. Server flags (`--config`, `--database-url`)
 * are handled by the shared flag loop and deliberately not forwarded — the db parser rejects
 * anything it does not recognize, which is what keeps `reset --dry-run` from reading as safe.
 */
function dbArgv(positionals: string[], flags: Map<string, string | boolean>): string[] {
  return [
    ...positionals,
    ...(booleanFlag(flags, "yes") ? ["--yes"] : []),
    ...(booleanFlag(flags, "allow-dirty") ? ["--allow-dirty"] : []),
  ];
}

/**
 * `--config`, then ANCHOR_MCP_CONFIG, then ./anchor-mcp.config.json when it exists. An
 * explicit path that cannot be read is an error; a discovered one is simply absent. Shared
 * by the server and the db commands so the two cannot resolve different schemas.
 */
function resolveConfigPath(
  flags: Map<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  cwd: string,
): string | undefined {
  const explicit = stringFlag(flags, "config") ?? env.ANCHOR_MCP_CONFIG;
  if (explicit) {
    return path.resolve(expandHome(explicit));
  }

  const discovered = path.join(cwd, CONFIG_FILE_NAME);
  return existsSync(discovered) ? discovered : undefined;
}

function readConfigFile(resolvedPath: string | undefined): CliConfigFile {
  if (!resolvedPath) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read anchor-mcp config ${resolvedPath}: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Expected anchor-mcp config ${resolvedPath} to contain a JSON object`);
  }

  return parsed;
}

function stringFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(flags: Map<string, string | boolean>, key: string): boolean {
  return flags.get(key) === true || flags.get(key) === "true";
}

function numberFlag(flags: Map<string, string | boolean>, key: string): number | undefined {
  const value = stringFlag(flags, key);
  return numberEnv(value);
}

function numberEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected numeric value, received ${value}`);
  }

  return parsed;
}

function listFlag(flags: Map<string, string | boolean>, key: string): string[] | undefined {
  return listEnv(stringFlag(flags, key));
}

function listEnv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(",")
    .map(normalizeHost)
    .filter((item) => item.length > 0);

  return items.length > 0 ? items : undefined;
}

function stringConfigValue(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected config field ${key} to be a string`);
  }

  return value || undefined;
}

function listConfigValue(value: unknown, key: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return listEnv(value);
  }

  if (!Array.isArray(value)) {
    throw new Error(`Expected config field ${key} to be a string or string array`);
  }

  const items = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Expected every config field ${key} item to be a string`);
    }
    return normalizeHost(item);
  });

  const hosts = items.filter((item) => item.length > 0);
  return hosts.length > 0 ? hosts : undefined;
}

function numberConfigValue(value: unknown, key: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new Error(`Expected config field ${key} to be a number`);
  }

  return value;
}

function databaseConfigValue(value: unknown, key: string): DatabaseConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Expected config field ${key} to be an object`);
  }

  return resolveDatabaseConfig({
    poolSize: numberConfigValue(value.poolSize, `${key}.poolSize`),
    schemaName: stringConfigValue(value.schemaName, `${key}.schemaName`),
    // storeTaskText was missing here from the day it shipped. The type carried it, the server
    // honoured it, and the config file — the only place an operator can set a workspace-level
    // policy — silently dropped it, so `storeTaskText: false` was accepted and did nothing.
    // A setting that exists to let someone refuse to retain their questions is a bad one to
    // read only from a type declaration.
    storeTaskText: booleanConfigValue(value.storeTaskText, `${key}.storeTaskText`),
    telemetryRetention: telemetryRetentionConfigValue(
      value.telemetryRetention,
      `${key}.telemetryRetention`,
    ),
  });
}

function telemetryRetentionConfigValue(
  value: unknown,
  key: string,
): Partial<TelemetryRetentionSettings> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Expected config field ${key} to be an object`);
  }

  // Absent fields are omitted, not passed as undefined. resolveDatabaseConfig merges this over
  // the defaults with a spread, and a spread copies an explicitly-undefined key — so a config
  // naming only intervalHours would blank both windows and leave the policy unresolvable. The
  // key has to be missing, not present and empty.
  const settings: Partial<TelemetryRetentionSettings> = {};
  const taskTextDays = numberConfigValue(value.taskTextDays, `${key}.taskTextDays`);
  if (taskTextDays !== undefined) {
    settings.taskTextDays = taskTextDays;
  }
  const requestDays = numberConfigValue(value.requestDays, `${key}.requestDays`);
  if (requestDays !== undefined) {
    settings.requestDays = requestDays;
  }
  const intervalHours = numberConfigValue(value.intervalHours, `${key}.intervalHours`);
  if (intervalHours !== undefined) {
    settings.intervalHours = intervalHours;
  }
  return settings;
}

function booleanConfigValue(value: unknown, key: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Expected config field ${key} to be a boolean`);
  }

  return value;
}

const LOG_LEVELS = new Set(["error", "warn", "info", "http", "verbose", "debug", "silly"]);

function logLevelConfigValue(value: unknown, key: string): string | undefined {
  const level = stringConfigValue(value, key);
  if (level === undefined) {
    return undefined;
  }

  if (!LOG_LEVELS.has(level)) {
    throw new Error(`Expected config field ${key} to be one of ${[...LOG_LEVELS].join(", ")}`);
  }

  return level;
}

function loggingConfigValue(value: unknown, key: string): LoggingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Expected config field ${key} to be an object`);
  }

  const file = fileLoggingConfigValue(value.file, `${key}.file`);
  const requests = requestLoggingConfigValue(value.requests, `${key}.requests`);
  const traces = traceLoggingConfigValue(value.traces, `${key}.traces`);
  return file || requests || traces
    ? { ...(file ? { file } : {}), ...(requests ? { requests } : {}), ...(traces ? { traces } : {}) }
    : undefined;
}

function fileLoggingConfigValue(value: unknown, key: string): FileLoggingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return { enabled: value };
  }

  if (!isRecord(value)) {
    throw new Error(`Expected config field ${key} to be a boolean or object`);
  }

  return {
    enabled: booleanConfigValue(value.enabled, `${key}.enabled`) ?? true,
    dirname: stringConfigValue(value.dirname, `${key}.dirname`),
    filename: stringConfigValue(value.filename, `${key}.filename`),
    level: logLevelConfigValue(value.level, `${key}.level`),
    datePattern: stringConfigValue(value.datePattern, `${key}.datePattern`),
    maxSize: stringConfigValue(value.maxSize, `${key}.maxSize`),
    maxFiles: stringConfigValue(value.maxFiles, `${key}.maxFiles`),
    zippedArchive: booleanConfigValue(value.zippedArchive, `${key}.zippedArchive`),
  };
}

function requestLoggingConfigValue(value: unknown, key: string): RequestLoggingConfig | undefined {
  const file = fileLoggingConfigValue(value, key);
  if (!file) {
    return undefined;
  }

  if (!isRecord(value)) {
    return file;
  }

  return {
    ...file,
    includeArguments: booleanConfigValue(value.includeArguments, `${key}.includeArguments`),
    redactArguments: booleanConfigValue(value.redactArguments, `${key}.redactArguments`),
  };
}

function traceLoggingConfigValue(value: unknown, key: string): TraceLoggingConfig | undefined {
  const file = fileLoggingConfigValue(value, key);
  if (!file) {
    return undefined;
  }

  if (!isRecord(value)) {
    return file;
  }

  return {
    ...file,
    includeTaskText: booleanConfigValue(value.includeTaskText, `${key}.includeTaskText`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHost(rawHost: string): string {
  const value = rawHost.trim();
  if (!value) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      return normalizeHost(new URL(value).host);
    } catch {
      return "";
    }
  }

  const host = value.split("/", 1)[0] ?? "";
  if (host.startsWith("[")) {
    return host.match(/^\[[^\]]+\]/)?.[0] ?? "";
  }

  return host.split(":", 1)[0] ?? "";
}
