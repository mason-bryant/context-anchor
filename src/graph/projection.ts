/**
 * Bounded graph projection (Goal 1 slice 1: "Inspectable graph foundation").
 *
 * Pure function over an already-built `GraphIndex`'s edges plus the anchor/
 * claim coverage records `AnchorService.graphCoverage` already assembles —
 * no I/O, no git, mirrors the purity discipline `src/graph/coverage.ts`
 * establishes (`AnchorService` is the only caller that touches storage, and
 * it does so before calling in). This module materializes a client-facing
 * node/link projection of the derived graph: every anchor gets a first-class
 * node even when it has zero edges (a bare `allEdges()` walk would silently
 * drop it), every edge gets a short deterministic id, and every node gets a
 * deterministic layout seed so the same tree always lays out the same way
 * and an anchor rename never moves its node (the seed is keyed off the
 * CANONICAL node id, which — for an id-bearing anchor — is its immutable
 * `anchor_id`, not its path).
 *
 * Three composable steps, exported individually so callers needing raw
 * (unfiltered, unclamped) counts — `AnchorService.graphSchema` — can stop
 * after materialization instead of paying for a filter+clamp pass meant for
 * `graphSnapshot`'s bounded response:
 *
 *   1. `materializeGraphProjection` — union edges' endpoints with the
 *      caller-supplied anchor/claim record sets, assign type/display/seed/
 *      sourceOfTruth to every node, and give every edge a deterministic id.
 *   2. `applyProjectionFilters` — project/nodeTypes/edgeTypes/coverage/q,
 *      all in-memory over the materialized sets.
 *   3. `clampProjectionSize` — bound to maxNodes/maxEdges, dropping edges
 *      that reference a dropped node and counting everything it drops.
 *
 * `buildGraphProjection` composes all three for `graphSnapshot`.
 */

import { inferNodeType } from "./neighbors.js";
import type { GraphEdge, GraphEdgeType, GraphNodeType } from "./model.js";
import type { CoverageState } from "./coverage.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Where a NODE's underlying fact comes from — distinct from `GraphEdgeSourceOfTruth` (edges cite a fact's provenance; this is a coarser "what kind of record backs this entity" classification for the node itself). */
export type ProjectionNodeSourceOfTruth = "anchor" | "registry" | "mapping" | "git" | "derived";

export type ProjectionSeed = { x: number; y: number };

export type ProjectionNode = {
  id: string;
  type: GraphNodeType;
  display: string;
  anchorName?: string;
  project?: string;
  status?: string;
  sourceOfTruth: ProjectionNodeSourceOfTruth;
  lastValidated?: string;
  observedAt?: string;
  certainty?: number;
  coverageState?: CoverageState;
  seed: ProjectionSeed;
  properties: Record<string, unknown>;
};

export type ProjectionEdge = {
  id: string;
  from: string;
  to: string;
  type: GraphEdgeType;
  sourceOfTruth: GraphEdge["sourceOfTruth"];
  confidence: number;
  inferred: false;
  observedAt?: string;
  properties: Record<string, unknown>;
};

/** An anchor to materialize as a first-class node, even if `allEdges()` never mentions it (the isolated-node case). */
export type ProjectionAnchorInput = {
  anchorName: string;
  /** The anchor's current canonical node id (`anchor:<anchor-id>` v2, or `anchor:<anchor-name>` v1) — callers resolve this via `GraphIndex.canonicalizeNodeId` before calling in, so this module never re-derives identity. */
  canonicalNodeId: string;
  display: string;
  project?: string;
  coverageState?: CoverageState;
  lastValidated?: string;
};

/** A claim (with a minted id — an id-less claim has no addressable node) to materialize as a first-class node. */
export type ProjectionClaimInput = {
  anchorName: string;
  claimId: string;
  /** The claim's current canonical node id (`claim:<anchor-id>#<claim-id>` v2 or `claim:<anchor-name>#<claim-id>` v1). */
  canonicalNodeId: string;
  coverageState: CoverageState;
  project?: string;
  /** Human-readable label (the claim's bullet text, caller-truncated) shown instead of the opaque `<anchor-id>#<claim-id>` id. Omitted → falls back to the id-derived label. */
  display?: string;
};

export type ProjectionFilters = {
  project?: string;
  nodeTypes?: readonly GraphNodeType[];
  edgeTypes?: readonly GraphEdgeType[];
  /** Restrict to nodes carrying one of these coverage states (anchor/claim nodes only — every other node type has no coverage state and is dropped by this filter when set). */
  coverageStates?: readonly CoverageState[];
  /** Case-insensitive substring match against `display`. */
  q?: string;
};

export type ProjectionClamps = {
  maxNodes: number;
  maxEdges: number;
};

export type ProjectionTotals = {
  matchingNodes: number;
  returnedNodes: number;
  matchingEdges: number;
  returnedEdges: number;
};

export type GraphProjection = {
  nodes: ProjectionNode[];
  edges: ProjectionEdge[];
  totals: ProjectionTotals;
  truncated: boolean;
  warnings: string[];
};

export type BuildGraphProjectionInput = {
  edges: readonly GraphEdge[];
  anchors: readonly ProjectionAnchorInput[];
  claims: readonly ProjectionClaimInput[];
  filters?: ProjectionFilters;
  clamps: ProjectionClamps;
};

// ---------------------------------------------------------------------------
// Step 1: materialize nodes + edges (unfiltered, unclamped).
// ---------------------------------------------------------------------------

/** Coarse node-kind -> `ProjectionNodeSourceOfTruth` classification. A node kind never observed among these arms falls back to `"derived"`. */
function nodeSourceOfTruth(type: GraphNodeType): ProjectionNodeSourceOfTruth {
  switch (type) {
    case "anchor":
    case "milestone":
    case "task":
    case "section":
    case "claim":
    case "goal":
      return "anchor";
    case "person":
    case "team":
      return "registry";
    case "project":
    case "repo":
    case "path":
      return "mapping";
    case "pr":
    case "file":
      return "git";
    default:
      return "derived";
  }
}

/** Human label for a node this module only ever saw as an edge endpoint (no anchor/claim record supplied it a display) — the id's content after its type prefix. */
function fallbackDisplay(id: string, type: GraphNodeType): string {
  const prefix = `${type}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/**
 * Project slug derivable directly from an id's own shape, for the two node
 * kinds whose canonical id embeds it: `project:<slug>` (trivially) and a v2
 * scoped goal `goal:<project-slug>:<goal-id>` (a v1 unscoped `goal:<goal-id>`
 * has no second colon and yields `undefined`, same as any other kind). Every
 * other node kind (milestone/task/section/claim embed an ANCHOR id/path, not
 * a project slug directly; person/team/repo/path/pr/file/url are not
 * project-scoped at all) relies on an explicit `ProjectionAnchorInput`/
 * `ProjectionClaimInput.project` instead.
 */
function deriveProjectFromNodeId(id: string, type: GraphNodeType): string | undefined {
  if (type === "project") {
    return id.slice("project:".length) || undefined;
  }
  if (type === "goal") {
    const parts = id.slice("goal:".length).split(":");
    return parts.length >= 2 ? parts[0] : undefined;
  }
  return undefined;
}

/**
 * The owning anchor's identity segment embedded in a `section:<owner>#<heading>`,
 * `milestone:<owner>`, or `task:<owner>#<taskId>` node id — everything between
 * the type prefix and the FIRST `#` (owner segments never contain `#`; a
 * section heading legitimately might, e.g. "## C# notes", so splitting on the
 * first `#` rather than the last is what keeps the owner segment correct).
 * Mirrors `canonicalizeSectionNodeId`'s own split convention in
 * `src/graph/canonicalIds.ts`. `undefined` for a node type with no owner
 * (anchor/claim already get their own record; section/milestone/task never
 * do, which is exactly the gap this enrichment closes) or a malformed id.
 */
function anchorOwnerIdentity(id: string, type: GraphNodeType): string | undefined {
  if (type !== "section" && type !== "milestone" && type !== "task") {
    return undefined;
  }
  const prefix = `${type}:`;
  if (!id.startsWith(prefix)) {
    return undefined;
  }
  const rest = id.slice(prefix.length);
  const hashIndex = rest.indexOf("#");
  return hashIndex === -1 ? rest : rest.slice(0, hashIndex);
}

/** The heading text embedded in a `section:<owner>#<heading>` id (first `#` onward), for a nicer label than the raw owner+heading string. `undefined` if the id has no `#` segment. */
function sectionHeadingFromNodeId(id: string): string | undefined {
  if (!id.startsWith("section:")) {
    return undefined;
  }
  const rest = id.slice("section:".length);
  const hashIndex = rest.indexOf("#");
  return hashIndex === -1 ? undefined : rest.slice(hashIndex + 1);
}

type MutableNode = ProjectionNode;

function ensureNode(nodes: Map<string, MutableNode>, id: string): MutableNode {
  const existing = nodes.get(id);
  if (existing) {
    return existing;
  }
  // Every node id this module ever sees is either a `GraphEdge` endpoint (a
  // canonical id `GraphIndex` emitted) or a caller-supplied canonical anchor/
  // claim id — both always carry one of `CANONICAL_NODE_PREFIXES`' 14
  // prefixes, so `inferNodeType` always matches in practice; the fallback is
  // a defensive last resort, never expected to fire.
  const type = inferNodeType(id) ?? "anchor";
  const project = deriveProjectFromNodeId(id, type);
  const created: MutableNode = {
    id,
    type,
    display: fallbackDisplay(id, type),
    ...(project !== undefined ? { project } : {}),
    sourceOfTruth: nodeSourceOfTruth(type),
    seed: computeSeed(id, project),
    properties: {},
  };
  nodes.set(id, created);
  return created;
}

/**
 * Materialize the full (unfiltered, unclamped) node/edge universe: every
 * edge endpoint becomes a node, every supplied anchor/claim record becomes
 * (or enriches) a node — including anchors with zero edges — and every edge
 * gets a deterministic id. Exported standalone for `graphSchema`, which
 * wants type/edge-type counts over the WHOLE (optionally project-scoped)
 * graph, not a filtered+clamped response.
 */
export function materializeGraphProjection(
  input: Pick<BuildGraphProjectionInput, "edges" | "anchors" | "claims">,
): { nodes: ProjectionNode[]; edges: ProjectionEdge[] } {
  const nodes = new Map<string, MutableNode>();

  // Edge endpoints first, so an anchor/claim record below can enrich (not
  // just create) a node the edges already introduced.
  for (const edge of input.edges) {
    ensureNode(nodes, edge.from);
    ensureNode(nodes, edge.to);
  }

  for (const anchor of input.anchors) {
    const node = ensureNode(nodes, anchor.canonicalNodeId);
    node.display = anchor.display;
    node.anchorName = anchor.anchorName;
    if (anchor.project !== undefined) {
      node.project = anchor.project;
    }
    if (anchor.coverageState !== undefined) {
      node.coverageState = anchor.coverageState;
    }
    if (anchor.lastValidated !== undefined) {
      node.lastValidated = anchor.lastValidated;
    }
    // Project-known nodes get a project-centroid-biased seed instead of the
    // placeholder global seed `ensureNode` assigned on first sight.
    node.seed = computeSeed(node.id, anchor.project);
  }

  for (const claim of input.claims) {
    const node = ensureNode(nodes, claim.canonicalNodeId);
    node.anchorName = claim.anchorName;
    node.coverageState = claim.coverageState;
    if (claim.display) {
      node.display = claim.display;
    }
    if (claim.project !== undefined) {
      node.project = claim.project;
    }
    node.seed = computeSeed(node.id, claim.project);
  }

  // Section/milestone/task nodes never get their own input record (unlike
  // anchors/claims above), so left alone they carry nothing but a raw
  // fallback display derived from their own id — no anchorName, no project,
  // no "Open detail" link. Backfill from the owning anchor's already-known
  // record when it's in scope (a cross-project reference outside the current
  // project filter has no entry here and is left as-is — the same documented
  // permissive-project tradeoff `applyProjectionFilters` already makes).
  const ownerAnchorsByIdentity = new Map<string, ProjectionAnchorInput>();
  for (const anchor of input.anchors) {
    if (anchor.canonicalNodeId.startsWith("anchor:")) {
      ownerAnchorsByIdentity.set(anchor.canonicalNodeId.slice("anchor:".length), anchor);
    }
  }
  for (const node of nodes.values()) {
    const ownerIdentity = anchorOwnerIdentity(node.id, node.type);
    const owner = ownerIdentity ? ownerAnchorsByIdentity.get(ownerIdentity) : undefined;
    if (!owner) {
      continue;
    }
    node.anchorName = owner.anchorName;
    if (owner.project !== undefined) {
      node.project = owner.project;
    }
    if (node.type === "section") {
      const heading = sectionHeadingFromNodeId(node.id);
      if (heading) {
        node.display = heading;
      }
    }
    node.seed = computeSeed(node.id, node.project);
  }

  const edgeIdCounts = new Map<string, number>();
  const edges: ProjectionEdge[] = input.edges.map((edge) => ({
    id: nextEdgeId(edgeIdCounts, edge),
    from: edge.from,
    to: edge.to,
    type: edge.type,
    sourceOfTruth: edge.sourceOfTruth,
    // Structural/authored edges are certain by construction this goal —
    // there is no inference step yet (`inferred` is always false); a future
    // slice that adds inferred/weighted edges will vary this.
    confidence: 1,
    inferred: false,
    properties: {},
  }));

  return { nodes: [...nodes.values()], edges };
}

// ---------------------------------------------------------------------------
// Step 2: filters.
// ---------------------------------------------------------------------------

export function applyProjectionFilters(
  nodes: readonly ProjectionNode[],
  edges: readonly ProjectionEdge[],
  filters: ProjectionFilters | undefined,
): { nodes: ProjectionNode[]; edges: ProjectionEdge[] } {
  const nodeTypeFilter = filters?.nodeTypes && filters.nodeTypes.length > 0 ? new Set(filters.nodeTypes) : undefined;
  const coverageFilter =
    filters?.coverageStates && filters.coverageStates.length > 0 ? new Set(filters.coverageStates) : undefined;
  const edgeTypeFilter = filters?.edgeTypes && filters.edgeTypes.length > 0 ? new Set(filters.edgeTypes) : undefined;
  const q = filters?.q?.trim().toLowerCase();

  const filteredNodes = nodes.filter((node) => {
    // A project filter only excludes nodes that DECLARE a conflicting
    // project — node kinds this slice never scopes to a project (person,
    // team, url, ...) pass through so shared entities stay visible rather
    // than vanishing behind a project filter that was never meant for them.
    if (filters?.project && node.project !== undefined && node.project !== filters.project) {
      return false;
    }
    if (nodeTypeFilter && !nodeTypeFilter.has(node.type)) {
      return false;
    }
    // Coverage filtering is exclusive by design: a caller asking for
    // specific coverage states wants ONLY records classified into them, so a
    // node with no coverage state at all (most non-anchor/claim kinds) is
    // dropped rather than passed through.
    if (coverageFilter && (node.coverageState === undefined || !coverageFilter.has(node.coverageState))) {
      return false;
    }
    if (q && !node.display.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const keepNodeIds = new Set(filteredNodes.map((node) => node.id));
  const filteredEdges = edges.filter((edge) => {
    if (edgeTypeFilter && !edgeTypeFilter.has(edge.type)) {
      return false;
    }
    return keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to);
  });

  return { nodes: filteredNodes, edges: filteredEdges };
}

// ---------------------------------------------------------------------------
// Step 3: clamp.
// ---------------------------------------------------------------------------

/**
 * Bound to `clamps.maxNodes`/`maxEdges`, dropping (and counting) any edge
 * that references a node the node clamp dropped, on top of whatever the edge
 * clamp itself drops. Selection order is the node/edge id's lexicographic
 * order — arbitrary but deterministic, so two builds over the same tree
 * always keep the same subset.
 */
export function clampProjectionSize(
  nodes: readonly ProjectionNode[],
  edges: readonly ProjectionEdge[],
  clamps: ProjectionClamps,
): { nodes: ProjectionNode[]; edges: ProjectionEdge[]; totals: ProjectionTotals; truncated: boolean; warnings: string[] } {
  const maxNodes = Math.max(0, Math.floor(clamps.maxNodes));
  const maxEdges = Math.max(0, Math.floor(clamps.maxEdges));

  const sortedNodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const clampedNodes = sortedNodes.slice(0, maxNodes);
  const keptNodeIds = new Set(clampedNodes.map((node) => node.id));

  const survivingEdges = edges.filter((edge) => keptNodeIds.has(edge.from) && keptNodeIds.has(edge.to));
  const edgesDroppedByNodeClamp = edges.length - survivingEdges.length;

  const sortedEdges = [...survivingEdges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const clampedEdges = sortedEdges.slice(0, maxEdges);

  const totals: ProjectionTotals = {
    matchingNodes: nodes.length,
    returnedNodes: clampedNodes.length,
    matchingEdges: edges.length,
    returnedEdges: clampedEdges.length,
  };

  const warnings: string[] = [];
  const nodesDropped = nodes.length - clampedNodes.length;
  if (nodesDropped > 0) {
    warnings.push(`Dropped ${nodesDropped} node(s) beyond maxNodes=${maxNodes}.`);
  }
  if (edgesDroppedByNodeClamp > 0) {
    warnings.push(`Dropped ${edgesDroppedByNodeClamp} edge(s) referencing a node clamped out of the result.`);
  }
  const edgesDroppedByOwnClamp = survivingEdges.length - clampedEdges.length;
  if (edgesDroppedByOwnClamp > 0) {
    warnings.push(`Dropped ${edgesDroppedByOwnClamp} edge(s) beyond maxEdges=${maxEdges}.`);
  }

  return {
    nodes: clampedNodes,
    edges: clampedEdges,
    totals,
    truncated: totals.returnedNodes < totals.matchingNodes || totals.returnedEdges < totals.matchingEdges,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

export function buildGraphProjection(input: BuildGraphProjectionInput): GraphProjection {
  const materialized = materializeGraphProjection(input);
  const filtered = applyProjectionFilters(materialized.nodes, materialized.edges, input.filters);
  const clamped = clampProjectionSize(filtered.nodes, filtered.edges, input.clamps);
  return {
    nodes: clamped.nodes,
    edges: clamped.edges,
    totals: clamped.totals,
    truncated: clamped.truncated,
    warnings: clamped.warnings,
  };
}

// ---------------------------------------------------------------------------
// Deterministic hashing (edge ids + layout seeds) — tiny FNV-1a, no
// dependency. Short, stable, and good enough for id/coordinate derivation;
// not used for anything security-sensitive.
// ---------------------------------------------------------------------------

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A value in `[0, 1)`, deterministic in `input`. */
function hashUnit(input: string): number {
  return fnv1a(input) / 0x100000000;
}

/** Coordinate space every node's seed is spread across (arbitrary unit; a future UI layer scales/pans as it likes). */
const SEED_SPACE = 1000;
/** Radius of the jitter box around a project's centroid — small relative to `SEED_SPACE` so same-project nodes cluster and cross-project centroids stay visibly apart. */
const PROJECT_JITTER = 120;

/**
 * Deterministic `{x, y}` for a node, keyed off its CANONICAL id (so an
 * anchor rename never moves its seed — an id-bearing anchor's canonical id
 * is its immutable `anchor_id`, unaffected by a path/name change) and,
 * when a project is known, biased toward a per-project hash-derived
 * centroid so nodes sharing a project cluster together. No server-side
 * force simulation — this is a one-shot deterministic placement, not a
 * physics layout.
 */
function computeSeed(nodeId: string, project: string | undefined): ProjectionSeed {
  if (project) {
    const centroidX = hashUnit(`graph-projection:centroid:${project}:x`) * SEED_SPACE;
    const centroidY = hashUnit(`graph-projection:centroid:${project}:y`) * SEED_SPACE;
    const jitterX = (hashUnit(`${nodeId}:x`) - 0.5) * PROJECT_JITTER;
    const jitterY = (hashUnit(`${nodeId}:y`) - 0.5) * PROJECT_JITTER;
    return { x: centroidX + jitterX, y: centroidY + jitterY };
  }
  return {
    x: hashUnit(`${nodeId}:x`) * SEED_SPACE,
    y: hashUnit(`${nodeId}:y`) * SEED_SPACE,
  };
}

/**
 * Deterministic edge id: a short hash of (from, to, type, sourceOfTruth),
 * disambiguated by a stable occurrence counter so two structurally
 * identical "parallel" edges (e.g. two body-links between the same anchor
 * pair) get distinct ids instead of colliding onto one. The counter only
 * depends on the input edge array's own order, which `GraphIndex.allEdges()`
 * produces deterministically for a stable tree — so two builds over the same
 * tree still agree on every id.
 */
function nextEdgeId(counts: Map<string, number>, edge: GraphEdge): string {
  // NUL joins the parts so no field's value can bleed across a separator (node
  // ids never contain NUL); written as an explicit "\u0000" escape rather than a
  // literal NUL byte, so the separator is visible and unambiguous in source.
  const key = [edge.from, edge.to, edge.type, edge.sourceOfTruth].join("\u0000");
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  const base = fnv1a(key).toString(16).padStart(8, "0");
  return occurrence === 0 ? base : `${base}-${occurrence}`;
}
