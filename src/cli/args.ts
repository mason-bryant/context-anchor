import { readFileSync } from "node:fs";
import path from "node:path";

import type { AnchorSchemaMode, FileLoggingConfig, LoggingConfig, RequestLoggingConfig, ServerConfig, TraceLoggingConfig } from "../types.js";
import { ANCHOR_SCHEMA_MODES } from "../types.js";
import { assertValidDatabaseUrl, resolveDatabaseConfig, type DatabaseConfig } from "../db/config.js";
import { expandHome } from "../utils/path.js";
import { DEFAULT_GRAPH_SCORING_ENABLED, DEFAULT_GRAPH_SCORING_MAX_BOOST, clampGraphScoringMaxBoost } from "../graph/proximity.js";

export const HELP_TEXT = `anchor-mcp — Git-backed MCP server for context anchors

Usage: anchor-mcp [options]

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

Environment equivalents: ANCHOR_MCP_REPO, ANCHOR_MCP_ANCHOR_ROOT, ANCHOR_MCP_CONFIG,
ANCHOR_MCP_TRANSPORT, ANCHOR_MCP_HOST, ANCHOR_MCP_PORT, ANCHOR_MCP_ALLOWED_HOSTS,
ANCHOR_MCP_AUTH_TOKEN, ANCHOR_MCP_STATEFUL, ANCHOR_MCP_SYNC_INTERVAL_MS,
ANCHOR_MCP_STALE_AFTER_DAYS, ANCHOR_MCP_ANCHOR_SCHEMA_MODE, DATABASE_URL.

Flags take precedence over environment variables, which take precedence over the
config file. The connection string is never read from the config file.`;

export type CliOptions = {
  config: ServerConfig;
  /** True when the caller asked for usage; nothing else in this object is meaningful. */
  help: boolean;
  transport: "stdio" | "http";
  host: string;
  port: number;
  allowedHosts?: string[];
  authToken?: string;
  stateless: boolean;
  /** `--database-url` / `DATABASE_URL` only — never the config file; see ServerConfig.database for the non-secret settings that do live there. */
  databaseUrl?: string;
};

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  // Checked against argv directly, before the flag loop: that loop only recognizes `--`
  // arguments, so `-h` would never reach it. Resolving help first also means asking a tool
  // how to use it never depends on being correctly configured — including not depending on
  // the default anchor repository existing, which on a fresh machine it does not.
  if (argv.includes("--help") || argv.includes("-h")) {
    return helpOnlyOptions();
  }

  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(rawKey, next);
      index += 1;
    } else {
      flags.set(rawKey, true);
    }
  }

  const repo = stringFlag(flags, "repo") ?? env.ANCHOR_MCP_REPO ?? "~/agent-context";
  const fileConfig = readConfigFile(flags, env);
  const transport = (stringFlag(flags, "transport") ?? env.ANCHOR_MCP_TRANSPORT ?? "stdio") as "stdio" | "http";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`Unsupported --transport ${transport}; expected stdio or http`);
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
    transport,
    host: stringFlag(flags, "host") ?? env.ANCHOR_MCP_HOST ?? "127.0.0.1",
    port: numberFlag(flags, "port") ?? numberEnv(env.ANCHOR_MCP_PORT) ?? 3000,
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
    transport: "stdio",
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
  /** HTTP transport session mode; CLI --stateful and ANCHOR_MCP_STATEFUL take precedence. */
  stateful?: unknown;
  logging?: unknown;
  /** Non-secret only (poolSize, schemaName) — never a connection string; see databaseUrl. */
  database?: unknown;
};

function readConfigFile(flags: Map<string, string | boolean>, env: NodeJS.ProcessEnv): CliConfigFile {
  const configPath = stringFlag(flags, "config") ?? env.ANCHOR_MCP_CONFIG;
  if (!configPath) {
    return {};
  }

  const resolvedPath = path.resolve(expandHome(configPath));
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
  });
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
