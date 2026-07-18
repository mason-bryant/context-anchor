import { describe, expect, it } from "vitest";

import {
  coverageStyle,
  edgeStrokeStyle,
  filterOptionsFromSchema,
  graphFiltersFromUrlParams,
  graphHeaderSummary,
  graphSnapshotQueryParams,
  graphUrlParamsFromState,
  nodeTypeShape,
  pruneSelectionToAvailable,
  snapshotToCyElements,
  sortGraphTableRows,
  tableRowsFromSnapshot,
  type GraphTableRow,
} from "../src/ui/graph/viewModel.js";
import type { ProjectionEdge, ProjectionNode } from "../src/graph/projection.js";
import type { GraphSnapshotResult } from "../src/anchorService.js";

function node(overrides: Partial<ProjectionNode> & Pick<ProjectionNode, "id" | "type" | "display">): ProjectionNode {
  return {
    sourceOfTruth: "anchor",
    seed: { x: 0, y: 0 },
    properties: {},
    ...overrides,
  };
}

function edge(overrides: Partial<ProjectionEdge> & Pick<ProjectionEdge, "id" | "from" | "to" | "type">): ProjectionEdge {
  return {
    sourceOfTruth: "front-matter",
    confidence: 1,
    inferred: false,
    properties: {},
    ...overrides,
  };
}

function snapshot(nodes: ProjectionNode[], edges: ProjectionEdge[]): Pick<GraphSnapshotResult, "nodes" | "edges"> {
  return { nodes, edges };
}

describe("nodeTypeShape", () => {
  it("maps each node type to a shape per the visual grammar", () => {
    expect(nodeTypeShape("project")).toBe("round-rectangle");
    expect(nodeTypeShape("task")).toBe("round-rectangle");
    expect(nodeTypeShape("anchor")).toBe("rectangle");
    expect(nodeTypeShape("milestone")).toBe("diamond");
    expect(nodeTypeShape("claim")).toBe("ellipse");
    expect(nodeTypeShape("goal")).toBe("star");
    expect(nodeTypeShape("person")).toBe("ellipse");
    expect(nodeTypeShape("team")).toBe("ellipse");
    expect(nodeTypeShape("repo")).toBe("hexagon");
    expect(nodeTypeShape("path")).toBe("hexagon");
    expect(nodeTypeShape("pr")).toBe("hexagon");
    expect(nodeTypeShape("file")).toBe("hexagon");
    expect(nodeTypeShape("url")).toBe("hexagon");
    expect(nodeTypeShape("section")).toBe("hexagon");
  });
});

describe("coverageStyle", () => {
  it("returns undefined for a node with no coverage state", () => {
    expect(coverageStyle(undefined)).toBeUndefined();
  });

  it("maps structured to solid, partial to outline, prose_only to ghost", () => {
    expect(coverageStyle("structured")).toEqual({ treatment: "solid", warn: false });
    expect(coverageStyle("partial")).toEqual({ treatment: "outline", warn: false });
    expect(coverageStyle("prose_only")).toEqual({ treatment: "ghost", warn: false });
  });

  it("flags ambiguous/dangling/malformed with warn: true", () => {
    expect(coverageStyle("ambiguous")).toEqual({ treatment: "outline", warn: true });
    expect(coverageStyle("dangling")).toEqual({ treatment: "ghost", warn: true });
    expect(coverageStyle("malformed")).toEqual({ treatment: "ghost", warn: true });
  });
});

describe("edgeStrokeStyle", () => {
  it("treats authored facts (front-matter/registry/claim-annotation) as normal solid", () => {
    expect(edgeStrokeStyle("front-matter")).toEqual({ lineStyle: "solid", weight: "normal" });
    expect(edgeStrokeStyle("registry")).toEqual({ lineStyle: "solid", weight: "normal" });
    expect(edgeStrokeStyle("claim-annotation")).toEqual({ lineStyle: "solid", weight: "normal" });
  });

  it("treats containment as thin solid and body-link as dashed", () => {
    expect(edgeStrokeStyle("containment")).toEqual({ lineStyle: "solid", weight: "thin" });
    expect(edgeStrokeStyle("body-link")).toEqual({ lineStyle: "dashed", weight: "normal" });
  });
});

describe("snapshotToCyElements", () => {
  it("carries each node's seed as its initial Cytoscape position", () => {
    const snap = snapshot(
      [node({ id: "anchor:a.md", type: "anchor", display: "a.md", seed: { x: 12, y: -7 } })],
      [],
    );
    const elements = snapshotToCyElements(snap);
    expect(elements.nodes).toHaveLength(1);
    expect(elements.nodes[0].position).toEqual({ x: 12, y: -7 });
    expect(elements.nodes[0].data.id).toBe("anchor:a.md");
    expect(elements.nodes[0].data.shape).toBe("rectangle");
  });

  it("classifies coverage treatment onto node classes", () => {
    const snap = snapshot(
      [node({ id: "anchor:a.md", type: "anchor", display: "a.md", coverageState: "structured" })],
      [],
    );
    const elements = snapshotToCyElements(snap);
    expect(elements.nodes[0].classes).toContain("coverage-solid");
    expect(elements.nodes[0].data.coverageTreatment).toBe("solid");
    expect(elements.nodes[0].data.coverageWarn).toBe(false);
  });

  it("references valid endpoints: every edge's source/target resolves to an included node", () => {
    const snap = snapshot(
      [
        node({ id: "anchor:a.md", type: "anchor", display: "a.md" }),
        node({ id: "project:demo", type: "project", display: "demo" }),
      ],
      [edge({ id: "e1", from: "anchor:a.md", to: "project:demo", type: "anchor_project" })],
    );
    const elements = snapshotToCyElements(snap);
    expect(elements.edges).toHaveLength(1);
    expect(elements.edges[0].data.source).toBe("anchor:a.md");
    expect(elements.edges[0].data.target).toBe("project:demo");
  });

  it("drops an edge referencing a node outside this element set (defensive against a malformed/partial snapshot)", () => {
    const snap = snapshot(
      [node({ id: "anchor:a.md", type: "anchor", display: "a.md" })],
      [edge({ id: "e1", from: "anchor:a.md", to: "project:missing", type: "anchor_project" })],
    );
    const elements = snapshotToCyElements(snap);
    expect(elements.edges).toHaveLength(0);
  });

  it("sets openDetailAnchorName only for anchor/claim/milestone/task/section nodes carrying an anchorName", () => {
    const snap = snapshot(
      [
        node({ id: "anchor:a.md", type: "anchor", display: "a.md", anchorName: "a.md" }),
        node({ id: "project:demo", type: "project", display: "demo" }),
        node({ id: "milestone:a.md", type: "milestone", display: "a.md milestone", anchorName: "a.md" }),
        node({ id: "section:a.md#Constraints", type: "section", display: "Constraints", anchorName: "a.md" }),
        // A section outside the enrichment's project scope has no anchorName
        // backfilled (materializeGraphProjection's documented no-op case) --
        // still gated off even though "section" is in OPEN_DETAIL_NODE_TYPES.
        node({ id: "section:a-other#Notes", type: "section", display: "a-other#Notes" }),
      ],
      [],
    );
    const elements = snapshotToCyElements(snap);
    const byId = Object.fromEntries(elements.nodes.map((n) => [n.data.id, n.data]));
    expect(byId["anchor:a.md"].openDetailAnchorName).toBe("a.md");
    expect(byId["project:demo"].openDetailAnchorName).toBeUndefined();
    expect(byId["milestone:a.md"].openDetailAnchorName).toBe("a.md");
    expect(byId["section:a.md#Constraints"].openDetailAnchorName).toBe("a.md");
    expect(byId["section:a-other#Notes"].openDetailAnchorName).toBeUndefined();
  });

  it("handles an empty snapshot", () => {
    const elements = snapshotToCyElements(snapshot([], []));
    expect(elements.nodes).toEqual([]);
    expect(elements.edges).toEqual([]);
  });
});

describe("tableRowsFromSnapshot", () => {
  it("derives one row per node with the accessible fields", () => {
    const snap = snapshot(
      [
        node({ id: "anchor:a.md", type: "anchor", display: "a.md", project: "demo", coverageState: "structured", anchorName: "a.md" }),
      ],
      [],
    );
    const rows = tableRowsFromSnapshot(snap);
    expect(rows).toEqual([
      { id: "anchor:a.md", type: "anchor", display: "a.md", project: "demo", coverageState: "structured", openDetailAnchorName: "a.md" },
    ]);
  });

  it("handles an empty snapshot", () => {
    expect(tableRowsFromSnapshot(snapshot([], []))).toEqual([]);
  });
});

describe("sortGraphTableRows", () => {
  const rows: GraphTableRow[] = [
    { id: "b", type: "anchor", display: "Bravo", project: "zzz" },
    { id: "a", type: "anchor", display: "Alpha", project: "aaa" },
    { id: "c", type: "anchor", display: "Charlie" },
  ];

  it("sorts ascending by the given column and puts rows missing the field last", () => {
    const sorted = sortGraphTableRows(rows, "project");
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortGraphTableRows(rows, "display");
    expect(rows).toEqual(copy);
  });
});

describe("graphSnapshotQueryParams", () => {
  it("builds params only for filters actually set", () => {
    expect(graphSnapshotQueryParams({})).toEqual({});
    expect(
      graphSnapshotQueryParams({
        project: " demo ",
        nodeTypes: ["anchor", "task"],
        edgeTypes: ["depends_on"],
        coverageStates: ["structured", "partial"],
        q: " roadmap ",
        maxNodes: 100,
        maxEdges: 400,
      }),
    ).toEqual({
      project: "demo",
      nodeTypes: "anchor,task",
      edgeTypes: "depends_on",
      coverage: "structured,partial",
      q: "roadmap",
      maxNodes: "100",
      maxEdges: "400",
    });
  });
});

describe("filterOptionsFromSchema", () => {
  it("derives sorted node/edge type option lists from schema counts", () => {
    const options = filterOptionsFromSchema({
      nodeTypeCounts: { task: 3, anchor: 5 },
      edgeTypeCounts: { depends_on: 2, anchor_project: 1 },
    });
    expect(options.nodeTypes).toEqual(["anchor", "task"]);
    expect(options.edgeTypes).toEqual(["anchor_project", "depends_on"]);
  });

  it("handles empty schema counts", () => {
    const options = filterOptionsFromSchema({ nodeTypeCounts: {}, edgeTypeCounts: {} });
    expect(options.nodeTypes).toEqual([]);
    expect(options.edgeTypes).toEqual([]);
  });
});

describe("pruneSelectionToAvailable", () => {
  it("drops selected values the new schema no longer offers, preserving surviving order", () => {
    // e.g. after switching to a project with no milestones, "milestone" is gone.
    expect(pruneSelectionToAvailable(["milestone", "anchor"], ["anchor", "task", "claim"])).toEqual(["anchor"]);
  });

  it("keeps every still-available selection and tolerates an undefined selection", () => {
    expect(pruneSelectionToAvailable(["anchor", "task"], ["anchor", "task", "claim"])).toEqual(["anchor", "task"]);
    expect(pruneSelectionToAvailable(undefined, ["anchor"])).toEqual([]);
    expect(pruneSelectionToAvailable(["anchor"], [])).toEqual([]);
  });
});

describe("graphHeaderSummary", () => {
  it("passes through returned/matching counts and the truncation flag", () => {
    const summary = graphHeaderSummary({
      totals: { matchingNodes: 500, returnedNodes: 200, matchingEdges: 900, returnedEdges: 400 },
      truncated: true,
    });
    expect(summary).toEqual({
      returnedNodes: 200,
      matchingNodes: 500,
      returnedEdges: 400,
      matchingEdges: 900,
      truncated: true,
    });
  });
});

describe("graph URL state round-trip", () => {
  it("round-trips filters, sort, and selection through URL query params", () => {
    const state = {
      project: "anchor-mcp",
      nodeTypes: ["anchor", "claim"] as const,
      edgeTypes: ["depends_on"] as const,
      coverageStates: ["structured", "partial"] as const,
      q: "roadmap",
      sortKey: "display" as const,
      sortDir: "desc" as const,
      selectedId: "anchor:a-abc123",
    };
    const params = graphUrlParamsFromState(state);
    const restored = graphFiltersFromUrlParams((key) => params[key] ?? null);
    expect(restored).toEqual(state);
  });

  it("omits every key (including default sort) when serializing empty/default state", () => {
    expect(graphUrlParamsFromState({})).toEqual({});
    expect(graphUrlParamsFromState({ sortKey: "type", sortDir: "asc" })).toEqual({});
  });

  it("parses nothing from an empty URL", () => {
    expect(graphFiltersFromUrlParams(() => null)).toEqual({});
  });

  it("drops an unknown coverage state or sort key instead of throwing, matching the ES5 mirror's forgiving URL policy", () => {
    const restored = graphFiltersFromUrlParams((key) => {
      if (key === "graphCoverage") return "structured,not_a_real_state,dangling";
      if (key === "graphSort") return "not_a_real_column";
      return null;
    });
    expect(restored.coverageStates).toEqual(["structured", "dangling"]);
    expect(restored.sortKey).toBeUndefined();
  });

  it("deduplicates repeated node/edge/coverage tokens from the URL in order", () => {
    const restored = graphFiltersFromUrlParams((key) => {
      if (key === "graphNodeTypes") return "anchor,task,anchor";
      if (key === "graphCoverage") return "dangling,dangling,malformed";
      return null;
    });
    expect(restored.nodeTypes).toEqual(["anchor", "task"]);
    expect(restored.coverageStates).toEqual(["dangling", "malformed"]);
  });

  it("trims whitespace-padded project, search, and selection values when parsing from the URL", () => {
    const restored = graphFiltersFromUrlParams((key) => {
      if (key === "graphProject") return "  anchor-mcp  ";
      if (key === "graphSearch") return "  roadmap  ";
      if (key === "graphSelected") return "  anchor:a-abc123  ";
      return null;
    });
    expect(restored.project).toBe("anchor-mcp");
    expect(restored.q).toBe("roadmap");
    expect(restored.selectedId).toBe("anchor:a-abc123");

    const whitespaceOnly = graphFiltersFromUrlParams((key) =>
      key === "graphProject" || key === "graphSearch" || key === "graphSelected" ? "   " : null,
    );
    expect(whitespaceOnly.project).toBeUndefined();
    expect(whitespaceOnly.q).toBeUndefined();
    expect(whitespaceOnly.selectedId).toBeUndefined();
  });

  it("accepts node/edge type tokens as-is (no fixed vocabulary — pruneSelectionToAvailable is the real gatekeeper)", () => {
    const restored = graphFiltersFromUrlParams((key) => (key === "graphNodeTypes" ? "anchor,not_a_real_type" : null));
    expect(restored.nodeTypes).toEqual(["anchor", "not_a_real_type"]);
  });

  it("ignores an invalid sortDir instead of restoring a bogus value", () => {
    const restored = graphFiltersFromUrlParams((key) => (key === "graphSortDir" ? "sideways" : null));
    expect(restored.sortDir).toBeUndefined();
  });
});
