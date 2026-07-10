import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findReferencingAnchorMetas } from "../src/relations/index.js";
import { AnchorRepository } from "../src/git/repo.js";
import type { AnchorMeta } from "../src/types.js";
import type { AnchorStore } from "../src/storage/store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-relations-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Reference copy of the PRE-WP3 `findReferencingAnchorMetas`: an O(N)
 * full-tree scan that reads every anchor's front-matter `relations` object
 * and checks every key's array for a literal (non-goal_ids-resolving) match.
 * Kept here, inlined, purely so the parity test below can assert the new
 * reverse-edge implementation returns byte-identical results.
 */
async function oldFullScanFindReferencingAnchorMetas(
  repo: AnchorStore,
  targetName: string,
  kind?: string,
): Promise<AnchorMeta[]> {
  const normalizedTarget = targetName.endsWith(".md") ? targetName : `${targetName}.md`;
  const metas = await repo.listAnchors();
  const out: AnchorMeta[] = [];

  for (const meta of metas) {
    const read = await repo.readAnchor(meta.name);
    const relRaw = read.frontmatter.relations;
    if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
      continue;
    }
    const rel = relRaw as Record<string, unknown>;
    const keys = kind ? [kind] : Object.keys(rel);
    let hit = false;
    outer: for (const k of keys) {
      const values = rel[k];
      if (!Array.isArray(values)) {
        continue;
      }
      for (const v of values) {
        if (typeof v !== "string") {
          continue;
        }
        const resolved = v.endsWith(".md") ? v : `${v}.md`;
        if (resolved === normalizedTarget) {
          hit = true;
          break outer;
        }
      }
    }
    if (hit) {
      out.push(meta);
    }
  }

  return out;
}

const TARGET = `---
type: context-anchor
tags: []
summary: Target anchor.
read_this_if:
  - Testing relations parity.
last_validated: 2026-07-07
---

# Target

## Current State

None.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

function referencingAnchor(depends: string[], supersedes: string[] = []): string {
  return `---
type: context-anchor
tags: []
summary: Referencing anchor.
read_this_if:
  - Testing relations parity.
last_validated: 2026-07-07
relations:
  depends_on:
${depends.map((d) => `    - ${d}`).join("\n")}
${supersedes.length > 0 ? `  supersedes:\n${supersedes.map((s) => `    - ${s}`).join("\n")}` : ""}
---

# Referencing

## Current State

None.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;
}

const MILESTONE_WITH_GOAL_IDS = `---
project:
  - demo
type: project-milestone
tags: [milestone]
summary: Milestone with goal_ids.
read_this_if:
  - Testing relations parity.
last_validated: 2026-07-07
milestone_id: M1
sequence: 1
theme: Demo theme
status: active
relations:
  goal_ids:
    - target
---

# Milestone

## Current State

Not started.
`;

describe("findReferencingAnchorMetas parity (old full-scan vs new reverse-edge)", () => {
  it("matches the old algorithm across several (targetName, kind) combinations, including the goal_ids literal-semantics case", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();

    await repo.commitAnchor({ name: "shared/target.md", content: TARGET });
    await repo.commitAnchor({ name: "shared/referrer-a.md", content: referencingAnchor(["shared/target"]) });
    await repo.commitAnchor({
      name: "shared/referrer-b.md",
      content: referencingAnchor(["shared/other"], ["shared/target"]),
    });
    await repo.commitAnchor({ name: "shared/unrelated.md", content: referencingAnchor(["shared/other"]) });
    // goal_ids on a project-milestone anchor: the OLD findReferencingAnchorMetas
    // treats this as a literal target list (no resolution to a sibling
    // roadmap anchor) — this anchor's relations.goal_ids literally names
    // "target", which normalizes to "target.md", NOT "shared/target.md", so
    // it must NOT match a query for "shared/target".
    await repo.commitAnchor({ name: "projects/demo/milestones/m1.md", content: MILESTONE_WITH_GOAL_IDS });

    const cases: Array<{ target: string; kind?: string }> = [
      { target: "shared/target" },
      { target: "shared/target.md" },
      { target: "shared/target", kind: "depends_on" },
      { target: "shared/target", kind: "supersedes" },
      { target: "shared/target", kind: "goal_ids" },
      { target: "target" },
      { target: "shared/other" },
      { target: "shared/nonexistent" },
    ];

    for (const { target, kind } of cases) {
      const expected = await oldFullScanFindReferencingAnchorMetas(repo, target, kind);
      const actual = await findReferencingAnchorMetas(repo, target, kind);

      const expectedNames = expected.map((meta) => meta.name).sort();
      const actualNames = actual.map((meta) => meta.name).sort();
      expect(actualNames, `mismatch for target=${target} kind=${kind ?? "(any)"}`).toEqual(expectedNames);
    }
  });

  it("finds the direct referrer(s) for a plain depends_on relation", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await repo.commitAnchor({ name: "shared/target.md", content: TARGET });
    await repo.commitAnchor({ name: "shared/referrer-a.md", content: referencingAnchor(["shared/target"]) });

    const result = await findReferencingAnchorMetas(repo, "shared/target");
    expect(result.map((meta) => meta.name)).toEqual(["shared/referrer-a.md"]);
  });

  it("returns nothing for a target no anchor references", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await repo.commitAnchor({ name: "shared/target.md", content: TARGET });

    const result = await findReferencingAnchorMetas(repo, "shared/target");
    expect(result).toEqual([]);
  });
});
