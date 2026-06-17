import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorRepository } from "../src/git/repo.js";
import type { AnchorStore } from "../src/storage/store.js";

let tmpDir: string;
let store: AnchorStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-store-contract-"));
  store = new AnchorRepository({ repoPath: tmpDir });
  await store.ensureReady();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AnchorStore contract", () => {
  it("supports core anchor metadata, read, search, and version operations", async () => {
    const firstVersion = await store.commitAnchor({
      name: "shared/contract",
      content: anchorContent("Contract Store"),
      message: "test: add contract anchor",
    });

    expect(firstVersion).toMatch(/[a-f0-9]{40}/);

    const [meta] = await store.listAnchors();
    expect(meta?.name).toBe("shared/contract.md");
    expect(meta?.summary).toBe("Contract Store anchor summary.");

    const read = await store.readAnchor("shared/contract");
    expect(read.content).toContain("storage boundary contract search text");
    expect(read.fileCommit).toMatch(/[a-f0-9]{40}/);

    const resolved = store.resolveAnchor("shared/contract");
    await expect(store.lastRevisionForPath(resolved.repoRelativePath)).resolves.toBe(read.fileCommit);

    const hits = await store.searchAnchors("boundary contract");
    expect(hits.map((hit) => hit.name)).toContain("shared/contract.md");

    const versions = await store.listVersions("shared/contract");
    expect(versions[0]?.message).toBe("test: add contract anchor");

    const secondVersion = await store.commitAnchor({
      name: "shared/contract",
      content: anchorContent("Contract Store Updated"),
      message: "test: update contract anchor",
    });
    expect(secondVersion).toMatch(/[a-f0-9]{40}/);

    const diff = await store.diffAnchor("shared/contract", firstVersion!, secondVersion!);
    expect(diff).toContain("Contract Store Updated");
  });
});

function anchorContent(title: string): string {
  return `---
type: context-anchor
tags:
  - contract
summary: ${title} anchor summary.
read_this_if:
  - You are testing the storage boundary contract.
last_validated: 2026-06-17
---

# ${title}

## Current State

- This anchor includes storage boundary contract search text.

## Decisions

- Keep storage behavior available through an interface.

## Constraints

- Contract tests should avoid backend-specific APIs.

## PRs

None.
`;
}
