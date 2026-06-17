import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorRepository } from "../src/git/repo.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-repo-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AnchorRepository", () => {
  it.each([
    "fatal: no upstream configured for branch 'main'",
    "fatal: HEAD does not point to a branch",
    "fatal: no such branch: 'main'",
  ])("returns undefined for expected missing-upstream errors: %s", async (message) => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    vi.spyOn(repo.git, "revparse").mockRejectedValue(new Error(message));

    await expect(repo.currentUpstream()).resolves.toBeUndefined();
  });

  it("rethrows unexpected upstream lookup errors", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    const error = new Error("fatal: not a git repository");
    vi.spyOn(repo.git, "revparse").mockRejectedValue(error);

    await expect(repo.currentUpstream()).rejects.toBe(error);
  });

  it("uses the first git commit date as anchor createdAt metadata", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await mkdir(path.join(tmpDir, "shared"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "shared", "created.md"),
      `---
type: context-anchor
tags: []
summary: Created date test anchor.
read_this_if:
  - You are testing git-backed creation metadata.
last_validated: 2026-05-24
---

# Created Date

## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.
`,
      "utf8",
    );

    await repo.git.add("shared/created.md");
    await repo.git.raw([
      "-c",
      "user.name=anchor-mcp",
      "-c",
      "user.email=anchor-mcp@local",
      "commit",
      "--date=2020-01-02T03:04:05Z",
      "-m",
      "test: add created anchor",
    ]);

    const anchors = await repo.listAnchors();

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.createdAt).toBe("2020-01-02T03:04:05.000Z");
  });

  it("reuses indexed anchor metadata across repeated listings and invalidates after writes", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await mkdir(path.join(tmpDir, "shared"), { recursive: true });
    await commitAnchorFile(repo, "shared/cache-test.md", "Cache Test", "2026-05-03T00:00:00Z");

    const rawSpy = vi.spyOn(repo.git, "raw");

    await repo.listAnchors();
    await repo.listAnchors();

    expect(gitLogFollowCalls(rawSpy)).toHaveLength(1);

    rawSpy.mockClear();
    await repo.commitAnchor({
      name: "shared/cache-test",
      content: anchorContent("Cache Test Updated"),
      message: "test: update cache test",
    });
    await repo.listAnchors();

    expect(gitLogFollowCalls(rawSpy)).toHaveLength(1);
  });

  it("returns paged anchor metadata in last-updated order", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await mkdir(path.join(tmpDir, "shared"), { recursive: true });

    const files = [
      { name: "old", updatedAt: "2026-05-01T00:00:00.000Z" },
      { name: "new", updatedAt: "2026-05-03T00:00:00.000Z" },
      { name: "middle", updatedAt: "2026-05-02T00:00:00.000Z" },
    ];
    for (const file of files) {
      const absolutePath = path.join(tmpDir, "shared", `${file.name}.md`);
      await writeFile(absolutePath, anchorContent(file.name), "utf8");
      const updatedAt = new Date(file.updatedAt);
      await utimes(absolutePath, updatedAt, updatedAt);
    }

    const firstPage = await repo.listAnchorsPage({}, { sort: "updated", offset: 0, limit: 2 });
    const secondPage = await repo.listAnchorsPage({}, { sort: "updated", offset: 2, limit: 2 });

    expect(firstPage.anchors.map((anchor) => anchor.name)).toEqual(["shared/new.md", "shared/middle.md"]);
    expect(firstPage.total).toBe(3);
    expect(firstPage.nextOffset).toBe(2);
    expect(secondPage.anchors.map((anchor) => anchor.name)).toEqual(["shared/old.md"]);
    expect(secondPage.total).toBe(3);
    expect(secondPage.nextOffset).toBeUndefined();
  });

  it("pages created sort using the same git-created timestamp returned in metadata", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await mkdir(path.join(tmpDir, "shared"), { recursive: true });

    await commitAnchorFile(repo, "shared/first-created.md", "First Created", "2026-05-03T00:00:00Z");
    await commitAnchorFile(repo, "shared/second-created.md", "Second Created", "2026-05-01T00:00:00Z");

    const firstPage = await repo.listAnchorsPage({}, { sort: "created", offset: 0, limit: 1 });
    const secondPage = await repo.listAnchorsPage({}, { sort: "created", offset: 1, limit: 1 });

    expect(firstPage.anchors.map((anchor) => [anchor.name, anchor.createdAt])).toEqual([
      ["shared/first-created.md", "2026-05-03T00:00:00.000Z"],
    ]);
    expect(firstPage.nextOffset).toBe(1);
    expect(secondPage.anchors.map((anchor) => [anchor.name, anchor.createdAt])).toEqual([
      ["shared/second-created.md", "2026-05-01T00:00:00.000Z"],
    ]);
  });
});

async function commitAnchorFile(
  repo: AnchorRepository,
  name: string,
  title: string,
  date: string,
): Promise<void> {
  await writeFile(path.join(tmpDir, name), anchorContent(title), "utf8");
  await repo.git.add(name);
  await repo.git.raw([
    "-c",
    "user.name=anchor-mcp",
    "-c",
    "user.email=anchor-mcp@local",
    "commit",
    "--date",
    date,
    "-m",
    `test: add ${title}`,
  ]);
}

function anchorContent(title: string): string {
  return `---
type: context-anchor
tags: []
summary: ${title} anchor summary.
read_this_if:
  - You are testing paged anchor metadata.
last_validated: 2026-05-24
---

# ${title}

## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;
}

function gitLogFollowCalls(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((call) => {
    const args = call[0];
    return Array.isArray(args) && args[0] === "log" && args.includes("--follow");
  });
}
