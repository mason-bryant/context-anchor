/**
 * Typed relation vocabulary (Goal 0 Phase 1, WP3:
 * `goal0_semantic_substrate_implementation_plan.md`; background design in
 * `knowledge_graph_visualization_design_and_roadmap.md`, "Goal 0 -- Structured
 * anchor substrate and graph contract" — "Register the initial typed relation
 * vocabulary, direction, allowed source kinds, allowed target kinds, and
 * whether each relation is symmetric").
 *
 * This module is purely additive: a registry of relation keys plus a target
 * parser. Nothing here changes `extract.ts`'s existing `anchor_anchor`
 * fallback behavior for unregistered keys or unparseable targets — WP3 wires
 * successfully parsed, kind-valid targets into new typed edges ALONGSIDE that
 * fallback, never replacing it.
 *
 * `derived_from` / `contradicts` are deliberately NOT registered here: they
 * stay claim-annotation grammar in `src/claims.ts` (parsed off annotation
 * rows, not front-matter `relations.*` arrays) and are already reserved
 * `GraphEdgeType` union members in `src/graph/model.ts`. Duplicating them in
 * this front-matter-relation vocabulary would conflate two different grammars
 * that happen to share a name.
 */

export type RelationNodeKind = "anchor" | "milestone" | "task" | "goal" | "person" | "team";

export type RelationVocabularyEntry = {
  /** The front-matter `relations.<key>` key this entry governs. */
  key: string;
  /** Edge direction semantics: "directed" (from -> to) or "symmetric" (no privileged direction). */
  direction: "directed" | "symmetric";
  /** Node kinds the relation may originate from (the anchor declaring `relations.<key>`). */
  sourceKinds: readonly RelationNodeKind[];
  /** Node kinds a target may resolve to. */
  targetKinds: readonly RelationNodeKind[];
  /** True when the relation reads the same both directions (e.g. `related_to`). */
  symmetric: boolean;
};

/**
 * The locked initial vocabulary (plan WP3, exactly these five keys).
 * `sourceKinds` for every entry here is anchor-shaped ("anchor" covers plain
 * context anchors; "milestone"/"task" are additionally listed on `implements`
 * and `owned_by` because those keys are meaningful from a milestone or task,
 * not just a generic anchor).
 */
export const RELATION_VOCABULARY: readonly RelationVocabularyEntry[] = [
  {
    key: "depends_on",
    direction: "directed",
    sourceKinds: ["anchor"],
    targetKinds: ["anchor"],
    symmetric: false,
  },
  {
    key: "implements",
    direction: "directed",
    sourceKinds: ["anchor", "milestone", "task"],
    targetKinds: ["goal"],
    symmetric: false,
  },
  {
    key: "supersedes",
    direction: "directed",
    sourceKinds: ["anchor"],
    targetKinds: ["anchor"],
    symmetric: false,
  },
  {
    key: "related_to",
    direction: "symmetric",
    sourceKinds: ["anchor"],
    targetKinds: ["anchor"],
    symmetric: true,
  },
  {
    key: "owned_by",
    direction: "directed",
    sourceKinds: ["anchor", "goal", "task"],
    targetKinds: ["person", "team"],
    symmetric: false,
  },
] as const;

const VOCABULARY_BY_KEY = new Map(RELATION_VOCABULARY.map((entry) => [entry.key, entry]));

/** Look up a relation key's registry entry, or undefined for an unregistered key (legacy `anchor_anchor` fallback territory). */
export function relationVocabularyEntry(key: string): RelationVocabularyEntry | undefined {
  return VOCABULARY_BY_KEY.get(key);
}

// ---------------------------------------------------------------------------
// Target parsing.
// ---------------------------------------------------------------------------

/** Reason a target string failed to parse as any recognized shape. */
export type RelationTargetParseFailureReason = "empty" | "unrecognized_shape";

export type ParsedRelationTarget =
  | { kind: "anchor"; id: string }
  | { kind: "goal"; projectSlug: string; goalId: string }
  | { kind: "person"; id: string }
  | { kind: "team"; id: string };

/**
 * Result of parsing one `relations.<key>` array entry. `legacy: true` means
 * the string was read as a bare legacy target (anchor path/name) rather than
 * a canonical typed ref — still potentially resolvable, just not in the new
 * canonical shape. `parsed` is only present for canonical typed refs;
 * `legacy` entries carry their raw string for the caller's existing
 * bare-anchor resolution path (unchanged from today's `anchor_anchor`
 * handling).
 */
export type RelationTargetParseResult = {
  raw: string;
  legacy: boolean;
  parsed?: ParsedRelationTarget;
  /** Present when the raw string looked like a canonical typed ref (had a recognized prefix) but failed to parse — e.g. `goal:onlyoneslug`. Distinguishes "malformed typed ref" from "legacy bare string" for WP5 coverage. */
  malformedReason?: string;
};

const GOAL_REF_PATTERN = /^goal:([^:]*):(.*)$/;
const ANCHOR_REF_PATTERN = /^anchor:(.*)$/;
const PERSON_REF_PATTERN = /^person:(.*)$/;
const TEAM_REF_PATTERN = /^team:(.*)$/;

/**
 * Parse one relation target string into a canonical typed ref
 * (`anchor:a-xxxxxx`, `goal:<project-slug>:G-123`, `person:<id>`,
 * `team:<id>`) or fall back to treating it as a legacy bare string (anchor
 * path/name — the only shape `relations.*` targets could be before this
 * phase). Does not resolve the target against the tree (existence,
 * ambiguity) — that is `extract.ts`'s (for edges) and WP5 coverage's job.
 */
export function parseRelationTarget(raw: string): RelationTargetParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { raw, legacy: true, malformedReason: "empty" };
  }

  const goalMatch = GOAL_REF_PATTERN.exec(trimmed);
  if (goalMatch) {
    const [, projectSlug, goalId] = goalMatch;
    if (!projectSlug.trim() || !goalId.trim()) {
      return { raw, legacy: false, malformedReason: "goal ref requires <project-slug>:<goal-id>" };
    }
    return {
      raw,
      legacy: false,
      parsed: { kind: "goal", projectSlug: projectSlug.trim(), goalId: goalId.trim() },
    };
  }

  const anchorMatch = ANCHOR_REF_PATTERN.exec(trimmed);
  if (anchorMatch) {
    const id = anchorMatch[1].trim();
    if (!id) {
      return { raw, legacy: false, malformedReason: "anchor ref requires a non-empty id" };
    }
    return { raw, legacy: false, parsed: { kind: "anchor", id } };
  }

  const personMatch = PERSON_REF_PATTERN.exec(trimmed);
  if (personMatch) {
    const id = personMatch[1].trim();
    if (!id) {
      return { raw, legacy: false, malformedReason: "person ref requires a non-empty id" };
    }
    return { raw, legacy: false, parsed: { kind: "person", id } };
  }

  const teamMatch = TEAM_REF_PATTERN.exec(trimmed);
  if (teamMatch) {
    const id = teamMatch[1].trim();
    if (!id) {
      return { raw, legacy: false, malformedReason: "team ref requires a non-empty id" };
    }
    return { raw, legacy: false, parsed: { kind: "team", id } };
  }

  // No recognized canonical prefix: legacy bare string (anchor path/name),
  // exactly what every `relations.*` target looked like before this phase.
  return { raw, legacy: true };
}

/** True when a parsed target's kind is one of `targetKinds` for the given vocabulary entry. */
export function relationTargetKindAllowed(
  entry: RelationVocabularyEntry,
  parsed: ParsedRelationTarget,
): boolean {
  return (entry.targetKinds as readonly string[]).includes(parsed.kind);
}
