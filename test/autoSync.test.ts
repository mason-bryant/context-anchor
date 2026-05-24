import { describe, expect, it, vi } from "vitest";

import { AutoSync } from "../src/git/autoSync.js";
import type { AnchorRepository } from "../src/git/repo.js";
import type { AppLogger } from "../src/logger.js";
import type { ConflictStatus } from "../src/types.js";

type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
};

function testLogger(): { logger: AppLogger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const push = (level: LogEntry["level"], message: string, meta?: Record<string, unknown>) => {
    entries.push({ level, message, meta });
  };

  return {
    entries,
    logger: {
      enabled: true,
      debug: (message, meta) => push("debug", message, meta),
      info: (message, meta) => push("info", message, meta),
      warn: (message, meta) => push("warn", message, meta),
      error: (message, meta) => push("error", message, meta),
      async close() {},
    },
  };
}

function testRepo(options: {
  status?: ConflictStatus;
  upstream?: string;
}): AnchorRepository & {
  conflictStatus: ReturnType<typeof vi.fn>;
  currentUpstream: ReturnType<typeof vi.fn>;
  pullRebase: ReturnType<typeof vi.fn>;
} {
  const status = options.status ?? { state: "clean" };
  return {
    repoPath: "/tmp/anchor-context",
    conflictStatus: vi.fn(async () => status),
    currentUpstream: vi.fn(async () => options.upstream),
    pullRebase: vi.fn(async () => undefined),
  } as unknown as AnchorRepository & {
    conflictStatus: ReturnType<typeof vi.fn>;
    currentUpstream: ReturnType<typeof vi.fn>;
    pullRebase: ReturnType<typeof vi.fn>;
  };
}

describe("AutoSync", () => {
  it("skips pull and logs once when the current branch has no upstream", async () => {
    const repo = testRepo({});
    const { logger, entries } = testLogger();
    const autoSync = new AutoSync(repo, 45_000, logger);

    await autoSync.tick();
    await autoSync.tick();

    expect(repo.currentUpstream).toHaveBeenCalledTimes(2);
    expect(repo.pullRebase).not.toHaveBeenCalled();
    expect(entries.filter((entry) => entry.level === "warn")).toEqual([
      {
        level: "warn",
        message: "auto sync skipped because current branch has no upstream",
        meta: { repoPath: "/tmp/anchor-context" },
      },
    ]);
  });

  it("pulls when the current branch has an upstream", async () => {
    const repo = testRepo({ upstream: "origin/main" });
    const { logger, entries } = testLogger();
    const autoSync = new AutoSync(repo, 45_000, logger);

    await autoSync.tick();

    expect(repo.currentUpstream).toHaveBeenCalledOnce();
    expect(repo.pullRebase).toHaveBeenCalledOnce();
    expect(entries.filter((entry) => entry.level === "warn")).toEqual([]);
  });
});
