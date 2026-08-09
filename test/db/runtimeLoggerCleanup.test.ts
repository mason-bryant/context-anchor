import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appLoggerClose = vi.fn(async () => {});
const requestLoggerClose = vi.fn(async () => {});
const traceLoggerClose = vi.fn(async () => {});

// Mocked so the loggers createAnchorRuntime builds internally are observable. They are
// never returned to the caller, so closure on the failure path cannot be asserted any
// other way.
vi.mock("../../src/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/logger.js")>();
  return {
    ...actual,
    createAppLogger: () => ({
      enabled: false,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      close: appLoggerClose,
    }),
    createRequestLogger: () => ({ enabled: false, logToolCall: vi.fn(), close: requestLoggerClose }),
  };
});

vi.mock("../../src/trace/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/trace/logger.js")>();
  return {
    ...actual,
    createTraceLogger: () => ({
      enabled: false,
      dirname: os.tmpdir(),
      includeTaskText: false,
      log: vi.fn(),
      onEvent: vi.fn(),
      close: traceLoggerClose,
    }),
  };
});

const { createAnchorRuntime } = await import("../../src/runtime.js");

let tmpDir: string;
let unusableRepoPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-logger-cleanup-"));
  // A regular file where a repo directory is expected makes repo.ensureReady() fail, which
  // aborts startup before anything is returned — no database required.
  unusableRepoPath = path.join(tmpDir, "not-a-directory");
  await writeFile(unusableRepoPath, "x", "utf8");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function configFor(repoPath: string) {
  return {
    repoPath,
    anchorRoot: ".",
    autoSync: false,
    pushOnWrite: false,
    syncIntervalMs: 0,
    migrationWarnOnly: false,
    staleAfterDays: 45,
    graphScoring: { enabled: false, maxBoost: 8 },
  };
}

describe("createAnchorRuntime logger cleanup on startup failure", () => {
  it("closes every logger it created itself when initialization throws", async () => {
    await expect(createAnchorRuntime(configFor(unusableRepoPath))).rejects.toThrow();

    expect(appLoggerClose).toHaveBeenCalledTimes(1);
    expect(requestLoggerClose).toHaveBeenCalledTimes(1);
    expect(traceLoggerClose).toHaveBeenCalledTimes(1);
  });

  it("closes nothing it did not create", async () => {
    const callerClose = vi.fn(async () => {});
    const callerLogger = {
      enabled: false,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      close: callerClose,
    };

    await expect(createAnchorRuntime(configFor(unusableRepoPath), { logger: callerLogger })).rejects.toThrow();

    // Caller-supplied: it outlives this call and reports the failure that aborted startup.
    expect(callerClose).not.toHaveBeenCalled();
    // The two this function still created itself are cleaned up as usual.
    expect(requestLoggerClose).toHaveBeenCalledTimes(1);
    expect(traceLoggerClose).toHaveBeenCalledTimes(1);
    expect(appLoggerClose).not.toHaveBeenCalled();
  });
});
