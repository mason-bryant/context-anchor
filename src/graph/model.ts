/**
 * Graph node/edge model (WP3 of the claim knowledge graph plan).
 *
 * WP2 only needed the source-node vocabulary `parseClaimSource` classifies
 * (`ClaimSourceNodeType` / `ParsedSourceNode`, kept below unchanged). WP3
 * extends this file with canonical node-id constructors for every remaining
 * node kind the derived graph index covers, plus the edge model itself.
 *
 * Design refs: `claim_provenance_and_knowledge_graph_design.md` part 3
 * (Nodes / Edges tables); `claim_graph_implementation_plan.md` WP3.
 */

// ---------------------------------------------------------------------------
// Source nodes (WP2 — unchanged; `parseClaimSource` classifies claim `src`
// strings into these node kinds).
// ---------------------------------------------------------------------------

export type ClaimSourceNodeType = "pr" | "file" | "anchor" | "section" | "url" | "person";

export type ParsedSourceNode = {
  /** Canonical, deterministic node id for this source. */
  nodeId: string;
  type: ClaimSourceNodeType;
  /** Optional human-facing label distinct from the raw src string. */
  display?: string;
};

// ---------------------------------------------------------------------------
// Full node vocabulary (WP3).
// ---------------------------------------------------------------------------

/**
 * Every node kind the derived graph index materializes. Source-node kinds
 * (`pr` | `file` | `anchor` | `section` | `url` | `person`) are shared with
 * `ClaimSourceNodeType` above — a claim source and, say, a task owner can
 * resolve to the exact same `person:<id>` node.
 */
export type GraphNodeType =
  | ClaimSourceNodeType
  | "project"
  | "goal"
  | "milestone"
  | "task"
  | "team"
  | "repo"
  | "path"
  | "claim";

/** Minimal node shape for WP3. Extend with display/meta fields as WP4 needs them. */
export type GraphNode = {
  id: string;
  type: GraphNodeType;
  display?: string;
};

// --- Node-id constructors ---------------------------------------------------
// One constructor per node kind, each a pure deterministic string function so
// two extractors that independently derive "the same thing" always agree on
// its node id. Source-kind constructors (anchor/section/pr/file/url/person)
// intentionally match the id shapes `parseClaimSource` already produces in
// `src/graph/sourceId.ts` (kept there to avoid a churny cross-import; these
// are net-new constructors for the node kinds WP2 did not need).

export function anchorNodeId(anchorName: string): string {
  return `anchor:${anchorName}`;
}

export function projectNodeId(projectSlug: string): string {
  return `project:${projectSlug}`;
}

export function goalNodeId(goalId: string): string {
  return `goal:${goalId}`;
}

/**
 * Milestones are anchors (`type: project-milestone`) but get a distinct
 * `milestone:` node id from their generic `anchor:` node. The design doc's
 * edge table lists "milestone -> goal" as an edge between distinct node
 * kinds, and a milestone plays graph roles (goal owner, task container) that
 * a generic anchor does not. Every anchor — milestone or not — still gets an
 * `anchor:` node; milestone anchors additionally get this `milestone:` node,
 * connected to their own `anchor:` node via containment so both identities
 * stay reachable.
 */
export function milestoneNodeId(anchorName: string): string {
  return `milestone:${anchorName}`;
}

export function taskNodeId(milestoneAnchorName: string, taskId: string): string {
  return `task:${milestoneAnchorName}#${taskId}`;
}

export function personNodeId(personId: string): string {
  return `person:${personId}`;
}

export function teamNodeId(teamId: string): string {
  return `team:${teamId}`;
}

export function repoNodeId(repoName: string): string {
  return `repo:${repoName}`;
}

/** A project-mappings-configured directory prefix within a repo (distinct from a claim-source `file:` node). */
export function pathNodeId(repoName: string, dirPath: string): string {
  return `path:${repoName}:${dirPath}`;
}

export function prNodeId(repoName: string, prNumber: number): string {
  return `pr:${repoName}#${prNumber}`;
}

export function fileNodeId(repoName: string | undefined, filePath: string): string {
  return repoName ? `file:${repoName}:${filePath}` : `file:?:${filePath}`;
}

export function urlNodeId(normalizedUrl: string): string {
  return `url:${normalizedUrl}`;
}

export function sectionNodeId(anchorName: string, normalizedHeading: string): string {
  return `section:${anchorName}#${normalizedHeading}`;
}

export function claimNodeId(anchorName: string, claimId: string): string {
  return `claim:${anchorName}#${claimId}`;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Every edge type the derived graph index produces or reserves room for.
 * Covers each row of the design doc's part-3 edge table. `claim_source` is a
 * single edge type (not one per source kind) — the design doc lists
 * "claim -> source (PR/file/anchor/person/URL)" as ONE table row, and the
 * target node's own `type` field (pr/file/anchor/person/url) disambiguates
 * which kind of source it is, so the edge type itself does not need to
 * proliferate.
 *
 * `derived_from` and `contradicts` are the two claim-to-claim edge types
 * (design doc part 3 "Exactly two claim-to-claim edge types"), authored via
 * the `derived_from`/`contradicts` annotation grammar keys (`src/claims.ts`,
 * WP5) and emitted by `extractClaimEdges` (`src/graph/extract.ts`). WP3
 * reserved the union entries; WP5 filled in the grammar and extraction.
 */
export type GraphEdgeType =
  | "anchor_project"
  | "milestone_anchor"
  /** True semantic "milestone -> goal" edge (design doc's edge table): a `milestone:` node to a `goal:` node, sourced from `relations.goal_ids` on a `project-milestone` anchor (resolved to its sibling roadmap anchor's goal headings). NOT the roadmap-anchor-to-goal containment edge below — see `roadmap_goal`. */
  | "milestone_goal"
  /** Containment: a `type: project-roadmap` anchor to each `goal:` node its headings define. The `from` side is an `anchor:` node, never a `milestone:` node — distinct from `milestone_goal` above. */
  | "roadmap_goal"
  /**
   * Containment: a `milestone:` node to each `task:` node its front-matter
   * `tasks[]` defines (WP4 addition — the design doc's edge table does not
   * list this row explicitly, but the implementation plan's own Phase-C
   * acceptance note names "graphNeighbors on a milestone returns its goal,
   * project, tasks, and owners" as the capability to verify, and without
   * this edge a task node was reachable only in reverse, from its owner via
   * `task_owner`, never forward from its milestone). Sourced the same way
   * `task_owner` is: `normalizedTasksFromFm` on a `project-milestone`
   * anchor's front matter.
   */
  | "milestone_task"
  | "task_owner"
  | "person_project"
  | "team_project"
  | "project_repo"
  | "repo_path"
  | "anchor_anchor"
  | "claim_source"
  | "claim_person"
  | "claim_section"
  | "section_anchor"
  | "derived_from"
  | "contradicts"
  /**
   * Typed relation vocabulary edges (Goal 0 Phase 1 WP3,
   * `src/relations/vocabulary.ts`): emitted for a `relations.<key>` entry
   * whose key is registered AND whose target parses to a kind-valid,
   * resolved canonical ref. An unregistered key or an unparseable/wrong-kind
   * target keeps today's `anchor_anchor` fallback instead (these five never
   * replace `anchor_anchor`, they are additive). `related_to` is symmetric:
   * `extractRelationsEdges` emits it in both directions.
   */
  | "depends_on"
  | "implements"
  | "supersedes"
  | "related_to"
  | "owned_by";

/**
 * Where an edge's fact was read from. `front-matter` covers project slugs,
 * `relations.*`, and milestone `tasks[].owner`; `registry` covers people RACI
 * and project-mappings repos/paths; `body-link` covers markdown links in
 * anchor bodies; `claim-annotation` covers claim -> source / person / section
 * edges parsed from annotation rows; `containment` covers section -> anchor
 * (and milestone -> anchor) structural containment edges derived from the
 * reference itself rather than an explicit authored fact.
 */
export type GraphEdgeSourceOfTruth = "front-matter" | "registry" | "body-link" | "claim-annotation" | "containment";

export type GraphEdge = {
  from: string;
  to: string;
  type: GraphEdgeType;
  sourceOfTruth: GraphEdgeSourceOfTruth;
};
