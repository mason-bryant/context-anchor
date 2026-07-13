import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../src/cli/args.js";
import { buildAllowedHosts } from "../src/http/server.js";

describe("CLI args", () => {
  it("uses MCP Express default host validation without extra allowed hosts", () => {
    const options = parseCliArgs(["--transport", "http"], {});

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
    const options = parseCliArgs(["--transport", "http"], {});
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
