import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";

let tmpDir: string;
let repo: AnchorRepository;
let service: AnchorService;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-milestone-update-fields-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("milestone update fields", () => {
  it("normalizes schedule and structured tasks for milestone metadata", async () => {
    await writeRoadmap();
    const result = await service.writeAnchor({
      name: "projects/acme/milestones/m1.md",
      content: milestoneContent({
        extraFrontmatter: `
schedule:
  start: 2026-06-01
  target: 2026-06-30
  date_confidence: internal_goal
tasks:
  - id: T-001
    title: "Implement update snapshot"
    status: active
    goal_ids:
      - G-001
    due: 2026-06-14
    date_confidence: estimated
    notes: "First reporting slice"
  - id: T-002
    title: "Ship renderer"
    status: done
    goal_ids:
      - G-001
    completed_on: 2026-06-10
`,
      }),
      message: "test: add milestone tasks",
    });

    expect(result.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const milestones = await service.listMilestones("acme");
    expect(milestones[0]?.schedule).toEqual({
      start: "2026-06-01",
      target: "2026-06-30",
      dateConfidence: "internal_goal",
    });
    expect(milestones[0]?.tasks).toEqual([
      {
        id: "T-001",
        title: "Implement update snapshot",
        status: "active",
        goalIds: ["G-001"],
        due: "2026-06-14",
        dateConfidence: "estimated",
        notes: "First reporting slice",
      },
      {
        id: "T-002",
        title: "Ship renderer",
        status: "done",
        goalIds: ["G-001"],
        completedOn: "2026-06-10",
      },
    ]);
  });

  it("blocks missing date confidence, duplicate ids, and outside-scope task goal refs", async () => {
    await writeRoadmap();
    const result = await service.writeAnchor({
      name: "projects/acme/milestones/m1.md",
      content: milestoneContent({
        extraFrontmatter: `
schedule:
  target: 2026-06-30
tasks:
  - id: T-001
    title: "First task"
    status: active
    due: 2026-06-14
    goal_ids:
      - G-999
  - id: T-001
    title: "Duplicate task"
    status: todo
`,
      }),
      message: "test: reject invalid task metadata",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("front_matter_typed_schema");
    expect(result.warnings.map((warning) => warning.message).join("\n")).toContain("schedule.date_confidence");
    expect(result.warnings.map((warning) => warning.message).join("\n")).toContain("task.date_confidence");
    expect(result.warnings.map((warning) => warning.message).join("\n")).toContain('duplicate task id "T-001"');
    expect(result.warnings.map((warning) => warning.message).join("\n")).toContain('task goal_id "G-999"');
  });

  it("allows a reserved backlog milestone with tasks and no sequence or goal ids", async () => {
    const result = await service.writeAnchor({
      name: "projects/acme/milestones/backlog.md",
      content: `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Acme backlog milestone."
read_this_if:
  - "Testing backlog task handling."
last_validated: 2026-05-25
milestone_id: backlog
theme: "Backlog"
steel_thread: "Tasks awaiting assignment to sequenced milestones."
status: active
relations:
  goal_ids: []
tasks:
  - id: T-001
    title: "Groom unassigned project update tasks"
    status: todo
---

# Backlog

## Current State

- Holds unassigned tasks.

## Decisions

- None.

## Constraints

- No sequence.

## PRs

None.
`,
      message: "test: add backlog milestone",
    });

    expect(result.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const milestones = await service.listMilestones("acme");
    expect(milestones[0]?.displayId).toBe("backlog");
    expect(milestones[0]?.sequence).toBeUndefined();
    expect(milestones[0]?.tasks?.[0]?.title).toBe("Groom unassigned project update tasks");
  });
});

async function writeRoadmap(): Promise<void> {
  await service.writeAnchor({
    name: "projects/acme/acme-roadmap.md",
    content: `---
project:
  - acme
type: project-roadmap
tags:
  - roadmap
summary: "Acme roadmap."
read_this_if:
  - "Testing project updates."
last_validated: 2026-05-25
---

# Acme Roadmap

## Goals

### Goal G-001 -- Update reporting

#### Acceptance Criteria

#### Approved

- [x] AC-001: Reporting works. Evidence: test.

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`,
    message: "test: add roadmap",
    approved: true,
  });
}

function milestoneContent(input: { extraFrontmatter?: string } = {}): string {
  return `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Acme milestone."
read_this_if:
  - "Testing milestone update metadata."
last_validated: 2026-05-25
milestone_id: M1
sequence: 1
theme: "Reporting slice"
steel_thread: "Produce project updates."
status: active
relations:
  goal_ids:
    - G-001
${input.extraFrontmatter ?? ""}---

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
}
