/**
 * Graph identity contract (Goal 0 Phase 1, WP1:
 * `goal0_semantic_substrate_implementation_plan.md`; background design in
 * `knowledge_graph_visualization_design_and_roadmap.md`, "Goal 0 -- Structured
 * anchor substrate and graph contract").
 *
 * This module is purely additive: it introduces v2 identity constructors and
 * a compatibility map alongside the v1 constructors already in
 * `src/graph/model.ts`. It does not change what `GraphIndex`/`extract.ts`
 * emit today, does not re-key any existing node id, and does not switch any
 * extraction path over to v2. That migration is Phase 2.
 *
 * Decisions already made (do not re-litigate; see the plan's "Decisions
 * already made" section):
 *   1. `anchor_id` format mirrors `mintClaimId` exactly: `a-` + 6 random
 *      base36 chars, grown to 8 on collision. Server-minted, opaque,
 *      immutable, never content-derived.
 *   2. Scoped goal identity (v2): `goal:<project-slug>:<goal-id>`. The
 *      existing unscoped `goal:<goal-id>` node id (see `goalNodeId` in
 *      `model.ts`) remains the live default until the re-key phase.
 *   3. Section ids stay derived from normalized headings (no change).
 */

import { mintPrefixedId } from "../ids.js";

/** Current graph identity contract version this module implements. */
export const GRAPH_IDENTITY_VERSION = 2;

/** `a-` + 6-8 lowercase base36 chars — mirrors claim id shape (`c-...`) in `src/claims.ts`. */
export const ANCHOR_ID_PATTERN = /^a-[0-9a-z]{6,8}$/;

/** True when `value` matches the server-minted `anchor_id` format. */
export function isValidAnchorId(value: string): boolean {
  return ANCHOR_ID_PATTERN.test(value);
}

/**
 * Mint a new anchor id: `a-` + 6 random base36 chars, grown to 8 chars on
 * collision against `existing` — the same collision-growth algorithm as
 * `mintClaimId` (`src/claims.ts`), sharing its `mintPrefixedId` primitive
 * (`src/ids.ts`) so both mint algorithms are byte-identical by construction.
 */
export function mintAnchorId(existing: ReadonlySet<string>): string {
  return mintPrefixedId("a", existing);
}

// ---------------------------------------------------------------------------
// V2 canonical node-id constructors.
//
// These live ALONGSIDE (never replacing) the v1 constructors in
// `src/graph/model.ts`. Nothing in this phase calls these from extraction;
// they exist so the identity contract can be specified, fixtured, and tested
// before any canonical id changes.
// ---------------------------------------------------------------------------

/** V2 anchor node id, keyed by the anchor's immutable server-minted `anchor_id` rather than its (renameable) path. */
export function anchorNodeIdV2(anchorId: string): string {
  return `anchor:${anchorId}`;
}

/** V2 scoped goal node id: `goal:<project-slug>:<goal-id>` — distinct goal nodes per project, unlike v1's unscoped `goal:<goal-id>` (`goalNodeId` in `model.ts`). */
export function goalNodeIdV2(projectSlug: string, goalId: string): string {
  return `goal:${projectSlug}:${goalId}`;
}

/** V2 milestone node id, keyed by the milestone anchor's `anchor_id`. */
export function milestoneNodeIdV2(anchorId: string): string {
  return `milestone:${anchorId}`;
}

/** V2 task node id, scoped by the owning milestone anchor's `anchor_id` (stable parent identity) rather than its path. */
export function taskNodeIdV2(anchorId: string, taskId: string): string {
  return `task:${anchorId}#${taskId}`;
}

/** V2 section node id, scoped by the owning anchor's `anchor_id`. Heading normalization is unchanged (decision 3). */
export function sectionNodeIdV2(anchorId: string, normalizedHeading: string): string {
  return `section:${anchorId}#${normalizedHeading}`;
}

/** V2 claim node id, scoped by the owning anchor's `anchor_id` rather than its path. */
export function claimNodeIdV2(anchorId: string, claimId: string): string {
  return `claim:${anchorId}#${claimId}`;
}

// ---------------------------------------------------------------------------
// Front-matter read helper.
// ---------------------------------------------------------------------------

/**
 * Read a front-matter `anchor_id` value without validating or coercing it —
 * callers that need format validation should also check `isValidAnchorId`.
 * A missing or non-string value returns `undefined` (a coverage finding in
 * WP5, never a validator violation per the plan's validation posture).
 */
export function anchorIdFromFrontmatter(fm: Record<string, unknown> | undefined): string | undefined {
  const value = fm?.anchor_id;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Identity compatibility map.
// ---------------------------------------------------------------------------

/** One v1<->v2 node id pair the compatibility map can resolve in either direction. */
export type IdentityCompatibilityEntry = {
  v1: string;
  v2: string;
};

/**
 * Bidirectional lookup between a v1 node id and its v2 equivalent, built from
 * (anchorName -> anchorId) and (goalId -> projectSlug) mappings the caller
 * supplies (e.g. read off front matter / roadmap headings during a tree
 * scan). Records lacking the inputs needed to compute a v2 id (most commonly:
 * an anchor with no `anchor_id`) are reported in `unmapped` rather than
 * silently dropped, since "this v1 id has no v2 equivalent yet" is itself a
 * fact WP5's coverage analysis needs.
 */
export type IdentityCompatibilityMap = {
  /** v1 node id -> v2 node id. */
  toV2: ReadonlyMap<string, string>;
  /** v2 node id -> v1 node id. */
  toV1: ReadonlyMap<string, string>;
  /** Every entry successfully mapped in both directions. */
  entries: readonly IdentityCompatibilityEntry[];
  /** v1 anchor node ids that could not be mapped (no known `anchor_id`), with the reason. */
  unmapped: readonly { v1: string; reason: "missing_anchor_id" | "missing_project_slug" }[];
};

export type BuildIdentityCompatibilityMapInput = {
  /** Every anchor's v1 name -> its `anchor_id`, when known. Anchors absent from this map, or mapped to `undefined`, are reported unmapped. */
  anchorIdByName: ReadonlyMap<string, string | undefined>;
  /** Every goal id -> the project slug that scopes it (e.g. from the roadmap anchor that defines the goal heading). Goal ids absent from this map are reported unmapped. */
  projectSlugByGoalId: ReadonlyMap<string, string | undefined>;
};

/**
 * Build the v1<->v2 compatibility map for anchor and goal node ids. Milestone,
 * task, section, and claim v2 ids all key off the SAME anchor's `anchor_id`
 * as the anchor mapping (a milestone is an anchor; a task/section/claim is
 * scoped by its owning anchor) — see `buildIdentityCompatibilityMapEntries`.
 */
export function buildIdentityCompatibilityMap(
  input: BuildIdentityCompatibilityMapInput,
): IdentityCompatibilityMap {
  const toV2 = new Map<string, string>();
  const toV1 = new Map<string, string>();
  const entries: IdentityCompatibilityEntry[] = [];
  const unmapped: { v1: string; reason: "missing_anchor_id" | "missing_project_slug" }[] = [];

  const addEntry = (v1: string, v2: string): void => {
    toV2.set(v1, v2);
    toV1.set(v2, v1);
    entries.push({ v1, v2 });
  };

  for (const [anchorName, anchorId] of input.anchorIdByName) {
    const v1 = `anchor:${anchorName}`;
    if (!anchorId) {
      unmapped.push({ v1, reason: "missing_anchor_id" });
      continue;
    }
    addEntry(v1, anchorNodeIdV2(anchorId));
  }

  for (const [goalId, projectSlug] of input.projectSlugByGoalId) {
    const v1 = `goal:${goalId}`;
    if (!projectSlug) {
      unmapped.push({ v1, reason: "missing_project_slug" });
      continue;
    }
    addEntry(v1, goalNodeIdV2(projectSlug, goalId));
  }

  return { toV2, toV1, entries, unmapped };
}
