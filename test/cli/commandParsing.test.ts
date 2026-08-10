import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HELP_TEXT, THREE_SOURCE_KEYS, parseCliArgs } from "../../src/cli/args.js";

async function configDir(contents: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-cmd-"));
  await writeFile(path.join(dir, "anchor-mcp.config.json"), JSON.stringify(contents), "utf8");
  return dir;
}

describe("subcommand dispatch", () => {
  // The compatibility guarantee that matters most: every MCP client stanza in the wild
  // launches `anchor-mcp --repo X --transport stdio` with no subcommand, and those must
  // keep serving in the foreground rather than becoming a detached `start`.
  it("defaults to serve when no subcommand is given", () => {
    const options = parseCliArgs(["--repo", "/tmp/anchors", "--transport", "stdio"], {});

    expect(options.command).toBe("serve");
    expect(options.config.repoPath).toBe("/tmp/anchors");
  });

  it("parses an explicit serve subcommand with flags after it", () => {
    const options = parseCliArgs(["serve", "--transport", "http", "--port", "4100"], {});

    expect(options.command).toBe("serve");
    expect(options.transport).toBe("http");
    expect(options.port).toBe(4100);
  });

  it.each(["start", "stop", "restart", "status"] as const)("parses the %s subcommand", (name) => {
    const options = parseCliArgs([name], {});

    expect(options.command).toBe(name);
  });

  it("keeps flags meaningful after a lifecycle subcommand", () => {
    // stop/restart/status all have to resolve the same host:port the server would bind,
    // or they would look for the wrong pidfile.
    const options = parseCliArgs(["stop", "--port", "4100", "--host", "0.0.0.0"], {});

    expect(options.command).toBe("stop");
    expect(options.port).toBe(4100);
    expect(options.host).toBe("0.0.0.0");
  });

  it("parses db subcommands", () => {
    const options = parseCliArgs(["db", "migrate"], {});

    expect(options.command).toBe("db");
    expect(options.db).toEqual({ command: "migrate" });
  });

  it("carries the reset confirmation through to the db command", () => {
    const options = parseCliArgs(["db", "reset", "--yes"], {});

    expect(options.db).toEqual({ command: "reset", yes: true });
  });

  // `db start`/`db stop` read better alongside the server's start/stop, but `db:up`/`db:down`
  // are in the docs and in muscle memory, so both spellings resolve to the same command.
  it("accepts start and stop as aliases for up and down", () => {
    expect(parseCliArgs(["db", "start"], {}).db).toEqual({ command: "up" });
    expect(parseCliArgs(["db", "stop"], {}).db).toEqual({ command: "down" });
    expect(parseCliArgs(["db", "up"], {}).db).toEqual({ command: "up" });
    expect(parseCliArgs(["db", "down"], {}).db).toEqual({ command: "down" });
  });

  it("rejects db reset without --yes", () => {
    expect(() => parseCliArgs(["db", "reset"], {})).toThrow(/--yes/);
  });

  it("rejects an unknown db subcommand", () => {
    expect(() => parseCliArgs(["db", "bogus"], {})).toThrow(/bogus/);
  });

  it("rejects an unknown subcommand rather than silently serving", () => {
    // `anchor-mcp serv` must not start a server: a typo that silently does the right-ish
    // thing is how you end up with two servers and no idea which one is answering.
    expect(() => parseCliArgs(["serv"], {})).toThrow(/serv/);
  });

  // The flag loop consumes a bare word following a valueless flag as that flag's value,
  // so `--no-auto-sync start` would parse as autoSync="start" (falsy -> sync stays ON)
  // and then serve. Requiring the subcommand first makes that misuse loud.
  it("rejects a known subcommand that appears after a flag", () => {
    expect(() => parseCliArgs(["--no-auto-sync", "start"], {})).toThrow(/subcommand/i);
  });

  it("still resolves --help before any subcommand handling", () => {
    expect(parseCliArgs(["--help"], {}).help).toBe(true);
    expect(parseCliArgs(["db", "--help"], {}).help).toBe(true);
  });

  it("documents every subcommand in the help text", () => {
    // Matched at the start of a line so this cannot pass on incidental prose —
    // "serve" appears inside "Transport to serve on", and "db" inside "database".
    for (const name of ["serve", "start", "stop", "restart", "status", "db"]) {
      expect(HELP_TEXT).toMatch(new RegExp(`^\\s{2}${name}\\b`, "m"));
    }
  });
});

// The help text has twice claimed a precedence story the parser did not implement. These
// cases assert the claim against real resolution instead of against prose, so a key listed
// as three-source that only reads from two fails here rather than misleading a reader.
const THREE_SOURCE_CASES: Record<
  (typeof THREE_SOURCE_KEYS)[number],
  { flag: string[]; env: NodeJS.ProcessEnv; file: unknown; read: (o: ReturnType<typeof parseCliArgs>) => unknown; expected: unknown }
> = {
  allowedHosts: {
    flag: ["--allowed-hosts", "a.test"],
    env: { ANCHOR_MCP_ALLOWED_HOSTS: "a.test" },
    file: ["a.test"],
    read: (o) => o.allowedHosts,
    expected: ["a.test"],
  },
  authToken: {
    flag: ["--auth-token", "tok"],
    env: { ANCHOR_MCP_AUTH_TOKEN: "tok" },
    file: "tok",
    read: (o) => o.authToken,
    expected: "tok",
  },
  stateful: {
    flag: ["--stateful"],
    env: { ANCHOR_MCP_STATEFUL: "true" },
    file: true,
    read: (o) => o.stateless,
    expected: false,
  },
  transport: {
    flag: ["--transport", "http"],
    env: { ANCHOR_MCP_TRANSPORT: "http" },
    file: "http",
    read: (o) => o.transport,
    expected: "http",
  },
  host: {
    flag: ["--host", "0.0.0.0"],
    env: { ANCHOR_MCP_HOST: "0.0.0.0" },
    file: "0.0.0.0",
    read: (o) => o.host,
    expected: "0.0.0.0",
  },
  port: {
    flag: ["--port", "4100"],
    env: { ANCHOR_MCP_PORT: "4100" },
    file: 4100,
    read: (o) => o.port,
    expected: 4100,
  },
  repo: {
    flag: ["--repo", "/tmp/anchors-x"],
    env: { ANCHOR_MCP_REPO: "/tmp/anchors-x" },
    file: "/tmp/anchors-x",
    read: (o) => o.config.repoPath,
    expected: "/tmp/anchors-x",
  },
};

describe("documented three-source precedence", () => {
  it.each(THREE_SOURCE_KEYS)("resolves %s from a flag, the environment, and the config file", async (key) => {
    const testCase = THREE_SOURCE_CASES[key];
    const empty = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-none-"));
    const withFile = await configDir({ [key]: testCase.file });

    expect(testCase.read(parseCliArgs(testCase.flag, {}, { cwd: empty })), `${key} from flag`).toEqual(
      testCase.expected,
    );
    expect(testCase.read(parseCliArgs([], testCase.env, { cwd: empty })), `${key} from env`).toEqual(
      testCase.expected,
    );
    expect(testCase.read(parseCliArgs([], {}, { cwd: withFile })), `${key} from config file`).toEqual(
      testCase.expected,
    );
  });

  it("lists exactly those keys in the help text", () => {
    const claimed = /readable\s+from all three:\s*([^.]+)\./.exec(HELP_TEXT.replace(/\s+/g, " "));
    expect(claimed, "help text should state which keys are three-source").not.toBeNull();
    expect(claimed?.[1]?.split(",").map((k) => k.trim()).sort()).toEqual([...THREE_SOURCE_KEYS].sort());
  });
});

describe("config file discovery", () => {
  it("auto-discovers anchor-mcp.config.json from the working directory", async () => {
    const dir = await configDir({ authToken: "from-discovered-file" });

    const options = parseCliArgs(["--transport", "http"], {}, { cwd: dir });

    expect(options.authToken).toBe("from-discovered-file");
  });

  it("prefers an explicit --config over a discovered file", async () => {
    const discovered = await configDir({ authToken: "discovered" });
    const explicitDir = await configDir({ authToken: "explicit" });

    const options = parseCliArgs(
      ["--config", path.join(explicitDir, "anchor-mcp.config.json")],
      {},
      { cwd: discovered },
    );

    expect(options.authToken).toBe("explicit");
  });

  it("prefers ANCHOR_MCP_CONFIG over a discovered file", async () => {
    const discovered = await configDir({ authToken: "discovered" });
    const fromEnv = await configDir({ authToken: "from-env" });

    const options = parseCliArgs(
      [],
      { ANCHOR_MCP_CONFIG: path.join(fromEnv, "anchor-mcp.config.json") },
      { cwd: discovered },
    );

    expect(options.authToken).toBe("from-env");
  });

  it("works with no config file present", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-empty-"));

    expect(() => parseCliArgs([], {}, { cwd: empty })).not.toThrow();
  });

  // host/port/transport have to be resolvable without flags: `stop` finds the pidfile by
  // host:port, so if they lived only in flags, `stop` would need the exact flags `start`
  // was given or it would look for the wrong file and report "nothing running".
  it("reads transport, host, and port from the config file", async () => {
    const dir = await configDir({ transport: "http", host: "0.0.0.0", port: 3333 });

    const options = parseCliArgs(["start"], {}, { cwd: dir });

    expect(options.transport).toBe("http");
    expect(options.host).toBe("0.0.0.0");
    expect(options.port).toBe(3333);
  });

  it("lets flags and environment override config-file transport, host, and port", async () => {
    const dir = await configDir({ transport: "http", host: "0.0.0.0", port: 3333 });

    expect(parseCliArgs(["serve", "--port", "4100"], {}, { cwd: dir }).port).toBe(4100);
    expect(parseCliArgs(["serve"], { ANCHOR_MCP_PORT: "4200" }, { cwd: dir }).port).toBe(4200);
    expect(parseCliArgs(["serve", "--host", "127.0.0.1"], {}, { cwd: dir }).host).toBe("127.0.0.1");
  });

  // Detached only ever means http, so `start` must not require the user to put
  // `transport: "http"` in the config — doing that would also flip every bare
  // `anchor-mcp` launch (i.e. every stdio MCP client stanza) onto the wrong transport.
  it("reports whether the transport was chosen explicitly or defaulted", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-none-"));
    const withFile = await configDir({ transport: "http" });

    expect(parseCliArgs(["start"], {}, { cwd: empty }).transportExplicit).toBe(false);
    expect(parseCliArgs(["serve", "--transport", "stdio"], {}, { cwd: empty }).transportExplicit).toBe(true);
    expect(parseCliArgs(["serve"], { ANCHOR_MCP_TRANSPORT: "http" }, { cwd: empty }).transportExplicit).toBe(true);
    expect(parseCliArgs(["serve"], {}, { cwd: withFile }).transportExplicit).toBe(true);
  });

  it("rejects an invalid transport from the config file", async () => {
    const dir = await configDir({ transport: "carrier-pigeon" });

    expect(() => parseCliArgs(["serve"], {}, { cwd: dir })).toThrow(/transport/i);
  });

  // The whole point of unifying discovery: `anchor-mcp db migrate` and the server must
  // agree on database.schemaName, or migrate applies to one schema and the server then
  // refuses to boot against another.
  it("resolves the same schemaName for the server and the db command", async () => {
    const dir = await configDir({ database: { schemaName: "shared_schema" } });

    const serve = parseCliArgs(["serve"], {}, { cwd: dir });
    const db = parseCliArgs(["db", "migrate"], {}, { cwd: dir });

    expect(serve.config.database?.schemaName).toBe("shared_schema");
    expect(db.config.database?.schemaName).toBe("shared_schema");
  });
});
