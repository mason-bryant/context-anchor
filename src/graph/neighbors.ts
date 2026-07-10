/**
 * `graphNeighbors` traversal core (WP4 of the claim knowledge graph plan).
 *
 * Pure BFS over an already-built `GraphIndex`: no I/O beyond the index's own
 * `edgesFrom`/`edgesTo`, no git subprocesses (the index guarantees that on
 * its own read path). Node-input resolution (anchor name / `G-###` / claim
 * `<anchor>#<id>` / person-team fuzzy / canonical passthrough) lives in
 * `resolveGraphNode` below and is funneled through the SAME resolvers the
 * rest of the codebase already uses (`AnchorStore.listAnchors`,
 * `buildPeopleIndex`) rather than inventing new parsers.
 *
 * Design refs: `claim_provenance_and_knowledge_graph_design.md` part 3
 * "Exposure"; `claim_graph_implementation_plan.md` WP4.
 */

import { goalNodeId, personNodeId, teamNodeId, type GraphEdge, type GraphEdgeType, type GraphNodeType } from "./model.js";
import type { GraphIndex } from "./index.js";
import type { PeopleIndex } from "../peopleRegistry.js";
import type { AnchorClaim } from "../claims.js";
import type { AnchorMeta, PeopleRegistry } from "../types.js";

export type GraphNeighborsDirection = "forward" | "reverse" | "both";

export type GraphNeighborsInput = {
  node: string;
  depth?: number;
  edgeTypes?: GraphEdgeType[];
  direction?: GraphNeighborsDirection;
  limit?: number;
};

/** One resolved candidate for an ambiguous node input. */
export type GraphNodeCandidate = {
  nodeId: string;
  type: GraphNodeType;
  display?: string;
};

/** Successful, unambiguous node resolution. */
export type ResolvedGraphNode = GraphNodeCandidate & {
  /** How the input string was resolved, for inspectability. */
  via: "canonical" | "anchor-name" | "goal-id" | "claim-id" | "person" | "team";
};

export type GraphNeighborsResultNode = {
  id: string;
  type: GraphNodeType;
  display?: string;
  /** Hop distance from the origin node (0 for the origin itself). */
  depth: number;
  /**
   * One shortest path of edges from the origin to this node (BFS
   * discovery order), so every result node is traceable back to the
   * origin — "no opaque results" per the ground rules.
   */
  hopPath: GraphEdge[];
  /**
   * For `type: "claim"` nodes only: the same per-claim provenance shape the
   * `includeProvenance` sidecar's `claims[]` uses (resolved source links,
   * strength, ids) — attached by `AnchorService.graphNeighbors`, not by the
   * pure traversal core, since it requires a content read.
   */
  claim?: AnchorClaim;
};

export type GraphNeighborsResult =
  | {
      /** Ambiguous input: candidates are returned instead of guessing. */
      candidates: GraphNodeCandidate[];
      resolvedNode?: undefined;
      nodes?: undefined;
      edges?: undefined;
    }
  | {
      candidates?: undefined;
      resolvedNode: ResolvedGraphNode;
      nodes: GraphNeighborsResultNode[];
      edges: GraphEdge[];
    };

export const GRAPH_NEIGHBORS_MIN_DEPTH = 1;
export const GRAPH_NEIGHBORS_MAX_DEPTH = 3;
export const GRAPH_NEIGHBORS_DEFAULT_DEPTH = 1;
export const GRAPH_NEIGHBORS_DEFAULT_LIMIT = 50;
export const GRAPH_NEIGHBORS_MAX_LIMIT = 200;

export function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) {
    return GRAPH_NEIGHBORS_DEFAULT_DEPTH;
  }
  return Math.min(GRAPH_NEIGHBORS_MAX_DEPTH, Math.max(GRAPH_NEIGHBORS_MIN_DEPTH, Math.floor(depth)));
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return GRAPH_NEIGHBORS_DEFAULT_LIMIT;
  }
  return Math.min(GRAPH_NEIGHBORS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Node-id constructor prefixes this module recognizes for canonical
 * passthrough, kept in one place so every prefix check and node-type
 * inference in this module agree.
 */
const CANONICAL_NODE_PREFIXES: Record<string, GraphNodeType> = {
  "anchor:": "anchor",
  "project:": "project",
  "goal:": "goal",
  "milestone:": "milestone",
  "task:": "task",
  "person:": "person",
  "team:": "team",
  "repo:": "repo",
  "path:": "path",
  "pr:": "pr",
  "file:": "file",
  "url:": "url",
  "section:": "section",
  "claim:": "claim",
};

function inferNodeType(nodeId: string): GraphNodeType | undefined {
  for (const [prefix, type] of Object.entries(CANONICAL_NODE_PREFIXES)) {
    if (nodeId.startsWith(prefix)) {
      return type;
    }
  }
  return undefined;
}

const GOAL_ID_PATTERN = /^G-\d{1,6}$/i;
/** `<anchor-name>#<claim-id>` — the anchor part is everything before the LAST `#` so anchor names are never truncated by an accidental extra `#`. */
const CLAIM_REF_PATTERN = /^(.+)#([a-z0-9][a-z0-9-]*)$/i;

export type ResolveGraphNodeContext = {
  anchorNames: ReadonlySet<string>;
  resolveAnchorName: (value: string) => string | undefined;
  anchorMetaByName: (anchorName: string) => AnchorMeta | undefined;
  /** Whether a claim id exists under the given (already-resolved) anchor name — used to disambiguate `<anchor>#<claim-id>` from a section reference. */
  anchorHasClaimId: (anchorName: string, claimId: string) => boolean;
  peopleIndex: PeopleIndex;
  /** Raw registry, for the ambiguous-input candidate scan only (exact-match resolution goes through `peopleIndex`, funneled through the same `resolveOwner` the rest of the codebase uses; this is substring filtering over already-parsed data, not a new parser). */
  peopleRegistry: PeopleRegistry;
};

/**
 * Resolve a user-supplied node string, trying in order: canonical node-id
 * passthrough, `G-###` goal id, `<anchor>#<claim-id>`, anchor-name
 * resolution, then person/team fuzzy resolution (funneled through the
 * existing `PeopleIndex`, not a new parser). Returns either one unambiguous
 * `ResolvedGraphNode` or a `candidates` list when more than one interpretation
 * is plausible — never guesses.
 */
export function resolveGraphNode(
  input: string,
  ctx: ResolveGraphNodeContext,
): { resolved: ResolvedGraphNode } | { candidates: GraphNodeCandidate[] } {
  const trimmed = input.trim();

  // 1. Canonical node id passthrough — an input that already carries one of
  // our own node-id prefixes is taken at face value (the graph itself proves
  // or disproves existence via empty edge sets; this module never reads the
  // index to validate identity, only to traverse from it).
  const canonicalType = inferNodeType(trimmed);
  if (canonicalType) {
    return {
      resolved: { nodeId: trimmed, type: canonicalType, via: "canonical" },
    };
  }

  // 2. `G-###` roadmap goal id.
  if (GOAL_ID_PATTERN.test(trimmed)) {
    const normalized = trimmed.toUpperCase();
    return {
      resolved: { nodeId: goalNodeId(normalized), type: "goal", display: normalized, via: "goal-id" },
    };
  }

  // 3. `<anchor>#<claim-id>` — tried before bare anchor-name resolution so a
  // claim reference is never misread as a literal anchor name containing a
  // `#`. Split on the LAST `#` (an anchor path never legitimately contains
  // one) and require the anchor side to resolve AND the claim id to exist
  // under it, so a `<anchor>#<heading>` section-style reference (not a valid
  // claim id shape check alone would be ambiguous with) falls through to
  // anchor-name handling instead of a wrong claim match.
  const claimMatch = CLAIM_REF_PATTERN.exec(trimmed);
  if (claimMatch) {
    const [, anchorPart, claimId] = claimMatch;
    const resolvedAnchor = ctx.resolveAnchorName(anchorPart.trim());
    if (resolvedAnchor && ctx.anchorHasClaimId(resolvedAnchor, claimId)) {
      return {
        resolved: {
          nodeId: `claim:${resolvedAnchor}#${claimId}`,
          type: "claim",
          via: "claim-id",
        },
      };
    }
  }

  // 4. Anchor-name resolution (exact/normalized, same resolver the rest of
  // the codebase uses via ctx.resolveAnchorName).
  const resolvedAnchor = ctx.resolveAnchorName(trimmed);
  if (resolvedAnchor) {
    const meta = ctx.anchorMetaByName(resolvedAnchor);
    return {
      resolved: { nodeId: `anchor:${resolvedAnchor}`, type: "anchor", display: meta?.title, via: "anchor-name" },
    };
  }

  // 5. Person/team fuzzy resolution, reusing PeopleIndex.resolveOwner (the
  // single person/team resolver already used for task owners) instead of a
  // new fuzzy matcher.
  const owner = ctx.peopleIndex.resolveOwner(trimmed);
  if (owner) {
    return owner.kind === "person"
      ? { resolved: { nodeId: personNodeId(owner.person.id), type: "person", display: owner.person.displayName, via: "person" } }
      : { resolved: { nodeId: teamNodeId(owner.team.id), type: "team", display: owner.team.displayName, via: "team" } };
  }

  // Nothing resolved unambiguously: surface every plausible reading we could
  // partially match as a candidate list rather than guessing. An input with
  // zero matches anywhere still returns an (empty) candidates list, which the
  // caller can render as "no matches" without conflating it with a resolved
  // empty-neighborhood node.
  return { candidates: collectAmbiguousCandidates(trimmed, ctx) };
}

function collectAmbiguousCandidates(trimmed: string, ctx: ResolveGraphNodeContext): GraphNodeCandidate[] {
  if (trimmed.length === 0) {
    return [];
  }
  const needle = trimmed.toLowerCase();
  const candidates: GraphNodeCandidate[] = [];

  for (const anchorName of ctx.anchorNames) {
    if (anchorName.toLowerCase().includes(needle)) {
      const meta = ctx.anchorMetaByName(anchorName);
      candidates.push({ nodeId: `anchor:${anchorName}`, type: "anchor", display: meta?.title ?? anchorName });
    }
  }

  for (const person of ctx.peopleRegistry.people) {
    const haystack = [person.displayName, person.id, ...(person.identities?.names ?? [])];
    if (haystack.some((value) => value.toLowerCase().includes(needle))) {
      candidates.push({ nodeId: personNodeId(person.id), type: "person", display: person.displayName });
    }
  }
  for (const team of ctx.peopleRegistry.teams) {
    const haystack = [team.displayName, team.id, ...(team.synonyms ?? [])];
    if (haystack.some((value) => value.toLowerCase().includes(needle))) {
      candidates.push({ nodeId: teamNodeId(team.id), type: "team", display: team.displayName });
    }
  }

  return candidates;
}

/**
 * BFS from `origin` up to `depth` hops, following `direction` (forward =
 * `edgesFrom`, reverse = `edgesTo`, both = union of both directions per
 * step), optionally filtered to `edgeTypes`, capped at `limit` result nodes
 * (the origin itself never counts against the limit). Every discovered node
 * carries the single BFS-shortest-path hop chain that reached it first, so
 * results are always traceable — never opaque.
 */
export async function traverseGraphNeighbors(
  graph: GraphIndex,
  origin: ResolvedGraphNode,
  options: { depth: number; edgeTypes?: GraphEdgeType[]; direction: GraphNeighborsDirection; limit: number },
): Promise<{ nodes: GraphNeighborsResultNode[]; edges: GraphEdge[] }> {
  const nodes = new Map<string, GraphNeighborsResultNode>();
  const edgesUsed: GraphEdge[] = [];
  const edgeKeysUsed = new Set<string>();

  nodes.set(origin.nodeId, { id: origin.nodeId, type: origin.type, display: origin.display, depth: 0, hopPath: [] });

  let frontier: GraphNeighborsResultNode[] = [nodes.get(origin.nodeId)!];

  for (let hop = 1; hop <= options.depth; hop += 1) {
    if (nodes.size - 1 >= options.limit) {
      break;
    }
    const nextFrontier: GraphNeighborsResultNode[] = [];

    for (const current of frontier) {
      const candidateEdges = await edgesForDirection(graph, current.id, options.direction, options.edgeTypes);
      for (const edge of candidateEdges) {
        const targetId = edge.from === current.id ? edge.to : edge.from;
        if (nodes.has(targetId)) {
          continue;
        }
        if (nodes.size - 1 >= options.limit) {
          break;
        }
        const targetType = inferNodeType(targetId) ?? "anchor";
        const resultNode: GraphNeighborsResultNode = {
          id: targetId,
          type: targetType,
          depth: hop,
          hopPath: [...current.hopPath, edge],
        };
        nodes.set(targetId, resultNode);
        nextFrontier.push(resultNode);

        const edgeKey = `${edge.from}${edge.to}${edge.type}`;
        if (!edgeKeysUsed.has(edgeKey)) {
          edgeKeysUsed.add(edgeKey);
          edgesUsed.push(edge);
        }
      }
      if (nodes.size - 1 >= options.limit) {
        break;
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) {
      break;
    }
  }

  return { nodes: [...nodes.values()], edges: edgesUsed };
}

async function edgesForDirection(
  graph: GraphIndex,
  nodeId: string,
  direction: GraphNeighborsDirection,
  edgeTypes: GraphEdgeType[] | undefined,
): Promise<GraphEdge[]> {
  if (edgeTypes && edgeTypes.length > 0) {
    const results = await Promise.all(
      edgeTypes.map(async (type) => {
        const forward = direction === "reverse" ? [] : await graph.edgesFrom(nodeId, type);
        const reverse = direction === "forward" ? [] : await graph.edgesTo(nodeId, type);
        return [...forward, ...reverse];
      }),
    );
    return dedupeEdgeList(results.flat());
  }
  const forward = direction === "reverse" ? [] : await graph.edgesFrom(nodeId);
  const reverse = direction === "forward" ? [] : await graph.edgesTo(nodeId);
  return dedupeEdgeList([...forward, ...reverse]);
}

function dedupeEdgeList(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}${edge.to}${edge.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(edge);
  }
  return out;
}
