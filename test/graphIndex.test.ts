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

## Decisions

None.

## Constraints

None.

## PRs

None.
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

## Current State

None.

## Decisions

None.

## Constraints

None.

## PRs

None.

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
    // Slice 4 re-key: referring.md has no anchor_id (v1 FROM), but with-id.md
    // owns a-abc123, so the depends_on target endpoint is the v2 anchor node.
    expect(edges).toEqual([
      {
        from: "anchor:projects/demo/referring.md",
        to: "anchor:a-abc123",
        type: "depends_on",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("never resolves a typed target through a MALFORMED declared anchor_id (format-gated at the resolver map)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);
    // "bogus-id" fails ANCHOR_ID_PATTERN but the repo layer (unlike the
    // write-path validator) accepts it — e.g. a hand-edited file. The typed
    // ref "anchor:bogus-id" parses (the parser only requires non-empty), so
    // without the resolver-map format gate this WOULD resolve and emit a
    // typed edge to the declaring anchor.
    await repo.commitAnchor({
      name: "projects/demo/bad-id.md",
      content: `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor declaring a malformed anchor_id.
read_this_if:
  - Testing malformed anchor_id resolution.
last_validated: 2026-07-07
anchor_id: bogus-id
---

# Bad Id

## Current State

None.
`,
    });
    await repo.commitAnchor({
      name: "projects/demo/cites-bad-id.md",
      content: `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor citing a malformed anchor_id.
read_this_if:
  - Testing malformed anchor_id resolution.
last_validated: 2026-07-07
relations:
  depends_on:
    - "anchor:bogus-id"
---

# Cites Bad Id

## Current State

None.
`,
    });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const typed = await graph.edgesFrom("anchor:projects/demo/cites-bad-id.md", "depends_on");
    expect(typed).toEqual([]);
    const legacy = await graph.edgesFrom("anchor:projects/demo/cites-bad-id.md", "anchor_anchor");
    expect(legacy).toEqual([]);
  });

  it("treats a typed target citing a DUPLICATED anchor_id as unresolvable (legacy fallback) instead of picking one anchor", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);
    // Two more anchors that both (illegally — WP5 coverage reports this as a
    // tree defect) declare the same anchor_id. A typed depends_on target
    // citing that id must not resolve to whichever duplicate the resolver
    // map happened to keep; it falls back to legacy handling, where the raw
    // "anchor:a-dup999" string resolves to no anchor name, so no edge at all.
    const dupFrontmatter = (title: string) => `---
project:
  - demo
type: context-anchor
tags: []
summary: ${title} declaring a duplicated anchor_id.
read_this_if:
  - Testing duplicated anchor_id resolution.
last_validated: 2026-07-07
anchor_id: a-dup999
---

# ${title}

## Current State

None.
`;
    await repo.commitAnchor({ name: "projects/demo/dup-one.md", content: dupFrontmatter("Dup One") });
    await repo.commitAnchor({ name: "projects/demo/dup-two.md", content: dupFrontmatter("Dup Two") });
    await repo.commitAnchor({
      name: "projects/demo/cites-dup.md",
      content: `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor citing a duplicated anchor_id.
read_this_if:
  - Testing duplicated anchor_id resolution.
last_validated: 2026-07-07
relations:
  depends_on:
    - "anchor:a-dup999"
---

# Cites Dup

## Current State

None.
`,
    });

    const graph = new GraphIndex(repo, graphDeps(repo));
    const typed = await graph.edgesFrom("anchor:projects/demo/cites-dup.md", "depends_on");
    expect(typed).toEqual([]);
    const legacy = await graph.edgesFrom("anchor:projects/demo/cites-dup.md", "anchor_anchor");
    expect(legacy).toEqual([]);
    // The unique anchor_id elsewhere in the tree still resolves normally.
    const unaffected = await graph.edgesFrom("anchor:projects/demo/referring.md", "depends_on");
    expect(unaffected).toHaveLength(1);
  });

  it("emits related_to symmetrically (both directions) for a canonical anchor:<anchor-id> target keyed v2 on the id-bearing endpoint (slice 4 re-key)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    // with-id.md owns a-abc123, so its node re-keys to anchor:a-abc123: the
    // forward edge targets it, and the symmetric reverse edge originates FROM
    // it (so the reverse lookup is keyed by the v2 id, not the path).
    const forward = await graph.edgesFrom("anchor:projects/demo/referring.md", "related_to");
    const reverse = await graph.edgesFrom("anchor:a-abc123", "related_to");
    expect(forward).toEqual([
      {
        from: "anchor:projects/demo/referring.md",
        to: "anchor:a-abc123",
        type: "related_to",
        sourceOfTruth: "front-matter",
      },
    ]);
    expect(reverse).toEqual([
      {
        from: "anchor:a-abc123",
        to: "anchor:projects/demo/referring.md",
        type: "related_to",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("resolves a canonical goal:<project-slug>:<goal-id> implements target to the SCOPED v2 goal node (slice 4 re-key)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedTypedRelationRepo(repo);

    const graph = new GraphIndex(repo, graphDeps(repo));
    const edges = await graph.edgesFrom("anchor:projects/demo/referring.md", "implements");
    // The roadmap defines G-001 for project demo (its sole owner), so the goal
    // node re-keys to the scoped v2 id goal:demo:G-001.
    expect(edges).toEqual([
      {
        from: "anchor:projects/demo/referring.md",
        to: "goal:demo:G-001",
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

    // Derive the second write from the actually-committed first content (not
    // the static PROJECT_CONTEXT template): mint-on-create (Goal 0 Phase 2
    // WP-A) injects an anchor_id on the first write, and anchor_id is
    // immutable, so a second write must carry it forward rather than
    // reconstructing content from the pre-mint fixture.
    const firstContent = (await service.readAnchor("projects/demo/demo-project-context.md")).content;
    const secondContent = firstContent
      .replace(
        "## Decisions\n\nNone.",
        "## Decisions\n\n- A second claim was added.\n  {src: PR #56; observed: 2026-07-08; conf: medium; id: c-second1}",
      )
      .replace("last_validated: 2026-07-07", "last_validated: 2026-07-08");
    const secondResult = await service.writeAnchor({
      name: "projects/demo/demo-project-context.md",
      content: secondContent,
      approved: true,
    });
    expect(secondResult.version).toBeTruthy();

    // Slice 4 re-key: mint-on-create gave this anchor an anchor_id, so its
    // claim nodes are keyed v2 (claim:<anchor-id>#c-second1), not by path.
    // Derive the minted id from the committed front matter so the assertion
    // targets the actual canonical node id rather than the pre-mint v1 shape.
    const mintedId = /anchor_id:\s*(a-[0-9a-z]{6,8})\b/.exec(firstContent)?.[1];
    expect(mintedId).toBeTruthy();
    const c2Node = `claim:${mintedId}#c-second1`;

    // Force graph construction and a build that observes the second claim.
    const graph = forceGraphIndex(service);
    const beforeRevert = await graph.allEdges();
    expect(beforeRevert.some((edge) => edge.from === c2Node)).toBe(true);

    await service.revertAnchor("projects/demo/demo-project-context.md", firstVersion!);
    await graph.invalidateDocument("projects/demo/demo-project-context.md");
    const afterRevert = await graph.allEdges();
    // The reverted content (original PROJECT_CONTEXT) has no c-second1 claim;
    // if revertAnchor's invalidateGraphDocument hook is missing, this stale
    // edge would still be served indefinitely after revert.
    expect(afterRevert.some((edge) => edge.from === c2Node)).toBe(false);
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

describe("AnchorService.graphCoverage (Goal 0 Phase 1 WP6)", () => {
  it("reports coverage records, summary, identity contract version, and graph generation/HEAD for a real tree", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.graphCoverage({});

    expect(result.records.length).toBeGreaterThan(0);
    expect(
      result.records.some((record) => record.kind === "anchor" && record.anchorName === "projects/demo/demo-project-context.md"),
    ).toBe(true);
    expect(result.summary.totalAnchors).toBeGreaterThan(0);
    expect(result.identityContractVersion).toBe(2);
    expect(typeof result.graphGeneration).toBe("number");
    expect(result.totalMatching).toBeGreaterThanOrEqual(result.records.length);
    expect(result.limit).toBe(100);
  });

  it("filters graphCoverage results by project", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.graphCoverage({ project: "demo" });
    const anchorRecords = result.records.filter((record) => record.kind === "anchor");
    expect(anchorRecords.length).toBeGreaterThan(0);
    for (const record of anchorRecords) {
      expect(record.anchorName.startsWith("projects/demo/")).toBe(true);
    }
  });

  it("filters graphCoverage results by state", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.graphCoverage({ states: ["prose_only"] });
    expect(result.records.every((record) => record.state === "prose_only")).toBe(true);
  });

  it("bounds and paginates graphCoverage with a cursor that eventually terminates", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const firstPage = await service.graphCoverage({ limit: 1 });
    expect(firstPage.records.length).toBeLessThanOrEqual(1);
    expect(firstPage.limit).toBe(1);

    if (firstPage.nextCursor) {
      const secondPage = await service.graphCoverage({ limit: 1, cursor: firstPage.nextCursor });
      expect(secondPage.records).not.toEqual(firstPage.records);
    }
  });

  it("summary counts agree with the returned+total record counts for an unfiltered, unpaginated request", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.graphCoverage({ limit: 500 });
    const anchorCount = result.records.filter((record) => record.kind === "anchor").length;
    const claimCount = result.records.filter((record) => record.kind === "claim").length;
    expect(result.summary.totalAnchors).toBe(anchorCount);
    expect(result.summary.totalClaims).toBe(claimCount);
  });
});

describe("AnchorService.graphSnapshot / graphSchema (Goal 1 slice 1)", () => {
  it("materializes an isolated anchor (zero edges) as a first-class node, with coverage state attached", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
    // No project/relations at all -> genuinely zero edges from extraction.
    await repo.commitAnchor({
      name: "invariants/isolated.md",
      content: `---
type: context-anchor
tags: []
summary: An anchor with no edges.
read_this_if:
  - Testing isolated-node materialization.
last_validated: 2026-07-07
---

## Current State

None.
`,
    });

    const result = await service.graphSnapshot({});
    const node = result.nodes.find((candidate) => candidate.anchorName === "invariants/isolated.md");
    expect(node).toBeDefined();
    expect(node?.type).toBe("anchor");
    expect(node?.coverageState).toBeTruthy();
    expect(node?.seed).toBeDefined();
  });

  it("reports graph generation/HEAD, identity contract version, applied filters, clamps, totals, and no truncation for a small tree", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.graphSnapshot({ project: "demo" });
    expect(typeof result.graphGeneration).toBe("number");
    expect(result.identityContractVersion).toBe(2);
    expect(result.appliedFilters.project).toBe("demo");
    expect(result.clamps).toEqual({ maxNodes: 500, maxEdges: 2000 });
    expect(result.totals.matchingNodes).toBe(result.totals.returnedNodes);
    expect(result.totals.matchingEdges).toBe(result.totals.returnedEdges);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
    // The milestone -> goal edge (and others) should be present with ids/type/sourceOfTruth.
    expect(result.edges.length).toBeGreaterThan(0);
    for (const edge of result.edges) {
      expect(edge.id).toBeTruthy();
      expect(edge.type).toBeTruthy();
      expect(edge.sourceOfTruth).toBeTruthy();
    }
  });

  it("clamps a client-requested maxNodes/maxEdges DOWN to the configured ceiling, never up", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, {
      pushOnWrite: false,
      migrationWarnOnly: false,
      staleAfterDays: 45,
      graphUi: { maxNodes: 2, maxEdges: 2 },
    });

    const result = await service.graphSnapshot({ maxNodes: 999, maxEdges: 999 });
    expect(result.clamps).toEqual({ maxNodes: 2, maxEdges: 2 });
    expect(result.nodes.length).toBeLessThanOrEqual(2);
    expect(result.edges.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);

    // A client requesting FEWER than the ceiling is honored as requested.
    const smaller = await service.graphSnapshot({ maxNodes: 1, maxEdges: 1 });
    expect(smaller.clamps).toEqual({ maxNodes: 1, maxEdges: 1 });
    expect(smaller.nodes.length).toBeLessThanOrEqual(1);
  });

  it("isGraphUiEnabled defaults to true and honors graphUi.enabled = false", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const defaultService = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
    expect(defaultService.isGraphUiEnabled()).toBe(true);

    const disabledService = new AnchorService(repo, {
      pushOnWrite: false,
      migrationWarnOnly: false,
      staleAfterDays: 45,
      graphUi: { enabled: false },
    });
    expect(disabledService.isGraphUiEnabled()).toBe(false);
  });

  it("graphSchema's node/edge type counts agree with graphSnapshot's totals for the same generation", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const schema = await service.graphSchema({});
    const snapshot = await service.graphSnapshot({ maxNodes: 500, maxEdges: 2000 });

    expect(schema.graphGeneration).toBe(snapshot.graphGeneration);
    const nodeTotal = Object.values(schema.nodeTypeCounts).reduce((sum, count) => sum + count, 0);
    const edgeTotal = Object.values(schema.edgeTypeCounts).reduce((sum, count) => sum + count, 0);
    expect(nodeTotal).toBe(snapshot.totals.matchingNodes);
    expect(edgeTotal).toBe(snapshot.totals.matchingEdges);
    expect(schema.identityContractVersion).toBe(2);
    expect(schema.features.graphUiEnabled).toBe(true);
    expect(schema.features.anchorSchemaMode).toBe("legacy");
    // Unscoped request reflects the whole graph: no project echoed.
    expect(schema.appliedFilters.project).toBeUndefined();
  });

  it("graphSchema echoes the resolved project filter in appliedFilters", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const schema = await service.graphSchema({ project: "demo" });
    expect(schema.appliedFilters.project).toBe("demo");
  });

  it("graphSchema's project-scoped counts agree with graphSnapshot's totals for the same project", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const schema = await service.graphSchema({ project: "demo" });
    // Large clamps so the snapshot isn't truncated: totals reflect the full
    // project-scoped (but unclamped) match, directly comparable to schema.
    const snapshot = await service.graphSnapshot({ project: "demo", maxNodes: 100000, maxEdges: 100000 });

    expect(schema.graphGeneration).toBe(snapshot.graphGeneration);
    const nodeTotal = Object.values(schema.nodeTypeCounts).reduce((sum, count) => sum + count, 0);
    const edgeTotal = Object.values(schema.edgeTypeCounts).reduce((sum, count) => sum + count, 0);
    expect(nodeTotal).toBe(snapshot.totals.matchingNodes);
    expect(edgeTotal).toBe(snapshot.totals.matchingEdges);
  });

  it("graphSnapshot echoes the trimmed q the filter actually applies", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const snapshot = await service.graphSnapshot({ q: "  demo  " });
    expect(snapshot.appliedFilters.q).toBe("demo");

    // An all-whitespace q is omitted entirely rather than echoed as "".
    const blank = await service.graphSnapshot({ q: "   " });
    expect(blank.appliedFilters.q).toBeUndefined();
  });

  it("labels a claim node with its bullet text, not its opaque id", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const snapshot = await service.graphSnapshot({ maxNodes: 100000, maxEdges: 100000 });
    const claim = snapshot.nodes.find((n) => n.type === "claim");
    expect(claim).toBeDefined();
    // PROJECT_CONTEXT's claim c-7f3a9d — labeled by its text, not "…#c-7f3a9d".
    expect(claim?.display).toBe("Effective certainty is never persisted.");
    expect(claim?.display).not.toContain("#");
  });

  it("labels a section node with its heading and backfills anchorName/project through the real service pipeline", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await repo.writePeopleRegistryRaw({ people: [], teams: [] });
    await repo.writeProjectMappingsRaw({ projects: [] });
    // A section node only materializes when a claim actually creates a
    // claim_section/section_anchor edge -- an ANNOTATED claim (like
    // PROJECT_CONTEXT's) only does that if one of its sources is itself a
    // section reference. An id-only (unannotated) claim is simpler: it always
    // anchors into its OWN containing section (see extractDocumentEdges'
    // "own section containment" branch), which is what this fixture exercises
    // (same pattern as the "GraphIndex id-only claim node" describe block).
    await repo.commitAnchor({
      name: "projects/demo/id-only.md",
      content: `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor with an id-only claim.
read_this_if:
  - Testing section node labeling.
last_validated: 2026-07-07
---

# Anchor With Id Only Claim

## Current State

- Legacy claim with a stable id but no provenance.
  {id: c-legacy1}
`,
    });
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const snapshot = await service.graphSnapshot({ maxNodes: 100000, maxEdges: 100000 });
    const section = snapshot.nodes.find((n) => n.type === "section");
    expect(section).toBeDefined();
    expect(section?.display).toBe("Current State");
    expect(section?.anchorName).toBe("projects/demo/id-only.md");
    expect(section?.project).toBe("demo");
  });

  it("graphSnapshot honors maxNodes: 0 as a metadata-only request", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const snapshot = await service.graphSnapshot({ maxNodes: 0, maxEdges: 0 });
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.edges).toEqual([]);
    // Counts still report the full graph, and truncation flags the drop.
    expect(snapshot.totals.matchingNodes).toBeGreaterThan(0);
    expect(snapshot.totals.returnedNodes).toBe(0);
    expect(snapshot.truncated).toBe(true);
  });

  it("normalizes a misconfigured graphUi ceiling so echoed clamps match what is enforced", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    // A negative ceiling is a misconfiguration: it must fall back to the
    // default rather than silently zeroing the graph, and the echoed clamp
    // must equal the enforced one (an integer), never the raw config value.
    const service = new AnchorService(repo, {
      pushOnWrite: false,
      migrationWarnOnly: false,
      staleAfterDays: 45,
      graphUi: { maxNodes: -5, maxEdges: 3.7 },
    });

    const snapshot = await service.graphSnapshot({});
    expect(snapshot.clamps.maxNodes).toBe(500); // negative -> default
    expect(snapshot.clamps.maxEdges).toBe(3); // 3.7 floored
    expect(Number.isInteger(snapshot.clamps.maxNodes)).toBe(true);
    expect(Number.isInteger(snapshot.clamps.maxEdges)).toBe(true);
  });

  it("keeps an id-bearing anchor's node seed unchanged across a rename (seed is keyed off the anchor_id, not the path)", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    // writeAnchor mint-on-create gives this a real anchor_id, so its canonical
    // node id is v2 (anchor:<anchor-id>) and rename-invariant.
    await service.writeAnchor({
      name: "projects/demo/old-name.md",
      content: PROJECT_CONTEXT,
      message: "test: add anchor before rename",
      approved: true,
    });
    const before = await service.graphSnapshot({});
    const beforeNode = before.nodes.find((node) => node.anchorName === "projects/demo/old-name.md");
    expect(beforeNode).toBeDefined();
    expect(beforeNode!.id.startsWith("anchor:a-")).toBe(true);

    const rename = await service.renameAnchor({
      from: "projects/demo/old-name.md",
      to: "projects/demo/new-name.md",
      approved: true,
    });
    expect(rename.version).toBeTruthy();

    const after = await service.graphSnapshot({});
    const afterNode = after.nodes.find((node) => node.anchorName === "projects/demo/new-name.md");
    expect(afterNode).toBeDefined();
    expect(afterNode!.id).toBe(beforeNode!.id);
    expect(afterNode!.seed).toEqual(beforeNode!.seed);
  });

  it("filters graphSnapshot nodes by project", async () => {
    const repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    await seedRepo(repo);
    const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

    const result = await service.graphSnapshot({ project: "demo" });
    const anchorNodes = result.nodes.filter((node) => node.anchorName);
    expect(anchorNodes.length).toBeGreaterThan(0);
    for (const node of anchorNodes) {
      expect(node.anchorName!.startsWith("projects/demo/")).toBe(true);
    }
  });
});
