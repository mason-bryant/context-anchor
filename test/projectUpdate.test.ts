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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-project-update-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
  await seedProject();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("project update snapshots", () => {
  it("returns active milestones with resolved goals, tasks, progress, and backlog last", async () => {
    const snapshot = await service.projectUpdateSnapshot({ project: "acme", asOf: "2026-05-25" });

    expect(snapshot.project).toBe("acme");
    expect(snapshot.milestones.map((milestone) => milestone.displayId)).toEqual(["M1", "M2"]);
    expect(snapshot.milestones[0]?.goals[0]).toMatchObject({
      id: "G-001",
      title: "Goal G-001 -- Update snapshots",
      hasAcceptanceCriteria: true,
    });
    expect(snapshot.milestones[0]?.tasks.map((task) => task.id)).toEqual(["T-002", "T-001"]);
    expect(snapshot.progress.tasks).toMatchObject({ done: 1, active: 1, blocked: 0, todo: 2, total: 4 });
    expect(snapshot.backlog?.displayId).toBe("backlog");
    expect(snapshot.backlog?.tasks.map((task) => task.title)).toEqual(["Decide owner mapping"]);
  });

  it("renders markdown with backlog items at the end", async () => {
    const rendered = await service.renderProjectUpdate({
      project: "acme",
      format: "markdown",
      asOf: "2026-05-25",
    });

    expect(rendered.body).toContain("# Project Update: acme");
    expect(rendered.body).toContain("## In Progress Milestones");
    expect(rendered.body).toContain("Goals: G-001 Update snapshots");
    expect(rendered.body).not.toContain("G-001 Goal G-001");
    expect(rendered.body).toContain("## Backlog");
    expect(rendered.body.indexOf("## Backlog")).toBeGreaterThan(rendered.body.indexOf("## Starting Soon"));
    expect(rendered.body).toContain("Backlog grooming: in progress.");
    expect(rendered.body).toContain("T-010: Decide owner mapping");
  });

  it("renders cancelled milestones and start-only schedule confidence", async () => {
    const snapshot = await service.projectUpdateSnapshot({
      project: "acme",
      statuses: ["cancelled"],
      asOf: "2026-05-25",
    });
    expect(snapshot.milestones.map((milestone) => milestone.displayId)).toEqual(["M3"]);
    expect(snapshot.progress.milestones).toMatchObject({ cancelled: 1, total: 1 });

    const rendered = await service.renderProjectUpdate({
      project: "acme",
      format: "markdown",
      statuses: ["cancelled"],
      asOf: "2026-05-25",
    });
    expect(rendered.body).toContain("Milestones: 0 shipped, 0 active, 0 upcoming, 1 cancelled.");
    expect(rendered.body).toContain("## Cancelled Milestones");
    expect(rendered.body).toContain("Schedule: starts 2026-06-20; confidence estimated");
  });

  it("does not duplicate milestone status in Slack output", async () => {
    const rendered = await service.renderProjectUpdate({
      project: "acme",
      format: "slack",
      milestone: "M1",
      asOf: "2026-05-25",
    });

    expect(rendered.body).toContain("_M1 - Snapshot generation_ (active)");
    expect(rendered.body).not.toContain("Status: active");
  });

  it("supports milestone selectors and includeBacklog", async () => {
    const byDisplayId = await service.projectUpdateSnapshot({
      project: "acme",
      milestone: "M2",
      includeBacklog: false,
      asOf: "2026-05-25",
    });
    expect(byDisplayId.milestones.map((milestone) => milestone.displayId)).toEqual(["M2"]);
    expect(byDisplayId.backlog?.displayId).toBe("backlog");

    const backlogOnly = await service.projectUpdateSnapshot({
      project: "acme",
      milestone: "backlog",
      asOf: "2026-05-25",
    });
    expect(backlogOnly.milestones).toEqual([]);
    expect(backlogOnly.backlog?.displayId).toBe("backlog");
  });
});

async function seedProject(): Promise<void> {
  await service.writeAnchor({
    name: "projects/acme/acme.md",
    content: baseAnchor("context-anchor", "Acme Context", "Acme project context."),
    message: "test: add project context",
  });
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
  - "Testing project update snapshots."
last_validated: 2026-05-25
---

# Acme Roadmap

## Goals

### Goal G-001 -- Update snapshots

#### Acceptance Criteria

#### Approved

- [x] AC-001: Snapshot works. Evidence: test.

### Goal G-002 -- Update rendering

#### Acceptance Criteria

#### Approved

- [x] AC-002: Render works. Evidence: test.

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
  await service.writeAnchor({
    name: "projects/acme/milestones/m1.md",
    content: milestone({
      milestoneId: "M1",
      sequence: 1,
      status: "active",
      theme: "Snapshot generation",
      goalIds: ["G-001"],
      tasks: `
  - id: T-001
    title: "Build snapshot"
    status: active
    goal_ids:
      - G-001
    due: 2026-05-30
    date_confidence: committed
  - id: T-002
    title: "Write tests"
    status: done
    goal_ids:
      - G-001
    completed_on: 2026-05-24
`,
    }),
    message: "test: add m1",
  });
  await service.writeAnchor({
    name: "projects/acme/milestones/m2.md",
    content: milestone({
      milestoneId: "M2",
      sequence: 2,
      status: "proposed",
      theme: "Update rendering",
      goalIds: ["G-002"],
      tasks: `
  - id: T-003
    title: "Render Slack update"
    status: todo
    goal_ids:
      - G-002
    due: 2026-06-10
    date_confidence: estimated
`,
    }),
    message: "test: add m2",
  });
  await service.writeAnchor({
    name: "projects/acme/milestones/backlog.md",
    content: milestone({
      milestoneId: "backlog",
      status: "active",
      theme: "Backlog",
      goalIds: [],
      tasks: `
  - id: T-010
    title: "Decide owner mapping"
    status: todo
`,
    }),
    message: "test: add backlog",
  });
  await service.writeAnchor({
    name: "projects/acme/milestones/m3.md",
    content: milestone({
      milestoneId: "M3",
      sequence: 3,
      status: "cancelled",
      theme: "Retired reporting slice",
      goalIds: ["G-002"],
      schedule: `
schedule:
  start: 2026-06-20
  date_confidence: estimated
`,
      tasks: `
  - id: T-004
    title: "Retire duplicate renderer"
    status: cancelled
    goal_ids:
      - G-002
`,
    }),
    message: "test: add m3",
  });
}

function baseAnchor(type: string, title: string, summary: string): string {
  return `---
project:
  - acme
type: ${type}
tags:
  - test
summary: "${summary}"
read_this_if:
  - "Testing project updates."
last_validated: 2026-05-25
---

# ${title}

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;
}

function milestone(input: {
  milestoneId: "backlog" | `M${number}`;
  sequence?: number;
  status: "active" | "proposed" | "cancelled";
  theme: string;
  goalIds: string[];
  schedule?: string;
  tasks: string;
}): string {
  const sequence = input.sequence !== undefined ? `sequence: ${input.sequence}\n` : "";
  const schedule = input.schedule ?? "";
  const goalIds =
    input.goalIds.length > 0
      ? `  goal_ids:\n${input.goalIds.map((goalId) => `    - ${goalId}`).join("\n")}`
      : "  goal_ids: []";
  return `---
project:
  - acme
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Acme milestone ${input.milestoneId}."
read_this_if:
  - "Testing project update milestones."
last_validated: 2026-05-25
milestone_id: ${input.milestoneId}
${sequence}theme: "${input.theme}"
steel_thread: "${input.theme}"
status: ${input.status}
relations:
${goalIds}
${schedule}
tasks:
${input.tasks}---

# ${input.milestoneId}

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;
}
