import { describe, expect, it } from "vitest";

import {
  applyProjectionFilters,
  buildGraphProjection,
  clampProjectionSize,
  materializeGraphProjection,
  type ProjectionAnchorInput,
  type ProjectionClaimInput,
} from "../src/graph/projection.js";
import type { GraphEdge } from "../src/graph/model.js";

function edge(overrides: Partial<GraphEdge> & Pick<GraphEdge, "from" | "to" | "type">): GraphEdge {
  return { sourceOfTruth: "front-matter", ...overrides };
}

function anchor(overrides: Partial<ProjectionAnchorInput> & Pick<ProjectionAnchorInput, "anchorName" | "canonicalNodeId">): ProjectionAnchorInput {
  return { display: overrides.anchorName, ...overrides };
}

describe("materializeGraphProjection: isolated nodes", () => {
  it("materializes an anchor with zero edges as a first-class node", () => {
    const result = materializeGraphProjection({
      edges: [],
      anchors: [anchor({ anchorName: "projects/demo/a.md", canonicalNodeId: "anchor:projects/demo/a.md" })],
      claims: [],
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: "anchor:projects/demo/a.md", type: "anchor", display: "projects/demo/a.md" });
  });

  it("unions edge endpoints with the supplied anchor set rather than replacing it", () => {
    const result = materializeGraphProjection({
      edges: [edge({ from: "anchor:a.md", to: "project:demo", type: "anchor_project" })],
      anchors: [
        anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md", project: "demo" }),
        anchor({ anchorName: "b.md", canonicalNodeId: "anchor:b.md" }), // isolated: no edge mentions it
      ],
      claims: [],
    });
    const ids = new Set(result.nodes.map((node) => node.id));
    expect(ids.has("anchor:a.md")).toBe(true);
    expect(ids.has("project:demo")).toBe(true);
    expect(ids.has("anchor:b.md")).toBe(true);
    expect(result.nodes).toHaveLength(3);
  });
});

describe("materializeGraphProjection: coverage state", () => {
  it("attaches coverage state to anchor and claim nodes", () => {
    const result = materializeGraphProjection({
      edges: [],
      anchors: [anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md", coverageState: "structured" })],
      claims: [
        {
          anchorName: "a.md",
          claimId: "c-abc123",
          canonicalNodeId: "claim:a.md#c-abc123",
          coverageState: "partial",
        },
      ],
    });
    const anchorNode = result.nodes.find((node) => node.id === "anchor:a.md");
    const claimNode = result.nodes.find((node) => node.id === "claim:a.md#c-abc123");
    expect(anchorNode?.coverageState).toBe("structured");
    expect(claimNode?.coverageState).toBe("partial");
  });
});

describe("materializeGraphProjection: deterministic edge ids", () => {
  it("assigns the same edge ids across two independent builds over the same tree", () => {
    const edges: GraphEdge[] = [
      edge({ from: "anchor:a.md", to: "project:demo", type: "anchor_project" }),
      edge({ from: "anchor:a.md", to: "anchor:b.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
    ];
    const first = materializeGraphProjection({ edges, anchors: [], claims: [] });
    const second = materializeGraphProjection({ edges, anchors: [], claims: [] });
    expect(first.edges.map((e) => e.id)).toEqual(second.edges.map((e) => e.id));
  });

  it("gives structurally identical parallel edges distinct ids instead of colliding onto one", () => {
    const edges: GraphEdge[] = [
      edge({ from: "anchor:a.md", to: "anchor:b.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
      edge({ from: "anchor:a.md", to: "anchor:b.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
    ];
    const result = materializeGraphProjection({ edges, anchors: [], claims: [] });
    expect(result.edges).toHaveLength(2);
    const ids = result.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("clampProjectionSize", () => {
  it("drops nodes beyond maxNodes and their referencing edges, counting both", () => {
    const materialized = materializeGraphProjection({
      edges: [
        edge({ from: "anchor:a.md", to: "anchor:b.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
        edge({ from: "anchor:b.md", to: "anchor:c.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
      ],
      anchors: [
        anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md" }),
        anchor({ anchorName: "b.md", canonicalNodeId: "anchor:b.md" }),
        anchor({ anchorName: "c.md", canonicalNodeId: "anchor:c.md" }),
      ],
      claims: [],
    });
    expect(materialized.nodes).toHaveLength(3);
    expect(materialized.edges).toHaveLength(2);

    const clamped = clampProjectionSize(materialized.nodes, materialized.edges, { maxNodes: 2, maxEdges: 10 });
    expect(clamped.nodes).toHaveLength(2);
    // At least one edge referenced the dropped (lexicographically last) node.
    expect(clamped.totals.matchingNodes).toBe(3);
    expect(clamped.totals.returnedNodes).toBe(2);
    expect(clamped.edges.length).toBeLessThan(2);
    expect(clamped.truncated).toBe(true);
    expect(clamped.warnings.some((w) => w.includes("node"))).toBe(true);
  });

  it("also clamps edges directly beyond maxEdges, independent of the node clamp", () => {
    const materialized = materializeGraphProjection({
      edges: [
        edge({ from: "anchor:a.md", to: "anchor:b.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
        edge({ from: "anchor:a.md", to: "anchor:c.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
      ],
      anchors: [
        anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md" }),
        anchor({ anchorName: "b.md", canonicalNodeId: "anchor:b.md" }),
        anchor({ anchorName: "c.md", canonicalNodeId: "anchor:c.md" }),
      ],
      claims: [],
    });
    const clamped = clampProjectionSize(materialized.nodes, materialized.edges, { maxNodes: 10, maxEdges: 1 });
    expect(clamped.nodes).toHaveLength(3);
    expect(clamped.edges).toHaveLength(1);
    expect(clamped.totals.matchingEdges).toBe(2);
    expect(clamped.totals.returnedEdges).toBe(1);
    expect(clamped.truncated).toBe(true);
  });

  it("reports no truncation when nothing exceeds the clamps", () => {
    const materialized = materializeGraphProjection({
      edges: [],
      anchors: [anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md" })],
      claims: [],
    });
    const clamped = clampProjectionSize(materialized.nodes, materialized.edges, { maxNodes: 500, maxEdges: 2000 });
    expect(clamped.truncated).toBe(false);
    expect(clamped.warnings).toEqual([]);
  });
});

describe("applyProjectionFilters", () => {
  const materialized = materializeGraphProjection({
    edges: [
      edge({ from: "anchor:a.md", to: "project:demo", type: "anchor_project" }),
      edge({ from: "anchor:x.md", to: "project:other", type: "anchor_project" }),
    ],
    anchors: [
      anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md", project: "demo", coverageState: "structured" }),
      anchor({ anchorName: "x.md", canonicalNodeId: "anchor:x.md", project: "other", coverageState: "prose_only" }),
    ],
    claims: [],
  });

  it("keeps only nodes matching a project filter, but passes through nodes with no known project", () => {
    const filtered = applyProjectionFilters(materialized.nodes, materialized.edges, { project: "demo" });
    const ids = new Set(filtered.nodes.map((node) => node.id));
    expect(ids.has("anchor:a.md")).toBe(true);
    expect(ids.has("anchor:x.md")).toBe(false);
    // project:demo is derivable from its own id -> kept; project:other excluded.
    expect(ids.has("project:demo")).toBe(true);
    expect(ids.has("project:other")).toBe(false);
  });

  it("filters nodes by coverage state, excluding nodes with no coverage state at all", () => {
    const filtered = applyProjectionFilters(materialized.nodes, materialized.edges, { coverageStates: ["structured"] });
    const ids = new Set(filtered.nodes.map((node) => node.id));
    expect(ids.has("anchor:a.md")).toBe(true);
    expect(ids.has("anchor:x.md")).toBe(false);
    // project:demo has no coverage state -> dropped by an exclusive coverage filter.
    expect(ids.has("project:demo")).toBe(false);
  });

  it("filters nodes by a case-insensitive q substring match on display", () => {
    const filtered = applyProjectionFilters(materialized.nodes, materialized.edges, { q: "A.MD" });
    expect(filtered.nodes.map((node) => node.id)).toEqual(["anchor:a.md"]);
  });

  it("drops edges whose type does not match edgeTypes even if both endpoints remain", () => {
    const filtered = applyProjectionFilters(materialized.nodes, materialized.edges, { edgeTypes: ["anchor_anchor"] });
    expect(filtered.edges).toEqual([]);
    // Nodes are untouched by an edge-type filter.
    expect(filtered.nodes.length).toBe(materialized.nodes.length);
  });
});

describe("seeds: determinism and rename invariance", () => {
  it("gives the same node the same seed across two independent builds", () => {
    const build = () =>
      materializeGraphProjection({
        edges: [],
        anchors: [anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a-abc123", project: "demo" })],
        claims: [],
      });
    const first = build().nodes[0]!;
    const second = build().nodes[0]!;
    expect(first.seed).toEqual(second.seed);
  });

  it("keeps a node's seed unchanged when the anchor is renamed but its canonical (anchor_id-keyed) node id is unchanged", () => {
    // Simulates an id-bearing anchor being renamed: `anchorName` (the path)
    // changes, but the CANONICAL node id — keyed off the immutable anchor_id
    // — does not, so the seed (keyed off the canonical id) must not move.
    const before = materializeGraphProjection({
      edges: [],
      anchors: [
        anchor({ anchorName: "projects/demo/old-name.md", canonicalNodeId: "anchor:a-abc123", project: "demo" }),
      ],
      claims: [],
    }).nodes[0]!;
    const after = materializeGraphProjection({
      edges: [],
      anchors: [
        anchor({ anchorName: "projects/demo/new-name.md", canonicalNodeId: "anchor:a-abc123", project: "demo" }),
      ],
      claims: [],
    }).nodes[0]!;
    expect(after.seed).toEqual(before.seed);
  });

  it("biases same-project nodes measurably closer together than cross-project nodes, on average", () => {
    const projectA = Array.from({ length: 6 }, (_, i) =>
      anchor({ anchorName: `a${i}.md`, canonicalNodeId: `anchor:a-proj-a-${i}`, project: "project-a" }),
    );
    const projectB = Array.from({ length: 6 }, (_, i) =>
      anchor({ anchorName: `b${i}.md`, canonicalNodeId: `anchor:a-proj-b-${i}`, project: "project-b" }),
    );
    const result = materializeGraphProjection({ edges: [], anchors: [...projectA, ...projectB], claims: [] });
    const nodesA = result.nodes.filter((node) => node.project === "project-a");
    const nodesB = result.nodes.filter((node) => node.project === "project-b");

    const distance = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);

    const avgPairDistance = (nodes: typeof nodesA) => {
      let total = 0;
      let count = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          total += distance(nodes[i]!.seed, nodes[j]!.seed);
          count += 1;
        }
      }
      return total / count;
    };

    const withinA = avgPairDistance(nodesA);
    const withinB = avgPairDistance(nodesB);
    const acrossTotal = nodesA.flatMap((a) => nodesB.map((b) => distance(a.seed, b.seed)));
    const acrossAvg = acrossTotal.reduce((sum, d) => sum + d, 0) / acrossTotal.length;

    expect(withinA).toBeLessThan(acrossAvg);
    expect(withinB).toBeLessThan(acrossAvg);
  });
});

describe("buildGraphProjection: composition", () => {
  it("composes materialize + filter + clamp into one bounded projection", () => {
    const edges: GraphEdge[] = [
      edge({ from: "anchor:a.md", to: "project:demo", type: "anchor_project" }),
      edge({ from: "anchor:a.md", to: "anchor:b.md", type: "anchor_anchor", sourceOfTruth: "body-link" }),
    ];
    const anchors: ProjectionAnchorInput[] = [
      anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a.md", project: "demo", coverageState: "structured" }),
      anchor({ anchorName: "b.md", canonicalNodeId: "anchor:b.md", project: "demo", coverageState: "partial" }),
    ];
    const claims: ProjectionClaimInput[] = [];

    const projection = buildGraphProjection({
      edges,
      anchors,
      claims,
      filters: { project: "demo" },
      clamps: { maxNodes: 500, maxEdges: 2000 },
    });

    expect(projection.nodes.some((node) => node.id === "anchor:a.md")).toBe(true);
    expect(projection.truncated).toBe(false);
    expect(projection.totals.matchingNodes).toBe(projection.totals.returnedNodes);
  });
});

describe("materializeGraphProjection: section/milestone/task owner-anchor enrichment", () => {
  it("labels a section node with its heading text and backfills anchorName/project from the owning anchor", () => {
    const result = materializeGraphProjection({
      edges: [edge({ from: "section:a-abc123#Constraints", to: "anchor:a-abc123", type: "section_anchor" })],
      anchors: [anchor({ anchorName: "projects/demo/a.md", canonicalNodeId: "anchor:a-abc123", project: "demo" })],
      claims: [],
    });
    const section = result.nodes.find((node) => node.id === "section:a-abc123#Constraints");
    expect(section).toMatchObject({
      display: "Constraints",
      anchorName: "projects/demo/a.md",
      project: "demo",
    });
  });

  it("splits owner-vs-heading on the FIRST # so a heading that itself contains # is preserved intact", () => {
    const result = materializeGraphProjection({
      edges: [edge({ from: "section:a-abc123#C# notes", to: "anchor:a-abc123", type: "section_anchor" })],
      anchors: [anchor({ anchorName: "a.md", canonicalNodeId: "anchor:a-abc123" })],
      claims: [],
    });
    const section = result.nodes.find((node) => node.id === "section:a-abc123#C# notes");
    expect(section?.display).toBe("C# notes");
    expect(section?.anchorName).toBe("a.md");
  });

  it("backfills anchorName/project for milestone and task nodes the same way (display unchanged -- no title data available at this slice)", () => {
    const result = materializeGraphProjection({
      edges: [
        edge({ from: "milestone:a-abc123", to: "anchor:a-abc123", type: "milestone_anchor" }),
        edge({ from: "task:a-abc123#T-1", to: "milestone:a-abc123", type: "milestone_task" }),
      ],
      anchors: [anchor({ anchorName: "projects/demo/m1.md", canonicalNodeId: "anchor:a-abc123", project: "demo" })],
      claims: [],
    });
    const milestone = result.nodes.find((node) => node.id === "milestone:a-abc123");
    const task = result.nodes.find((node) => node.id === "task:a-abc123#T-1");
    expect(milestone).toMatchObject({ anchorName: "projects/demo/m1.md", project: "demo", display: "a-abc123" });
    expect(task).toMatchObject({ anchorName: "projects/demo/m1.md", project: "demo", display: "a-abc123#T-1" });
  });

  it("leaves a section/milestone/task node unenriched when its owning anchor is outside the supplied anchor set (e.g. a different project's scope)", () => {
    const result = materializeGraphProjection({
      edges: [edge({ from: "section:a-outside#Notes", to: "anchor:a-outside", type: "section_anchor" })],
      anchors: [], // owner not supplied -- as when a project-scoped snapshot excludes it
      claims: [],
    });
    const section = result.nodes.find((node) => node.id === "section:a-outside#Notes");
    expect(section?.anchorName).toBeUndefined();
    expect(section?.display).toBe("a-outside#Notes"); // unchanged fallback, no crash
  });
});
