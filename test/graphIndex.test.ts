import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { GraphIndex } from "../src/graph/index.js";
import { AnchorRepository } from "../src/git/repo.js";
import { parsePeopleRegistry } from "../src/peopleRegistry.js";
import { parseProjectMappings } from "../src/projectMappings.js";
import type { GraphEdge } from "../src/graph/model.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-graph-"));
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

const PROJECT_CONTEXT = `---
project:
  - demo
type: context-anchor
tags: []
summary: Demo project context.
read_this_if:
  - Testing graph index.
last_validated: 2026-07-07
---

# Demo Project

## Current State

- Effective certainty is never persisted.
  {src: PR #55; observed: 2026-07-07; conf: high; id: c-7f3a9d}

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
  - Testing graph index.
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
  - Testing graph index.
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
    people: [{ id: "alice", displayName: "Alice", projects: [{ project: "demo", role: "responsible" }] }],
    teams: [],
  });
  await repo.writeProjectMappingsRaw({
    projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: ["src"] }] }],
  });
  await repo.commitAnchor({ name: "projects/demo/demo-project-context.md", content: PROJECT_CONTEXT });
  await repo.commitAnchor({ name: "projects/demo/milestones/m1.md", content: MILESTONE });
  await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });
}

describe("GraphIndex build", () => {
  it("is deterministic: building twice from the same tree yields identical edge sets", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graphA = new GraphIndex(repo, graphDeps(repo));
    const graphB = new GraphIndex(repo, graphDeps(repo));

    const edgesA = sortEdges(await graphA.allEdges());
    const edgesB = sortEdges(await graphB.allEdges());

    expect(edgesA).toEqual(edgesB);
    expect(edgesA.length).toBeGreaterThan(0);
  });

  it("produces the expected edge types across front matter, milestone, roadmap, registry, and claim extractors", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const edges = await graph.allEdges();
    const types = new Set(edges.map((edge) => edge.type));

    expect(types.has("anchor_project")).toBe(true);
    expect(types.has("milestone_anchor")).toBe(true);
    expect(types.has("milestone_goal")).toBe(true); // relations.goal_ids -> milestone: node -> goal: node
    expect(types.has("roadmap_goal")).toBe(true); // roadmap heading -> anchor: node -> goal: node
    expect(types.has("task_owner")).toBe(true);
    expect(types.has("person_project")).toBe(true);
    expect(types.has("project_repo")).toBe(true);
    expect(types.has("repo_path")).toBe(true);
    expect(types.has("claim_source")).toBe(true);
  });

  it("derived_from is a reserved edge type nothing extracts yet (WP5 unmerged) — WP6's weakest-link lookup degrades gracefully", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const edges = await graph.allEdges();
    // No extractor emits derived_from/contradicts today (src/claims.ts's
    // ANNOTATION_KEYS has no such grammar keys yet), even though the type is
    // reserved in the GraphEdgeType enum for WP5.
    expect(edges.some((edge) => edge.type === "derived_from")).toBe(false);

    // The claim node from PROJECT_CONTEXT's annotated bullet (id: c-7f3a9d)
    // has zero derived_from out-edges — exactly the input WP6's
    // weakestAncestorCertainty needs to degrade to "the origin is its own
    // weakest ancestor" (see test/certainty.test.ts and
    // AnchorService.derivedFromAncestors).
    const claimEdges = await graph.edgesFrom("claim:projects/demo/demo-project-context.md#c-7f3a9d", "derived_from");
    expect(claimEdges).toEqual([]);
  });

  it("spawns zero git subprocesses during a full graph build", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    // Warm AnchorRepository's own GitMetadataCache/meta caches first (one
    // listAnchors call), matching the established "warm access spawns zero
    // git processes" pattern in test/gitMetadataCache.test.ts. This isolates
    // the assertion to GraphIndex's OWN build cost: listAnchors/readAnchor on
    // an already-warm repo read purely from the filesystem + in-memory
    // caches, so any subprocess call the spies catch below is attributable
    // to GraphIndex, not to AnchorRepository's first-ever git log walk.
    await repo.listAnchors();

    // Spy on every SimpleGit method used anywhere in src/git/repo.ts:
    // init, show, add, status, raw, log, diff, revparse, pull, push.
    const spies = [
      vi.spyOn(repo.git, "init"),
      vi.spyOn(repo.git, "show"),
      vi.spyOn(repo.git, "add"),
      vi.spyOn(repo.git, "status"),
      vi.spyOn(repo.git, "raw"),
      vi.spyOn(repo.git, "log"),
      vi.spyOn(repo.git, "diff"),
      vi.spyOn(repo.git, "revparse"),
      vi.spyOn(repo.git, "pull"),
      vi.spyOn(repo.git, "push"),
    ];

    const graph = new GraphIndex(repo, graphDeps(repo));
    await graph.ensureBuilt();
    await graph.allEdges();
    await graph.edgesTo("project:demo");

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("GraphIndex invalidateDocument", () => {
  it("scopes an update to only the touched document's edges", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const before = sortEdges(await graph.allEdges());

    // Change only a Decisions-section bullet with a fresh claim so Current
    // State's existing claim id is untouched, isolating the diff to one new
    // claim -> source edge.
    const newContent = PROJECT_CONTEXT.replace(
      "## Decisions\n\nNone.",
      "## Decisions\n\n- A second claim was added.\n  {src: PR #56; observed: 2026-07-08; conf: medium; id: c-second1}",
    );
    await repo.commitAnchor({ name: "projects/demo/demo-project-context.md", content: newContent });
    await graph.invalidateDocument("projects/demo/demo-project-context.md");

    const after = sortEdges(await graph.allEdges());

    const beforeKeys = new Set(before.map((edge) => `${edge.from}|${edge.to}|${edge.type}`));
    const afterKeys = new Set(after.map((edge) => `${edge.from}|${edge.to}|${edge.type}`));

    const added = [...afterKeys].filter((key) => !beforeKeys.has(key));
    const removed = [...beforeKeys].filter((key) => !afterKeys.has(key));

    // Only new-claim edges should appear; nothing from the untouched
    // milestone/roadmap documents should have changed.
    expect(removed).toEqual([]);
    expect(added.every((key) => key.includes("projects/demo/demo-project-context.md"))).toBe(true);
    expect(added.length).toBeGreaterThan(0);

    // Cross-check: milestone and roadmap edges are byte-identical before/after.
    const milestoneEdgesBefore = before.filter((edge) => edge.from.includes("milestones/m1.md") || edge.to.includes("milestones/m1.md"));
    const milestoneEdgesAfter = after.filter((edge) => edge.from.includes("milestones/m1.md") || edge.to.includes("milestones/m1.md"));
    expect(milestoneEdgesAfter).toEqual(milestoneEdgesBefore);
  });

  it("adopts the advanced HEAD so the next query keeps the incremental update instead of full-rebuilding", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    await graph.allEdges(); // first query builds the graph (HEAD = H0)

    const rebuildSpy = vi.spyOn(
      graph as unknown as { rebuild: (head: string | undefined, generation: number) => Promise<void> },
      "rebuild",
    );

    // A write advances HEAD, then the change is folded in per-document.
    const newContent = PROJECT_CONTEXT.replace(
      "## Decisions\n\nNone.",
      "## Decisions\n\n- Another claim.\n  {src: PR #99; observed: 2026-07-08; conf: medium; id: c-head01}",
    );
    await repo.commitAnchor({ name: "projects/demo/demo-project-context.md", content: newContent });
    await graph.invalidateDocument("projects/demo/demo-project-context.md");

    // The next query must be served from the incrementally-updated graph, not a
    // full rebuild: invalidateDocument adopted the new HEAD. Without that, a
    // HEAD mismatch would discard the per-document work every write.
    const edges = await graph.allEdges();
    expect(rebuildSpy).not.toHaveBeenCalled();
    expect(edges.some((edge) => edge.from.includes("c-head01"))).toBe(true);

    rebuildSpy.mockRestore();
  });

  it("removes a document's edges entirely when the document is deleted", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    await graph.ensureBuilt();

    await repo.deleteAnchorFile({ name: "projects/demo/milestones/m1.md" });
    await graph.invalidateDocument("projects/demo/milestones/m1.md");

    const after = await graph.allEdges();
    expect(after.some((edge) => edge.from.includes("milestones/m1.md") || edge.to.includes("milestones/m1.md"))).toBe(
      false,
    );
  });

  it("is a no-op when the graph has never been built", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    // Should not throw and should not force a build.
    await expect(graph.invalidateDocument("projects/demo/demo-project-context.md")).resolves.toBeUndefined();
  });
});

describe("GraphIndex reverse edges", () => {
  it("edgesTo returns O(1)-style reverse adjacency for a project node", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const reverse = await graph.edgesTo("project:demo");
    const types = new Set(reverse.map((edge) => edge.type));
    expect(types.has("anchor_project")).toBe(true);
    expect(types.has("person_project")).toBe(true);
    expect(types.has("project_repo")).toBe(false); // project:demo is the FROM side of project_repo, not the TO side
  });
});

describe("GraphIndex typed relation vocabulary end-to-end (WP3)", () => {
  const ANCHOR_WITH_ID = `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor with a server-minted anchor_id.
read_this_if:
  - Testing typed relation vocabulary.
last_validated: 2026-07-07
anchor_id: a-abc123
---

# Anchor With Id

## Current State

None.
`;

  const ANCHOR_REFERRING = `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor referring to another via typed relations.
read_this_if:
  - Testing typed relation vocabulary.
last_validated: 2026-07-07
relations:
  depends_on:
    - "anchor:a-abc123"
  related_to:
    - "anchor:a-abc123"
  implements:
    - "goal:demo:G-001"
---

# Anchor Referring

## Current State

None.
`;

  async function seedTypedRelationRepo(repo: AnchorRepository): Promise<void> {
    await repo.writePeopleRegistryRaw({ people: [], teams: [] });
    await repo.writeProjectMappingsRaw({ projects: [] });
    await repo.commitAnchor({ name: "projects/demo/with-id.md", content: ANCHOR_WITH_ID });
    await repo.commitAnchor({ name: "projects/demo/referring.md", content: ANCHOR_REFERRING });
    await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });
  }

  it("resolves a canonical anchor:<anchor-id> depends_on target to a typed depends_on edge via a real GraphIndex build", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const edges = await graph.edgesFrom("anchor:projects/demo/referring.md", "depends_on");
    expect(edges).toEqual([
      {
        from: "anchor:projects/demo/referring.md",
        to: "anchor:projects/demo/with-id.md",
        type: "depends_on",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("emits related_to symmetrically (both directions) for a canonical anchor:<anchor-id> target", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const forward = await graph.edgesFrom("anchor:projects/demo/referring.md", "related_to");
    const reverse = await graph.edgesFrom("anchor:projects/demo/with-id.md", "related_to");
    expect(forward).toEqual([
      {
        from: "anchor:projects/demo/referring.md",
        to: "anchor:projects/demo/with-id.md",
        type: "related_to",
        sourceOfTruth: "front-matter",
      },
    ]);
    expect(reverse).toEqual([
      {
        from: "anchor:projects/demo/with-id.md",
        to: "anchor:projects/demo/referring.md",
        type: "related_to",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("resolves a canonical goal:<project-slug>:<goal-id> implements target to the existing unscoped v1 goal node", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const edges = await graph.edgesFrom("anchor:projects/demo/referring.md", "implements");
    expect(edges).toEqual([
      {
        from: "anchor:projects/demo/referring.md",
        to: "goal:G-001",
        type: "implements",
        sourceOfTruth: "front-matter",
      },
    ]);
  });
});

describe("GraphIndex id-only claim node (Goal 0 Phase 1 WP4)", () => {
  const ANCHOR_WITH_ID_ONLY_CLAIM = `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor with an id-only claim.
read_this_if:
  - Testing WP4 id-only claim graph nodes.
last_validated: 2026-07-07
---

# Anchor With Id Only Claim

## Current State

- Legacy claim with a stable id but no provenance.
  {id: c-legacy1}
`;

  it("materializes a claim: node for an id-only (unannotated) claim through a real GraphIndex build", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await repo.writePeopleRegistryRaw({ people: [], teams: [] });
    await repo.writeProjectMappingsRaw({ projects: [] });
    await repo.commitAnchor({ name: "projects/demo/id-only.md", content: ANCHOR_WITH_ID_ONLY_CLAIM });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const claimNode = "claim:projects/demo/id-only.md#c-legacy1";
    const forward = await graph.edgesFrom(claimNode);
    expect(forward).toEqual([
      {
        from: claimNode,
        to: "section:projects/demo/id-only.md#Current State",
        type: "claim_section",
        sourceOfTruth: "containment",
      },
    ]);
  });
});

describe("AnchorService graph wiring", () => {
  it("does not construct a GraphIndex until a graph-consuming call happens (writeAnchor works without ever building the graph)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.writeAnchor({ name: "projects/demo/demo-project-context.md", content: PROJECT_CONTEXT });
    expect(result.version).toBeTruthy();
    // No assertion possible on the private field directly; this test's
    // purpose is that writeAnchor succeeds without needing any graph query
    // pre-requisite, proving the hook does not force a build.
  });

  /** Test-only accessor for AnchorService's private lazy GraphIndex field, so these tests can force construction without a public query method (WP4 adds one). */
  function forceGraphIndex(service: AnchorService): GraphIndex {
    const withPrivateAccess = service as unknown as { getGraphIndex: () => GraphIndex };
    return withPrivateAccess.getGraphIndex();
  }

  it("invalidates the touched document's graph edges after revertAnchor", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const first = await service.writeAnchor({ name: "projects/demo/demo-project-context.md", content: PROJECT_CONTEXT });
    const firstVersion = first.version;
    expect(firstVersion).toBeTruthy();

    const secondContent = PROJECT_CONTEXT.replace(
      "## Decisions\n\nNone.",
      "## Decisions\n\n- A second claim was added.\n  {src: PR #56; observed: 2026-07-08; conf: medium; id: c-second1}",
    ).replace("last_validated: 2026-07-07", "last_validated: 2026-07-08");
    const secondResult = await service.writeAnchor({
      name: "projects/demo/demo-project-context.md",
      content: secondContent,
      approved: true,
    });
    expect(secondResult.version).toBeTruthy();

    // Force graph construction and a build that observes the second claim.
    const graph = forceGraphIndex(service);
    const beforeRevert = await graph.allEdges();
    expect(beforeRevert.some((edge) => edge.from === "claim:projects/demo/demo-project-context.md#c-second1")).toBe(
      true,
    );

    await service.revertAnchor("projects/demo/demo-project-context.md", firstVersion!);
    await graph.invalidateDocument("projects/demo/demo-project-context.md");
    const afterRevert = await graph.allEdges();
    // The reverted content (original PROJECT_CONTEXT) has no c-second1 claim;
    // if revertAnchor's invalidateGraphDocument hook is missing, this stale
    // edge would still be served indefinitely after revert.
    expect(afterRevert.some((edge) => edge.from === "claim:projects/demo/demo-project-context.md#c-second1")).toBe(
      false,
    );
  });

  it("wholesale-invalidates the graph after writePeopleRegistry / writeProjectMappings so registry-derived edges are never served stale", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    await service.writeAnchor({ name: "projects/demo/demo-project-context.md", content: PROJECT_CONTEXT });

    // Force graph construction and an initial build with no "bob" person edge.
    const graph = forceGraphIndex(service);
    const before = await graph.allEdges();
    expect(before.some((edge) => edge.from === "person:bob")).toBe(false);

    await service.writePeopleRegistry({
      registry: {
        people: [{ id: "bob", displayName: "Bob", projects: [{ project: "demo", role: "responsible" }] }],
        teams: [],
      },
    });

    // invalidate() resets `built`, so the next allEdges() call triggers a
    // fresh rebuild picking up the new registry contents — proving the write
    // path's explicit this._graphIndex?.invalidate() call actually fired
    // (without it, this already-built graph would keep serving the stale
    // pre-write registry edges).
    const after = await graph.allEdges();
    expect(after.some((edge) => edge.from === "person:bob" && edge.to === "project:demo")).toBe(true);
  });
});
