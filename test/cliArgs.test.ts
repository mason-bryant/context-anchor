import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mkdtempSync } from "node:fs";

import { HELP_TEXT, parseCliArgs } from "../src/cli/args.js";
import { buildAllowedHosts } from "../src/http/server.js";

/**
 * parseCliArgs discovers ./anchor-mcp.config.json, so any test asserting that a value has
 * *no* source has to run from a directory without one — otherwise it passes or fails
 * depending on the developer's working directory, and in this repo it picks up the real
 * config (including a real auth token).
 */
const NO_CONFIG = { cwd: mkdtempSync(path.join(os.tmpdir(), "anchor-mcp-noconfig-")) };

describe("CLI args", () => {
  it("uses MCP Express default host validation without extra allowed hosts", () => {
    const options = parseCliArgs(["--transport", "http"], {}, NO_CONFIG);

    expect(options.allowedHosts).toBeUndefined();
    expect(buildAllowedHosts(options.allowedHosts)).toBeUndefined();
  });

  it("parses allowed hostnames from a comma-separated flag", () => {
    const options = parseCliArgs(
      [
        "--transport",
        "http",
        "--allowed-hosts",
        "https://oversight-tabby-chaperone.ngrok-free.dev/mcp,example.test:8443,[::1]:3333",
      ],
      {},
    );

    expect(options.allowedHosts).toEqual(["oversight-tabby-chaperone.ngrok-free.dev", "example.test", "[::1]"]);
  });

  it("preserves localhost host headers when extra allowed hosts are configured", () => {
    expect(buildAllowedHosts(["oversight-tabby-chaperone.ngrok-free.dev"])).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
      "oversight-tabby-chaperone.ngrok-free.dev",
    ]);
  });

  it("reads allowed hosts from the environment", () => {
    const options = parseCliArgs(["--transport", "http"], {
      ANCHOR_MCP_ALLOWED_HOSTS: "one.ngrok-free.dev,two.ngrok-free.dev",
    });

    expect(options.allowedHosts).toEqual(["one.ngrok-free.dev", "two.ngrok-free.dev"]);
  });

  it("reads allowed hosts from an explicit config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        allowedHosts: ["https://config-tunnel.ngrok-free.dev/mcp"],
      }),
      "utf8",
    );

    const options = parseCliArgs(["--transport", "http", "--config", configPath], {});

    expect(options.allowedHosts).toEqual(["config-tunnel.ngrok-free.dev"]);
  });

  it("lets command-line allowed hosts override config file hosts", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ allowedHosts: ["config.ngrok-free.dev"] }), "utf8");

    const options = parseCliArgs(
      ["--transport", "http", "--config", configPath, "--allowed-hosts", "flag.ngrok-free.dev"],
      {},
    );

    expect(options.allowedHosts).toEqual(["flag.ngrok-free.dev"]);
  });
});

describe("CLI args — authToken", () => {
  it("returns undefined when no token source is provided", () => {
    const options = parseCliArgs(["--transport", "http"], {}, NO_CONFIG);
    expect(options.authToken).toBeUndefined();
  });

  it("reads authToken from the --auth-token flag", () => {
    const options = parseCliArgs(["--transport", "http", "--auth-token", "flag-token"], {});
    expect(options.authToken).toBe("flag-token");
  });

  it("reads authToken from the environment variable", () => {
    const options = parseCliArgs(["--transport", "http"], { ANCHOR_MCP_AUTH_TOKEN: "env-token" });
    expect(options.authToken).toBe("env-token");
  });

  it("reads authToken from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ authToken: "config-token" }), "utf8");

    const options = parseCliArgs(["--transport", "http", "--config", configPath], {});
    expect(options.authToken).toBe("config-token");
  });

  it("CLI flag takes precedence over env var and config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ authToken: "config-token" }), "utf8");

    const options = parseCliArgs(["--transport", "http", "--auth-token", "flag-token", "--config", configPath], {
      ANCHOR_MCP_AUTH_TOKEN: "env-token",
    });
    expect(options.authToken).toBe("flag-token");
  });

  it("env var takes precedence over config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ authToken: "config-token" }), "utf8");

    const options = parseCliArgs(["--transport", "http", "--config", configPath], {
      ANCHOR_MCP_AUTH_TOKEN: "env-token",
    });
    expect(options.authToken).toBe("env-token");
  });

  it("rejects a non-string authToken in the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ authToken: 12345 }), "utf8");

    expect(() => parseCliArgs(["--transport", "http", "--config", configPath], {})).toThrow(
      /Expected config field authToken to be a string/,
    );
  });
});

describe("CLI args — stateful HTTP sessions", () => {
  it("defaults to stateless", () => {
    const options = parseCliArgs(["--transport", "http"], {});
    expect(options.stateless).toBe(true);
  });

  it("enables stateful mode via the --stateful flag", () => {
    const options = parseCliArgs(["--transport", "http", "--stateful"], {});
    expect(options.stateless).toBe(false);
  });

  it("enables stateful mode via ANCHOR_MCP_STATEFUL", () => {
    const options = parseCliArgs(["--transport", "http"], { ANCHOR_MCP_STATEFUL: "true" });
    expect(options.stateless).toBe(false);
  });

  it("enables stateful mode via the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ stateful: true }), "utf8");

    const options = parseCliArgs(["--transport", "http", "--config", configPath], {});
    expect(options.stateless).toBe(false);
  });

  it("env var takes precedence over a config file that sets stateful false", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ stateful: false }), "utf8");

    const options = parseCliArgs(["--transport", "http", "--config", configPath], {
      ANCHOR_MCP_STATEFUL: "true",
    });
    expect(options.stateless).toBe(false);
  });

  it("stays stateless when the config file sets stateful false and nothing overrides it", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ stateful: false }), "utf8");

    const options = parseCliArgs(["--transport", "http", "--config", configPath], {});
    expect(options.stateless).toBe(true);
  });

  it("rejects a non-boolean stateful config value", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ stateful: "yes" }), "utf8");

    expect(() => parseCliArgs(["--transport", "http", "--config", configPath], {})).toThrow(
      /stateful/,
    );
  });
});

describe("CLI args — file logging", () => {
  it("reads file logging defaults from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ logging: { file: true } }), "utf8");

    const options = parseCliArgs(["--config", configPath], {});

    expect(options.config.logging?.file).toMatchObject({ enabled: true });
  });

  it("reads custom file logging options from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        logging: {
          file: {
            enabled: true,
            dirname: "/tmp/anchor-mcp-test-logs",
            filename: "custom-%DATE%.log",
            level: "debug",
            datePattern: "YYYY-MM-DD-HH",
            maxSize: "5m",
            maxFiles: "7d",
            zippedArchive: false,
          },
        },
      }),
      "utf8",
    );

    const options = parseCliArgs(["--config", configPath], {});

    expect(options.config.logging?.file).toEqual({
      enabled: true,
      dirname: "/tmp/anchor-mcp-test-logs",
      filename: "custom-%DATE%.log",
      level: "debug",
      datePattern: "YYYY-MM-DD-HH",
      maxSize: "5m",
      maxFiles: "7d",
      zippedArchive: false,
    });
  });

  it("rejects invalid file logging config", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ logging: { file: { maxFiles: 14 } } }), "utf8");

    expect(() => parseCliArgs(["--config", configPath], {})).toThrow(
      /Expected config field logging\.file\.maxFiles to be a string/,
    );
  });

  it("reads request logging defaults from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ logging: { requests: true } }), "utf8");

    const options = parseCliArgs(["--config", configPath], {});

    expect(options.config.logging?.requests).toMatchObject({ enabled: true });
  });

  it("reads custom request logging options from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        logging: {
          requests: {
            enabled: true,
            dirname: "/tmp/anchor-mcp-test-request-logs",
            filename: "requests-%DATE%.log",
            level: "debug",
            datePattern: "YYYY-MM-DD-HH",
            maxSize: "2m",
            maxFiles: "3d",
            zippedArchive: false,
            includeArguments: false,
            redactArguments: false,
          },
        },
      }),
      "utf8",
    );

    const options = parseCliArgs(["--config", configPath], {});

    expect(options.config.logging?.requests).toEqual({
      enabled: true,
      dirname: "/tmp/anchor-mcp-test-request-logs",
      filename: "requests-%DATE%.log",
      level: "debug",
      datePattern: "YYYY-MM-DD-HH",
      maxSize: "2m",
      maxFiles: "3d",
      zippedArchive: false,
      includeArguments: false,
      redactArguments: false,
    });
  });

  it("rejects invalid request logging config", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ logging: { requests: { includeArguments: "yes" } } }), "utf8");

    expect(() => parseCliArgs(["--config", configPath], {})).toThrow(
      /Expected config field logging\.requests\.includeArguments to be a boolean/,
    );
  });

  it("parses stale-after-days from CLI flags", () => {
    const options = parseCliArgs(["--stale-after-days", "30"], {});
    expect(options.config.staleAfterDays).toBe(30);
  });

  it("reads stale-after-days from the environment", () => {
    const options = parseCliArgs([], { ANCHOR_MCP_STALE_AFTER_DAYS: "14" });
    expect(options.config.staleAfterDays).toBe(14);
  });

});

describe("CLI args — anchorSchema.mode (Goal 0 Phase 2 slice 3b)", () => {
  it("defaults to legacy when unset", () => {
    expect(parseCliArgs([], {}).config.anchorSchema?.mode).toBe("legacy");
  });

  it("reads the mode from the --anchor-schema-mode flag", () => {
    expect(parseCliArgs(["--anchor-schema-mode", "warn"], {}).config.anchorSchema?.mode).toBe("warn");
    expect(parseCliArgs(["--anchor-schema-mode", "enforce"], {}).config.anchorSchema?.mode).toBe("enforce");
  });

  it("reads the mode from the environment", () => {
    expect(parseCliArgs([], { ANCHOR_MCP_ANCHOR_SCHEMA_MODE: "enforce" }).config.anchorSchema?.mode).toBe("enforce");
  });

  it("rejects an invalid mode with a fail-fast error", () => {
    expect(() => parseCliArgs(["--anchor-schema-mode", "strict"], {})).toThrow(/anchorSchema\.mode/);
  });
});

describe("CLI args — graphScoring.enabled", () => {
  it("defaults to enabled when unset", () => {
    expect(parseCliArgs([], {}).config.graphScoring.enabled).toBe(true);
  });

  it("stays enabled when the legacy opt-in flag/env var is set (harmless no-op now that the default is on)", () => {
    expect(parseCliArgs(["--graph-scoring-enabled"], {}).config.graphScoring.enabled).toBe(true);
    expect(parseCliArgs([], { ANCHOR_MCP_GRAPH_SCORING_ENABLED: "true" }).config.graphScoring.enabled).toBe(true);
  });

  it("opts out via --no-graph-scoring-enabled", () => {
    expect(parseCliArgs(["--no-graph-scoring-enabled"], {}).config.graphScoring.enabled).toBe(false);
  });

  it("opts out via ANCHOR_MCP_NO_GRAPH_SCORING_ENABLED", () => {
    expect(parseCliArgs([], { ANCHOR_MCP_NO_GRAPH_SCORING_ENABLED: "true" }).config.graphScoring.enabled).toBe(false);
  });

  it("the opt-out flag wins if both the opt-in and opt-out are somehow set", () => {
    expect(
      parseCliArgs(["--graph-scoring-enabled", "--no-graph-scoring-enabled"], {}).config.graphScoring.enabled,
    ).toBe(false);
  });

  it("still honors --graph-scoring-max-boost independent of the enabled resolution", () => {
    const options = parseCliArgs(["--no-graph-scoring-enabled", "--graph-scoring-max-boost", "3"], {});
    expect(options.config.graphScoring.enabled).toBe(false);
    expect(options.config.graphScoring.maxBoost).toBe(3);
  });
});

describe("CLI args — help", () => {
  it("reports help for --help and -h without requiring any other argument", () => {
    // Help must resolve before anything touches the filesystem: the default repo path may
    // not exist, and asking a tool how to use it should never depend on being configured.
    expect(parseCliArgs(["--help"], {}).help).toBe(true);
    expect(parseCliArgs(["-h"], {}).help).toBe(true);
  });

  it("does not report help when it was not asked for", () => {
    expect(parseCliArgs([], {}).help).toBe(false);
    expect(parseCliArgs(["--transport", "http"], {}).help).toBe(false);
  });

  it("wins over other flags, including invalid ones", () => {
    // `--help` after a typo should still explain the tool rather than reporting the typo.
    expect(parseCliArgs(["--anchor-schema-mode", "nonsense", "--help"], {}).help).toBe(true);
  });

  it("documents every environment variable the parser actually reads", () => {
    // The flag assertion below has a blind spot in this dimension: help omitted the three
    // graph-scoring variables precisely because nothing checked env coverage.
    for (const variable of [
      "ANCHOR_MCP_REPO",
      "ANCHOR_MCP_ANCHOR_ROOT",
      "ANCHOR_MCP_CONFIG",
      "ANCHOR_MCP_TRANSPORT",
      "ANCHOR_MCP_HOST",
      "ANCHOR_MCP_PORT",
      "ANCHOR_MCP_ALLOWED_HOSTS",
      "ANCHOR_MCP_AUTH_TOKEN",
      "ANCHOR_MCP_STATEFUL",
      "ANCHOR_MCP_SYNC_INTERVAL_MS",
      "ANCHOR_MCP_STALE_AFTER_DAYS",
      "ANCHOR_MCP_ANCHOR_SCHEMA_MODE",
      "ANCHOR_MCP_GRAPH_SCORING_ENABLED",
      "ANCHOR_MCP_NO_GRAPH_SCORING_ENABLED",
      "ANCHOR_MCP_GRAPH_SCORING_MAX_BOOST",
      "DATABASE_URL",
    ]) {
      expect(HELP_TEXT, `help should document ${variable}`).toContain(variable);
    }
  });

  it("names the settings reachable only from the config file", () => {
    // logging and database have no flag and no variable, so help is the only place a reader
    // could discover they exist at all.
    expect(HELP_TEXT).toContain("Config-file only");
    expect(HELP_TEXT).toContain("logging");
    expect(HELP_TEXT).toContain("poolSize");
  });

  it("documents every flag the parser actually accepts", () => {
    // A help text that omits a flag is worse than none: it implies the flag does not exist.
    for (const flag of [
      "--repo",
      "--config",
      "--transport",
      "--host",
      "--port",
      "--allowed-hosts",
      "--auth-token",
      "--stateful",
      "--anchor-root",
      "--no-auto-sync",
      "--no-push-on-write",
      "--sync-interval-ms",
      "--stale-after-days",
      "--anchor-schema-mode",
      "--database-url",
    ]) {
      expect(HELP_TEXT, `help should document ${flag}`).toContain(flag);
    }
  });
});

describe("CLI args — databaseUrl", () => {
  it("returns undefined when no source is provided", () => {
    expect(parseCliArgs([], {}, NO_CONFIG).databaseUrl).toBeUndefined();
  });

  it("reads databaseUrl from the --database-url flag", () => {
    const options = parseCliArgs(["--database-url", "postgres://anchor:anchor@localhost:55432/anchor_mcp"], {});
    expect(options.databaseUrl).toBe("postgres://anchor:anchor@localhost:55432/anchor_mcp");
  });

  it("reads databaseUrl from the DATABASE_URL environment variable", () => {
    const options = parseCliArgs([], { DATABASE_URL: "postgres://anchor:anchor@localhost:55432/anchor_mcp" });
    expect(options.databaseUrl).toBe("postgres://anchor:anchor@localhost:55432/anchor_mcp");
  });

  it("the --database-url flag takes precedence over DATABASE_URL", () => {
    const options = parseCliArgs(["--database-url", "postgres://flag@localhost:55432/db"], {
      DATABASE_URL: "postgres://env@localhost:55432/db",
    });
    expect(options.databaseUrl).toBe("postgres://flag@localhost:55432/db");
  });

  it("rejects a databaseUrl that is not a Postgres connection string", () => {
    expect(() => parseCliArgs(["--database-url", "mysql://localhost/db"], {})).toThrow(/postgres/i);
  });

  it("treats an exported-but-empty DATABASE_URL as unset rather than as a connection string", () => {
    expect(parseCliArgs([], { DATABASE_URL: "" }, NO_CONFIG).databaseUrl).toBeUndefined();
    expect(parseCliArgs([], { DATABASE_URL: "   " }, NO_CONFIG).databaseUrl).toBeUndefined();
    expect(parseCliArgs(["--database-url", "  "], {}, NO_CONFIG).databaseUrl).toBeUndefined();
  });

  it("trims surrounding whitespace off a real connection string", () => {
    expect(parseCliArgs([], { DATABASE_URL: "  postgres://anchor@localhost:55432/db  " }).databaseUrl).toBe(
      "postgres://anchor@localhost:55432/db",
    );
  });

  it("never reads a connection string from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ database: { url: "postgres://sneaky@localhost/db" } }), "utf8");

    const options = parseCliArgs(["--config", configPath], {});
    expect(options.databaseUrl).toBeUndefined();
  });
});

describe("CLI args — config.database (poolSize, schemaName)", () => {
  it("is undefined when no database config is supplied", () => {
    expect(parseCliArgs([], {}, NO_CONFIG).config.database).toBeUndefined();
  });

  it("reads poolSize and schemaName from the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ database: { poolSize: 4, schemaName: "knowledge_dev" } }), "utf8");

    const options = parseCliArgs(["--config", configPath], {});
    // storeTaskText comes through resolved too: a config block that named only poolSize and
    // schemaName still carries the retention decision, and asserting the whole object is what
    // makes a silently-added or silently-dropped setting visible here.
    expect(options.config.database).toEqual({
      poolSize: 4,
      schemaName: "knowledge_dev",
      storeTaskText: true,
    });
  });

  it("defaults poolSize and schemaName when the database block is empty", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ database: {} }), "utf8");

    const options = parseCliArgs(["--config", configPath], {});
    expect(options.config.database).toEqual({
      poolSize: 10,
      schemaName: "knowledge",
      storeTaskText: true,
    });
  });

  it("rejects a non-object database config value", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ database: "knowledge" }), "utf8");

    expect(() => parseCliArgs(["--config", configPath], {})).toThrow(/Expected config field database to be an object/);
  });

  it("rejects an invalid schemaName in the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ database: { schemaName: "Not Valid" } }), "utf8");

    expect(() => parseCliArgs(["--config", configPath], {})).toThrow(/schemaName/);
  });

  it("rejects a non-positive poolSize in the config file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-config-"));
    const configPath = path.join(tmpDir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify({ database: { poolSize: 0 } }), "utf8");

    expect(() => parseCliArgs(["--config", configPath], {})).toThrow(/poolSize/);
  });
});
