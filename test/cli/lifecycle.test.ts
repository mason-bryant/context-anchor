import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import net from "node:net";

import {
  inspectServer,
  isPortListening,
  runtimePaths,
  startServer,
  stopServer,
  writePidFile,
  type ProcessProbe,
} from "../../src/cli/lifecycle.js";

async function home(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "anchor-mcp-home-"));
}

/** Nothing is alive and nothing can be signalled, unless a test says otherwise. */
function probe(overrides: Partial<ProcessProbe> = {}): ProcessProbe & { signalled: number[] } {
  const signalled: number[] = [];
  return {
    signalled,
    isAlive: () => false,
    commandLine: () => undefined,
    signal: (pid) => {
      signalled.push(pid);
    },
    ...overrides,
  };
}

describe("runtime paths", () => {
  it("keys the pidfile and log by host and port so two instances do not collide", async () => {
    const root = await home();

    const a = runtimePaths("127.0.0.1", 3333, root);
    const b = runtimePaths("127.0.0.1", 4100, root);

    expect(a.pidFile).not.toBe(b.pidFile);
    expect(a.logFile).not.toBe(b.logFile);
    expect(a.pidFile.startsWith(root)).toBe(true);
  });

  // The anchor repository auto-commits and auto-pushes, so runtime files must never land
  // there — a pidfile would get committed to the user's context repo on the next sync.
  it("puts runtime files under the home directory, not the anchor repo", async () => {
    const root = await home();

    const paths = runtimePaths("127.0.0.1", 3333, root);

    expect(paths.pidFile).toContain(path.join(".anchor-mcp", "run"));
    expect(paths.logFile).toContain(path.join(".anchor-mcp", "logs"));
  });

  it("does not put a path separator in the file name for an IPv6 host", async () => {
    const root = await home();

    const paths = runtimePaths("[::1]", 3333, root);

    expect(path.basename(paths.pidFile)).not.toContain(path.sep);
    expect(path.basename(paths.pidFile)).toMatch(/3333/);
  });
});

describe("port probing", () => {
  // net.Socket.connect wants an unbracketed address: "[::1]" resolves as a hostname and
  // fails ENOTFOUND, which would make every probe report "nothing listening" and break
  // start/restart/status for an IPv6 bind.
  it("probes a bracketed IPv6 host", async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "::1", () => {
        resolve((server.address() as net.AddressInfo).port);
      });
    });

    try {
      expect(await isPortListening("[::1]", port)).toBe(true);
      expect(await isPortListening("::1", port)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("probes a 0.0.0.0 bind through loopback", async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "0.0.0.0", () => {
        resolve((server.address() as net.AddressInfo).port);
      });
    });

    try {
      expect(await isPortListening("0.0.0.0", port)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("reports nothing listening on a free port", async () => {
    expect(await isPortListening("127.0.0.1", 1)).toBe(false);
  });
});

describe("server state", () => {
  // status and stop must agree: reporting "running detached" for a pid that stop will
  // refuse to signal sends the user in a circle.
  it("classifies a live foreign pid as foreign, not running", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 4600, root);
    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 4600 });

    const state = await inspectServer({
      host: "127.0.0.1",
      port: 4600,
      home: root,
      probe: probe({ isAlive: () => true, commandLine: () => "/usr/bin/postgres -D /var/lib/pg" }),
    });

    expect(state.kind).toBe("foreign");
  });

  it("classifies a live anchor-mcp pid as running", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 4601, root);
    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 4601 });

    const state = await inspectServer({
      host: "127.0.0.1",
      port: 4601,
      home: root,
      probe: probe({ isAlive: () => true, commandLine: () => "node /usr/local/bin/anchor-mcp serve" }),
    });

    expect(state.kind).toBe("running");
  });
});

describe("start", () => {
  // A dev watch server, a foreground `serve`, or anything else on the port. Without this
  // check the child spawns, dies on bind, and the user waits out the full timeout only to
  // be told "did not start listening" — with the real reason buried in a log file.
  it("refuses to spawn when something else already holds the port", async () => {
    const root = await home();
    const squatter = net.createServer();
    const port = await new Promise<number>((resolve) => {
      squatter.listen(0, "127.0.0.1", () => {
        resolve((squatter.address() as net.AddressInfo).port);
      });
    });

    try {
      const result = await startServer({
        host: "127.0.0.1",
        port,
        home: root,
        serverScript: "/nonexistent/should-never-spawn.js",
        probe: probe(),
      });

      expect(result.started).toBe(false);
      expect(result.message).toMatch(/already listening/i);
      // Nothing was spawned, so nothing should have been recorded.
      expect(existsSync(runtimePaths("127.0.0.1", port, root).pidFile)).toBe(false);
    } finally {
      await new Promise((resolve) => squatter.close(resolve));
    }
  });

  it("reports an already-running server from its own pidfile without spawning a second one", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 4571, root);
    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 4571 });

    const result = await startServer({
      host: "127.0.0.1",
      port: 4571,
      home: root,
      serverScript: "/nonexistent/should-never-spawn.js",
      probe: probe({ isAlive: () => true }),
    });

    expect(result.started).toBe(false);
    expect(result.pid).toBe(4242);
    expect(result.message).toMatch(/already running/i);
  });
});

describe("stop", () => {
  it("reports nothing running, and points at the MCP client, when no pidfile exists", async () => {
    const root = await home();

    const result = await stopServer({ host: "127.0.0.1", port: 3333, home: root, probe: probe() });

    expect(result.stopped).toBe(false);
    expect(result.reason).toBe("not-running");
    // Without this the message reads as a bug to anyone whose editor clearly has a
    // stdio server running right now.
    expect(result.message).toMatch(/stdio/i);
    expect(result.message).toMatch(/client/i);
  });

  it("signals the recorded pid and removes the pidfile", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 3333, root);
    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 3333 });

    const p = probe({ isAlive: () => true, commandLine: () => "node /usr/local/bin/anchor-mcp start" });
    const result = await stopServer({ host: "127.0.0.1", port: 3333, home: root, probe: p });

    expect(result.stopped).toBe(true);
    expect(p.signalled).toEqual([4242]);
    expect(existsSync(paths.pidFile)).toBe(false);
  });

  it("cleans up a stale pidfile whose process is gone without signalling anything", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 3333, root);
    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 3333 });

    const p = probe({ isAlive: () => false });
    const result = await stopServer({ host: "127.0.0.1", port: 3333, home: root, probe: p });

    expect(result.stopped).toBe(false);
    expect(result.reason).toBe("stale");
    expect(p.signalled).toEqual([]);
    expect(existsSync(paths.pidFile)).toBe(false);
  });

  // The reason a pidfile is safer than `lsof -ti:PORT`: pids get recycled, and killing
  // whatever inherited 4242 would be a very bad day.
  it("refuses to signal a live pid that is not an anchor-mcp process", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 3333, root);
    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 3333 });

    const p = probe({ isAlive: () => true, commandLine: () => "/usr/bin/postgres -D /var/lib/pg" });
    const result = await stopServer({ host: "127.0.0.1", port: 3333, home: root, probe: p });

    expect(result.stopped).toBe(false);
    expect(result.reason).toBe("foreign-process");
    expect(p.signalled).toEqual([]);
    expect(result.message).toMatch(/4242/);
    // A pidfile pointing at someone else's process is not evidence we may delete it and
    // move on silently; the operator has to see it.
    expect(existsSync(paths.pidFile)).toBe(true);
  });

  it("treats an unreadable or corrupt pidfile as stale rather than crashing", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 3333, root);
    await writePidFile(paths.pidFile, { pid: 1, host: "127.0.0.1", port: 3333 });
    await writeFile(paths.pidFile, "not json at all", "utf8");

    const result = await stopServer({ host: "127.0.0.1", port: 3333, home: root, probe: probe() });

    expect(result.stopped).toBe(false);
    expect(result.reason).toBe("stale");
  });

  it("records the host and port it bound so status can report them", async () => {
    const root = await home();
    const paths = runtimePaths("127.0.0.1", 3333, root);

    await writePidFile(paths.pidFile, { pid: 4242, host: "127.0.0.1", port: 3333 });

    const written: unknown = JSON.parse(await readFile(paths.pidFile, "utf8"));
    expect(written).toMatchObject({ pid: 4242, host: "127.0.0.1", port: 3333 });
    expect(written).toHaveProperty("startedAt");
  });
});
