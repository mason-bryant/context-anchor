import { readFileSync } from "node:fs";
import path from "node:path";

import type { ServerConfig } from "../types.js";
import { expandHome } from "../utils/path.js";

export type CliOptions = {
  config: ServerConfig;
  transport: "stdio" | "http";
  host: string;
  port: number;
  allowedHosts?: string[];
  authToken?: string;
  stateless: boolean;
};

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
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

  return {
    transport,
    host: stringFlag(flags, "host") ?? env.ANCHOR_MCP_HOST ?? "127.0.0.1",
    port: numberFlag(flags, "port") ?? numberEnv(env.ANCHOR_MCP_PORT) ?? 3000,
    allowedHosts,
    authToken:
      stringFlag(flags, "auth-token") ??
      env.ANCHOR_MCP_AUTH_TOKEN ??
      stringConfigValue(fileConfig.authToken, "authToken"),
    stateless: !booleanFlag(flags, "stateful"),
    config: {
      repoPath: path.resolve(expandHome(repo)),
      anchorRoot: stringFlag(flags, "anchor-root") ?? env.ANCHOR_MCP_ANCHOR_ROOT ?? ".",
      autoSync: !booleanFlag(flags, "no-auto-sync"),
      pushOnWrite: !booleanFlag(flags, "no-push-on-write"),
      syncIntervalMs:
        numberFlag(flags, "sync-interval-ms") ?? numberEnv(env.ANCHOR_MCP_SYNC_INTERVAL_MS) ?? 45_000,
      migrationWarnOnly: booleanFlag(flags, "migration-warn-only"),
    },
  };
}

type CliConfigFile = {
  allowedHosts?: unknown;
  authToken?: unknown;
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

function isRecord(value: unknown): value is CliConfigFile {
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
