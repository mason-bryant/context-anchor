/**
 * Canonical node-id resolvers (Goal 0 Phase 2 slice 4: re-key the derived
 * graph to v2 identities).
 *
 * Phase 1 shipped the v2 constructors (`anchorNodeIdV2`, `goalNodeIdV2`, ...)
 * in `src/graph/identity.ts` but left them dormant — extraction still emitted
 * v1 everywhere. This module is the bridge extraction now routes ALL node-id
 * emission through: each `canonical*NodeId` resolver keys a node v2 when its
 * owning anchor has a valid `anchor_id` (or, for goals, when the goal's
 * scoping project is unambiguously known), and otherwise falls back to the
 * v1 constructor in `src/graph/model.ts`.
 *
 * The core rule (plan's "The core rule"): a node is keyed v2 when its owning
 * anchor has a valid `anchor_id`, else v1. This is inherently gradual — there
 * is NO flag and NO forced tree-wide re-key; legacy (id-less) anchors keep
 * their path-based v1 ids until migrated, id-bearing anchors get v2. Because
 * an edge can target ANOTHER anchor, the resolvers take the tree-wide
 * `anchorName -> anchorId` map (the same `anchorIdByName` `GraphIndex` already
 * builds in pass 1 and threads into the extract context — never re-scanned
 * here) plus, for goals, a `goalId -> projectSlug` resolver.
 *
 * Every function here is pure and deterministic: the same maps yield the same
 * ids, so an incremental update and a clean rebuild agree by construction.
 */

import {
  anchorNodeIdV2,
  claimNodeIdV2,
  goalNodeIdV2,
  milestoneNodeIdV2,
  sectionNodeIdV2,
  taskNodeIdV2,
  type IdentityCompatibilityMap,
} from "./identity.js";
import {
  anchorNodeId,
  claimNodeId,
  goalNodeId,
  milestoneNodeId,
  sectionNodeId,
  taskNodeId,
} from "./model.js";

/**
 * The tree-wide resolution inputs every canonical resolver needs, sourced
 * from `GraphIndex`'s already-built maps (see `buildExtractContext`). Kept as
 * one bag so the extract context carries a single canonical-id resolver
 * surface rather than N loose maps.
 */
export type CanonicalIdResolvers = {
  /** Anchor name (v1 node identity) -> its valid `anchor_id`, or `undefined`/absent when the anchor has no id yet. */
  anchorIdByName: ReadonlyMap<string, string | undefined>;
  /**
   * The single project slug that scopes `goalId` for v2 purposes, or
   * `undefined` when the goal's scope is unknown (defined by no roadmap) or
   * ambiguous (defined by more than one project's roadmap — scoping it to
   * either would be arbitrary, so it stays v1). Sourced from
   * `GraphIndex.goalIdOwnersSnapshot` inverted to a single-owner lookup.
   */
  projectSlugForGoalId: (goalId: string) => string | undefined;
};

/** True when `anchorName` owns a valid `anchor_id` in the tree-wide map. */
function anchorIdFor(anchorName: string, resolvers: CanonicalIdResolvers): string | undefined {
  return resolvers.anchorIdByName.get(anchorName) ?? undefined;
}

/**
 * Canonical anchor node id: `anchor:<anchor-id>` (v2) when `anchorName` owns a
 * valid `anchor_id`, else the path-based `anchor:<anchorName>` (v1). This is
 * the acceptance criterion the whole substrate exists for — an id-bearing
 * anchor's graph identity is its immutable id, so it survives a path rename.
 */
export function canonicalAnchorNodeId(anchorName: string, resolvers: CanonicalIdResolvers): string {
  const anchorId = anchorIdFor(anchorName, resolvers);
  return anchorId ? anchorNodeIdV2(anchorId) : anchorNodeId(anchorName);
}

/** Canonical milestone node id, keyed off the SAME owning anchor's id (v2) or path (v1). */
export function canonicalMilestoneNodeId(anchorName: string, resolvers: CanonicalIdResolvers): string {
  const anchorId = anchorIdFor(anchorName, resolvers);
  return anchorId ? milestoneNodeIdV2(anchorId) : milestoneNodeId(anchorName);
}

/** Canonical task node id, scoped by the owning milestone anchor's id (v2) or path (v1). */
export function canonicalTaskNodeId(anchorName: string, taskId: string, resolvers: CanonicalIdResolvers): string {
  const anchorId = anchorIdFor(anchorName, resolvers);
  return anchorId ? taskNodeIdV2(anchorId, taskId) : taskNodeId(anchorName, taskId);
}

/** Canonical section node id, scoped by the owning anchor's id (v2) or path (v1). Heading normalization is unchanged. */
export function canonicalSectionNodeId(
  anchorName: string,
  normalizedHeading: string,
  resolvers: CanonicalIdResolvers,
): string {
  const anchorId = anchorIdFor(anchorName, resolvers);
  return anchorId ? sectionNodeIdV2(anchorId, normalizedHeading) : sectionNodeId(anchorName, normalizedHeading);
}

/** Canonical claim node id, scoped by the owning anchor's id (v2) or path (v1). */
export function canonicalClaimNodeId(anchorName: string, claimId: string, resolvers: CanonicalIdResolvers): string {
  const anchorId = anchorIdFor(anchorName, resolvers);
  return anchorId ? claimNodeIdV2(anchorId, claimId) : claimNodeId(anchorName, claimId);
}

/**
 * Canonical goal node id: `goal:<project-slug>:<goal-id>` (v2) when the goal's
 * scoping project is unambiguously known, else the unscoped `goal:<goal-id>`
 * (v1). A goal defined by no roadmap, or by more than one project's roadmap
 * (ambiguous — the exact collision scoped goals exist to prevent), stays v1:
 * scoping it to an arbitrary project would be wrong.
 */
export function canonicalGoalNodeId(goalId: string, resolvers: CanonicalIdResolvers): string {
  const projectSlug = resolvers.projectSlugForGoalId(goalId);
  return projectSlug ? goalNodeIdV2(projectSlug, goalId) : goalNodeId(goalId);
}

/**
 * Re-key a v1 `anchor:<anchor-path>` node id (as produced by `parseClaimSource`
 * for a bare-anchor claim source) to the owning anchor's canonical id. The
 * embedded path is looked up in `anchorIdByName`; an id-shaped or unknown value
 * passes through unchanged.
 */
export function canonicalizeAnchorSourceNodeId(anchorNodeIdValue: string, resolvers: CanonicalIdResolvers): string {
  if (!anchorNodeIdValue.startsWith("anchor:")) {
    return anchorNodeIdValue;
  }
  const anchorName = anchorNodeIdValue.slice("anchor:".length);
  return canonicalAnchorNodeId(anchorName, resolvers);
}

/**
 * Re-key a v1 `section:<anchor-path>#<heading>` node id (as produced by
 * `parseClaimSource` for a section claim source) to the owning anchor's
 * canonical id, preserving the normalized heading. The embedded path is looked
 * up in `anchorIdByName`; an id-shaped or unknown value passes through
 * unchanged.
 */
export function canonicalizeSectionNodeId(sectionNodeIdValue: string, resolvers: CanonicalIdResolvers): string {
  if (!sectionNodeIdValue.startsWith("section:")) {
    return sectionNodeIdValue;
  }
  const rest = sectionNodeIdValue.slice("section:".length);
  const hashIndex = rest.indexOf("#");
  if (hashIndex === -1) {
    return sectionNodeIdValue;
  }
  const anchorName = rest.slice(0, hashIndex);
  const heading = rest.slice(hashIndex + 1);
  return canonicalSectionNodeId(anchorName, heading, resolvers);
}

// ---------------------------------------------------------------------------
// Query-time normalization (graph-neighbors route / planner signals).
// ---------------------------------------------------------------------------

/**
 * Normalize an INCOMING node id to its current canonical form, so an old
 * v1/path deep link still resolves to the (now v2) node after re-key.
 *
 * The compatibility map (`buildIdentityCompatibilityMap`) covers the two node
 * kinds whose v1 id does not embed a resolvable anchor path — `anchor:` and
 * `goal:`. Milestone/task/section/claim v1 ids DO embed the owning anchor's
 * path, so they are normalized structurally here: rewrite the embedded anchor
 * path to its `anchor_id` (via `anchorIdByName`) when the owner has one. A
 * node id already in canonical (v2) form, or one whose owner has no id yet,
 * passes through unchanged.
 */
export function canonicalizeNodeId(
  nodeId: string,
  compat: IdentityCompatibilityMap,
  anchorIdByName: ReadonlyMap<string, string | undefined>,
): string {
  // Exact v1 -> v2 hit (anchor: / goal: ids the compat map tracks directly).
  const direct = compat.toV2.get(nodeId);
  if (direct) {
    return direct;
  }

  // Anchor-path-embedding node kinds: milestone:<path>, task:<path>#<id>,
  // section:<path>#<heading>, claim:<path>#<id>. Rewrite the embedded path to
  // its anchor id when known. (An id-shaped middle segment — already v2 —
  // simply won't match any anchor name and passes through unchanged.)
  for (const kind of ["milestone", "task", "section", "claim"] as const) {
    const prefix = `${kind}:`;
    if (!nodeId.startsWith(prefix)) {
      continue;
    }
    const rest = nodeId.slice(prefix.length);
    // milestone has no `#suffix`; the others do. Split on the FIRST `#` so an
    // anchor path (which never legitimately contains `#`) is never truncated.
    const hashIndex = rest.indexOf("#");
    const anchorPart = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
    const suffix = hashIndex === -1 ? "" : rest.slice(hashIndex); // includes the leading '#'
    const anchorId = anchorIdByName.get(anchorPart) ?? undefined;
    if (!anchorId) {
      return nodeId;
    }
    return `${prefix}${anchorId}${suffix}`;
  }

  return nodeId;
}
