import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { collectMilestoneAcceptanceMissingSignals } from "../src/contextPlanner.js";
import { buildContextRoot } from "../src/contextRoot.js";
import { AnchorRepository } from "../src/git/repo.js";
import type { AnchorMeta } from "../src/types.js";

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
milestone_id: M1
sequence: 1
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
    expect(listed[0]?.displayId).toBe("M1");
    expect(listed[0]?.milestoneId).toBe("M1");
    expect(listed[0]?.sequence).toBe(1);

    const bundle = await service.planContextBundle({
      task: "Work on G-001 slice for acme",
      project: "acme",
      budgetTokens: 8000,
    });
    expect(bundle.missingContext.some((line) => line.includes("Milestone"))).toBe(false);
    expect(bundle.included.map((a) => a.name)).toContain("projects/acme/milestones/m1.md");
    expect(bundle.included.map((a) => a.name)).toContain("projects/acme/acme-roadmap.md");
    const milestoneItem = bundle.included.find((a) => a.name === "projects/acme/milestones/m1.md");
    const roadmapItem = bundle.included.find((a) => a.name === "projects/acme/acme-roadmap.md");
    expect(milestoneItem?.reason).toContain("task matched a milestone goal id");
    expect(roadmapItem?.reason).toContain("task matched goal id linked from an active milestone");

    const related = await service.getRelated("projects/acme/milestones/m1");
    expect(related.some((r) => r.name === "projects/acme/acme-roadmap.md")).toBe(true);

    const rm = await service.readMilestone("projects/acme/milestones/m1");
    expect(rm.goals.map((g) => g.id).sort()).toEqual(["G-001", "G-002"]);

    const anchors = await service.listAnchors({ project: "acme" });
    const root = buildContextRoot(anchors, { format: "markdown", generatedAt: "2026-05-12T00:00:00.000Z" });
    expect(root.markdown).toContain("#### Milestones");
    expect(root.markdown).toContain("projects/acme/milestones/m1.md");
  });

  it("blocks milestone goal references when the sibling roadmap has duplicate goal ids", async () => {
    const duplicateRoadmap = `---
project:
  - acme
type: project-roadmap
tags:
  - roadmap
summary: "Acme roadmap with duplicate goal ids."
read_this_if:
  - "Testing duplicate ids."
last_validated: 2026-05-12
---

# Acme roadmap

## Goals

### Goal G-001 -- First

#### Acceptance Criteria

#### Approved

- [x] AC-001: First. Evidence: test.

### Goal G-001 -- Duplicate

#### Acceptance Criteria

#### Approved

- [x] AC-002: Duplicate. Evidence: test.

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    await service.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: duplicateRoadmap,
      message: "test: duplicate roadmap",
      approved: true,
    });

    const milestone = `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Acme milestone linking duplicate roadmap goals."
read_this_if:
  - "Testing milestone duplicate validation."
last_validated: 2026-05-12
theme: "Acme duplicate check"
status: active
relations:
  goal_ids:
    - G-001
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

    const result = await service.writeAnchor({
      name: "projects/acme/milestones/m1",
      content: milestone,
      message: "test: duplicate milestone",
      approved: true,
    });

    expect(result.warnings.some((w) => w.severity === "BLOCK" && w.code === "roadmap_goal_duplicate_id")).toBe(true);
  });

  it("enforces roadmap stable ids when a milestone exists by path even if project front matter mismatches", async () => {
    const warnOnlyService = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: true });
    const strictService = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false });

    const stableRoadmap = `---
project:
  - acme
type: project-roadmap
tags:
  - roadmap
summary: "Acme roadmap with stable goal ids."
read_this_if:
  - "Testing milestone path detection."
last_validated: 2026-05-12
---

# Acme roadmap

## Goals

### Goal G-001 -- First

#### Acceptance Criteria

#### Approved

- [x] AC-001: First. Evidence: test.

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    const mismatchedMilestone = `---
project:
  - wrong
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Milestone with mismatched project front matter."
read_this_if:
  - "Testing path based milestone detection."
last_validated: 2026-05-12
theme: "Path based detection"
status: active
relations:
  goal_ids:
    - G-001
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

    await warnOnlyService.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: stableRoadmap,
      message: "test: stable roadmap",
      approved: true,
    });
    const milestoneResult = await warnOnlyService.writeAnchor({
      name: "projects/acme/milestones/m1",
      content: mismatchedMilestone,
      message: "test: mismatched milestone",
      approved: true,
    });
    expect(milestoneResult.warnings.some((w) => w.code === "project_slug_mismatch")).toBe(true);

    const bareRoadmap = stableRoadmap.replace("### Goal G-001 -- First", "### Goal 1 -- First");
    const result = await strictService.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: bareRoadmap,
      message: "test: bare roadmap",
      approved: true,
    });

    expect(
      result.warnings.some((w) => w.severity === "BLOCK" && w.code === "roadmap_goal_stable_id_required"),
    ).toBe(true);
  });

  it("rejects readMilestone for anchors outside the milestones directory", async () => {
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

    await service.writeAnchor({
      name: "projects/acme/acme",
      content: ctx,
      message: "test: context",
      approved: true,
    });

    await expect(service.readMilestone("projects/acme/acme")).rejects.toThrow(
      "readMilestone requires a project milestone anchor",
    );
  });

  it("rejects readMilestone for milestones with the wrong type", async () => {
    const wrongTypeMilestone = `---
project:
  - acme
type: context-anchor
tags:
  - milestone
summary: "Wrongly typed milestone anchor."
read_this_if:
  - "Testing readMilestone type validation."
last_validated: 2026-05-12
---

# M1

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    await service.writeAnchor({
      name: "projects/acme/milestones/m1",
      content: wrongTypeMilestone,
      message: "test: wrong type milestone",
      approved: true,
    });

    await expect(service.readMilestone("projects/acme/milestones/m1")).rejects.toThrow(
      "readMilestone requires type: project-milestone",
    );
  });
});

describe("collectMilestoneAcceptanceMissingSignals", () => {
  it("reports referenced missing acceptance criteria with a pre-indexed roadmap lookup", () => {
    const anchors: AnchorMeta[] = [
      {
        name: "projects/acme/acme-roadmap.md",
        path: "projects/acme/acme-roadmap.md",
        category: "projects",
        projectSlug: "acme",
        project: ["acme"],
        type: "project-roadmap",
        tags: [],
        summary: "Roadmap.",
        read_this_if: ["Planning acme."],
        last_validated: "2026-05-12",
        updatedAt: "2026-05-12T00:00:00.000Z",
        origin: "repo",
        acceptanceCriteria: {
          activeGoals: 2,
          goalsWithCriteria: 1,
          goalsMissingCriteria: ["Goal G-002 -- Missing AC"],
          goalsMissingCriteriaIds: ["G-002"],
          hasProposedCriteria: false,
        },
      },
      {
        name: "projects/acme/milestones/m1.md",
        path: "projects/acme/milestones/m1.md",
        category: "projects",
        projectSlug: "acme",
        project: ["acme"],
        type: "project-milestone",
        tags: [],
        summary: "Milestone.",
        read_this_if: ["Planning milestone."],
        last_validated: "2026-05-12",
        updatedAt: "2026-05-12T00:00:00.000Z",
        origin: "repo",
        milestone: {
          status: "active",
          theme: "Missing AC",
          goalIds: ["G-001", "G-002"],
        },
      },
    ];

    expect(collectMilestoneAcceptanceMissingSignals(anchors)).toEqual([
      'Milestone "projects/acme/milestones/m1.md" has goal(s) without acceptance criteria: G-002.',
    ]);
  });
});

describe("milestone ordering and id uniqueness", () => {
  const roadmapThreeGoals = `---
project:
  - acme
type: project-roadmap
tags:
  - roadmap
summary: "Acme roadmap for ordering tests."
read_this_if:
  - "Testing milestone ordering."
last_validated: 2026-05-12
---

# Acme roadmap

## Goals

### Goal G-001 -- First

#### Acceptance Criteria

#### Approved

- [x] AC-001: First. Evidence: test.

### Goal G-002 -- Second

#### Acceptance Criteria

#### Approved

- [x] AC-002: Second. Evidence: test.

### Goal G-003 -- Third

#### Acceptance Criteria

#### Approved

- [x] AC-003: Third. Evidence: test.

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

  it("listMilestones sorts by sequence with backlog last", async () => {
    await service.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: roadmapThreeGoals,
      message: "test: roadmap three goals",
      approved: true,
    });

    const mBacklog = `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Backlog bucket."
read_this_if:
  - "Testing backlog."
last_validated: 2026-05-12
milestone_id: backlog
theme: "Backlog"
status: proposed
relations:
  goal_ids:
    - G-003
---

# Backlog

## Current State

- Holding.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    const m2 = `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Second milestone."
read_this_if:
  - "Testing order."
last_validated: 2026-05-12
milestone_id: M2
sequence: 2
theme: "Second"
status: proposed
relations:
  goal_ids:
    - G-002
---

# M2

## Current State

- Second.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    const m1 = `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "First milestone."
read_this_if:
  - "Testing order."
last_validated: 2026-05-12
milestone_id: M1
sequence: 1
theme: "First"
status: proposed
relations:
  goal_ids:
    - G-001
---

# M1

## Current State

- First.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    await service.writeAnchor({ name: "projects/acme/milestones/backlog", content: mBacklog, message: "b", approved: true });
    await service.writeAnchor({ name: "projects/acme/milestones/m-2", content: m2, message: "m2", approved: true });
    await service.writeAnchor({ name: "projects/acme/milestones/m-1", content: m1, message: "m1", approved: true });

    const listed = await service.listMilestones("acme");
    expect(listed.map((r) => r.name)).toEqual([
      "projects/acme/milestones/m-1.md",
      "projects/acme/milestones/m-2.md",
      "projects/acme/milestones/backlog.md",
    ]);
    expect(listed[0]?.displayId).toBe("M1");
    expect(listed[1]?.displayId).toBe("M2");
    expect(listed[2]?.displayId).toBe("backlog");
  });

  it("blocks duplicate milestone_id in the same project", async () => {
    await service.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: roadmapThreeGoals,
      message: "test: roadmap",
      approved: true,
    });

    const body = (slug: string, goal: string) => `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Milestone ${slug}."
read_this_if:
  - "Testing."
last_validated: 2026-05-12
milestone_id: M1
sequence: 1
theme: "Theme ${slug}"
status: proposed
relations:
  goal_ids:
    - ${goal}
---

# ${slug}

## Current State

- X.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    await service.writeAnchor({
      name: "projects/acme/milestones/a",
      content: body("a", "G-001"),
      message: "a",
      approved: true,
    });

    const dup = await service.writeAnchor({
      name: "projects/acme/milestones/b",
      content: body("b", "G-002").replace("sequence: 1", "sequence: 2"),
      message: "b",
      approved: true,
    });
    expect(dup.warnings.some((w) => w.severity === "BLOCK" && w.code === "milestone_duplicate_id")).toBe(true);
  });

  it("blocks duplicate sequence in the same project", async () => {
    await service.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: roadmapThreeGoals,
      message: "test: roadmap",
      approved: true,
    });

    const body = (file: string, mid: string, goal: string) => `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Milestone ${file}."
read_this_if:
  - "Testing."
last_validated: 2026-05-12
milestone_id: ${mid}
sequence: 1
theme: "Theme ${file}"
status: proposed
relations:
  goal_ids:
    - ${goal}
---

# ${file}

## Current State

- X.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    await service.writeAnchor({
      name: "projects/acme/milestones/a",
      content: body("a", "M1", "G-001"),
      message: "a",
      approved: true,
    });

    const dupSeq = await service.writeAnchor({
      name: "projects/acme/milestones/b",
      content: body("b", "M2", "G-002"),
      message: "b",
      approved: true,
    });
    expect(dupSeq.warnings.some((w) => w.severity === "BLOCK" && w.code === "milestone_duplicate_sequence")).toBe(
      true,
    );
  });

  it("blocks second backlog milestone_id in the same project", async () => {
    await service.writeAnchor({
      name: "projects/acme/acme-roadmap",
      content: roadmapThreeGoals,
      message: "test: roadmap",
      approved: true,
    });

    const backlogBody = (goal: string) => `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Backlog."
read_this_if:
  - "Testing."
last_validated: 2026-05-12
milestone_id: backlog
theme: "Backlog theme"
status: proposed
relations:
  goal_ids:
    - ${goal}
---

# B

## Current State

- X.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

    await service.writeAnchor({
      name: "projects/acme/milestones/b1",
      content: backlogBody("G-001"),
      message: "b1",
      approved: true,
    });

    const second = await service.writeAnchor({
      name: "projects/acme/milestones/b2",
      content: backlogBody("G-002"),
      message: "b2",
      approved: true,
    });
    expect(second.warnings.some((w) => w.severity === "BLOCK" && w.code === "milestone_duplicate_id")).toBe(true);
  });
});

describe("migrateRoadmapGoalIds", () => {
  const bareRoadmap = `---
project:
  - acme
type: project-roadmap
tags:
  - roadmap
summary: "Acme roadmap."
read_this_if:
  - "Testing migration."
last_validated: 2026-05-12
---

# Acme Roadmap

## Goals

### Goal 1 -- Alpha feature

#### Acceptance Criteria

#### Approved

- [x] AC-001: Alpha ships. Evidence: test.

### Goal 2 -- Beta feature

#### Acceptance Criteria

#### Approved

- [x] AC-002: Beta ships. Evidence: test.

### Goal 3

#### Acceptance Criteria

#### Approved

- [x] AC-003: Goal three ships. Evidence: test.

## Current State

- Active.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;

  it("assigns G-### ids to bare goals and returns assignments", async () => {
    const wr = await service.writeAnchor({
      name: "projects/acme/acme-roadmap.md",
      content: bareRoadmap,
      approved: true,
    });
    expect(wr.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);

    const result = await service.migrateRoadmapGoalIds({ project: "acme" });

    expect(result.noChangesNeeded).toBe(false);
    expect(result.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(result.version).toMatch(/[a-f0-9]{40}/);

    expect(result.assigned).toHaveLength(3);
    expect(result.assigned[0]).toEqual({
      from: "### Goal 1 -- Alpha feature",
      to: "### Goal G-001 -- Alpha feature",
    });
    expect(result.assigned[1]).toEqual({
      from: "### Goal 2 -- Beta feature",
      to: "### Goal G-002 -- Beta feature",
    });
    expect(result.assigned[2]).toEqual({
      from: "### Goal 3",
      to: "### Goal G-003",
    });

    // Verify the roadmap on disk has the new headings
    const updated = await service.readAnchor("projects/acme/acme-roadmap.md");
    expect(updated.content).toContain("### Goal G-001 -- Alpha feature");
    expect(updated.content).toContain("### Goal G-002 -- Beta feature");
    expect(updated.content).toContain("### Goal G-003");
    expect(updated.content).not.toContain("### Goal 1 --");
  });

  it("reports noChangesNeeded when all goals already have stable ids", async () => {
    const alreadyMigrated = bareRoadmap
      .replace("### Goal 1 -- Alpha feature", "### Goal G-001 -- Alpha feature")
      .replace("### Goal 2 -- Beta feature", "### Goal G-002 -- Beta feature")
      .replace("### Goal 3", "### Goal G-003");

    await service.writeAnchor({
      name: "projects/acme/acme-roadmap.md",
      content: alreadyMigrated,
      approved: true,
    });

    const result = await service.migrateRoadmapGoalIds({ project: "acme" });
    expect(result.noChangesNeeded).toBe(true);
    expect(result.assigned).toHaveLength(0);
  });

  it("continues numbering from the highest existing G-### id", async () => {
    const partialRoadmap = bareRoadmap.replace(
      "### Goal 1 -- Alpha feature",
      "### Goal G-005 -- Alpha feature",
    );

    await service.writeAnchor({
      name: "projects/acme/acme-roadmap.md",
      content: partialRoadmap,
      approved: true,
    });

    const result = await service.migrateRoadmapGoalIds({ project: "acme" });
    expect(result.noChangesNeeded).toBe(false);
    expect(result.assigned[0]!.to).toBe("### Goal G-006 -- Beta feature");
    expect(result.assigned[1]!.to).toBe("### Goal G-007");
  });

  it("respects an explicit startFrom override", async () => {
    await service.writeAnchor({
      name: "projects/acme/acme-roadmap.md",
      content: bareRoadmap,
      approved: true,
    });

    const result = await service.migrateRoadmapGoalIds({ project: "acme", startFrom: 42 });
    expect(result.assigned[0]!.to).toBe("### Goal G-042 -- Alpha feature");
    expect(result.assigned[1]!.to).toBe("### Goal G-043 -- Beta feature");
  });

  it("returns BLOCK when the roadmap does not exist", async () => {
    const result = await service.migrateRoadmapGoalIds({ project: "nonexistent" });
    expect(result.warnings.some((w) => w.severity === "BLOCK" && w.code === "missing_anchor")).toBe(true);
  });
});
