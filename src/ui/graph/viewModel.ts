/**
 * Pure, browser-free view-model helpers for the Graph tab (Goal 1: 2D graph
 * visualization UI). Mirrors the split `src/ui/viewModel.ts` already
 * establishes for the Coverage tab: the logic that decides "what does a
 * snapshot look like once it's shaped for rendering" lives here, tested
 * without a browser or a Cytoscape instance; `UI_JS` (a plain ES5 string —
 * there is no bundler, see `src/ui/assets.ts`) re-implements the same rules
 * inline for the actual DOM/Cytoscape wiring, the same way it already
 * mirrors `filterCoverageRecords`/`coverageQueryParams` from
 * `src/ui/viewModel.ts`. Keeping the rules here means the *mapping rules*
 * (type -> shape, coverage -> style, provenance -> stroke) are unit-tested
 * once, in one place, even though the runtime consumer is a hand-written JS
 * string.
 */

import type { GraphEdgeType, GraphNodeType, GraphEdgeSourceOfTruth } from "../../graph/model.js";
import type { CoverageState } from "../../graph/coverage.js";
import type { ProjectionEdge, ProjectionNode } from "../../graph/projection.js";
import type { GraphSchemaResult, GraphSnapshotResult } from "../../anchorService.js";

// ---------------------------------------------------------------------------
// Visual grammar: node shape by type, coverage treatment, edge stroke.
// ---------------------------------------------------------------------------

/** Cytoscape core node shapes (`node-shape` style values) this app actually uses — a subset of what Cytoscape supports, per the Graph tab's visual-grammar spec. */
export type GraphNodeShape =
  | "round-rectangle"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "star"
  | "hexagon";

/** Node shape by `GraphNodeType`, per the Graph tab's visual grammar: project/task read as "boxy" (round-rectangle), anchor as a plain rectangle, milestone as a diamond, claim/person/team as an ellipse, goal as a star, everything else (repo/path/pr/file/url/section) as a hexagon. Shape is never the only signal for a distinction that also carries a coverage or provenance treatment — see `coverageStyle`/`edgeStrokeStyle` below. */
export function nodeTypeShape(type: GraphNodeType): GraphNodeShape {
  switch (type) {
    case "project":
      return "round-rectangle";
    case "task":
      return "round-rectangle";
    case "anchor":
      return "rectangle";
    case "milestone":
      return "diamond";
    case "claim":
      return "ellipse";
    case "goal":
      return "star";
    case "person":
      return "ellipse";
    case "team":
      return "ellipse";
    default:
      // repo | path | pr | file | url | section
      return "hexagon";
  }
}

/** The three coverage-treatment buckets the Graph tab renders (fill weight, independent of color) — `structured` reads as solid/filled, `partial`/`ambiguous` as outlined/lighter, `prose_only`/`dangling`/`malformed` as translucent/"ghost". Only anchor and claim nodes carry a `coverageState`; every other node type gets `undefined` (no coverage treatment applies). */
export type CoverageTreatment = "solid" | "outline" | "ghost";

export type CoverageStyle = {
  treatment: CoverageTreatment;
  warn: boolean;
};

/** Maps a node's `coverageState` (anchor/claim nodes only) to its fill-weight treatment plus a warn flag. Returns `undefined` for a node with no coverage state (every non-anchor/claim node, and an anchor/claim the projection never scored). */
export function coverageStyle(coverageState: CoverageState | undefined): CoverageStyle | undefined {
  if (coverageState === undefined) {
    return undefined;
  }
  switch (coverageState) {
    case "structured":
      return { treatment: "solid", warn: false };
    case "partial":
      return { treatment: "outline", warn: false };
    case "ambiguous":
      return { treatment: "outline", warn: true };
    case "prose_only":
      return { treatment: "ghost", warn: false };
    case "dangling":
    case "malformed":
      return { treatment: "ghost", warn: true };
    default: {
      const exhaustive: never = coverageState;
      return exhaustive;
    }
  }
}

/** Edge stroke styles the Graph tab's legend and canvas both use. `containment` gets its own thin/neutral bucket (structural, not an authored fact) distinct from the other "solid" provenances (authored front-matter/registry/claim-annotation facts). */
export type EdgeStrokeStyle = {
  lineStyle: "solid" | "dashed";
  /** "thin" only for containment edges (structural, de-emphasized); every other bucket is the normal edge width. */
  weight: "normal" | "thin";
};

/** Maps an edge's `sourceOfTruth` to its stroke treatment: authored facts (front-matter, registry, claim-annotation) are solid; structural containment is a thin neutral solid; body-link (a markdown link the extractor found, not an explicit relation) is dashed. */
export function edgeStrokeStyle(sourceOfTruth: GraphEdgeSourceOfTruth): EdgeStrokeStyle {
  switch (sourceOfTruth) {
    case "containment":
      return { lineStyle: "solid", weight: "thin" };
    case "body-link":
      return { lineStyle: "dashed", weight: "normal" };
    case "front-matter":
    case "registry":
    case "claim-annotation":
      return { lineStyle: "solid", weight: "normal" };
    default: {
      const exhaustive: never = sourceOfTruth;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Snapshot -> Cytoscape elements.
// ---------------------------------------------------------------------------

export type CyNodeData = {
  id: string;
  label: string;
  type: GraphNodeType;
  shape: GraphNodeShape;
  coverageState?: CoverageState;
  coverageTreatment?: CoverageTreatment;
  coverageWarn: boolean;
  sourceOfTruth: ProjectionNode["sourceOfTruth"];
  project?: string;
  anchorName?: string;
  /** Set only for anchor/claim/milestone/task/section nodes carrying an `anchorName` — the Graph tab's "Open detail" deep link target (`?anchor=<name>`). */
  openDetailAnchorName?: string;
};

export type CyNodeElement = {
  group: "nodes";
  data: CyNodeData;
  position: { x: number; y: number };
  classes: string;
};

export type CyEdgeData = {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  sourceOfTruth: GraphEdgeSourceOfTruth;
  lineStyle: "solid" | "dashed";
  weight: "normal" | "thin";
};

export type CyEdgeElement = {
  group: "edges";
  data: CyEdgeData;
  classes: string;
};

export type CyElements = {
  nodes: CyNodeElement[];
  edges: CyEdgeElement[];
};

/** Node types whose "Open detail" deep link is meaningful (they resolve to an anchor the existing `?anchor=` deep-link mechanism can render). `section` joined this set once `materializeGraphProjection` started backfilling its owning anchor's `anchorName` — this set only gates on the type; the `!node.anchorName` check below is what actually makes it a no-op for a section outside the enrichment's project scope. */
const OPEN_DETAIL_NODE_TYPES: ReadonlySet<GraphNodeType> = new Set(["anchor", "claim", "milestone", "task", "section"]);

function openDetailAnchorName(node: ProjectionNode): string | undefined {
  if (!node.anchorName || !OPEN_DETAIL_NODE_TYPES.has(node.type)) {
    return undefined;
  }
  return node.anchorName;
}

function nodeClasses(node: ProjectionNode, style: CoverageStyle | undefined): string {
  const classes = [`type-${node.type}`];
  if (style) {
    classes.push(`coverage-${style.treatment}`);
    if (style.warn) {
      classes.push("coverage-warn");
    }
  }
  return classes.join(" ");
}

function edgeClasses(style: EdgeStrokeStyle, type: GraphEdgeType): string {
  return [`edge-type-${type}`, `edge-${style.lineStyle}`, `edge-${style.weight}`].join(" ");
}

/**
 * Builds a Cytoscape `elements` array (nodes + edges, each in Cytoscape's own
 * `{ group, data, position?, classes }` element shape) from a graph snapshot.
 * Every node keeps its server-assigned `seed` as its initial `position` (a
 * `preset` layout reads `position` directly, so the same tree lays out the
 * same way every time the tab opens — no unbounded physics reshuffle). Edges
 * are defensively filtered to those whose `from`/`to` both resolve to a node
 * in this same element set: the server's `clampProjectionSize` already drops
 * edges that reference a clamped-away node, but a defensive filter here means
 * a malformed/partial snapshot never hands Cytoscape a dangling edge
 * reference (Cytoscape throws on an edge with a missing endpoint).
 */
export function snapshotToCyElements(snapshot: Pick<GraphSnapshotResult, "nodes" | "edges">): CyElements {
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const nodes: CyNodeElement[] = snapshot.nodes.map((node) => {
    const style = coverageStyle(node.coverageState);
    return {
      group: "nodes",
      data: {
        id: node.id,
        label: node.display,
        type: node.type,
        shape: nodeTypeShape(node.type),
        coverageState: node.coverageState,
        coverageTreatment: style?.treatment,
        coverageWarn: style?.warn ?? false,
        sourceOfTruth: node.sourceOfTruth,
        project: node.project,
        anchorName: node.anchorName,
        openDetailAnchorName: openDetailAnchorName(node),
      },
      position: { x: node.seed.x, y: node.seed.y },
      classes: nodeClasses(node, style),
    };
  });

  const edges: CyEdgeElement[] = snapshot.edges
    .filter((edge: ProjectionEdge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => {
      const style = edgeStrokeStyle(edge.sourceOfTruth);
      return {
        group: "edges",
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: edge.type,
          sourceOfTruth: edge.sourceOfTruth,
          lineStyle: style.lineStyle,
          weight: style.weight,
        },
        classes: edgeClasses(style, edge.type),
      };
    });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Synchronized table rows.
// ---------------------------------------------------------------------------

export type GraphTableRow = {
  id: string;
  type: GraphNodeType;
  display: string;
  project?: string;
  coverageState?: CoverageState;
  openDetailAnchorName?: string;
};

/** One row per node, in the snapshot's own order (the caller sorts, per its current sort column) — the accessibility-required representation: every node reachable (and its Open-detail link operable) via a real `<table>` row, not just the canvas. */
export function tableRowsFromSnapshot(snapshot: Pick<GraphSnapshotResult, "nodes">): GraphTableRow[] {
  return snapshot.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    display: node.display,
    project: node.project,
    coverageState: node.coverageState,
    openDetailAnchorName: openDetailAnchorName(node),
  }));
}

export type GraphTableSortKey = "type" | "display" | "coverageState" | "project";

/** Sorts table rows by a single column, ascending; a row missing the sort field (e.g. `project` on a non-project-scoped node) sorts after every row that has one, then falls back to `display` for a stable tie-break so re-sorting the same column never visibly shuffles equal rows. */
export function sortGraphTableRows(rows: readonly GraphTableRow[], sortKey: GraphTableSortKey): GraphTableRow[] {
  const withValue = (row: GraphTableRow): string | undefined => {
    const value = row[sortKey];
    return value === undefined ? undefined : String(value);
  };
  return [...rows].sort((a, b) => {
    const va = withValue(a);
    const vb = withValue(b);
    if (va === undefined && vb === undefined) return a.display.localeCompare(b.display);
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    const cmp = va.localeCompare(vb);
    return cmp !== 0 ? cmp : a.display.localeCompare(b.display);
  });
}

// ---------------------------------------------------------------------------
// Filters <-> query params (server-side filtering, mirrors coverageQueryParams).
// ---------------------------------------------------------------------------

export type GraphFilters = {
  project?: string;
  nodeTypes?: readonly GraphNodeType[];
  edgeTypes?: readonly GraphEdgeType[];
  coverageStates?: readonly CoverageState[];
  q?: string;
  maxNodes?: number;
  maxEdges?: number;
};

/** Builds the `/api/ui/graph/snapshot` query string for a filter set — every filter is server-side (the API supports it directly), so the Graph tab re-fetches rather than filtering an already-fetched snapshot client-side. Mirrors `coverageQueryParams` in `src/ui/viewModel.ts`. */
export function graphSnapshotQueryParams(filters: GraphFilters): Record<string, string> {
  const params: Record<string, string> = {};
  const project = (filters.project || "").trim();
  if (project) params.project = project;
  if (filters.nodeTypes && filters.nodeTypes.length > 0) params.nodeTypes = filters.nodeTypes.join(",");
  if (filters.edgeTypes && filters.edgeTypes.length > 0) params.edgeTypes = filters.edgeTypes.join(",");
  if (filters.coverageStates && filters.coverageStates.length > 0) params.coverage = filters.coverageStates.join(",");
  const q = (filters.q || "").trim();
  if (q) params.q = q;
  if (filters.maxNodes !== undefined) params.maxNodes = String(filters.maxNodes);
  if (filters.maxEdges !== undefined) params.maxEdges = String(filters.maxEdges);
  return params;
}

// ---------------------------------------------------------------------------
// Schema -> filter rail options.
// ---------------------------------------------------------------------------

export type GraphFilterOptions = {
  nodeTypes: GraphNodeType[];
  edgeTypes: GraphEdgeType[];
};

/** Populates the filter rail's node-type/edge-type checkboxes from `/api/ui/graph/schema`'s observed counts — only types actually present in the (optionally project-scoped) graph appear as checkboxes, sorted for a stable render. */
export function filterOptionsFromSchema(schema: Pick<GraphSchemaResult, "nodeTypeCounts" | "edgeTypeCounts">): GraphFilterOptions {
  return {
    nodeTypes: (Object.keys(schema.nodeTypeCounts) as GraphNodeType[]).sort(),
    edgeTypes: (Object.keys(schema.edgeTypeCounts) as GraphEdgeType[]).sort(),
  };
}

/**
 * Drops any previously-selected filter value the current schema no longer
 * offers (e.g. a node/edge type that only existed in the previously-scoped
 * project), so a stale selection can't stay applied to the snapshot query with
 * no checkbox left to clear it. `UI_JS` mirrors this inline as `pruneToAvailable`
 * in the render path; the rule is unit-tested here. Order and duplicates of the
 * surviving selection are preserved.
 */
export function pruneSelectionToAvailable<T>(selected: readonly T[] | undefined, available: readonly T[]): T[] {
  const present = new Set(available);
  return (selected ?? []).filter((value) => present.has(value));
}

// ---------------------------------------------------------------------------
// Header counts / truncation notice.
// ---------------------------------------------------------------------------

export type GraphHeaderSummary = {
  returnedNodes: number;
  matchingNodes: number;
  returnedEdges: number;
  matchingEdges: number;
  truncated: boolean;
};

/** Derives the header's "returned vs matching" counts and truncation notice from a snapshot response — a thin pass-through today, kept as its own function so the render layer never has to reach into `snapshot.totals` field names directly (and so a future reshaping of the response only touches this one function). */
export function graphHeaderSummary(snapshot: Pick<GraphSnapshotResult, "totals" | "truncated">): GraphHeaderSummary {
  return {
    returnedNodes: snapshot.totals.returnedNodes,
    matchingNodes: snapshot.totals.matchingNodes,
    returnedEdges: snapshot.totals.returnedEdges,
    matchingEdges: snapshot.totals.matchingEdges,
    truncated: snapshot.truncated,
  };
}

// ---------------------------------------------------------------------------
// URL <-> filter/sort/selection state, mirroring `coverageFiltersFromUrlParams`
// / `coverageUrlParamsFromFilters` in `src/ui/viewModel.ts`. `UI_JS`
// re-implements this inline in `applyUrlStateToControls`/`paramsForState` (it
// cannot import this module — no bundler); the pure round-trip rules are
// tested here. Satisfies the Goal 1 acceptance criterion "the graph URL can
// be copied and reopened to restore mode, filters, selected node, and layout"
// (layout has no param yet — Explore mode ships one canvas layout, nothing to
// select between).
// ---------------------------------------------------------------------------

export type GraphUrlState = {
  project?: string;
  /** Node/edge type tokens as read from the URL -- deliberately `string[]`, not `GraphNodeType[]`/`GraphEdgeType[]`: the URL has no closed vocabulary for these (unlike `coverageStates`/`sortKey` below), so an unknown or stale token round-trips as-is until `pruneSelectionToAvailable` gates it against the live schema. A narrower type here would be unsound and force casts in `graphFiltersFromUrlParams`. */
  nodeTypes?: readonly string[];
  edgeTypes?: readonly string[];
  coverageStates?: readonly CoverageState[];
  q?: string;
  sortKey?: GraphTableSortKey;
  sortDir?: "asc" | "desc";
  /** Canonical id of the selected node or edge, so a copied URL reopens with the same inspector/table selection. */
  selectedId?: string;
};

/** Every URL query key the Graph tab owns. Prefixed `graph*` throughout so it can never collide with the Anchors tab's own `project`/`sort`/`search` or the Coverage tab's `coverage*` params — all three tabs' state coexists in one URL simultaneously. */
export const GRAPH_URL_PARAM_KEYS = {
  project: "graphProject",
  nodeTypes: "graphNodeTypes",
  edgeTypes: "graphEdgeTypes",
  coverageStates: "graphCoverage",
  q: "graphSearch",
  sortKey: "graphSort",
  sortDir: "graphSortDir",
  selectedId: "graphSelected",
} as const;

export const DEFAULT_GRAPH_SORT_KEY: GraphTableSortKey = "type";
export const DEFAULT_GRAPH_SORT_DIR: "asc" | "desc" = "asc";

const VALID_GRAPH_TABLE_SORT_KEYS: ReadonlySet<GraphTableSortKey> = new Set(["type", "display", "coverageState", "project"]);
function isGraphTableSortKeyValue(value: string): value is GraphTableSortKey {
  return VALID_GRAPH_TABLE_SORT_KEYS.has(value as GraphTableSortKey);
}

const VALID_GRAPH_COVERAGE_STATES: ReadonlySet<CoverageState> = new Set([
  "structured",
  "partial",
  "prose_only",
  "ambiguous",
  "dangling",
  "malformed",
]);
function isGraphCoverageStateValue(value: string): value is CoverageState {
  return VALID_GRAPH_COVERAGE_STATES.has(value as CoverageState);
}

/** Trimmed, deduplicated (order-preserving), non-empty tokens from a comma-separated URL value. No fixed-vocabulary validation — node/edge types have no closed enum here (they vary with the graph); `pruneSelectionToAvailable` is the actual gatekeeper once the live schema is known, same as a stale checkbox selection left over from a different project scope. */
function splitUrlTokenList(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(",")) {
    const value = token.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Parse the Graph tab's filter/sort/selection state back out of a `URLSearchParams`-like plain object. `coverageStates` and `sortKey`/`sortDir` have small closed vocabularies and are validated (unknown tokens dropped, same forgiving policy `coverageFiltersFromUrlParams` uses for a stale/foreign link); `nodeTypes`/`edgeTypes` are accepted as-is. */
export function graphFiltersFromUrlParams(getParam: (key: string) => string | null): GraphUrlState {
  const project = (getParam(GRAPH_URL_PARAM_KEYS.project) || "").trim();
  const nodeTypes = splitUrlTokenList(getParam(GRAPH_URL_PARAM_KEYS.nodeTypes));
  const edgeTypes = splitUrlTokenList(getParam(GRAPH_URL_PARAM_KEYS.edgeTypes));
  const seenStates = new Set<CoverageState>();
  const coverageStates = splitUrlTokenList(getParam(GRAPH_URL_PARAM_KEYS.coverageStates)).filter(
    (value): value is CoverageState => {
      if (!isGraphCoverageStateValue(value) || seenStates.has(value)) {
        return false;
      }
      seenStates.add(value);
      return true;
    },
  );
  const q = (getParam(GRAPH_URL_PARAM_KEYS.q) || "").trim();
  const sortKeyRaw = getParam(GRAPH_URL_PARAM_KEYS.sortKey) || "";
  const sortDirRaw = getParam(GRAPH_URL_PARAM_KEYS.sortDir);
  const selectedId = (getParam(GRAPH_URL_PARAM_KEYS.selectedId) || "").trim();
  return {
    ...(project ? { project } : {}),
    ...(nodeTypes.length > 0 ? { nodeTypes } : {}),
    ...(edgeTypes.length > 0 ? { edgeTypes } : {}),
    ...(coverageStates.length > 0 ? { coverageStates } : {}),
    ...(q ? { q } : {}),
    ...(isGraphTableSortKeyValue(sortKeyRaw) ? { sortKey: sortKeyRaw } : {}),
    ...(sortDirRaw === "desc" || sortDirRaw === "asc" ? { sortDir: sortDirRaw } : {}),
    ...(selectedId ? { selectedId } : {}),
  };
}

/** Inverse of `graphFiltersFromUrlParams`. Only includes a key when it has an effective, non-default value, so applying it never leaves stale or no-op params behind (same convention `setParam`/`setNonDefaultParam` follow in `src/ui/assets.ts`). */
export function graphUrlParamsFromState(state: GraphUrlState): Record<string, string> {
  const params: Record<string, string> = {};
  const project = state.project?.trim();
  if (project) {
    params[GRAPH_URL_PARAM_KEYS.project] = project;
  }
  if (state.nodeTypes && state.nodeTypes.length > 0) {
    params[GRAPH_URL_PARAM_KEYS.nodeTypes] = state.nodeTypes.join(",");
  }
  if (state.edgeTypes && state.edgeTypes.length > 0) {
    params[GRAPH_URL_PARAM_KEYS.edgeTypes] = state.edgeTypes.join(",");
  }
  if (state.coverageStates && state.coverageStates.length > 0) {
    params[GRAPH_URL_PARAM_KEYS.coverageStates] = state.coverageStates.join(",");
  }
  const q = state.q?.trim();
  if (q) {
    params[GRAPH_URL_PARAM_KEYS.q] = q;
  }
  if (state.sortKey && state.sortKey !== DEFAULT_GRAPH_SORT_KEY) {
    params[GRAPH_URL_PARAM_KEYS.sortKey] = state.sortKey;
  }
  if (state.sortDir && state.sortDir !== DEFAULT_GRAPH_SORT_DIR) {
    params[GRAPH_URL_PARAM_KEYS.sortDir] = state.sortDir;
  }
  const selectedId = state.selectedId?.trim();
  if (selectedId) {
    params[GRAPH_URL_PARAM_KEYS.selectedId] = selectedId;
  }
  return params;
}
