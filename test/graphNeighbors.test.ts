import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { createAnchorMcpServer } from "../src/server.js";
import type { GraphNeighborsResult } from "../src/graph/neighbors.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-graph-neighbors-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const PROJECT_CONTEXT = `---
project:
  - demo
type: context-anchor
tags: []
summary: Demo project context.
read_this_if:
  - Testing graphNeighbors.
last_validated: 2026-07-07
---

# Demo Project

## Current State

- Effective certainty is never persisted.
  {src: PR #55; observed: 2026-07-07; conf: high; id: c-7f3a9d}
- A second claim citing the same PR.
  {src: PR #55; observed: 2026-07-08; conf: medium; id: c-second1}

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
summary: Demo milestone.
read_this_if:
  - Testing graphNeighbors.
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
  - Testing graphNeighbors.
last_validated: 2026-07-07
---

# Demo Roadmap

## Goals

### Goal G-001 -- Ship the thing

Some description.

#### Acceptance Criteria

- [ ] AC-1 Something happens.
`;

async function seedRepo(repo: AnchorRepository): Promise<void> {
  await repo.writePeopleRegistryRaw({
    people: [
      { id: "alice", displayName: "Alice", projects: [{ project: "demo", role: "responsible" }] },
      { id: "alicia", displayName: "Alicia", projects: [{ project: "demo", role: "informed" }] },
    ],
    teams: [],
  });
  await repo.writeProjectMappingsRaw({
    projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: ["src"] }] }],
  });
  await repo.commitAnchor({ name: "projects/demo/demo-project-context.md", content: PROJECT_CONTEXT });
  await repo.commitAnchor({ name: "projects/demo/milestones/m1.md", content: MILESTONE });
  await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });
}

function makeService(repo: AnchorRepository): AnchorService {
  return new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
}

describe("graphNeighbors: milestone traversal", () => {
  it("returns goal, project, tasks, and owners with correct edge types from a milestone node", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    // The milestone anchor's OWN node (`anchor:` — every anchor gets one) has
    // no direct edge to the goal/tasks/owners; the `milestone:` node is the
    // distinct graph identity that carries those edges (design doc: every
    // anchor gets an `anchor:` node, milestone anchors additionally get a
    // `milestone:` node connected to it by containment). Passing the
    // canonical `milestone:` node id directly exercises that identity.
    const result = await service.graphNeighbors({ node: "milestone:projects/demo/milestones/m1.md", depth: 2 });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }

    expect(result.resolvedNode.nodeId).toBe("milestone:projects/demo/milestones/m1.md");
    expect(result.resolvedNode.type).toBe("milestone");
    expect(result.resolvedNode.via).toBe("canonical");

    const nodeIds = new Set(result.nodes.map((node) => node.id));
    expect(nodeIds.has("goal:G-001")).toBe(true);
    expect(nodeIds.has("anchor:projects/demo/milestones/m1.md")).toBe(true);
    expect(nodeIds.has("task:projects/demo/milestones/m1.md#T-1")).toBe(true);
    expect(nodeIds.has("person:alice")).toBe(true);
    // Project is reachable at hop 2: milestone -> anchor (hop 1) -> project (hop 2).
    expect(nodeIds.has("project:demo")).toBe(true);

    const edgeTypes = new Set(result.edges.map((edge) => edge.type));
    expect(edgeTypes.has("milestone_goal")).toBe(true);
    expect(edgeTypes.has("milestone_anchor")).toBe(true);
    expect(edgeTypes.has("milestone_task")).toBe(true);
    expect(edgeTypes.has("task_owner")).toBe(true);
    expect(edgeTypes.has("anchor_project")).toBe(true);

    // Every edge carries type + sourceOfTruth (ground-rule: no opaque results).
    for (const edge of result.edges) {
      expect(edge.type).toBeTruthy();
      expect(edge.sourceOfTruth).toBeTruthy();
    }

    // Every result node (except the origin) carries a non-empty hop path
    // back to the origin.
    for (const node of result.nodes) {
      if (node.id === result.resolvedNode.nodeId) {
        expect(node.depth).toBe(0);
        expect(node.hopPath).toEqual([]);
      } else {
        expect(node.depth).toBeGreaterThan(0);
        expect(node.hopPath.length).toBeGreaterThan(0);
        expect(node.hopPath[node.hopPath.length - 1]!.to === node.id || node.hopPath[node.hopPath.length - 1]!.from === node.id).toBe(
          true,
        );
      }
    }
  });

  it("resolves a bare G-### input directly to the goal node", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({ node: "G-001", direction: "reverse", depth: 1 });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(result.resolvedNode.nodeId).toBe("goal:G-001");
    const nodeIds = new Set(result.nodes.map((node) => node.id));
    // Reverse from goal:G-001 should reach the milestone (milestone_goal) and
    // the roadmap anchor (roadmap_goal).
    expect(nodeIds.has("milestone:projects/demo/milestones/m1.md")).toBe(true);
    expect(nodeIds.has("anchor:projects/demo/demo-roadmap.md")).toBe(true);
  });
});

describe("graphNeighbors: source reverse query", () => {
  it("answers 'all claims citing PR #55' via a reverse query from the source node in <=1 hop", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({
      node: "pr:repo-a#55",
      direction: "reverse",
      edgeTypes: ["claim_source"],
      depth: 1,
    });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }

    expect(result.resolvedNode.nodeId).toBe("pr:repo-a#55");
    expect(result.resolvedNode.via).toBe("canonical");

    const claimNodeIds = result.nodes.filter((node) => node.type === "claim").map((node) => node.id);
    expect(claimNodeIds.sort()).toEqual(
      [
        "claim:projects/demo/demo-project-context.md#c-7f3a9d",
        "claim:projects/demo/demo-project-context.md#c-second1",
      ].sort(),
    );

    // Every claim node's provenance sidecar shape matches includeProvenance's per-claim shape.
    for (const node of result.nodes.filter((candidate) => candidate.type === "claim")) {
      expect(node.claim).toBeDefined();
      expect(node.claim?.status).toBe("annotated");
      expect(node.claim?.sources.length).toBeGreaterThan(0);
    }

    expect(result.edges.every((edge) => edge.type === "claim_source")).toBe(true);
  });

  it("reads an anchor's claims once when a result has several claims from that anchor (no per-claim reload)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    // Warm the graph so the initial build's reads do not count against enrichment.
    await service.graphNeighbors({ node: "pr:repo-a#55", direction: "reverse", edgeTypes: ["claim_source"], depth: 1 });

    const readSpy = vi.spyOn(repo, "readRaw");
    const result = await service.graphNeighbors({
      node: "pr:repo-a#55",
      direction: "reverse",
      edgeTypes: ["claim_source"],
      depth: 1,
    });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }

    // Both claims live in demo-project-context.md; enrichment must read+parse it
    // once for the whole result, not once per claim node (the N+1 that reloaded
    // mappings/anchors/people-index per claim).
    const claimNodes = result.nodes.filter((node) => node.type === "claim");
    expect(claimNodes.length).toBe(2);
    const contextReads = readSpy.mock.calls.filter(
      (call) => call[0] === "projects/demo/demo-project-context.md",
    ).length;
    expect(contextReads).toBe(1);

    readSpy.mockRestore();
  });

  it("resolves <anchor>#<claim-id> input directly to the claim node", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({
      node: "projects/demo/demo-project-context.md#c-7f3a9d",
      depth: 1,
    });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(result.resolvedNode.nodeId).toBe("claim:projects/demo/demo-project-context.md#c-7f3a9d");
    expect(result.resolvedNode.via).toBe("claim-id");

    const originNode = result.nodes.find((node) => node.id === result.resolvedNode.nodeId);
    expect(originNode?.claim?.id).toBe("c-7f3a9d");

    const nodeIds = new Set(result.nodes.map((node) => node.id));
    expect(nodeIds.has("pr:repo-a#55")).toBe(true);
  });
});

describe("graphNeighbors: depth and limit clamps", () => {
  it("clamps depth below 1 up to 1", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({ node: "projects/demo/milestones/m1.md", depth: 0 });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }
    // depth 0 clamps to 1: only direct neighbors of the milestone node are reachable.
    expect(result.nodes.every((node) => node.depth <= 1)).toBe(true);
  });

  it("clamps depth above 3 down to 3", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({ node: "projects/demo/milestones/m1.md", depth: 99 });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(result.nodes.every((node) => node.depth <= 3)).toBe(true);
  });

  it("clamps limit to at most 200 and never returns more result nodes than the limit", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({ node: "projects/demo/milestones/m1.md", depth: 3, limit: 1 });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }
    // Origin + at most 1 more node.
    expect(result.nodes.length).toBeLessThanOrEqual(2);
  });

  it("defaults depth to 1 and limit to 50 when omitted", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({ node: "projects/demo/milestones/m1.md" });
    if ("candidates" in result) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(result.nodes.every((node) => node.depth <= 1)).toBe(true);
    expect(result.nodes.length).toBeLessThanOrEqual(51);
  });
});

describe("graphNeighbors: ambiguous input", () => {
  it("returns a candidate list instead of guessing when a name matches more than one person", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    // "alic" matches both "alice" and "alicia" by substring, and does not
    // exactly resolve to any anchor/goal/claim/canonical node either.
    const result = await service.graphNeighbors({ node: "alic" });
    expect("candidates" in result).toBe(true);
    if (!("candidates" in result)) {
      throw new Error("expected candidates");
    }
    const candidateIds = result.candidates.map((candidate) => candidate.nodeId).sort();
    expect(candidateIds).toEqual(["person:alice", "person:alicia"]);
  });

  it("returns an empty candidate list (not a guess) for input matching nothing", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const result = await service.graphNeighbors({ node: "totally-unknown-node-xyz" });
    expect("candidates" in result).toBe(true);
    if (!("candidates" in result)) {
      throw new Error("expected candidates");
    }
    expect(result.candidates).toEqual([]);
  });
});

describe("graphNeighbors: determinism", () => {
  it("returns identical nodes/edges across repeated calls on the same tree", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = makeService(repo);

    const first = await service.graphNeighbors({ node: "projects/demo/milestones/m1.md", depth: 2 });
    const second = await service.graphNeighbors({ node: "projects/demo/milestones/m1.md", depth: 2 });
    expect(first).toEqual(second);
  });
});

describe("graphNeighbors: tool schema", () => {
  type RegisteredToolForTest = {
    inputSchema?: { parse(input: unknown): unknown };
    description?: string;
  };

  function toolForTest(server: unknown, name: string): RegisteredToolForTest {
    return (server as { _registeredTools: Record<string, RegisteredToolForTest> })._registeredTools[name]!;
  }

  it("registers graphNeighbors with a description naming both canonical queries", () => {
    const service = {} as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "graphNeighbors");

    expect(tool.description).toMatch(/claims cit/i);
    expect(tool.description).toMatch(/downstream/i);
  });

  it("accepts a minimal input (node only) and applies documented defaults via parse", () => {
    const service = {} as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "graphNeighbors");

    const parsed = tool.inputSchema?.parse({ node: "projects/demo/milestones/m1.md" });
    expect(parsed).toEqual({ node: "projects/demo/milestones/m1.md" });
  });

  it("rejects a depth outside 1-3 and a limit outside 1-200 at the schema layer", () => {
    const service = {} as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "graphNeighbors");

    expect(() => tool.inputSchema?.parse({ node: "x", depth: 4 })).toThrow();
    expect(() => tool.inputSchema?.parse({ node: "x", depth: 0 })).toThrow();
    expect(() => tool.inputSchema?.parse({ node: "x", limit: 0 })).toThrow();
    expect(() => tool.inputSchema?.parse({ node: "x", limit: 201 })).toThrow();
  });

  it("full-shape input snapshot: every documented field parses to a stable, deterministic shape", () => {
    const service = {} as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "graphNeighbors");

    const parsed = tool.inputSchema?.parse({
      node: "pr:repo-a#55",
      depth: 2,
      edgeTypes: ["claim_source", "task_owner"],
      direction: "reverse",
      limit: 25,
    });
    expect(parsed).toMatchInlineSnapshot(`
      {
        "depth": 2,
        "direction": "reverse",
        "edgeTypes": [
          "claim_source",
          "task_owner",
        ],
        "limit": 25,
        "node": "pr:repo-a#55",
      }
    `);
  });
});

// Re-exported type-only import keeps the GraphNeighborsResult type exercised
// by the compiler even where a test narrows through `"candidates" in result`.
export type { GraphNeighborsResult as _GraphNeighborsResultTypeCheck };
