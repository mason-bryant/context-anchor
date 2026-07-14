import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { isValidAnchorId } from "../src/graph/identity.js";

/**
 * Goal 0 Phase 2 WP-A: mint anchor_id + schema_version on anchor creation
 * (`goal0_phase2_mint_on_create_and_coverage_ui_plan.md`). Covers the
 * behaviors listed in the plan's WP-A test list.
 */

let tmpDir: string;
let repo: AnchorRepository;
let service: AnchorService;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-mint-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function anchorContent(overrides: { project?: string; anchorId?: string; schemaVersion?: string } = {}): string {
  return `---
project:
  - ${overrides.project ?? "demo"}
type: design
tags:
  - context
summary: "Demo anchor summary."
read_this_if:
  - "You are working on the demo project."
last_validated: 2026-07-10
${overrides.anchorId ? `anchor_id: ${overrides.anchorId}\n` : ""}${overrides.schemaVersion ? `schema_version: ${overrides.schemaVersion}\n` : ""}---

# Demo Anchor

## Current State

- The demo anchor exists.

## Decisions

- Keep storage git-backed.

## Constraints

- Preserve existing claims.

## PRs

- [PR Add anchor MCP - #123](https://github.com/example/repo/pull/123)
`;
}

describe("mint-on-create: anchor_id + schema_version", () => {
  it("mints a valid anchor_id and schema_version on create, and the committed file contains them", async () => {
    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: anchorContent(),
      message: "test: create demo anchor",
    });
    expect(result.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(result.version).toBeTruthy();

    const read = await service.readAnchor("projects/demo/demo");
    expect(typeof read.frontmatter.anchor_id).toBe("string");
    expect(isValidAnchorId(read.frontmatter.anchor_id as string)).toBe(true);
    expect(read.frontmatter.schema_version).toBe(1);

    // Byte-preservation: everything else the author wrote survives untouched.
    expect(read.frontmatter.summary).toBe("Demo anchor summary.");
    expect(read.content).toContain("## Current State");
    expect(read.content).toContain("- The demo anchor exists.");
  });

  it("keeps a caller-supplied valid anchor_id on create (migration/import case)", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: anchorContent({ anchorId: "a-abc123" }),
      message: "test: create with supplied id",
    });

    const read = await service.readAnchor("projects/demo/demo");
    expect(read.frontmatter.anchor_id).toBe("a-abc123");
    expect(read.frontmatter.schema_version).toBe(1);
  });

  it("keeps a caller-supplied schema_version on create instead of overwriting it", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: anchorContent({ schemaVersion: "2" }),
      message: "test: create with supplied schema_version",
    });

    const read = await service.readAnchor("projects/demo/demo");
    expect(String(read.frontmatter.schema_version)).toBe("2");
    expect(typeof read.frontmatter.anchor_id).toBe("string");
  });

  it("blocks a create whose supplied anchor_id duplicates an existing anchor's id (anchor_id_duplicate)", async () => {
    await service.writeAnchor({
      name: "projects/demo/one",
      content: anchorContent({ project: "demo", anchorId: "a-dup001" }),
      message: "test: create first anchor",
    });

    const second = await service.writeAnchor({
      name: "projects/demo/two",
      content: anchorContent({ project: "demo", anchorId: "a-dup001" }),
      message: "test: create duplicate-id anchor",
    });

    expect(second.version).toBeUndefined();
    expect(second.warnings.some((w) => w.severity === "BLOCK" && w.code === "anchor_id_duplicate")).toBe(true);

    // Not committed: reading it back must fail (no such anchor).
    await expect(service.readAnchor("projects/demo/two")).rejects.toBeTruthy();
  });

  it("never mints on update: an update write with no anchor_id in the committed file stays id-less", async () => {
    // Simulate a legacy anchor that predates WP-A by writing raw content
    // directly to disk (bypassing writeAnchor's mint injection), then
    // performing an update through writeAnchor.
    await repo.commitAnchor({
      name: "projects/demo/legacy",
      content: anchorContent(),
      message: "test: seed legacy anchor without going through writeAnchor mint path",
    });

    const before = await service.readAnchor("projects/demo/legacy");
    expect(before.frontmatter.anchor_id).toBeUndefined();

    const updated = before.content
      .replace("- The demo anchor exists.", "- The demo anchor was updated.")
      .replace("last_validated: 2026-07-10", "last_validated: 2026-07-11");
    const result = await service.writeAnchor({
      name: "projects/demo/legacy",
      content: updated,
      message: "test: update legacy anchor",
      approved: true,
    });
    expect(result.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(result.version).toBeTruthy();

    const after = await service.readAnchor("projects/demo/legacy");
    expect(after.frontmatter.anchor_id).toBeUndefined();
    expect(after.content).toContain("- The demo anchor was updated.");
  });

  it("blocks an update that changes an existing anchor_id (anchor_id_immutable)", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: anchorContent(),
      message: "test: create demo anchor",
    });
    const committed = await service.readAnchor("projects/demo/demo");
    const originalId = committed.frontmatter.anchor_id as string;
    expect(isValidAnchorId(originalId)).toBe(true);

    const tampered = committed.content.replace(`anchor_id: ${originalId}`, "anchor_id: a-zzzzzz");
    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: tampered,
      message: "test: attempt to change anchor_id",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.severity === "BLOCK" && w.code === "anchor_id_immutable")).toBe(true);

    const after = await service.readAnchor("projects/demo/demo");
    expect(after.frontmatter.anchor_id).toBe(originalId);
  });

  it("blocks an update that removes an existing anchor_id (anchor_id_immutable)", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: anchorContent(),
      message: "test: create demo anchor",
    });
    const committed = await service.readAnchor("projects/demo/demo");
    const originalId = committed.frontmatter.anchor_id as string;

    const withoutId = committed.content.replace(`anchor_id: ${originalId}\n`, "");
    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: withoutId,
      message: "test: attempt to remove anchor_id",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.severity === "BLOCK" && w.code === "anchor_id_immutable")).toBe(true);
  });

  it("allows an update that re-supplies the identical anchor_id", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: anchorContent(),
      message: "test: create demo anchor",
    });
    const committed = await service.readAnchor("projects/demo/demo");
    const originalId = committed.frontmatter.anchor_id as string;

    const updated = committed.content
      .replace("- The demo anchor exists.", "- The demo anchor exists and was reviewed.")
      .replace("last_validated: 2026-07-10", "last_validated: 2026-07-11");
    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: updated,
      message: "test: update with identical anchor_id",
      approved: true,
    });

    expect(result.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(result.version).toBeTruthy();
    const after = await service.readAnchor("projects/demo/demo");
    expect(after.frontmatter.anchor_id).toBe(originalId);
  });

  it("a MALFORMED anchor_id that slipped into the tree is not locked in: it can be corrected to a fresh valid id", async () => {
    // A malformed id can only exist on disk via a path that bypassed the
    // universal front-matter schema (e.g. a hand edit, or a write while
    // migrationWarnOnly softened the schema BLOCK to a WARN) — simulate that
    // with a direct repo commit.
    await repo.commitAnchor({
      name: "projects/demo/bad-id.md",
      content: anchorContent({ anchorId: "not-a-valid-id", schemaVersion: "1" }),
      message: "test: seed malformed anchor_id",
    });

    // Correcting the malformed id to a valid one must NOT trip
    // anchor_id_immutable — format-invalid values are treated as absent by
    // the integrity validator, so this is id ADOPTION, not mutation.
    const corrected = await service.writeAnchor({
      name: "projects/demo/bad-id.md",
      content: anchorContent({ anchorId: "a-fixed01", schemaVersion: "1" }),
      message: "test: correct malformed anchor_id",
    });
    expect(corrected.warnings.some((w) => w.code === "anchor_id_immutable")).toBe(false);
    expect(corrected.warnings.some((w) => w.severity === "BLOCK")).toBe(false);

    const read = await service.readAnchor("projects/demo/bad-id");
    expect(read.content).toContain("anchor_id: a-fixed01");

    // ...and the corrected valid id is then immutable like any other.
    const mutate = await service.writeAnchor({
      name: "projects/demo/bad-id.md",
      content: anchorContent({ anchorId: "a-other02", schemaVersion: "1" }),
      message: "test: attempt to change corrected id",
    });
    expect(mutate.warnings.some((w) => w.severity === "BLOCK" && w.code === "anchor_id_immutable")).toBe(true);
  });

  it("allows adding an anchor_id to a legacy (id-less) anchor and still duplicate-checks it", async () => {
    await repo.commitAnchor({
      name: "projects/demo/legacy",
      content: anchorContent(),
      message: "test: seed legacy anchor without an anchor_id",
    });
    await service.writeAnchor({
      name: "projects/demo/other",
      content: anchorContent({ project: "demo", anchorId: "a-taken01" }),
      message: "test: create another anchor with its own id",
    });

    const legacyBefore = await service.readAnchor("projects/demo/legacy");
    expect(legacyBefore.frontmatter.anchor_id).toBeUndefined();

    // Adding a fresh, non-colliding id succeeds.
    const addOk = await service.writeAnchor({
      name: "projects/demo/legacy",
      content: legacyBefore.content.replace("last_validated: 2026-07-10", "last_validated: 2026-07-10\nanchor_id: a-fresh01"),
      message: "test: add anchor_id to legacy anchor",
    });
    expect(addOk.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(addOk.version).toBeTruthy();
    const legacyAfter = await service.readAnchor("projects/demo/legacy");
    expect(legacyAfter.frontmatter.anchor_id).toBe("a-fresh01");

    // Adding an id that collides with another anchor's id blocks.
    await repo.commitAnchor({
      name: "projects/demo/legacy2",
      content: anchorContent(),
      message: "test: seed a second legacy anchor without an anchor_id",
    });
    const legacy2Before = await service.readAnchor("projects/demo/legacy2");
    const addDuplicate = await service.writeAnchor({
      name: "projects/demo/legacy2",
      content: legacy2Before.content.replace(
        "last_validated: 2026-07-10",
        "last_validated: 2026-07-10\nanchor_id: a-taken01",
      ),
      message: "test: attempt to add a duplicate anchor_id to legacy anchor",
    });
    expect(addDuplicate.version).toBeUndefined();
    expect(addDuplicate.warnings.some((w) => w.severity === "BLOCK" && w.code === "anchor_id_duplicate")).toBe(true);
  });

  it("preserves anchor_id across renameAnchor (identity travels with the moved file, not the path)", async () => {
    await service.writeAnchor({
      name: "projects/demo/original-name",
      content: anchorContent(),
      message: "test: create anchor to be renamed",
    });
    const before = await service.readAnchor("projects/demo/original-name");
    const originalId = before.frontmatter.anchor_id as string;
    expect(isValidAnchorId(originalId)).toBe(true);

    const renameResult = await service.renameAnchor({
      from: "projects/demo/original-name",
      to: "projects/demo/renamed",
      approved: true,
    });
    expect(renameResult.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(renameResult.version).toBeTruthy();

    const after = await service.readAnchor("projects/demo/renamed");
    expect(after.frontmatter.anchor_id).toBe(originalId);
  });

  it("generated documents (CONTEXT-ROOT.md) are never minted: writeAnchor rejects the write before mint logic runs", async () => {
    const result = await service.writeAnchor({
      name: "CONTEXT-ROOT.md",
      content: "# Context Root\n",
      message: "test: attempt to write generated doc",
    });
    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.severity === "BLOCK" && w.code === "generated_file_reserved")).toBe(true);
  });

  it("mints distinct anchor_ids for two rapid creates in the same session (no collisions)", async () => {
    const [first, second] = await Promise.all([
      service.writeAnchor({
        name: "projects/demo/rapid-one",
        content: anchorContent({ project: "demo" }),
        message: "test: rapid create one",
      }),
      service.writeAnchor({
        name: "projects/demo/rapid-two",
        content: anchorContent({ project: "demo" }),
        message: "test: rapid create two",
      }),
    ]);
    expect(first.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(second.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);

    const readOne = await service.readAnchor("projects/demo/rapid-one");
    const readTwo = await service.readAnchor("projects/demo/rapid-two");
    const idOne = readOne.frontmatter.anchor_id as string;
    const idTwo = readTwo.frontmatter.anchor_id as string;
    expect(isValidAnchorId(idOne)).toBe(true);
    expect(isValidAnchorId(idTwo)).toBe(true);
    expect(idOne).not.toBe(idTwo);
  });
});
