import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { buildPeopleIndex } from "../src/peopleRegistry.js";
import {
  DEFAULT_GRAPH_SCORING_MAX_BOOST,
  GRAPH_SCORING_MAX_BOOST_CEILING,
  clampGraphScoringMaxBoost,
  computeGraphProximityBoosts,
  resolveTaskSignalNodes,
} from "../src/graph/proximity.js";
import type { PlanContextBundleResult } from "../src/types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-planner-proximity-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures — a small tree with a project context anchor, an active milestone
// (which reaches project:demo via its own anchor_project edge), and a roadmap
// so the goal-id signal has something to resolve to.
// ---------------------------------------------------------------------------

const PROJECT_CONTEXT = `---
project:
  - demo
type: context-anchor
tags: []
summary: Demo project context.
read_this_if:
  - Testing planner graph proximity.
last_validated: 2026-07-07
---

# Demo Project

## Current State

- Demo state.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

const MILESTONE = `---
project:
  - demo
type: project-milestone
tags: [milestone]
summary: Demo milestone about widgets.
read_this_if:
  - Testing planner graph proximity.
last_validated: 2026-07-07
milestone_id: M1
sequence: 1
theme: Demo milestone theme
status: active
relations:
  goal_ids:
    - G-001
tasks:
  - id: T-1
    title: Do the thing
    status: todo
    owner: alice
---

# Demo Milestone

## Current State

Not started.
`;

const ROADMAP = `---
project:
  - demo
type: project-roadmap
tags: []
summary: Demo roadmap.
read_this_if:
  - Testing planner graph proximity.
last_validated: 2026-07-07
---

# Demo Roadmap

## Goals

### Goal G-001 -- Ship the thing

Some description.

#### Acceptance Criteria

- [ ] AC-1 Something happens.
`;

// An unrelated project + anchor with NO edges to demo, to prove the graph
// signal is targeted (this anchor never gets a proximity boost).
const OTHER_CONTEXT = `---
project:
  - other
type: context-anchor
tags: []
summary: Unrelated project context.
read_this_if:
  - Nothing to do with demo.
last_validated: 2026-07-07
---

# Other Project

## Current State

- Other state.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

async function seedRepo(repo: AnchorRepository): Promise<void> {
  await repo.writePeopleRegistryRaw({
    people: [{ id: "alice", displayName: "Alice", projects: [{ project: "demo", role: "responsible" }] }],
    teams: [],
  });
  await repo.writeProjectMappingsRaw({
    projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: ["src"] }] }],
  });
  await repo.commitAnchor({ name: "projects/demo/demo-project-context.md", content: PROJECT_CONTEXT });
  await repo.commitAnchor({ name: "projects/demo/milestones/m1.md", content: MILESTONE });
  await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });
  await repo.commitAnchor({ name: "projects/other/other-project-context.md", content: OTHER_CONTEXT });
}

function makeService(repo: AnchorRepository, graphScoring?: { enabled: boolean; maxBoost: number }): AnchorService {
  return new AnchorService(repo, {
    pushOnWrite: false,
    migrationWarnOnly: false,
    staleAfterDays: 45,
    ...(graphScoring ? { graphScoring } : {}),
  });
}

/**
 * Strip the volatile `generatedAt` timestamp so two plans of the same task
 * can be compared byte-for-byte on their deterministic content.
 */
function stablePlanJson(plan: PlanContextBundleResult): string {
  const { generatedAt: _generatedAt, ...rest } = plan;
  return JSON.stringify(rest);
}

// A task that mentions a repo/file path (-> project demo), a goal id, and a
// person, so all three task-signal kinds fire at once.
const TASK_INPUT = {
  task: "Work on G-001 widgets with alice",
  repo: "repo-a",
  filePaths: ["src/widgets.ts"],
} as const;

describe("planner graph proximity — flag OFF is byte-identical", () => {
  it("produces a plan byte-identical to a no-graphScoring service (default off)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    // Baseline: a service constructed exactly as pre-WP7 callers do (no
    // graphScoring option at all — the field is optional and defaults off).
    const baselineService = makeService(repo);
    const baselinePlan = await baselineService.planContextBundle({ ...TASK_INPUT });

    // Explicitly-disabled: graphScoring present but enabled:false.
    const disabledService = makeService(repo, { enabled: false, maxBoost: 8 });
    const disabledPlan = await disabledService.planContextBundle({ ...TASK_INPUT });

    expect(stablePlanJson(disabledPlan)).toBe(stablePlanJson(baselinePlan));

    // And neither plan carries any graph-proximity reason string.
    for (const anchor of [...baselinePlan.included, ...baselinePlan.excluded]) {
      expect(anchor.reason).not.toContain("graph:");
    }
    for (const anchor of [...disabledPlan.included, ...disabledPlan.excluded]) {
      expect(anchor.reason).not.toContain("graph:");
    }
  });
});

describe("planner graph proximity — flag ON is bounded, inspectable, deterministic", () => {
  it("boosts nearby anchors with a full hop-chain reason, bounded by maxBoost", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const maxBoost = 8;
    const service = makeService(repo, { enabled: true, maxBoost });

    const plan = await service.planContextBundle({ ...TASK_INPUT });

    const all = [...plan.included, ...plan.excluded];
    const boosted = all.filter((anchor) => anchor.reason.includes("graph:"));

    // At least the demo anchors (reachable within <=2 hops of project:demo /
    // goal:G-001 / person:alice) were boosted.
    expect(boosted.length).toBeGreaterThan(0);

    for (const anchor of boosted) {
      // Every graph boost is fully explained by a hop chain a reviewer can
      // read: it starts with `graph:`, shows `-> <node> (<edge-type>)`
      // segments, and ends with the `(+N)` points awarded.
      const graphSegment = anchor.reason.split("; ").find((segment) => segment.startsWith("graph:"));
      expect(graphSegment).toBeDefined();
      expect(graphSegment).toMatch(/^graph: .+ -> .+ \(\+\d+\)$/);
      const awarded = Number(/\(\+(\d+)\)$/.exec(graphSegment!)?.[1]);
      expect(awarded).toBeGreaterThanOrEqual(1);
      expect(awarded).toBeLessThanOrEqual(maxBoost);
    }

    // The unrelated anchor (no edges to demo) is never graph-boosted.
    const other = all.find((anchor) => anchor.name === "projects/other/other-project-context.md");
    expect(other?.reason.includes("graph:")).toBe(false);
  });

  it("is deterministic: the same task yields the same plan twice", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo, { enabled: true, maxBoost: 8 });

    const first = await service.planContextBundle({ ...TASK_INPUT });
    const second = await service.planContextBundle({ ...TASK_INPUT });

    expect(stablePlanJson(second)).toBe(stablePlanJson(first));
  });

  it("respects a smaller maxBoost bound", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const maxBoost = 3;
    const service = makeService(repo, { enabled: true, maxBoost });

    const plan = await service.planContextBundle({ ...TASK_INPUT });
    const boosted = [...plan.included, ...plan.excluded].filter((anchor) => anchor.reason.includes("graph:"));

    for (const anchor of boosted) {
      const graphSegment = anchor.reason.split("; ").find((segment) => segment.startsWith("graph:"))!;
      const awarded = Number(/\(\+(\d+)\)$/.exec(graphSegment)?.[1]);
      expect(awarded).toBeLessThanOrEqual(maxBoost);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the pure proximity module (no service / git needed).
// ---------------------------------------------------------------------------

describe("clampGraphScoringMaxBoost", () => {
  it("defaults when undefined and clamps into [1, ceiling]", () => {
    expect(clampGraphScoringMaxBoost(undefined)).toBe(DEFAULT_GRAPH_SCORING_MAX_BOOST);
    expect(clampGraphScoringMaxBoost(0)).toBe(1);
    expect(clampGraphScoringMaxBoost(-5)).toBe(1);
    expect(clampGraphScoringMaxBoost(1000)).toBe(GRAPH_SCORING_MAX_BOOST_CEILING);
    expect(clampGraphScoringMaxBoost(6)).toBe(6);
  });
});

describe("resolveTaskSignalNodes", () => {
  const peopleIndex = buildPeopleIndex({
    people: [{ id: "alice", displayName: "Alice", projects: [] }],
    teams: [{ id: "widgets-team", displayName: "Widgets Team", synonyms: ["widgeteers"] }],
  });

  it("resolves candidate projects, G-### mentions, and person mentions to graph nodes", () => {
    const signals = resolveTaskSignalNodes(
      {
        task: "Fix G-001 widgets with alice",
        projectResolution: {
          candidates: [{ project: "demo", boost: 8, reasons: ["repo match"] }],
          explanations: [],
        },
      },
      peopleIndex,
    );

    const nodeIds = signals.map((signal) => signal.nodeId);
    expect(nodeIds).toContain("project:demo");
    expect(nodeIds).toContain("goal:G-001");
    expect(nodeIds).toContain("person:alice");

    // Labels are human-readable so the reason string's first segment is legible.
    const goalSignal = signals.find((signal) => signal.nodeId === "goal:G-001");
    expect(goalSignal?.label).toBe("G-001");
    const personSignal = signals.find((signal) => signal.nodeId === "person:alice");
    expect(personSignal?.label).toBe("person Alice");
  });

  it("resolves an explicit project filter and a team mention", () => {
    const signals = resolveTaskSignalNodes({ task: "ask the widgeteers", project: "demo" }, peopleIndex);
    const nodeIds = signals.map((signal) => signal.nodeId);
    expect(nodeIds).toContain("project:demo");
    expect(nodeIds).toContain("team:widgets-team");
  });

  it("returns no signals for a task with no resolvable references", () => {
    const signals = resolveTaskSignalNodes({ task: "just do something generic" }, peopleIndex);
    expect(signals).toEqual([]);
  });
});

describe("computeGraphProximityBoosts (against a minimal stub graph)", () => {
  // A tiny stand-in exposing just the two adjacency methods the walk uses, so
  // the boost/hop-chain math can be tested without a git repo. Edges:
  //   anchor:milestone.md -> project:demo   (anchor_project)
  //   milestone:milestone.md -> anchor:milestone.md (milestone_anchor)
  // so from project:demo, hop 1 reaches anchor:milestone.md (reverse
  // anchor_project) and hop 2 reaches milestone:milestone.md.
  const edges = [
    { from: "anchor:milestone.md", to: "project:demo", type: "anchor_project" as const, sourceOfTruth: "front-matter" as const },
    { from: "milestone:milestone.md", to: "anchor:milestone.md", type: "milestone_anchor" as const, sourceOfTruth: "containment" as const },
  ];
  const stubGraph = {
    edgesFrom: async (nodeId: string) => edges.filter((edge) => edge.from === nodeId),
    edgesTo: async (nodeId: string) => edges.filter((edge) => edge.to === nodeId),
  };

  it("returns an empty map when there are no signals", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boosts = await computeGraphProximityBoosts(stubGraph as any, [], 8);
    expect(boosts.size).toBe(0);
  });

  it("boosts an anchor reached within 2 hops and reports the hop chain", async () => {
    const boosts = await computeGraphProximityBoosts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stubGraph as any,
      [{ nodeId: "project:demo", label: "file path -> project demo" }],
      8,
    );

    const hit = boosts.get("milestone.md");
    expect(hit).toBeDefined();
    // Hop 1 from project:demo lands directly on the milestone anchor node.
    expect(hit!.boost).toBe(8);
    expect(hit!.reason).toBe("graph: file path -> project demo -> anchor milestone.md (anchor_project) (+8)");
  });

  it("never exceeds maxBoost at any hop distance", async () => {
    const boosts = await computeGraphProximityBoosts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stubGraph as any,
      [{ nodeId: "milestone:milestone.md", label: "milestone milestone.md" }],
      4,
    );
    for (const boost of boosts.values()) {
      expect(boost.boost).toBeGreaterThanOrEqual(1);
      expect(boost.boost).toBeLessThanOrEqual(4);
    }
  });

  it("clamps maxBoost to the hard ceiling for direct callers (not just the CLI)", async () => {
    const boosts = await computeGraphProximityBoosts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stubGraph as any,
      [{ nodeId: "project:demo", label: "file path -> project demo" }],
      100, // far above GRAPH_SCORING_MAX_BOOST_CEILING (15)
    );
    for (const boost of boosts.values()) {
      expect(boost.boost).toBeLessThanOrEqual(15);
    }
  });

  it("keeps the strongest boost when a later signal reaches an anchor in fewer hops", async () => {
    // target.md is 1 hop from project:p but 2 hops from person:alice.
    const keepMaxEdges = [
      { from: "anchor:target.md", to: "project:p", type: "anchor_project", sourceOfTruth: "front-matter" },
      { from: "person:alice", to: "project:p", type: "person_project", sourceOfTruth: "registry" },
    ];
    const keepMaxGraph = {
      edgesFrom: async (nodeId: string) => keepMaxEdges.filter((edge) => edge.from === nodeId),
      edgesTo: async (nodeId: string) => keepMaxEdges.filter((edge) => edge.to === nodeId),
    };
    const boosts = await computeGraphProximityBoosts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      keepMaxGraph as any,
      [
        { nodeId: "person:alice", label: "person alice" }, // far (hop 2), resolved first
        { nodeId: "project:p", label: "project p" }, // near (hop 1), resolved second
      ],
      8,
    );
    const hit = boosts.get("target.md");
    expect(hit).toBeDefined();
    // The closer hop-1 boost (== maxBoost) wins over the earlier, farther hop-2 boost.
    expect(hit!.boost).toBe(8);
    expect(hit!.reason).toContain("project p");
  });
});
