/**
 * Effective certainty (WP6 of the claim knowledge graph plan, Phase B).
 *
 * A claim's *stated* confidence (`conf`) is an honest input, not a
 * trustworthy point-in-time score: it does not decay, and it says nothing
 * about whether the cited source is still around. `effectiveCertainty`
 * derives a numeric, reproducible-by-hand score at read time:
 *
 *   effectiveCertainty(row) = base(conf) x decay(now - observed) x liveness(src)
 *
 * computed per source row, then aggregated across a claim's rows by
 * **average** (decision gate D2, resolved 2026-07-10: matches the shipped
 * stated-strength `claimStrength` aggregation, and lets one stale
 * corroborating source drag the claim's score down for the
 * re-verification queue, rather than letting a single strong source paper
 * over a stale one via `max`).
 *
 * Hard acceptance criterion (design doc part 2; implementation plan WP6):
 * zero network calls and zero git subprocesses anywhere in this module.
 * `liveness` only ever consults data the caller already has in memory
 * (anchor/section name sets) or a synchronous local filesystem check the
 * caller injects — never a network fetch, never a `git` invocation.
 *
 * Weakest link (design doc part 3 "Certainty and the graph: weakest link,
 * not propagation"): certainty never blends or propagates numerically
 * across `derived_from` edges. `weakestAncestorCertainty` instead walks the
 * `derived_from` ancestor chain and reports the minimum score on the path,
 * as an inspectable flag *beside* the local score — never folded into it.
 */

import type { ClaimConfidence, AnchorClaim, ClaimSource } from "./claims.js";

/**
 * An `AnchorClaim` (as sidecars already return it) decorated with its
 * computed effective certainty and, when a `derived_from` ancestor path was
 * walked, the weakest-link flag. Both fields are optional additions layered
 * on read — they are never part of the stored annotation grammar
 * (`src/claims.ts` stays the single parser for that) and never persisted.
 */
export type ClaimWithCertainty = AnchorClaim & {
  effectiveCertainty?: EffectiveCertaintyResult;
  weakestAncestor?: WeakestAncestor;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Half-life category a claim's containing anchor falls into for decay purposes. */
export type CertaintyHalfLifeCategory = "agent-rules" | "projects" | "milestones";

export type CertaintyHalfLives = Record<CertaintyHalfLifeCategory, number>;

export type CertaintyConfig = {
  /** Multiplier applied per stated `conf` value before decay/liveness. */
  base: Record<ClaimConfidence, number>;
  /** Exponential decay half-life in days, per anchor category. */
  halfLifeDays: CertaintyHalfLives;
  /**
   * Fallback half-life (days) for an anchor whose category cannot be
   * classified into one of the three buckets above (e.g. `invariants`,
   * `conflicts`, `shared`, `archive`). Uses the `projects` default so
   * unclassified content still decays at a moderate rate rather than never
   * decaying at all.
   */
  defaultHalfLifeDays: number;
  /** Bundle claims scoring below this are flagged in planner `missingContext`. */
  missingContextThreshold: number;
};

/**
 * Defaults per the implementation plan (WP6 step 1) — flagged for operator
 * confirmation at PR time, per the plan's instructions. Chosen to mirror the
 * planner's existing 45-day anchor staleness window: milestones (the
 * fastest-moving content) decay quickest, agent-rules (the slowest-moving)
 * decay slowest.
 */
export const DEFAULT_CERTAINTY_CONFIG: CertaintyConfig = {
  base: { high: 0.9, medium: 0.6, low: 0.3 },
  halfLifeDays: {
    "agent-rules": 180,
    projects: 60,
    milestones: 45,
  },
  defaultHalfLifeDays: 60,
  missingContextThreshold: 0.4,
};

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

/**
 * A source row's classification, in exactly the shape `parseClaimSource`
 * (`src/graph/sourceId.ts`, WP2) already returns — this module never
 * re-classifies a `src` string itself (single-parser-funnel ground rule).
 * `warning` set means the anchor/section side of the reference is dangling
 * (`parseClaimSource`'s own tree-presence check, already local/synchronous);
 * its absence means the node resolved cleanly.
 */
export type LivenessSourceNode = {
  nodeId: string;
  type: "pr" | "file" | "anchor" | "section" | "url" | "person";
};

export type LivenessInput = {
  node?: LivenessSourceNode;
  /** True when `parseClaimSource` flagged this row's section/anchor reference as dangling. */
  dangling?: boolean;
};

/**
 * Everything `liveness()` needs beyond what `parseClaimSource` already
 * resolved, entirely local and synchronous (no network, no git subprocess —
 * see module docstring).
 */
export type LivenessContext = {
  /**
   * Optional synchronous check for whether a `file:<repo>:<path>` node's path
   * exists on disk in a project-mappings-configured local checkout. Absent
   * (or returning `undefined`) means "cannot determine locally" — treated as
   * live (liveness 1.0) rather than penalizing a claim for a checkout the
   * server simply isn't configured to see, per the plan's "only if locally
   * present" instruction.
   */
  fileExistsLocally?: (fileNodeId: string) => boolean | undefined;
};

const LIVE = 1;
const DEAD = 0;

/**
 * `liveness(src)`: 1.0 (live) or 0 (dangling), decided per node type:
 *   - anchor/section: live unless `parseClaimSource` already flagged the
 *     reference as dangling (the same check the write-path
 *     `claim_source_section_missing` warning uses — cheap, local, and
 *     computed once per row by the caller, not re-derived here).
 *   - file (repo-path): checked against a locally-present checkout ONLY if
 *     the caller can answer the question; otherwise defaults live (1.0) —
 *     never penalize for a checkout the server cannot see.
 *   - pr/url/person: always 1.0 — no network calls in this deterministic path.
 * A row with no classifiable source (e.g. a bare trust-me-bro person row,
 * where `node` is undefined) is treated as live: there is nothing to go stale.
 */
export function liveness(input: LivenessInput, ctx: LivenessContext): number {
  const node = input.node;
  if (!node) {
    return LIVE;
  }
  switch (node.type) {
    case "anchor":
    case "section":
      return input.dangling ? DEAD : LIVE;
    case "file": {
      const present = ctx.fileExistsLocally?.(node.nodeId);
      return present === false ? DEAD : LIVE;
    }
    case "pr":
    case "url":
    case "person":
      return LIVE;
  }
}

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between `observed` (YYYY-MM-DD) and `now`; never negative (a future-dated observation decays as if observed today). */
export function ageDays(observed: string, now: Date): number {
  const observedMs = Date.parse(`${observed}T00:00:00Z`);
  if (Number.isNaN(observedMs)) {
    return 0;
  }
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((nowMs - observedMs) / MS_PER_DAY);
  return Math.max(0, diffDays);
}

/** Exponential half-life decay: 1.0 at age 0, 0.5 at one half-life, 0.25 at two, etc. */
export function decay(days: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) {
    return days <= 0 ? 1 : 0;
  }
  return Math.pow(0.5, days / halfLifeDays);
}

/** Resolve which half-life bucket an anchor's category maps to. Non-agent-rules/projects/milestone categories fall back to `defaultHalfLifeDays`. */
export function halfLifeForCategory(category: CertaintyHalfLifeCategory | undefined, config: CertaintyConfig): number {
  if (category) {
    return config.halfLifeDays[category];
  }
  return config.defaultHalfLifeDays;
}

// ---------------------------------------------------------------------------
// Per-row and per-claim certainty
// ---------------------------------------------------------------------------

/** Every factor behind one source row's effective certainty, so a reviewer can reproduce the number by hand: base(conf) x decay x liveness. */
export type SourceRowCertainty = {
  /** 1-based line of the source row this factor set describes, when known. */
  line?: number;
  src: string;
  conf: ClaimConfidence;
  observed: string;
  base: number;
  ageDays: number;
  halfLifeDays: number;
  decay: number;
  liveness: number;
  /** base x decay x liveness for this row. */
  value: number;
};

export type EffectiveCertaintyResult = {
  /** Average of `rows[].value` (decision gate D2) — the claim's effective certainty, 0..1. */
  certainty: number;
  /** Every row's factors, in claim source order, so the aggregate is reproducible by hand. */
  rows: SourceRowCertainty[];
  aggregation: "average";
};

/**
 * Resolve one source row's liveness input (canonical node + dangling flag),
 * as `parseClaimSource` already computes it. Callers that already have
 * `parseClaimSource` results (the graph/service layer) should build this
 * directly rather than re-deriving it; kept as a thin adapter so
 * `certainty.ts` never imports `parseClaimSource` itself (this module has no
 * `ParseClaimSourceContext` — anchor resolution, project mappings, etc. — of
 * its own, and must not reach for git/network to build one; see module
 * docstring).
 */
export type SourceLivenessResolver = (source: ClaimSource) => LivenessInput;

/**
 * `effectiveCertainty(claim, now, config)` — per source row:
 * `base(conf) x decay(now - observed) x liveness(src)`; aggregated across
 * rows by average (D2). Returns the number AND every row's factors.
 *
 * `halfLifeCategory` is resolved once for the claim's containing anchor
 * (all of a claim's rows share the same anchor, hence the same decay
 * bucket) and passed in by the caller (typically via
 * `halfLifeForCategory(classifyAnchorPath(anchorName)...)`), keeping this
 * function free of any taxonomy/path-parsing concerns of its own.
 *
 * An unannotated claim (no sources) has no evidence to score: returns
 * certainty 0 with an empty `rows` array rather than throwing, so callers
 * scanning a mixed claim list never need a pre-filter.
 */
export function effectiveCertainty(
  claim: Pick<AnchorClaim, "sources">,
  now: Date,
  config: CertaintyConfig,
  halfLifeDays: number,
  resolveLiveness: SourceLivenessResolver,
  livenessCtx: LivenessContext,
): EffectiveCertaintyResult {
  const rows: SourceRowCertainty[] = claim.sources.map((source) => {
    const base = config.base[source.conf];
    const age = ageDays(source.observed, now);
    const rowDecay = decay(age, halfLifeDays);
    const rowLiveness = liveness(resolveLiveness(source), livenessCtx);
    return {
      ...(source.line !== undefined ? { line: source.line } : {}),
      src: source.src,
      conf: source.conf,
      observed: source.observed,
      base,
      ageDays: age,
      halfLifeDays,
      decay: rowDecay,
      liveness: rowLiveness,
      value: base * rowDecay * rowLiveness,
    };
  });

  if (rows.length === 0) {
    return { certainty: 0, rows, aggregation: "average" };
  }

  const certainty = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  return { certainty, rows, aggregation: "average" };
}

// ---------------------------------------------------------------------------
// Weakest link over the `derived_from` ancestor path
// ---------------------------------------------------------------------------

export type WeakestAncestor = {
  /** `<anchor>#<claim-id>` of the weakest claim found on the ancestor path (may be the origin claim itself). */
  claim: string;
  certainty: number;
  /** Ordered `<anchor>#<claim-id>` hop path from the origin claim to the weakest ancestor (inclusive of both ends). */
  path: string[];
};

/**
 * One `derived_from` ancestor's identity plus its already-computed effective
 * certainty, as returned by the caller's edge-lookup callback below. Kept as
 * a plain data shape (not `GraphIndex`-typed) so this module stays
 * independent of the graph package and trivially unit-testable.
 */
export type AncestorClaim = {
  /** `<anchor>#<claim-id>` node label for this ancestor. */
  claim: string;
  certainty: number;
};

/**
 * Resolve the `derived_from` targets of one claim (by its `<anchor>#<id>`
 * label), each with its own already-computed effective certainty. Returns an
 * empty array for a claim with no `derived_from` edges (including, today,
 * every claim: WP5 — which authors `derived_from` in the annotation grammar
 * — has not merged yet, so this callback degrades to "no ancestors" for the
 * whole tree until it does; see module docstring / WP6 plan note).
 */
export type DerivedFromLookup = (claimLabel: string) => Promise<AncestorClaim[]> | AncestorClaim[];

/**
 * Weakest link over the `derived_from` ancestor path (design doc part 3):
 * the minimum effective certainty among the origin claim and every claim
 * transitively reachable via `derived_from` edges, with the hop path that
 * produced it. A visited-set guards against cycles (a malformed or
 * adversarial `derived_from` chain must never infinite-loop the traversal).
 *
 * This is a flag BESIDE the local score, never blended into it (design
 * doc's "weakest link, not propagation" rule) — callers report
 * `origin.certainty` and `weakestAncestor` as two separate numbers.
 *
 * Degrades gracefully when no `derived_from` edges exist in the tree (the
 * expected state until WP5 ships): `lookup` returns `[]` for every claim, so
 * the traversal visits only the origin and returns the origin itself as its
 * own weakest ancestor with a single-element path — exactly the "no graph
 * data yet" answer a caller should get, with no special-casing required.
 */
export async function weakestAncestorCertainty(
  originClaim: string,
  originCertainty: number,
  lookup: DerivedFromLookup,
): Promise<WeakestAncestor> {
  const visited = new Set<string>([originClaim]);
  let weakest: WeakestAncestor = { claim: originClaim, certainty: originCertainty, path: [originClaim] };

  // BFS so `path` is always the shortest hop chain to whichever ancestor
  // turns out weakest, not an arbitrary DFS-discovery-order chain.
  const queue: { claim: string; path: string[] }[] = [{ claim: originClaim, path: [originClaim] }];

  while (queue.length > 0) {
    const current = queue.shift() as { claim: string; path: string[] };
    const ancestors = await lookup(current.claim);
    for (const ancestor of ancestors) {
      if (visited.has(ancestor.claim)) {
        continue;
      }
      visited.add(ancestor.claim);
      const path = [...current.path, ancestor.claim];
      if (ancestor.certainty < weakest.certainty) {
        weakest = { claim: ancestor.claim, certainty: ancestor.certainty, path };
      }
      queue.push({ claim: ancestor.claim, path });
    }
  }

  return weakest;
}
