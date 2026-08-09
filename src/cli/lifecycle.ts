import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Seam for process inspection so stale- and foreign-pid handling is testable without spawning real processes. */
export type ProcessProbe = {
  isAlive(pid: number): boolean;
  /** Full command line of a running pid, or undefined when it cannot be read. */
  commandLine(pid: number): string | undefined;
  signal(pid: number, signal: NodeJS.Signals): void;
};

export type PidFileContents = { pid: number; host: string; port: number; startedAt: string };

export type StopReason = "not-running" | "stale" | "foreign-process";

export type StopResult = {
  stopped: boolean;
  reason?: StopReason;
  message: string;
};

export const defaultProcessProbe: ProcessProbe = {
  isAlive(pid) {
    try {
      // Signal 0 performs the permission and existence check without delivering anything.
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the process exists but belongs to someone else — still alive.
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  commandLine(pid) {
    const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    if (result.status !== 0) {
      return undefined;
    }
    return result.stdout.trim() || undefined;
  },
  signal(pid, signal) {
    process.kill(pid, signal);
  },
};

/**
 * Runtime files live under the home directory rather than the anchor repository: that repo
 * auto-commits and auto-pushes, so a pidfile written there would be committed to the user's
 * context repo on the next sync. Keyed by host:port so instances on different ports have
 * distinct files and `stop --port N` targets exactly one of them.
 */
export function runtimePaths(host: string, port: number, home: string = os.homedir()) {
  const slug = `${host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}-${String(port)}`;
  return {
    pidFile: path.join(home, ".anchor-mcp", "run", `${slug}.pid`),
    logFile: path.join(home, ".anchor-mcp", "logs", `server-${slug}.log`),
  };
}

export async function writePidFile(
  pidFile: string,
  contents: Omit<PidFileContents, "startedAt"> & { startedAt?: string },
): Promise<void> {
  await mkdir(path.dirname(pidFile), { recursive: true });
  const payload: PidFileContents = { ...contents, startedAt: contents.startedAt ?? new Date().toISOString() };
  await writeFile(pidFile, JSON.stringify(payload, null, 2), "utf8");
}

export async function readPidFile(pidFile: string): Promise<PidFileContents | undefined> {
  if (!existsSync(pidFile)) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(await readFile(pidFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const { pid, host, port } = parsed as Partial<PidFileContents>;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      return undefined;
    }
    return {
      pid,
      host: typeof host === "string" ? host : "",
      port: typeof port === "number" ? port : 0,
      startedAt: (parsed as PidFileContents).startedAt ?? "",
    };
  } catch {
    // A truncated or hand-edited pidfile is indistinguishable from no server, and treating
    // it as fatal would leave `stop` permanently broken until someone deleted the file.
    return undefined;
  }
}

/** A pid is ours only if we can positively identify it. An unreadable command line fails closed. */
function isAnchorMcpProcess(commandLine: string | undefined): boolean {
  return commandLine !== undefined && /anchor-mcp/.test(commandLine);
}

export async function stopServer(options: {
  host: string;
  port: number;
  home?: string;
  probe?: ProcessProbe;
  signal?: NodeJS.Signals;
}): Promise<StopResult> {
  const probe = options.probe ?? defaultProcessProbe;
  const { pidFile } = runtimePaths(options.host, options.port, options.home);
  const record = await readPidFile(pidFile);

  if (!record) {
    // Distinguish "no detached server" from "no server at all": the caller very likely has
    // a stdio server running under their editor right now, and a bare "nothing to stop"
    // reads as a bug.
    if (existsSync(pidFile)) {
      await rm(pidFile, { force: true });
      return { stopped: false, reason: "stale", message: `Removed an unreadable pidfile at ${pidFile}.` };
    }
    return {
      stopped: false,
      reason: "not-running",
      message:
        `No detached anchor-mcp server is running on ${options.host}:${String(options.port)}. ` +
        `stdio servers are started and stopped by the MCP client that launched them.`,
    };
  }

  if (!probe.isAlive(record.pid)) {
    await rm(pidFile, { force: true });
    return {
      stopped: false,
      reason: "stale",
      message: `No process ${String(record.pid)} is running; removed the stale pidfile at ${pidFile}.`,
    };
  }

  if (!isAnchorMcpProcess(probe.commandLine(record.pid))) {
    // Pids are recycled. Deleting the file here would also be wrong: the operator needs to
    // see that something is inconsistent rather than have it quietly cleaned up.
    return {
      stopped: false,
      reason: "foreign-process",
      message:
        `Refusing to stop process ${String(record.pid)} from ${pidFile}: it is not an anchor-mcp process. ` +
        `The pid was likely reused. Remove the pidfile if that process is unrelated.`,
    };
  }

  probe.signal(record.pid, options.signal ?? "SIGTERM");
  await rm(pidFile, { force: true });
  return {
    stopped: true,
    message: `Stopped anchor-mcp (pid ${String(record.pid)}) on ${options.host}:${String(options.port)}.`,
  };
}

export type StartResult = { started: boolean; pid?: number; logFile: string; message: string };

/**
 * Spawns `serve` detached with output redirected to a log file, then waits until the port
 * actually accepts a connection — a spawn that returns successfully but dies on bind (port
 * taken, bad auth token) must be reported as a failure, not as a running server.
 */
export async function startServer(options: {
  host: string;
  port: number;
  serverScript: string;
  argv?: string[];
  home?: string;
  probe?: ProcessProbe;
  execPath?: string;
  timeoutMs?: number;
}): Promise<StartResult> {
  const probe = options.probe ?? defaultProcessProbe;
  const { pidFile, logFile } = runtimePaths(options.host, options.port, options.home);

  const existing = await readPidFile(pidFile);
  if (existing && probe.isAlive(existing.pid)) {
    return {
      started: false,
      pid: existing.pid,
      logFile,
      message: `anchor-mcp is already running (pid ${String(existing.pid)}) on ${options.host}:${String(options.port)}.`,
    };
  }

  // Something already on the port with no pidfile of ours — a foreground `serve`, a dev
  // watch server, an unrelated process. Spawning here would produce a child that dies on
  // bind and a misleading "did not start listening" after the full timeout.
  if (await isPortListening(options.host, options.port)) {
    return {
      started: false,
      logFile,
      message:
        `Something is already listening on ${options.host}:${String(options.port)}, and it was not started by ` +
        `\`anchor-mcp start\`. Stop it first, or choose another port with --port.`,
    };
  }

  await mkdir(path.dirname(logFile), { recursive: true });
  await mkdir(path.dirname(pidFile), { recursive: true });

  const { openSync, closeSync } = await import("node:fs");
  const { spawn } = await import("node:child_process");
  const fd = openSync(logFile, "a");
  try {
    const child = spawn(options.execPath ?? process.execPath, [options.serverScript, "serve", ...(options.argv ?? [])], {
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();

    if (child.pid === undefined) {
      return { started: false, logFile, message: "Could not spawn the server process." };
    }

    await writePidFile(pidFile, { pid: child.pid, host: options.host, port: options.port });

    const ready = await waitForPortListening(options.host, options.port, options.timeoutMs ?? 15_000);
    if (!ready) {
      // Leave the log in place; it holds the reason. Clean the pidfile so a later `start`
      // is not blocked by a process that never came up.
      if (probe.isAlive(child.pid)) {
        probe.signal(child.pid, "SIGTERM");
      }
      await rm(pidFile, { force: true });
      return {
        started: false,
        pid: child.pid,
        logFile,
        message: `Server did not start listening on ${options.host}:${String(options.port)}. See ${logFile}.`,
      };
    }

    return {
      started: true,
      pid: child.pid,
      logFile,
      message: `anchor-mcp listening on http://${options.host}:${String(options.port)}/mcp (pid ${String(child.pid)}), logging to ${logFile}.`,
    };
  } finally {
    closeSync(fd);
  }
}

async function waitForPortListening(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(host, port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Resolves once nothing is listening on host:port, so `restart` cannot race the old process's socket. */
export async function waitForPortFree(
  host: string,
  port: number,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortListening(host, port))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function isPortListening(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      done(true);
    });
    socket.once("timeout", () => {
      done(false);
    });
    socket.once("error", () => {
      done(false);
    });
    // 0.0.0.0 is a bind address, not a connect address.
    socket.connect(port, host === "0.0.0.0" ? "127.0.0.1" : host);
  });
}
