import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../../src/cli/args.js";
import { runtimePaths, writePidFile } from "../../src/cli/lifecycle.js";
import { statusReport } from "../../src/cli/status.js";

const SECRET = "s3cret-token-value-do-not-print";
const DATABASE_URL = "postgres://anchor:hunter2@127.0.0.1:55432/anchor_mcp";

async function optionsWith(config: Record<string, unknown>, argv: string[] = []) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-status-"));
  await writeFile(path.join(dir, "anchor-mcp.config.json"), JSON.stringify(config), "utf8");
  return parseCliArgs(argv, {}, { cwd: dir });
}

describe("status", () => {
  // `status` is the command people paste into bug reports.
  it("never prints the auth token or the database password", async () => {
    const options = await optionsWith({ authToken: SECRET }, ["status", "--database-url", DATABASE_URL]);

    const report = (
      await statusReport(options, {
        home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")),
        readDatabase: () => Promise.resolve({ version: 3, pending: 0 }),
      })
    ).join("\n");

    expect(report).not.toContain(SECRET);
    expect(report).not.toContain("hunter2");
    expect(report).toMatch(/token configured/);
  });

  it("reports the config file it actually resolved", async () => {
    const options = await optionsWith({ authToken: SECRET });

    const report = (
      await statusReport(options, { home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")) })
    ).join("\n");

    expect(report).toContain(options.configPath ?? "MISSING");
  });

  // The failure this prevents: a defaulted or mistyped repo path is created empty on
  // demand, so the server starts happily and then 500s on every lookup with an ENOENT
  // that names a file the user never expected to be looked for.
  it("calls out an anchor repo that exists but holds no anchors", async () => {
    const emptyRepo = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-emptyrepo-"));
    const options = await optionsWith({ repo: emptyRepo });

    const report = (
      await statusReport(options, { home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")) })
    ).join("\n");

    expect(report).toMatch(/EMPTY/);
  });

  it("says nothing extra when the repo actually holds anchors", async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-fullrepo-"));
    await writeFile(path.join(repo, "some-anchor.md"), "# anchor\n", "utf8");
    const options = await optionsWith({ repo });

    const report = (
      await statusReport(options, { home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")) })
    ).join("\n");

    expect(report).not.toMatch(/EMPTY/);
  });

  it("says the database is not configured rather than implying it is broken", async () => {
    const options = await optionsWith({});

    const report = (
      await statusReport(options, { home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")) })
    ).join("\n");

    expect(report).toMatch(/database\s+not configured/);
  });

  // Pending migrations are the one status that stops the server from booting, so the
  // report has to name the fix rather than leaving the reader to infer it.
  it("names the migrate command when migrations are pending", async () => {
    const options = await optionsWith({}, ["status", "--database-url", DATABASE_URL]);

    const report = (
      await statusReport(options, {
        home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")),
        readDatabase: () => Promise.resolve({ version: 1, pending: 2 }),
      })
    ).join("\n");

    expect(report).toMatch(/2 pending/);
    expect(report).toMatch(/anchor-mcp db migrate/);
  });

  // The contradiction Copilot caught: status said "running detached" for a recycled pid
  // that `stop` would refuse to signal, so the two commands disagreed about the same state.
  it("does not report a foreign pid as a running server", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-"));
    const options = await optionsWith({ port: 4700 });
    await writePidFile(runtimePaths(options.host, 4700, root).pidFile, {
      pid: 4242,
      host: options.host,
      port: 4700,
    });

    const report = (
      await statusReport(options, {
        home: root,
        probe: {
          isAlive: () => true,
          commandLine: () => "/usr/bin/postgres -D /var/lib/pg",
          signal: () => {
            throw new Error("status must never signal anything");
          },
        },
      })
    ).join("\n");

    expect(report).not.toMatch(/running detached/);
    expect(report).toMatch(/recycled pid|not anchor-mcp/);
  });

  it("reports an unreachable database without throwing", async () => {
    const options = await optionsWith({}, ["status", "--database-url", DATABASE_URL]);

    const report = (
      await statusReport(options, {
        home: await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-")),
        readDatabase: () => Promise.reject(new Error("ECONNREFUSED")),
      })
    ).join("\n");

    expect(report).toMatch(/unreachable/);
    expect(report).not.toContain("hunter2");
  });
});
