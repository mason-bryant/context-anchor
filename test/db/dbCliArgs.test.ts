import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDbCliArgs, resolveDbCliSchemaName } from "../../src/db/cliArgs.js";
import { DEFAULT_DATABASE_SCHEMA_NAME } from "../../src/db/config.js";

describe("parseDbCliArgs", () => {
  it("parses each known command", () => {
    expect(parseDbCliArgs(["up"])).toEqual({ command: "up" });
    expect(parseDbCliArgs(["down"])).toEqual({ command: "down" });
    expect(parseDbCliArgs(["status"])).toEqual({ command: "status" });
    expect(parseDbCliArgs(["migrate"])).toEqual({ command: "migrate" });
    expect(parseDbCliArgs(["psql"])).toEqual({ command: "psql" });
  });

  it("parses reset with the required --yes flag", () => {
    expect(parseDbCliArgs(["reset", "--yes"])).toEqual({ command: "reset", yes: true });
  });

  it("rejects reset without --yes", () => {
    expect(() => parseDbCliArgs(["reset"])).toThrow(/--yes/);
  });

  it("rejects a missing command", () => {
    expect(() => parseDbCliArgs([])).toThrow(/command/i);
  });

  it("rejects an unknown command", () => {
    expect(() => parseDbCliArgs(["frobnicate"])).toThrow(/frobnicate/);
  });

  it("rejects --yes on a command other than reset", () => {
    expect(() => parseDbCliArgs(["up", "--yes"])).toThrow(/reset/);
  });
});

describe("resolveDbCliSchemaName", () => {
  async function writeConfig(contents: unknown): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-db-cli-config-"));
    const configPath = path.join(dir, "anchor-mcp.config.json");
    await writeFile(configPath, JSON.stringify(contents), "utf8");
    return configPath;
  }

  it("defaults to the shared default schema when nothing is configured", () => {
    expect(resolveDbCliSchemaName({ env: {}, configPath: undefined })).toBe(DEFAULT_DATABASE_SCHEMA_NAME);
  });

  it("reads database.schemaName from the same config file the server reads", async () => {
    const configPath = await writeConfig({ database: { schemaName: "knowledge_dev" } });
    expect(resolveDbCliSchemaName({ env: {}, configPath })).toBe("knowledge_dev");
  });

  it("lets ANCHOR_MCP_DB_SCHEMA override the config file", async () => {
    const configPath = await writeConfig({ database: { schemaName: "knowledge_dev" } });
    expect(resolveDbCliSchemaName({ env: { ANCHOR_MCP_DB_SCHEMA: "knowledge_override" }, configPath })).toBe(
      "knowledge_override",
    );
  });

  it("falls back to the default when the config file has no database block", async () => {
    const configPath = await writeConfig({ authToken: "irrelevant" });
    expect(resolveDbCliSchemaName({ env: {}, configPath })).toBe(DEFAULT_DATABASE_SCHEMA_NAME);
  });

  it("ignores a missing config file rather than failing the CLI", () => {
    expect(resolveDbCliSchemaName({ env: {}, configPath: "/nonexistent/anchor-mcp.config.json" })).toBe(
      DEFAULT_DATABASE_SCHEMA_NAME,
    );
  });

  it("fails loudly when the config file is valid JSON but not an object", async () => {
    const configPath = await writeConfig([{ database: { schemaName: "knowledge_dev" } }]);
    expect(() => resolveDbCliSchemaName({ env: {}, configPath })).toThrow(/object/i);
  });

  it("fails loudly when database is present but not an object", async () => {
    for (const bad of ["knowledge_dev", 42, null, ["knowledge_dev"]]) {
      const configPath = await writeConfig({ database: bad });
      expect(() => resolveDbCliSchemaName({ env: {}, configPath }), `database: ${JSON.stringify(bad)}`).toThrow(
        /database/i,
      );
    }
  });

  it("fails loudly on a malformed config file instead of silently using the default schema", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-db-cli-config-"));
    const configPath = path.join(dir, "anchor-mcp.config.json");
    await writeFile(configPath, '{ "database": { "schemaName": "knowledge_dev" ', "utf8");

    // Falling back to the default here would migrate a different schema than the operator
    // configured — the exact divergence this resolver exists to prevent.
    expect(() => resolveDbCliSchemaName({ env: {}, configPath })).toThrow(/anchor-mcp\.config\.json|parse|JSON/i);
  });

  it("rejects an invalid schema name from either source", async () => {
    expect(() => resolveDbCliSchemaName({ env: { ANCHOR_MCP_DB_SCHEMA: "Not Valid" }, configPath: undefined })).toThrow(
      /schemaName/,
    );

    const configPath = await writeConfig({ database: { schemaName: "Not Valid" } });
    expect(() => resolveDbCliSchemaName({ env: {}, configPath })).toThrow(/schemaName/);
  });
});
