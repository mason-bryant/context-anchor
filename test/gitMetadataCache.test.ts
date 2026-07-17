import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitMetadataCache, parseNameStatusLog } from "../src/git/metadataCache.js";
import { AnchorRepository } from "../src/git/repo.js";

const MARKER = "\u0001";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-metadata-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function commitFile(
  repo: AnchorRepository,
  relativePath: string,
  content: string,
  message: string,
  authorDate?: string,
): Promise<string> {
  await mkdir(path.dirname(path.join(tmpDir, relativePath)), { recursive: true });
  await writeFile(path.join(tmpDir, relativePath), content, "utf8");
  await repo.git.add(relativePath);
  const args = ["-c", "user.name=test", "-c", "user.email=test@local", "commit", "-m", message];
  if (authorDate) {
    args.push("--date", authorDate);
  }
  await repo.git.raw(args);
  return (await repo.git.revparse(["HEAD"])).trim();
}

describe("parseNameStatusLog", () => {
  it("keys metadata by present-day path and follows renames backwards", () => {
    const output = [
      `${MARKER}ccc\t2026-03-01T00:00:00+00:00`,
      "",
      "M\tdocs/b.md",
      `${MARKER}bbb\t2026-02-01T00:00:00+00:00`,
      "",
      "R100\tdocs/a.md\tdocs/b.md",
      `${MARKER}aaa\t2026-01-01T00:00:00+00:00`,
      "",
      "A\tdocs/a.md",
      "A\tother.md",
    ].join("\n");

    const byPath = parseNameStatusLog(output);

    expect(byPath.get("docs/b.md")).toEqual({
      lastCommit: "ccc",
      firstCommitDate: new Date("2026-01-01T00:00:00Z").toISOString(),
    });
    expect(byPath.get("other.md")).toEqual({
      lastCommit: "aaa",
      firstCommitDate: new Date("2026-01-01T00:00:00Z").toISOString(),
    });
    expect(byPath.has("docs/a.md")).toBe(false);
  });

  it("uses the newest touching commit as lastCommit and the oldest as firstCommitDate", () => {
    const output = [
      `${MARKER}c3\t2026-03-01T00:00:00+00:00`,
      "",
      "M\ta.md",
      `${MARKER}c2\t2026-02-01T00:00:00+00:00`,
      "",
      "M\ta.md",
      `${MARKER}c1\t2026-01-01T00:00:00+00:00`,
      "",
      "A\ta.md",
    ].join("\n");

    const byPath = parseNameStatusLog(output);

    expect(byPath.get("a.md")).toEqual({
      lastCommit: "c3",
      firstCommitDate: new Date("2026-01-01T00:00:00Z").toISOString(),
    });
  });
});

describe("GitMetadataCache", () => {
  it("serves last commit, first commit date, and head from a single log walk", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const c1 = await commitFile(repo, "a.md", "one", "add a", "2026-01-02T03:04:05Z");
    const c2 = await commitFile(repo, "a.md", "two", "edit a");
    const c3 = await commitFile(repo, "b.md", "bee", "add b");

    const cache = new GitMetadataCache(repo.git, tmpDir);

    await expect(cache.lastCommitForPath("a.md")).resolves.toBe(c2);
    await expect(cache.lastCommitForPath("b.md")).resolves.toBe(c3);
    await expect(cache.firstCommitDateForPath("a.md")).resolves.toBe(new Date("2026-01-02T03:04:05Z").toISOString());
    await expect(cache.currentHead()).resolves.toBe(c3);
    expect(c1).not.toBe(c2);
  });

  it("spawns no git processes on warm access", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await commitFile(repo, "a.md", "one", "add a");

    const cache = new GitMetadataCache(repo.git, tmpDir);
    await cache.lastCommitForPath("a.md");

    const rawSpy = vi.spyOn(repo.git, "raw");
    const logSpy = vi.spyOn(repo.git, "log");
    const revparseSpy = vi.spyOn(repo.git, "revparse");

    await cache.lastCommitForPath("a.md");
    await cache.firstCommitDateForPath("a.md");
    await cache.currentHead();

    expect(rawSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(revparseSpy).not.toHaveBeenCalled();
  });

  it("picks up out-of-band commits through the filesystem HEAD check", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await commitFile(repo, "a.md", "one", "add a");

    const cache = new GitMetadataCache(repo.git, tmpDir);
    await cache.lastCommitForPath("a.md");

    const c2 = await commitFile(repo, "a.md", "two", "edit a out of band");

    await expect(cache.lastCommitForPath("a.md")).resolves.toBe(c2);
    await expect(cache.currentHead()).resolves.toBe(c2);
  });

  it("returns undefined for uncommitted paths and for an empty repository", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();

    const cache = new GitMetadataCache(repo.git, tmpDir);
    await expect(cache.lastCommitForPath("a.md")).resolves.toBeUndefined();
    await expect(cache.currentHead()).resolves.toBeUndefined();

    const c1 = await commitFile(repo, "a.md", "one", "add a");
    await expect(cache.lastCommitForPath("a.md")).resolves.toBe(c1);
    await expect(cache.lastCommitForPath("missing.md")).resolves.toBeUndefined();
  });

  it("follows renames for firstCommitDate when rebuilding from history", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await commitFile(repo, "a.md", "same body either way", "add a", "2026-01-02T03:04:05Z");
    await repo.git.raw(["mv", "--", "a.md", "b.md"]);
    await repo.git.raw(["-c", "user.name=test", "-c", "user.email=test@local", "commit", "-m", "rename a to b"]);
    const c2 = (await repo.git.revparse(["HEAD"])).trim();

    const cache = new GitMetadataCache(repo.git, tmpDir);

    await expect(cache.lastCommitForPath("b.md")).resolves.toBe(c2);
    await expect(cache.firstCommitDateForPath("b.md")).resolves.toBe(new Date("2026-01-02T03:04:05Z").toISOString());
    await expect(cache.lastCommitForPath("a.md")).resolves.toBeUndefined();
  });

  it("follows renames even when rename detection is disabled in git config", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await repo.git.raw(["config", "diff.renames", "false"]);
    await commitFile(repo, "a.md", "same body either way", "add a", "2026-01-02T03:04:05Z");
    await repo.git.raw(["mv", "--", "a.md", "b.md"]);
    await repo.git.raw(["-c", "user.name=test", "-c", "user.email=test@local", "commit", "-m", "rename a to b"]);

    const cache = new GitMetadataCache(repo.git, tmpDir);

    await expect(cache.firstCommitDateForPath("b.md")).resolves.toBe(new Date("2026-01-02T03:04:05Z").toISOString());
  });

  it("discards a rebuild that raced an invalidate instead of clobbering newer state", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await commitFile(repo, "a.md", "one", "add a");

    const cache = new GitMetadataCache(repo.git, tmpDir);

    const realRaw = repo.git.raw.bind(repo.git);
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let reachedGate!: () => void;
    const gateReached = new Promise<void>((resolve) => {
      reachedGate = resolve;
    });
    let gated = false;
    const rawSpy = vi.spyOn(repo.git, "raw");
    const gatedRaw = async (...args: unknown[]): Promise<string> => {
      const first = args[0];
      if (!gated && Array.isArray(first) && first.includes("--name-status")) {
        gated = true;
        reachedGate();
        await gate;
      }
      return realRaw(...(args as Parameters<typeof realRaw>));
    };
    rawSpy.mockImplementation(
      gatedRaw as unknown as Parameters<typeof rawSpy.mockImplementation>[0],
    );

    try {
      // First access starts a rebuild that blocks inside the history walk.
      const pending = cache.currentHead();
      await gateReached;

      // While the walk is in flight, the cache is invalidated and HEAD moves.
      cache.invalidate();
      const c2 = await commitFile(repo, "a.md", "two", "edit during rebuild");
      releaseGate();

      // The blocked rebuild must be discarded and re-run against the new HEAD,
      // not published over the invalidation.
      await expect(pending).resolves.toBe(c2);
      await expect(cache.lastCommitForPath("a.md")).resolves.toBe(c2);
    } finally {
      rawSpy.mockRestore();
    }
  });

  it("folds in-process commits in via recordCommit without rebuilding", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await commitFile(repo, "a.md", "one", "add a");

    const cache = new GitMetadataCache(repo.git, tmpDir);
    await cache.lastCommitForPath("a.md");

    const c2 = await commitFile(repo, "a.md", "two", "edit a");
    cache.recordCommit(c2, new Date().toISOString(), ["a.md"]);

    const rawSpy = vi.spyOn(repo.git, "raw");
    await expect(cache.lastCommitForPath("a.md")).resolves.toBe(c2);
    await expect(cache.currentHead()).resolves.toBe(c2);
    expect(rawSpy).not.toHaveBeenCalled();
  });
});

describe("AnchorRepository git metadata integration", () => {
  const anchorBody = `---
type: context-anchor
tags: []
summary: Metadata cache test anchor.
read_this_if:
  - You are testing the git metadata cache.
last_validated: 2026-07-07
---

# Metadata Cache

## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

  it("keeps readAnchor fileCommit and version consistent after commitAnchor with no per-read git calls", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();

    // Warm the metadata cache so the write below is folded in incrementally.
    await commitFile(repo, "seed.md", "seed", "seed commit");
    await repo.lastRevisionForPath("seed.md");

    const version = await repo.commitAnchor({ name: "shared/cache-test.md", content: anchorBody });
    expect(version).toBeTruthy();

    const rawSpy = vi.spyOn(repo.git, "raw");
    const logSpy = vi.spyOn(repo.git, "log");
    const revparseSpy = vi.spyOn(repo.git, "revparse");

    const read = await repo.readAnchor("shared/cache-test.md");
    expect(read.fileCommit).toBe(version);
    expect(read.version).toBe(version);

    expect(rawSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(revparseSpy).not.toHaveBeenCalled();
  });

  it("carries createdAt across renameAnchorFile", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();

    await repo.commitAnchor({ name: "shared/original.md", content: anchorBody });
    const before = await repo.listAnchors();
    const original = before.find((meta) => meta.name === "shared/original.md");
    expect(original?.createdAt).toBeTruthy();

    await repo.renameAnchorFile({ from: "shared/original.md", to: "shared/renamed.md" });

    const after = await repo.listAnchors();
    const renamed = after.find((meta) => meta.name === "shared/renamed.md");
    expect(renamed?.createdAt).toBe(original?.createdAt);
  });
});
