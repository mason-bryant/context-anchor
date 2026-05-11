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
