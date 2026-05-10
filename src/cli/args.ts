import path from "node:path";

import type { ServerConfig } from "../types.js";
import { expandHome } from "../utils/path.js";

export type CliOptions = {
  config: ServerConfig;
  transport: "stdio" | "http";
  host: string;
  port: number;
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
  const transport = (stringFlag(flags, "transport") ?? env.ANCHOR_MCP_TRANSPORT ?? "stdio") as "stdio" | "http";
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`Unsupported --transport ${transport}; expected stdio or http`);
  }

  return {
    transport,
    host: stringFlag(flags, "host") ?? env.ANCHOR_MCP_HOST ?? "127.0.0.1",
    port: numberFlag(flags, "port") ?? numberEnv(env.ANCHOR_MCP_PORT) ?? 3000,
    authToken: stringFlag(flags, "auth-token") ?? env.ANCHOR_MCP_AUTH_TOKEN,
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

