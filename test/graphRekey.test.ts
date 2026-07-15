/**
 * Goal 0 Phase 2 slice 4 — re-key the derived graph to v2 identities.
 *
 * These end-to-end tests build a real `GraphIndex` over anchors seeded with
 * (and without) `anchor_id` front matter and assert the core rule: a node is
 * keyed v2 when its owning anchor has a valid `anchor_id`, else v1. They also
 * cover the acceptance criterion the whole substrate exists for — a rename
 * does NOT change an id-bearing anchor's graph node id — plus mixed graphs,
 * determinism, incremental==clean-rebuild parity for an anchor gaining an id,
 * and the graph-neighbors route resolving an old v1/path deep link to the
 * now-v2 node.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { GraphIndex } from "../src/graph/index.js";
import { AnchorRepository } from "../src/git/repo.js";
import { parsePeopleRegistry } from "../src/peopleRegistry.js";
import { parseProjectMappings } from "../src/projectMappings.js";
import type { GraphEdge } from "../src/graph/model.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-graph-rekey-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function graphDeps(repo: AnchorRepository) {
  return {
    loadPeopleRegistry: async () => parsePeopleRegistry(await repo.readPeopleRegistryRaw()),
    loadProjectMappings: async () => parseProjectMappings(await repo.readProjectMappingsRaw()),
  };
}

function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...edges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type),
  );
}

/** A context anchor with a milestone-style claim, optionally carrying an anchor_id. */
function contextAnchor(anchorId?: string): string {
  return `---
project:
  - demo
type: context-anchor
tags: []
summary: A context anchor.
read_this_if:
  - Testing the re-key.
last_validated: 2026-07-07${anchorId ? `\nanchor_id: ${anchorId}` : ""}
---

# The Anchor

## Current State

- A claim about the system.
  {src: PR #7; observed: 2026-07-07; conf: high; id: c-aaaaaa}
- An unannotated claim addressable by id only.
  {id: c-bbbbbb}
`;
}

/** A project-milestone anchor referencing goal G-001 with a task owned by alice, optionally carrying an anchor_id. */
function milestoneAnchor(anchorId?: string): string {
  return `---
project:
  - demo
type: project-milestone
tags: [milestone]
summary: A milestone.
read_this_if:
  - Testing the re-key.
last_validated: 2026-07-07${anchorId ? `\nanchor_id: ${anchorId}` : ""}
milestone_id: M1
sequence: 1
theme: Theme
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

# The Milestone

## Current State

Not started.
`;
}

const ROADMAP = `---
project:
  - demo
type: project-roadmap
tags: []
summary: Demo roadmap.
read_this_if:
  - Testing the re-key.
last_validated: 2026-07-07
---

# Demo Roadmap

## Goals

### Goal G-001 -- Ship the thing

Some description.
`;

async function seedRegistries(repo: AnchorRepository): Promise<void> {
  await repo.writePeopleRegistryRaw({
    people: [{ id: "alice", displayName: "Alice", projects: [{ project: "demo", role: "responsible" }] }],
    teams: [],
  });
  await repo.writeProjectMappingsRaw({ projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: [] }] }] });
}

describe("graph re-key: v2 emission for an id-bearing anchor", () => {
  it("keys an id-bearing anchor's own, milestone, task, section, claim, and goal nodes by v2 identity", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor("a-ctx111") });
    await repo.commitAnchor({ name: "projects/demo/milestones/m1.md", content: milestoneAnchor("a-mst222") });
    await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const all = await graph.allEdges();
    const froms = new Set(all.map((e) => e.from));
    const tos = new Set(all.map((e) => e.to));
    const allNodeIds = new Set([...froms, ...tos]);

    // Own anchor node -> v2, no v1 path node for it.
    expect(allNodeIds.has("anchor:a-ctx111")).toBe(true);
    expect(allNodeIds.has("anchor:projects/demo/ctx.md")).toBe(false);
    // Milestone / task nodes -> v2 (scoped by the milestone anchor's id).
    expect(allNodeIds.has("milestone:a-mst222")).toBe(true);
    expect(allNodeIds.has("task:a-mst222#T-1")).toBe(true);
    expect(allNodeIds.has("milestone:projects/demo/milestones/m1.md")).toBe(false);
    // Claim + its containing section -> v2 (scoped by the context anchor's id).
    expect(allNodeIds.has("claim:a-ctx111#c-aaaaaa")).toBe(true);
    expect(allNodeIds.has("section:a-ctx111#Current State")).toBe(true);
    // Goal node -> scoped v2 (G-001's sole owning project is demo).
    expect(allNodeIds.has("goal:demo:G-001")).toBe(true);
    expect(allNodeIds.has("goal:G-001")).toBe(false);
  });
});

describe("graph re-key: v1 retained for a legacy (id-less) anchor", () => {
  it("keeps a legacy anchor's nodes on their path-based v1 ids", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    await repo.commitAnchor({ name: "projects/demo/legacy.md", content: contextAnchor(/* no id */) });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const all = await graph.allEdges();
    const nodeIds = new Set([...all.map((e) => e.from), ...all.map((e) => e.to)]);

    expect(nodeIds.has("anchor:projects/demo/legacy.md")).toBe(true);
    expect(nodeIds.has("claim:projects/demo/legacy.md#c-aaaaaa")).toBe(true);
    expect(nodeIds.has("section:projects/demo/legacy.md#Current State")).toBe(true);
    // No v2 anchor node exists for a legacy anchor.
    expect([...nodeIds].some((id) => id.startsWith("anchor:a-"))).toBe(false);
  });
});

describe("graph re-key: mixed graph keys each edge endpoint by its own anchor's status", () => {
  it("a migrated anchor referencing a legacy one, and vice versa, keys each side independently", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);

    // migrated.md (has id a-mig111) body-links to legacy.md (no id, referenced
    // by path) -> an anchor_anchor edge keyed v2-from / v1-to. legacy.md
    // related_to migrated.md by its anchor_id -> a typed related_to edge that
    // resolves to the v2 node (typed relations require an id-bearing target,
    // which is exactly why the FROM/TO asymmetry across the two anchors is the
    // point of this test).
    const migrated = `---
project:
  - demo
type: context-anchor
tags: []
summary: Migrated anchor.
read_this_if:
  - Testing mixed re-key.
last_validated: 2026-07-07
anchor_id: a-mig111
---

# Migrated

## Current State

See [the legacy anchor](projects/demo/legacy.md) for context.
`;
    const legacy = `---
project:
  - demo
type: context-anchor
tags: []
summary: Legacy anchor.
read_this_if:
  - Testing mixed re-key.
last_validated: 2026-07-07
relations:
  related_to:
    - "anchor:a-mig111"
---

# Legacy

## Current State

None.
`;
    await repo.commitAnchor({ name: "projects/demo/migrated.md", content: migrated });
    await repo.commitAnchor({ name: "projects/demo/legacy.md", content: legacy });

    const graph = new GraphIndex(repo, graphDeps(repo));

    // migrated.md's body link: from v2 (own id), to v1 (legacy path).
    const dep = await graph.edgesFrom("anchor:a-mig111", "anchor_anchor");
    expect(dep).toEqual([
      {
        from: "anchor:a-mig111",
        to: "anchor:projects/demo/legacy.md",
        type: "anchor_anchor",
        sourceOfTruth: "body-link",
      },
    ]);

    // legacy.md's related_to (symmetric): from v1 (legacy path), to v2
    // (migrated id); the reverse edge originates from the v2 node.
    const relForward = await graph.edgesFrom("anchor:projects/demo/legacy.md", "related_to");
    expect(relForward).toEqual([
      {
        from: "anchor:projects/demo/legacy.md",
        to: "anchor:a-mig111",
        type: "related_to",
        sourceOfTruth: "front-matter",
      },
    ]);
    const relReverse = await graph.edgesFrom("anchor:a-mig111", "related_to");
    expect(relReverse).toEqual([
      {
        from: "anchor:a-mig111",
        to: "anchor:projects/demo/legacy.md",
        type: "related_to",
        sourceOfTruth: "front-matter",
      },
    ]);
  });
});

describe("graph re-key: identity compatibility map round-trip", () => {
  it("maps an id-bearing anchor's v1<->v2 ids and scopes a sole-owner goal", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor("a-ctx111") });
    await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const compat = await graph.identityCompatibilityMap();

    expect(compat.toV2.get("anchor:projects/demo/ctx.md")).toBe("anchor:a-ctx111");
    expect(compat.toV1.get("anchor:a-ctx111")).toBe("anchor:projects/demo/ctx.md");
    expect(compat.toV2.get("goal:G-001")).toBe("goal:demo:G-001");
    expect(compat.toV1.get("goal:demo:G-001")).toBe("goal:G-001");
  });

  it("memoizes the compatibility map within a graph generation and rebuilds after a mutation", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor("a-ctx111") });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const first = await graph.identityCompatibilityMap();
    const second = await graph.identityCompatibilityMap();
    // Same object reused across per-request calls within a stable generation.
    expect(second).toBe(first);

    // A mutation invalidates the graph; the next call rebuilds a fresh map.
    graph.invalidate();
    const third = await graph.identityCompatibilityMap();
    expect(third).not.toBe(first);
    expect(third.toV2.get("anchor:projects/demo/ctx.md")).toBe("anchor:a-ctx111");
  });
});

describe("graph re-key: determinism", () => {
  it("yields identical canonical node ids across repeated builds of the same tree", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor("a-ctx111") });
    await repo.commitAnchor({ name: "projects/demo/milestones/m1.md", content: milestoneAnchor("a-mst222") });
    await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });

    const first = new GraphIndex(repo, graphDeps(repo));
    const second = new GraphIndex(repo, graphDeps(repo));
    const a = sortEdges(await first.allEdges());
    const b = sortEdges(await second.allEdges());
    expect(a).toEqual(b);
  });
});

describe("graph re-key: incremental == clean rebuild when an anchor gains an id", () => {
  it("full-invalidates on an anchor_id change so the folded-in graph matches a fresh build", async () => {
    // Use AnchorService so the write path drives invalidateGraphDocument, then
    // compare the incrementally-updated graph to a clean rebuild of the same
    // repo. `commitAnchor` writes raw content (no mint-on-create) so we control
    // exactly when the id appears.
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor(/* no id yet */) });

    const graph = new GraphIndex(repo, graphDeps(repo));
    // Build once so `built` is true and there is a stale anchorIdByName to fall
    // back from (the id-less snapshot).
    const beforeIds = new Set((await graph.allEdges()).flatMap((e) => [e.from, e.to]));
    expect(beforeIds.has("anchor:projects/demo/ctx.md")).toBe(true);
    expect(beforeIds.has("anchor:a-ctx111")).toBe(false);

    // The anchor gains an anchor_id, then we fold it in incrementally.
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor("a-ctx111") });
    await graph.invalidateDocument("projects/demo/ctx.md");
    const incremental = sortEdges(await graph.allEdges());

    // A brand-new index over the same on-disk tree = the clean rebuild.
    const rebuilt = new GraphIndex(repo, graphDeps(repo));
    const clean = sortEdges(await rebuilt.allEdges());

    expect(incremental).toEqual(clean);
    // And the fold-in actually re-keyed to v2 (not stuck on the stale v1 id).
    const nodeIds = new Set(incremental.flatMap((e) => [e.from, e.to]));
    expect(nodeIds.has("anchor:a-ctx111")).toBe(true);
    expect(nodeIds.has("anchor:projects/demo/ctx.md")).toBe(false);
  });
});

describe("graph re-key: rename preserves the graph node id (the acceptance criterion)", () => {
  it("renaming an id-bearing anchor's path does NOT change its graph node id", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    // Seed an id-bearing anchor and capture its v2 node id (keyed off the id,
    // not the path).
    await repo.commitAnchor({ name: "projects/demo/old-name.md", content: contextAnchor("a-keep11") });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const before = new Set((await graph.allEdges()).flatMap((e) => [e.from, e.to]));
    expect(before.has("anchor:a-keep11")).toBe(true);
    expect(before.has("claim:a-keep11#c-aaaaaa")).toBe(true);

    // Rename the path (git mv preserves the immutable anchor_id).
    const renamed = await service.renameAnchor({
      from: "projects/demo/old-name.md",
      to: "projects/demo/new-name.md",
      approved: true,
    });
    expect(renamed.version).toBeTruthy();

    // Rebuild from scratch over the renamed tree; the node id is unchanged.
    const after = new GraphIndex(repo, graphDeps(repo));
    const afterIds = new Set((await after.allEdges()).flatMap((e) => [e.from, e.to]));
    expect(afterIds.has("anchor:a-keep11")).toBe(true);
    expect(afterIds.has("claim:a-keep11#c-aaaaaa")).toBe(true);
    // The old path never appears as a node id on either side of the rename.
    expect(afterIds.has("anchor:projects/demo/old-name.md")).toBe(false);
    expect(afterIds.has("anchor:projects/demo/new-name.md")).toBe(false);
  });
});

describe("graph re-key: an old v1/path deep link still resolves via graphNeighbors", () => {
  it("a path input and a v1 anchor node id both resolve to the current v2 node", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRegistries(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
    await repo.commitAnchor({ name: "projects/demo/ctx.md", content: contextAnchor("a-ctx111") });

    // Path deep link.
    const byPath = await service.graphNeighbors({ node: "projects/demo/ctx.md", depth: 1 });
    if ("candidates" in byPath) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(byPath.resolvedNode.nodeId).toBe("anchor:a-ctx111");

    // Old v1 anchor node id deep link (as an existing bookmark would carry).
    const byV1 = await service.graphNeighbors({ node: "anchor:projects/demo/ctx.md", depth: 1 });
    if ("candidates" in byV1) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(byV1.resolvedNode.nodeId).toBe("anchor:a-ctx111");

    // A v2 id passes through unchanged.
    const byV2 = await service.graphNeighbors({ node: "anchor:a-ctx111", depth: 1 });
    if ("candidates" in byV2) {
      throw new Error("expected a resolved node, got candidates");
    }
    expect(byV2.resolvedNode.nodeId).toBe("anchor:a-ctx111");
  });
});
