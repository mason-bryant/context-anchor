/**
 * Planner graph-proximity scoring signal (WP7 of the claim knowledge graph
 * plan) — config-gated, additive to BM25/front-matter scoring, never a
 * replacement for it.
 *
 * Two pieces, deliberately separated:
 *
 * 1. `resolveTaskSignalNodes` — pure, synchronous resolution of the task
 *    signals `AnchorService.planContextBundle` already has in hand (resolved
 *    candidate projects from file paths/repo, `G-###` mentions in the task
 *    text, person mentions resolved through the people index) into graph
 *    node ids, each carrying a human-readable label for the `reason` hop
 *    chain's first segment (e.g. `file path -> project anchor-mcp`, `G-039`,
 *    `person Alice`).
 * 2. `computeGraphProximityBoosts` — walks the already-built `GraphIndex`
 *    outward from each resolved signal node, up to 2 hops, and returns a
 *    bounded, deterministic per-anchor boost plus the full hop-chain
 *    `reason` string a reviewer can verify by reading. No opaque numbers:
 *    every boost traces back to the edges that produced it.
 *
 * Design refs: `claim_provenance_and_knowledge_graph_design.md` part 3
 * "Exposure" (planner integration); `claim_graph_implementation_plan.md` WP7.
 */

import type { PeopleIndex } from "../peopleRegistry.js";
import type { ProjectResolution } from "../types.js";
import { goalNodeId, personNodeId, projectNodeId, teamNodeId, type GraphEdge } from "./model.js";
import type { GraphIndex } from "./index.js";

/** Bound on `graphScoring.maxBoost` so BM25 stays the primary signal (ground rule: boost stays small relative to BM25's ~18-point body-match contribution). */
export const GRAPH_SCORING_MAX_BOOST_CEILING = 15;
export const DEFAULT_GRAPH_SCORING_MAX_BOOST = 8;
export const DEFAULT_GRAPH_SCORING_ENABLED = false;
/** Hop depth clamp for the planner proximity walk (design doc: "anchors within <=2 hops"). */
const PROXIMITY_MAX_DEPTH = 2;

export function clampGraphScoringMaxBoost(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_GRAPH_SCORING_MAX_BOOST;
  }
  return Math.min(GRAPH_SCORING_MAX_BOOST_CEILING, Math.max(1, Math.floor(value)));
}

/** A task signal resolved to a graph node, with a human-readable label for the start of its hop-chain reason string. */
export type TaskSignalNode = {
  nodeId: string;
  /** e.g. `file path -> project anchor-mcp`, `G-039`, `person Alice` — the human-facing origin label used in the reason string. */
  label: string;
};

const GOAL_ID_PATTERN = /\bG-\d{1,6}\b/gi;

export type ResolveTaskSignalNodesInput = {
  task: string;
  /** Already-resolved candidate projects for this task's repo/filePaths (from `resolveCandidateProjects`), reused rather than re-deriving path->project matching. */
  projectResolution?: ProjectResolution;
  /** Explicit project filter, if the caller named one directly. */
  project?: string;
};

/**
 * Resolve the task signals `planContextBundle` already has in hand into
 * graph nodes: file paths/repo (via the already-computed `projectResolution`
 * candidate projects, or an explicit `project` filter), `G-###` mentions in
 * the task text, and person mentions (scanned against the people index's
 * existing fuzzy resolver — no new parser). Pure and synchronous; callers
 * that also want a graph walk do that separately via `computeGraphProximityBoosts`.
 */
export function resolveTaskSignalNodes(
  input: ResolveTaskSignalNodesInput,
  peopleIndex: PeopleIndex,
): TaskSignalNode[] {
  const signals: TaskSignalNode[] = [];
  const seen = new Set<string>();
  const add = (nodeId: string, label: string): void => {
    if (seen.has(nodeId)) {
      return;
    }
    seen.add(nodeId);
    signals.push({ nodeId, label });
  };

  // File paths -> project, via the candidate-project resolution the planner
  // already computes from filePaths/repo (resolveCandidateProjects). Each
  // filePath/repo-derived candidate's project becomes a signal node.
  if (input.projectResolution) {
    for (const candidate of input.projectResolution.candidates) {
      add(projectNodeId(candidate.project), `file path -> project ${candidate.project}`);
    }
  }
  if (input.project?.trim()) {
    add(projectNodeId(input.project.trim()), `project ${input.project.trim()}`);
  }

  // G-### mentions in the task text.
  const goalMatches = input.task.match(GOAL_ID_PATTERN) ?? [];
  for (const match of goalMatches) {
    const normalized = match.toUpperCase();
    add(goalNodeId(normalized), normalized);
  }

  // Person mentions: scan whitespace-delimited-ish word runs of the task text
  // against the existing person/team fuzzy resolver (PeopleIndex.resolveOwner),
  // the same resolver task-owner resolution already uses elsewhere. This is a
  // bounded scan (candidate substrings of the task text), not a new NLP
  // pipeline: single tokens and adjacent two-token runs only.
  for (const candidate of personMentionCandidates(input.task)) {
    const match = peopleIndex.resolveOwner(candidate);
    if (!match) {
      continue;
    }
    if (match.kind === "person") {
      add(personNodeId(match.person.id), `person ${match.person.displayName}`);
    } else {
      add(teamNodeId(match.team.id), `team ${match.team.displayName}`);
    }
  }

  return signals;
}

/** Extract single-word and adjacent-two-word candidate substrings from task text for person/team fuzzy resolution, skipping tiny/numeric tokens that would never resolve and G-### tokens already handled above. */
function personMentionCandidates(task: string): string[] {
  const words = task
    .replace(/[.,;:!?()[\]{}"']/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !/^G-\d+$/i.test(word) && !/^\d+$/.test(word));

  const candidates: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    candidates.push(words[i]);
    if (i + 1 < words.length) {
      candidates.push(`${words[i]} ${words[i + 1]}`);
    }
  }
  return candidates;
}

export type GraphProximityBoost = {
  boost: number;
  /** Full hop-chain reason, e.g. `graph: file path -> project anchor-mcp -> anchor projects/anchor-mcp/milestones/m8.md (anchor_project) (+8)` — every boost must be verifiable by reading this string. */
  reason: string;
};

/** Points awarded per hop distance (hop 1 = direct neighbor of a signal node, hop 2 = one hop further), floored at 1 and capped at `maxBoost` so the bound always holds. */
function pointsForHop(hop: number, maxBoost: number): number {
  const raw = hop === 1 ? maxBoost : Math.ceil(maxBoost / 2);
  return Math.max(1, Math.min(maxBoost, raw));
}

/** One BFS step: the node reached and the edge that reached it (the edge's `from`/`to` may point either way relative to the traversal direction, since the walk follows both). */
type HopStep = { nodeId: string; edge: GraphEdge };

/**
 * Walk the already-built `GraphIndex` outward from each resolved task-signal
 * node, up to 2 hops, in both directions (an anchor might declare a project,
 * or a project's edges might point at containment children — the walk does
 * not assume a direction). Every discovered `anchor:` node gets a bounded
 * boost (never exceeding `maxBoost`) and a reason string reporting the full
 * hop chain that reached it. Deterministic: signal nodes and each node's
 * outgoing/incoming edges are visited in a fixed order (the order the graph
 * index and caller supply them in), and the strongest (closest-hop) boost
 * across all signals is kept for a given anchor, with ties broken toward the
 * earlier-resolved signal.
 */
export async function computeGraphProximityBoosts(
  graph: GraphIndex,
  signals: TaskSignalNode[],
  maxBoost: number,
): Promise<Map<string, GraphProximityBoost>> {
  const boosts = new Map<string, GraphProximityBoost>();
  if (signals.length === 0) {
    return boosts;
  }

  // Goal 0 Phase 2 slice 4: node ids may be keyed v2 (anchor:<anchor-id>,
  // goal:<project>:<goal-id>). `resolveTaskSignalNodes` builds v1 signal ids
  // (unscoped goal id, project node) from the task text, so canonicalize each
  // signal to reach the current node — and, since the boost map is keyed by
  // ANCHOR NAME (contextPlanner looks it up by `anchor.name`), resolve each
  // discovered v2 anchor node back to its name via the compatibility map.
  const compat = await graph.identityCompatibilityMap();
  const anchorNameForNodeId = (nodeId: string): string => {
    // v2 anchor node -> v1 anchor node (anchor:<path>) via toV1, then strip the
    // prefix to the anchor name. A v1 node (no toV1 entry) is already the path.
    const v1 = compat.toV1.get(nodeId) ?? nodeId;
    return v1.slice("anchor:".length);
  };

  // Enforce the hard ceiling for every caller (CLI, programmatic, tests), not
  // only the CLI arg parser.
  const boundedMaxBoost = clampGraphScoringMaxBoost(maxBoost);
  for (const signal of signals) {
    const canonicalSignal: TaskSignalNode = {
      ...signal,
      nodeId: compat.toV2.get(signal.nodeId) ?? signal.nodeId,
    };
    await walkFromSignal(graph, canonicalSignal, boundedMaxBoost, boosts, anchorNameForNodeId);
  }

  return boosts;
}

async function walkFromSignal(
  graph: GraphIndex,
  signal: TaskSignalNode,
  maxBoost: number,
  boosts: Map<string, GraphProximityBoost>,
  anchorNameForNodeId: (nodeId: string) => string,
): Promise<void> {
  type Frontier = { nodeId: string; hopPath: HopStep[] };
  let frontier: Frontier[] = [{ nodeId: signal.nodeId, hopPath: [] }];
  const visited = new Set<string>([signal.nodeId]);

  for (let hop = 1; hop <= PROXIMITY_MAX_DEPTH; hop += 1) {
    const nextFrontier: Frontier[] = [];

    for (const current of frontier) {
      const edges = await edgesBothDirections(graph, current.nodeId);
      for (const edge of edges) {
        const targetId = edge.from === current.nodeId ? edge.to : edge.from;
        if (visited.has(targetId)) {
          continue;
        }
        visited.add(targetId);
        const hopPath = [...current.hopPath, { nodeId: targetId, edge }];
        nextFrontier.push({ nodeId: targetId, hopPath });

        if (targetId.startsWith("anchor:")) {
          // Key the boost by anchor NAME (contextPlanner looks it up by
          // `anchor.name`), resolving a v2 anchor node id back to its name.
          const anchorName = anchorNameForNodeId(targetId);
          const points = pointsForHop(hop, maxBoost);
          const existing = boosts.get(anchorName);
          // Keep the strongest (closest-hop) boost across all signals: a later
          // signal that reaches this anchor in fewer hops should win over an
          // earlier, farther one. Ties keep the earlier-resolved signal, so the
          // result stays deterministic.
          if (!existing || points > existing.boost) {
            boosts.set(anchorName, {
              boost: points,
              reason: `graph: ${signal.label} ${formatHopPath(hopPath)} (+${points})`,
            });
          }
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) {
      break;
    }
  }
}

async function edgesBothDirections(graph: GraphIndex, nodeId: string): Promise<GraphEdge[]> {
  const [forward, reverse] = await Promise.all([graph.edgesFrom(nodeId), graph.edgesTo(nodeId)]);
  return dedupeEdges([...forward, ...reverse]);
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from} ${edge.to} ${edge.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(edge);
  }
  return out;
}

/** Render a hop chain as `-> <node> (<edge-type>)` segments — each segment names both the node reached at that step and the edge type that reached it, so a reviewer can verify the chain without cross-referencing the graph. */
function formatHopPath(hopPath: HopStep[]): string {
  return hopPath.map((step) => `-> ${describeNode(step.nodeId)} (${step.edge.type})`).join(" ");
}

function describeNode(nodeId: string): string {
  const idx = nodeId.indexOf(":");
  if (idx === -1) {
    return nodeId;
  }
  const type = nodeId.slice(0, idx);
  const rest = nodeId.slice(idx + 1);
  return `${type} ${rest}`;
}
