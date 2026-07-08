import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { listRoadmapGoalsWithStatus } from "../src/roadmap/analyzeRoadmap.js";

const ROADMAP = `---
project:
  - demo
type: project-roadmap
tags:
  - project-roadmap
summary: "Demo roadmap."
read_this_if:
  - "Testing."
last_validated: 2026-07-07
---

# Demo -- Roadmap

## Current State

- Testing.

## Goals

### Goal G-001 -- Oldest active goal

#### Requirements

- Something.

### Goal G-039 -- Newest active goal

#### Requirements

- Something else.

#### Acceptance Criteria

- Observable condition.

\`\`\`markdown
### Goal G-999 -- Fenced decoy
\`\`\`

## Completed

### G-015 -- Shipped-only goal

- Done long ago.

### G-039 -- Newest active goal, Phase A (2026-07-07)

- Phase A shipped.

## Cancelled

### G-002 -- Abandoned goal

- Not worth it.

## PRs

None.
`;

const MILESTONE = `---
project:
  - demo
type: project-milestone
tags:
  - milestone
summary: "Demo milestone."
read_this_if:
  - "Testing."
last_validated: 2026-07-07
schema_version: 1
milestone_id: M1
sequence: 1
theme: "Demo theme"
status: active
relations:
  goal_ids:
    - G-039
---

# Milestone -- Demo

## Current State

- Testing.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

describe("listRoadmapGoalsWithStatus", () => {
  it("derives status from the region and keeps per-region occurrences", () => {
    const rows = listRoadmapGoalsWithStatus(ROADMAP);

    expect(rows).toEqual([
      { id: "G-001", title: "Goal G-001 -- Oldest active goal", status: "active", hasAcceptanceCriteria: false },
      { id: "G-039", title: "Goal G-039 -- Newest active goal", status: "active", hasAcceptanceCriteria: true },
      { id: "G-015", title: "G-015 -- Shipped-only goal", status: "completed", hasAcceptanceCriteria: false },
      {
        id: "G-039",
        title: "G-039 -- Newest active goal, Phase A (2026-07-07)",
        status: "completed",
        hasAcceptanceCriteria: false,
      },
      { id: "G-002", title: "G-002 -- Abandoned goal", status: "cancelled", hasAcceptanceCriteria: false },
    ]);
  });

  it("ignores fenced headings", () => {
    const rows = listRoadmapGoalsWithStatus(ROADMAP);
    expect(rows.some((row) => row.id === "G-999")).toBe(false);
  });
});

describe("AnchorService.listRoadmapGoals", () => {
  let tmpDir: string;
  let repo: AnchorRepository;
  let service: AnchorService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-goals-"));
    repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
    await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP, message: "seed roadmap" });
    await repo.commitAnchor({ name: "projects/demo/milestones/demo.md", content: MILESTONE, message: "seed milestone" });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sorts by status groups with newest goal ids first by default", async () => {
    const result = await service.listRoadmapGoals({ project: "demo" });
    expect(result.goals.map((goal) => `${goal.status}:${goal.id}`)).toEqual([
      "active:G-039",
      "active:G-001",
      "completed:G-039",
      "completed:G-015",
      "cancelled:G-002",
    ]);
    expect(result.summary).toEqual({ total: 5, active: 2, completed: 2, cancelled: 1 });
  });

  it("supports id and recent sorts plus status filtering", async () => {
    const byId = await service.listRoadmapGoals({ project: "demo", sort: "id" });
    expect(byId.goals.map((goal) => goal.id)).toEqual(["G-001", "G-002", "G-015", "G-039", "G-039"]);

    const recent = await service.listRoadmapGoals({ project: "demo", sort: "recent" });
    expect(recent.goals[0]?.id).toBe("G-039");
    expect(recent.goals[recent.goals.length - 1]?.id).toBe("G-001");

    const active = await service.listRoadmapGoals({ project: "demo", status: "active" });
    expect(active.goals.map((goal) => goal.id)).toEqual(["G-039", "G-001"]);
    // Summary always reflects the full roadmap, not the filtered list.
    expect(active.summary.total).toBe(5);
  });

  it("cross-links goals to the milestones that reference them", async () => {
    const result = await service.listRoadmapGoals({ project: "demo" });
    const activeNewest = result.goals[0];
    expect(activeNewest?.id).toBe("G-039");
    expect(activeNewest?.milestones).toEqual([
      { name: "projects/demo/milestones/demo.md", displayId: "M1", status: "active" },
    ]);
    expect(result.goals.find((goal) => goal.id === "G-001")?.milestones).toEqual([]);
  });

  it("returns an empty listing with a note when the roadmap is missing", async () => {
    const result = await service.listRoadmapGoals({ project: "nope" });
    expect(result.goals).toEqual([]);
    expect(result.note).toContain("Roadmap not found");
  });
});
