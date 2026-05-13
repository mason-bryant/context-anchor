import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { buildContextRoot } from "../src/contextRoot.js";
import { AnchorRepository } from "../src/git/repo.js";

let tmpDir: string;
let repo: AnchorRepository;
let service: AnchorService;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-milestone-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("Milestone steel thread", () => {
  it("writes roadmap with stable goal ids, milestone, and validates goal_ids", async () => {
    const roadmap = `---
project:
  - acme
type: project-roadmap
tags:
  - roadmap
summary: "Acme roadmap for milestone tests."
read_this_if:
  - "Testing milestones."
last_validated: 2026-05-12
---

# Acme roadmap

## Goals

### Goal G-001 -- First slice

#### Acceptance Criteria

#### Approved

- [x] AC-001: First. Evidence: test.

### Goal G-002 -- Second slice

#### Acceptance Criteria

#### Approved

- [x] AC-002: Second. Evidence: test.

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    const milestone = `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Acme milestone linking roadmap goals."
read_this_if:
  - "Testing milestone reads."
last_validated: 2026-05-12
theme: "Acme vertical slice"
steel_thread: "Prove taxonomy and relations."
status: active
relations:
  goal_ids:
    - G-001
    - G-002
---

# M1

## Current State

- Active milestone.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    const ctx = `---
project:
  - acme
type: context-anchor
tags:
  - context-anchor
summary: "Acme project context anchor."
read_this_if:
  - "You need acme context."
last_validated: 2026-05-12
---

# Acme

## Current State

- Project exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    const wr = await service.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: roadmap,
      message: "test: roadmap",
      approved: true,
    });
    expect(wr.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(wr.version).toMatch(/[a-f0-9]{40}/);

    const roadmapOnDisk = await repo.readRaw("projects/acme/acme-roadmap.md");
    expect(roadmapOnDisk).toBeDefined();

    await service.writeAnchor({
      name: "projects/acme/acme",
      content: ctx,
      message: "test: context",
      approved: true,
    });

    const mResult = await service.writeAnchor({
      name: "projects/acme/milestones/m1",
      content: milestone,
      message: "test: milestone",
      approved: true,
    });

    expect(mResult.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(mResult.version).toMatch(/[a-f0-9]{40}/);

    const listed = await service.listMilestones("acme");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.goalIds).toEqual(["G-001", "G-002"]);

    const bundle = await service.planContextBundle({
      task: "Work on G-001 slice for acme",
      project: "acme",
      budgetTokens: 8000,
    });
    expect(bundle.missingContext.some((line) => line.includes("Milestone"))).toBe(false);
    expect(bundle.included.map((a) => a.name)).toContain("projects/acme/milestones/m1.md");
    expect(bundle.included.map((a) => a.name)).toContain("projects/acme/acme-roadmap.md");

    const related = await service.getRelated("projects/acme/milestones/m1");
    expect(related.some((r) => r.name === "projects/acme/acme-roadmap.md")).toBe(true);

    const rm = await service.readMilestone("projects/acme/milestones/m1");
    expect(rm.goals.map((g) => g.id).sort()).toEqual(["G-001", "G-002"]);

    const anchors = await service.listAnchors({ project: "acme" });
    const root = buildContextRoot(anchors, { format: "markdown", generatedAt: "2026-05-12T00:00:00.000Z" });
    expect(root.markdown).toContain("#### Milestones");
    expect(root.markdown).toContain("projects/acme/milestones/m1.md");
  });
});
