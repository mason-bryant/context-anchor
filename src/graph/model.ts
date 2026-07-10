/**
 * Minimal graph node-id vocabulary needed by WP2 (canonical source ids).
 * The full node/edge model (anchors, projects, milestones, tasks, etc.) lands
 * with WP3's derived graph index; this file only defines the source-node
 * kinds that `parseClaimSource` classifies today.
 */

export type ClaimSourceNodeType = "pr" | "file" | "anchor" | "section" | "url" | "person";

export type ParsedSourceNode = {
  /** Canonical, deterministic node id for this source. */
  nodeId: string;
  type: ClaimSourceNodeType;
  /** Optional human-facing label distinct from the raw src string. */
  display?: string;
};
