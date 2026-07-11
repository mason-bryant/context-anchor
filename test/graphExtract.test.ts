import { describe, expect, it } from "vitest";

import {
  extractBodyLinkEdges,
  extractClaimEdges,
  extractDocumentEdges,
  extractLiteralRelationsEdges,
  extractMilestoneEdges,
  extractProjectEdges,
  extractRegistryPersonProjectEdges,
  extractRegistryProjectRepoEdges,
  extractRelationsEdges,
  extractRoadmapGoalEdges,
  type DocumentInput,
  type ExtractDocumentEdgesContext,
} from "../src/graph/extract.js";
import { buildPeopleIndex } from "../src/peopleRegistry.js";
import type { PeopleRegistry, ProjectMappings } from "../src/types.js";

const NO_MAPPINGS: ProjectMappings = { projects: [], claimSourceTypes: [] };
const NO_PEOPLE: PeopleRegistry = { people: [], teams: [] };

function makeCtx(overrides: Partial<ExtractDocumentEdgesContext> = {}): ExtractDocumentEdgesContext {
  const anchorNames = overrides.anchorNames ?? new Set<string>();
  const peopleRegistry = overrides.peopleRegistry ?? NO_PEOPLE;
  return {
    anchorNames,
    resolveAnchorName: (value: string) => {
      const trimmed = value.trim();
      if (anchorNames.has(trimmed)) return trimmed;
      const withMd = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      return anchorNames.has(withMd) ? withMd : undefined;
    },
    getAnchorSectionTitles: () => undefined,
    resolveProjectSlug: (slug: string) => slug.trim() || undefined,
    peopleRegistry,
    peopleIndex: buildPeopleIndex(peopleRegistry),
    mappings: overrides.mappings ?? NO_MAPPINGS,
    ...overrides,
  };
}

function doc(overrides: Partial<DocumentInput> & { anchorName: string }): DocumentInput {
  return {
    frontmatter: {},
    body: "",
    content: "",
    ...overrides,
  };
}

describe("extractProjectEdges", () => {
  it("emits anchor -> project for a mapped project slug", () => {
    const mappings: ProjectMappings = {
      projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: [] }] }],
      claimSourceTypes: [],
    };
    const ctx = makeCtx({ mappings });
    const d = doc({ anchorName: "projects/demo/demo-project-context.md", frontmatter: { project: ["demo"] } });
    const edges = extractProjectEdges(d, ctx);
    expect(edges).toEqual([
      { from: "anchor:projects/demo/demo-project-context.md", to: "project:demo", type: "anchor_project", sourceOfTruth: "front-matter" },
    ]);
  });

  it("still emits an edge for an unmapped project slug (front matter is source of truth for membership)", () => {
    const ctx = makeCtx();
    const d = doc({ anchorName: "projects/demo/demo-project-context.md", frontmatter: { project: "demo" } });
    const edges = extractProjectEdges(d, ctx);
    expect(edges).toEqual([
      { from: "anchor:projects/demo/demo-project-context.md", to: "project:demo", type: "anchor_project", sourceOfTruth: "front-matter" },
    ]);
  });

  it("returns no edges when front matter has no project", () => {
    const ctx = makeCtx();
    const d = doc({ anchorName: "shared/foo.md", frontmatter: {} });
    expect(extractProjectEdges(d, ctx)).toEqual([]);
  });

  it("resolves an alias slug to the canonical project node via ctx.resolveProjectSlug (GraphIndex wires this to buildProjectAliasIndex)", () => {
    const ctx = makeCtx({ resolveProjectSlug: (slug) => (slug === "old-name" ? "demo" : slug) });
    const d = doc({ anchorName: "projects/demo/legacy-anchor.md", frontmatter: { project: ["old-name"] } });
    const edges = extractProjectEdges(d, ctx);
    expect(edges).toEqual([
      { from: "anchor:projects/demo/legacy-anchor.md", to: "project:demo", type: "anchor_project", sourceOfTruth: "front-matter" },
    ]);
  });
});

describe("extractRelationsEdges", () => {
  it("resolves literal relations targets to anchor -> anchor edges", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({ anchorNames });
    const d = doc({
      anchorName: "projects/demo/a.md",
      frontmatter: { relations: { depends_on: ["projects/demo/b"] } },
    });
    const edges = extractRelationsEdges(d, ctx);
    expect(edges).toEqual([
      { from: "anchor:projects/demo/a.md", to: "anchor:projects/demo/b.md", type: "anchor_anchor", sourceOfTruth: "front-matter" },
    ]);
  });

  it("emits a milestone -> goal edge (not a literal anchor_anchor target) for goal_ids on a project-milestone anchor", () => {
    const ctx = makeCtx();
    const d = doc({
      anchorName: "projects/demo/milestones/m1.md",
      frontmatter: { type: "project-milestone", project: ["demo"], relations: { goal_ids: ["G-001"] } },
    });
    const edges = extractRelationsEdges(d, ctx);
    expect(edges).toEqual([
      {
        from: "milestone:projects/demo/milestones/m1.md",
        to: "goal:G-001",
        type: "milestone_goal",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("skips relation targets that do not resolve to a known anchor", () => {
    const ctx = makeCtx({ anchorNames: new Set(["projects/demo/a.md"]) });
    const d = doc({
      anchorName: "projects/demo/a.md",
      frontmatter: { relations: { depends_on: ["projects/demo/missing"] } },
    });
    expect(extractRelationsEdges(d, ctx)).toEqual([]);
  });
});

describe("extractLiteralRelationsEdges", () => {
  it("does NOT resolve goal_ids on project-milestone to the roadmap sibling (literal semantics for findReferencingAnchorMetas parity)", () => {
    const d = doc({
      anchorName: "projects/demo/milestones/m1.md",
      frontmatter: { type: "project-milestone", project: ["demo"], relations: { goal_ids: ["G-001"] } },
    });
    const edges = extractLiteralRelationsEdges(d);
    expect(edges).toEqual([{ from: "projects/demo/milestones/m1.md", to: "G-001.md", kind: "goal_ids" }]);
  });

  it("normalizes targets with a trailing .md appended if missing", () => {
    const d = doc({
      anchorName: "projects/demo/a.md",
      frontmatter: { relations: { depends_on: ["projects/demo/b", "projects/demo/c.md"] } },
    });
    const edges = extractLiteralRelationsEdges(d);
    expect(edges).toEqual([
      { from: "projects/demo/a.md", to: "projects/demo/b.md", kind: "depends_on" },
      { from: "projects/demo/a.md", to: "projects/demo/c.md", kind: "depends_on" },
    ]);
  });
});

describe("extractMilestoneEdges", () => {
  it("emits milestone -> anchor containment, milestone -> task containment, and task -> owner edges", () => {
    const peopleRegistry: PeopleRegistry = { people: [{ id: "alice", displayName: "Alice" }], teams: [] };
    const ctx = makeCtx({ peopleRegistry });
    const d = doc({
      anchorName: "projects/demo/milestones/m1.md",
      frontmatter: {
        type: "project-milestone",
        tasks: [{ id: "T-1", title: "Do a thing", status: "todo", owner: "alice" }],
      },
    });
    const edges = extractMilestoneEdges(d, ctx);
    expect(edges).toEqual([
      {
        from: "milestone:projects/demo/milestones/m1.md",
        to: "anchor:projects/demo/milestones/m1.md",
        type: "milestone_anchor",
        sourceOfTruth: "containment",
      },
      {
        from: "milestone:projects/demo/milestones/m1.md",
        to: "task:projects/demo/milestones/m1.md#T-1",
        type: "milestone_task",
        sourceOfTruth: "front-matter",
      },
      {
        from: "task:projects/demo/milestones/m1.md#T-1",
        to: "person:alice",
        type: "task_owner",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("still emits milestone -> task containment when a task owner does not resolve to a known person or team", () => {
    const ctx = makeCtx();
    const d = doc({
      anchorName: "projects/demo/milestones/m1.md",
      frontmatter: {
        type: "project-milestone",
        tasks: [{ id: "T-1", title: "Do a thing", status: "todo", owner: "nobody" }],
      },
    });
    const edges = extractMilestoneEdges(d, ctx);
    expect(edges).toEqual([
      {
        from: "milestone:projects/demo/milestones/m1.md",
        to: "anchor:projects/demo/milestones/m1.md",
        type: "milestone_anchor",
        sourceOfTruth: "containment",
      },
      {
        from: "milestone:projects/demo/milestones/m1.md",
        to: "task:projects/demo/milestones/m1.md#T-1",
        type: "milestone_task",
        sourceOfTruth: "front-matter",
      },
    ]);
  });

  it("returns no edges for a non-milestone anchor", () => {
    const ctx = makeCtx();
    const d = doc({ anchorName: "shared/foo.md", frontmatter: {} });
    expect(extractMilestoneEdges(d, ctx)).toEqual([]);
  });
});

describe("extractRoadmapGoalEdges", () => {
  it("emits anchor -> goal containment edges for goal headings in a roadmap anchor", () => {
    const content = `---
type: project-roadmap
---

## Goals

### Goal G-001 -- Do the thing

Some text.
`;
    const d = doc({ anchorName: "projects/demo/demo-roadmap.md", frontmatter: { type: "project-roadmap" }, content });
    const edges = extractRoadmapGoalEdges(d);
    expect(edges).toEqual([
      { from: "anchor:projects/demo/demo-roadmap.md", to: "goal:G-001", type: "roadmap_goal", sourceOfTruth: "containment" },
    ]);
  });

  it("returns no edges for a non-roadmap anchor", () => {
    const d = doc({ anchorName: "shared/foo.md", frontmatter: {}, content: "" });
    expect(extractRoadmapGoalEdges(d)).toEqual([]);
  });
});

describe("extractRegistryPersonProjectEdges / extractRegistryProjectRepoEdges", () => {
  it("emits person/team -> project edges from RACI associations", () => {
    const registry: PeopleRegistry = {
      people: [{ id: "alice", displayName: "Alice", projects: [{ project: "demo", role: "responsible" }] }],
      teams: [{ id: "core", displayName: "Core", projects: [{ project: "demo", role: "informed" }] }],
    };
    const edges = extractRegistryPersonProjectEdges(registry);
    expect(edges).toEqual([
      { from: "person:alice", to: "project:demo", type: "person_project", sourceOfTruth: "registry" },
      { from: "team:core", to: "project:demo", type: "team_project", sourceOfTruth: "registry" },
    ]);
  });

  it("emits project -> repo and repo -> path edges from project-mappings", () => {
    const mappings: ProjectMappings = {
      projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: ["src/foo", "src/bar"] }] }],
      claimSourceTypes: [],
    };
    const edges = extractRegistryProjectRepoEdges(mappings);
    expect(edges).toEqual([
      { from: "project:demo", to: "repo:repo-a", type: "project_repo", sourceOfTruth: "registry" },
      { from: "repo:repo-a", to: "path:repo-a:src/foo", type: "repo_path", sourceOfTruth: "registry" },
      { from: "repo:repo-a", to: "path:repo-a:src/bar", type: "repo_path", sourceOfTruth: "registry" },
    ]);
  });
});

describe("extractBodyLinkEdges", () => {
  it("resolves a markdown link that points at a real anchor name", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({ anchorNames });
    const d = doc({
      anchorName: "projects/demo/a.md",
      body: "See [the other anchor](projects/demo/b.md) for details.",
    });
    const edges = extractBodyLinkEdges(d, ctx);
    expect(edges).toEqual([
      { from: "anchor:projects/demo/a.md", to: "anchor:projects/demo/b.md", type: "anchor_anchor", sourceOfTruth: "body-link" },
    ]);
  });

  it("ignores external (http) links and self-links", () => {
    const anchorNames = new Set(["projects/demo/a.md"]);
    const ctx = makeCtx({ anchorNames });
    const d = doc({
      anchorName: "projects/demo/a.md",
      body: "[external](https://example.com) and [self](projects/demo/a.md)",
    });
    expect(extractBodyLinkEdges(d, ctx)).toEqual([]);
  });

  it("ignores links that do not resolve to a known anchor", () => {
    const ctx = makeCtx({ anchorNames: new Set(["projects/demo/a.md"]) });
    const d = doc({ anchorName: "projects/demo/a.md", body: "[missing](projects/demo/missing.md)" });
    expect(extractBodyLinkEdges(d, ctx)).toEqual([]);
  });
});

describe("extractClaimEdges", () => {
  const content = `---
type: context-anchor
---

## Current State

- Effective certainty is never persisted.
  {src: PR #55; observed: 2026-07-07; conf: high; id: c-7f3a9d}
- Someone told me this in passing.
  {src: trust me bro; kind: trust-me-bro; person: alice; observed: 2026-07-07; conf: high; id: c-abc999}
- This claim has no id and should not produce a node.
`;

  it("emits claim -> source edges for PR/file/anchor/url source rows", () => {
    const mappings: ProjectMappings = {
      projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: [] }] }],
      claimSourceTypes: [],
    };
    const ctx = makeCtx({ mappings });
    const d = doc({ anchorName: "projects/demo/a.md", content });
    const edges = extractClaimEdges(d, ctx);
    expect(edges).toContainEqual({
      from: "claim:projects/demo/a.md#c-7f3a9d",
      to: "pr:repo-a#55",
      type: "claim_source",
      sourceOfTruth: "claim-annotation",
    });
  });

  it("emits a claim -> person edge for a trust-me-bro row (person node only, no phantom source node)", () => {
    const peopleRegistry: PeopleRegistry = { people: [{ id: "alice", displayName: "Alice" }], teams: [] };
    const ctx = makeCtx({ peopleRegistry });
    const d = doc({ anchorName: "projects/demo/a.md", content });
    const edges = extractClaimEdges(d, ctx);
    const personEdges = edges.filter((edge) => edge.type === "claim_person");
    // Only the trust-me-bro claim (c-abc999) carries a `person` key; the
    // PR-sourced claim (c-7f3a9d) has none, so it contributes no person edge.
    expect(personEdges).toEqual([
      { from: "claim:projects/demo/a.md#c-abc999", to: "person:alice", type: "claim_person", sourceOfTruth: "claim-annotation" },
    ]);
    // trust-me-bro with no artifact src produces ONLY the person node/edge,
    // never a phantom claim_source edge for the same row.
    const sourceEdgesForTrustMeBro = edges.filter(
      (edge) => edge.from === "claim:projects/demo/a.md#c-abc999" && edge.type === "claim_source",
    );
    expect(sourceEdgesForTrustMeBro).toEqual([]);
  });

  it("emits claim -> section and section -> anchor containment edges for a section reference", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({
      anchorNames,
      getAnchorSectionTitles: (name: string) => (name === "projects/demo/b.md" ? new Set(["Decisions"]) : undefined),
    });
    const sectionContent = `---
type: context-anchor
---

## Current State

- Cites a section of another anchor.
  {src: projects/demo/b.md#Decisions; observed: 2026-07-07; conf: medium; id: c-abc123}
`;
    const d = doc({ anchorName: "projects/demo/a.md", content: sectionContent });
    const edges = extractClaimEdges(d, ctx);
    expect(edges).toEqual([
      {
        from: "claim:projects/demo/a.md#c-abc123",
        to: "section:projects/demo/b.md#Decisions",
        type: "claim_section",
        sourceOfTruth: "claim-annotation",
      },
      {
        from: "section:projects/demo/b.md#Decisions",
        to: "anchor:projects/demo/b.md",
        type: "section_anchor",
        sourceOfTruth: "containment",
      },
    ]);
  });

  it("never emits an edge for an unannotated or id-less claim", () => {
    const ctx = makeCtx();
    const noIdContent = `---
type: context-anchor
---

## Current State

- This has a source but no id.
  {src: PR #1; observed: 2026-07-07; conf: high}
- This is a plain bullet.
`;
    const d = doc({ anchorName: "projects/demo/a.md", content: noIdContent });
    expect(extractClaimEdges(d, ctx)).toEqual([]);
  });

  it("emits derived_from and contradicts claim -> claim edges (WP5)", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({ anchorNames });
    const edgeContent = `---
type: context-anchor
---

## Current State

- Downstream claim with edges.
  {src: PR #9; observed: 2026-07-08; conf: high; id: c-down01; derived_from: projects/demo/b.md#c-up0001; contradicts: #c-rival1}
- The rival claim in the same anchor.
  {src: PR #10; observed: 2026-07-08; conf: high; id: c-rival1}
`;
    const d = doc({ anchorName: "projects/demo/a.md", content: edgeContent });
    const edges = extractClaimEdges(d, ctx);
    expect(edges).toContainEqual({
      from: "claim:projects/demo/a.md#c-down01",
      to: "claim:projects/demo/b.md#c-up0001",
      type: "derived_from",
      sourceOfTruth: "claim-annotation",
    });
    // Same-anchor shorthand `#c-rival1` resolves against the owning anchor.
    expect(edges).toContainEqual({
      from: "claim:projects/demo/a.md#c-down01",
      to: "claim:projects/demo/a.md#c-rival1",
      type: "contradicts",
      sourceOfTruth: "claim-annotation",
    });
  });

  it("skips a derived_from edge whose anchor side does not resolve", () => {
    const ctx = makeCtx({ anchorNames: new Set(["projects/demo/a.md"]) });
    const content = `---
type: context-anchor
---

## Current State

- Cites a ghost anchor.
  {src: PR #1; observed: 2026-07-08; conf: high; id: c-only01; derived_from: projects/demo/ghost.md#c-up0001}
`;
    const d = doc({ anchorName: "projects/demo/a.md", content });
    const edges = extractClaimEdges(d, ctx);
    expect(edges.some((edge) => edge.type === "derived_from")).toBe(false);
  });
});

describe("extractDocumentEdges", () => {
  it("concatenates every per-document extractor's edges", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const mappings: ProjectMappings = {
      projects: [{ project: "demo", repos: [{ repo: "repo-a", paths: [] }] }],
      claimSourceTypes: [],
    };
    const ctx = makeCtx({ anchorNames, mappings });
    const content = `---
project:
  - demo
relations:
  depends_on:
    - projects/demo/b
---

## Current State

- See [the other anchor](projects/demo/b.md).
- Cites a PR.
  {src: PR #1; observed: 2026-07-07; conf: high; id: c-111111}
`;
    const d = doc({ anchorName: "projects/demo/a.md", frontmatter: { project: ["demo"], relations: { depends_on: ["projects/demo/b"] } }, content, body: content });
    const edges = extractDocumentEdges(d, ctx);
    const types = new Set(edges.map((edge) => edge.type));
    expect(types.has("anchor_project")).toBe(true);
    expect(types.has("anchor_anchor")).toBe(true);
    expect(types.has("claim_source")).toBe(true);
  });
});
