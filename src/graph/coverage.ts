/**
 * Structural coverage analysis (Goal 0 Phase 1, WP5:
 * `goal0_semantic_substrate_implementation_plan.md`; background design in
 * `knowledge_graph_visualization_design_and_roadmap.md`, "Goal 0 -- Structured
 * anchor substrate and graph contract" — "Add structural-coverage analysis
 * for structured, partial, prose-only, ambiguous, dangling, and malformed
 * records").
 *
 * Pure function over already-parsed documents and registries — no I/O, no
 * git, no filesystem access, following the exact purity pattern
 * `src/graph/extract.ts` establishes (`GraphIndex` is the only caller that
 * touches storage, and it does so before calling in). Read-only: nothing
 * here validates a write, mutates content, or mints an id. See the plan's
 * WP5 "State rules (exact)" section for the precedence and definition of
 * each state this module assigns.
 */

import { AnchorFrontmatterSchema } from "../validators/frontMatter.js";
import { extractClaims } from "../claims.js";
import { classifyAnchorPath } from "../taxonomy.js";
import { anchorIdFromFrontmatter, isValidAnchorId } from "./identity.js";
import { relationVocabularyEntry, parseRelationTarget, relationTargetKindAllowed } from "../relations/vocabulary.js";
import type { AnchorClaim } from "../claims.js";

export type CoverageState = "structured" | "partial" | "prose_only" | "ambiguous" | "dangling" | "malformed";

/** Stable, machine-readable finding code plus a human message and (when cheaply available) a source location. */
export type CoverageReason = {
  code: string;
  message: string;
  /** Anchor name the finding applies to (always present — every finding is anchor-scoped even for a claim-level record). */
  anchorName: string;
  /** 1-based source line, when cheaply available (e.g. a specific relation target or claim bullet). */
  line?: number;
  /** The section/H2 heading the finding concerns, when applicable. */
  heading?: string;
};

/** Descriptive-only in this phase (plan: "previewable migration operations" ship in Phase 2). */
export type SuggestedOperation = {
  code: "mint_anchor_id" | "scope_goal_reference" | "convert_relation" | "add_schema_version" | "mint_claim_id";
  message: string;
};

export type AnchorCoverageRecord = {
  anchorName: string;
  /** Project slug from path classification, when the anchor lives under `projects/<slug>/...`. */
  projectSlug?: string;
  /** Front-matter `type` (joined with `+` for array types), or "untyped" when absent. */
  anchorType: string;
  state: CoverageState;
  reasons: CoverageReason[];
  suggestedOperations: SuggestedOperation[];
};

export type ClaimCoverageRecord = {
  anchorName: string;
  /** 1-based claim bullet line, for stable identification within the anchor. */
  line: number;
  claimId?: string;
  /** The claim's bullet text (no leading `- `, no trailing annotation block) — carried so a graph projection can label a claim node with its text instead of its opaque id. */
  text: string;
  state: CoverageState;
  reasons: CoverageReason[];
  suggestedOperations: SuggestedOperation[];
};

export type DuplicateAnchorIdFinding = {
  anchorId: string;
  anchorNames: string[];
};

export type CoverageSummary = {
  totalAnchors: number;
  totalClaims: number;
  byState: Record<CoverageState, number>;
  byProject: Record<string, Partial<Record<CoverageState, number>>>;
  byAnchorType: Record<string, Partial<Record<CoverageState, number>>>;
  duplicateAnchorIdCount: number;
};

export type CoverageAnalysisResult = {
  anchors: AnchorCoverageRecord[];
  claims: ClaimCoverageRecord[];
  duplicateAnchorIds: DuplicateAnchorIdFinding[];
  summary: CoverageSummary;
};

/** Per-document input, mirroring `DocumentInput` (`src/graph/extract.ts`) so callers building both structures share the same shape. */
export type CoverageDocumentInput = {
  anchorName: string;
  frontmatter: Record<string, unknown>;
  content: string;
};

export type CoverageAnalysisContext = {
  /** Every known anchor/goal/person/team name, for relation-target existence checks (mirrors `ExtractDocumentEdgesContext`). */
  anchorNames: ReadonlySet<string>;
  resolveAnchorName: (value: string) => string | undefined;
  resolveProjectSlug: (slug: string) => string | undefined;
  /**
   * Every anchor name declaring the given `anchor_id` (same underlying
   * lookup `extract.ts`'s `resolveAnchorId` uses, but returning every match
   * rather than picking one) — 0 candidates is dangling, exactly 1 is
   * resolved, 2+ is ambiguous (a duplicated `anchor_id` referenced from
   * elsewhere: the anchors that declared the duplicate are themselves
   * `malformed`, per the plan's "duplicate anchor_id across the tree" rule;
   * a *reference* to that duplicated id is `ambiguous`, a distinct state
   * from the malformed anchors that caused it).
   */
  anchorNamesForAnchorId: (anchorId: string) => readonly string[];
  /** True when the goal id is defined by a roadmap belonging to the given canonical project slug (PROJECT-SCOPED, matching extract.ts's typed-goal resolution). */
  goalExistsInProject: (projectSlug: string, goalId: string) => boolean;
  personExists: (id: string) => boolean;
  teamExists: (id: string) => boolean;
};

/**
 * Analyze structural coverage across every document in the tree. Pure: takes
 * already-parsed documents plus the same kind of resolver context
 * `extract.ts` uses, returns per-anchor and per-claim records plus tree-level
 * summaries. Order of `anchors`/`claims` in the output follows the input
 * document order; summaries are computed from those same records so
 * "coverage counts... agree for the same graph generation" (design doc
 * acceptance criterion) holds by construction — the summary is never a
 * separate pass that could drift from the records.
 */
export function analyzeCoverage(
  docs: readonly CoverageDocumentInput[],
  ctx: CoverageAnalysisContext,
): CoverageAnalysisResult {
  const anchorIdOwners = new Map<string, string[]>();
  for (const doc of docs) {
    const anchorId = anchorIdFromFrontmatter(doc.frontmatter);
    if (anchorId && isValidAnchorId(anchorId)) {
      const owners = anchorIdOwners.get(anchorId) ?? [];
      owners.push(doc.anchorName);
      anchorIdOwners.set(anchorId, owners);
    }
  }
  // Sorted by anchorId so the findings list (and therefore API responses)
  // is deterministic regardless of the docs' Map-insertion/read order.
  const duplicateAnchorIds: DuplicateAnchorIdFinding[] = [...anchorIdOwners.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([anchorId, anchorNames]) => ({ anchorId, anchorNames: [...anchorNames].sort() }))
    .sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  const duplicatedAnchorIdSet = new Set(duplicateAnchorIds.map((entry) => entry.anchorId));

  const anchors: AnchorCoverageRecord[] = [];
  const claims: ClaimCoverageRecord[] = [];

  for (const doc of docs) {
    anchors.push(analyzeAnchorCoverage(doc, ctx, duplicatedAnchorIdSet));
    for (const claim of extractClaims(doc.content)) {
      claims.push(analyzeClaimCoverage(doc.anchorName, claim));
    }
  }

  const summary = summarizeCoverage(anchors, claims, duplicateAnchorIds);

  return { anchors, claims, duplicateAnchorIds, summary };
}

// ---------------------------------------------------------------------------
// Per-anchor analysis.
// ---------------------------------------------------------------------------

/**
 * Exported for `src/validators/anchorSchemaEnforcement.ts` (Goal 0 Phase 2
 * slice 3b: `goal0_phase2_enforcement_mode_plan.md`), so the write-time
 * enforcement validator derives its "fully structured" decision from the
 * exact same predicates this module's tree-wide `analyzeCoverage` uses,
 * rather than inventing a second notion of structuredness. Callers scoring a
 * single in-flight write (not a tree-wide pass) should pass an empty
 * `duplicatedAnchorIdSet`: tree-wide `anchor_id` duplication is already an
 * always-BLOCK invariant owned by `validateAnchorIdIntegrity`, orthogonal to
 * "is this anchor's OWN structure complete."
 */
export function analyzeAnchorCoverage(
  doc: CoverageDocumentInput,
  ctx: CoverageAnalysisContext,
  duplicatedAnchorIdSet: ReadonlySet<string>,
): AnchorCoverageRecord {
  const classification = classifyAnchorPath(doc.anchorName);
  const projectSlug = classification.kind === "anchor" ? classification.projectSlug : undefined;
  const anchorType = anchorTypeLabel(doc.frontmatter.type);
  const reasons: CoverageReason[] = [];
  const suggestedOperations: SuggestedOperation[] = [];

  if (classification.kind === "generated") {
    // Generated documents (e.g. CONTEXT-ROOT.md) are prose-only by
    // definition — no front matter/relations to structure.
    return {
      anchorName: doc.anchorName,
      ...(projectSlug ? { projectSlug } : {}),
      anchorType,
      state: "prose_only",
      reasons: [],
      suggestedOperations: [],
    };
  }

  const schemaResult = AnchorFrontmatterSchema.safeParse(doc.frontmatter);
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      reasons.push({
        code: "front_matter_schema",
        message: `Front matter ${issue.path.join(".") || "root"}: ${issue.message}`,
        anchorName: doc.anchorName,
      });
    }
    return finalizeAnchorRecord(doc.anchorName, projectSlug, anchorType, "malformed", reasons, suggestedOperations);
  }

  const anchorId = anchorIdFromFrontmatter(doc.frontmatter);
  const hasValidAnchorId = anchorId !== undefined && isValidAnchorId(anchorId);
  // Defense in depth: the schema check above already rejects a present-but-
  // invalid anchor_id (WP2 wired ANCHOR_ID_PATTERN into AnchorFrontmatterSchema
  // itself), so this branch is unreachable in practice today. Kept explicit
  // per the plan's "anchor_id ... present but invalid" malformed rule, in case
  // a future caller ever supplies frontmatter that bypassed schema validation.
  if (anchorId !== undefined && !hasValidAnchorId) {
    reasons.push({
      code: "anchor_id_invalid",
      message: `anchor_id "${anchorId}" does not match the required format.`,
      anchorName: doc.anchorName,
    });
  }
  if (anchorId && duplicatedAnchorIdSet.has(anchorId)) {
    reasons.push({
      code: "anchor_id_duplicate",
      message: `anchor_id "${anchorId}" is declared by more than one anchor.`,
      anchorName: doc.anchorName,
    });
  }
  if (!anchorId) {
    suggestedOperations.push({ code: "mint_anchor_id", message: "Mint a stable anchor_id for this anchor." });
  }

  const schemaVersion = doc.frontmatter.schema_version;
  const hasSchemaVersion = schemaVersion !== undefined && schemaVersion !== null;
  if (!hasSchemaVersion) {
    suggestedOperations.push({
      code: "add_schema_version",
      message: "Declare a schema_version for this anchor's front-matter shape.",
    });
  }

  const relationOutcome = analyzeAnchorRelations(doc, ctx);
  reasons.push(...relationOutcome.reasons);
  suggestedOperations.push(...relationOutcome.suggestedOperations);

  // Precedence (plan WP5, exact): malformed > dangling > ambiguous > partial;
  // structured and prose_only are the mutually exclusive happy/inert ends.
  if (reasons.some((reason) => MALFORMED_REASON_CODES.has(reason.code))) {
    return finalizeAnchorRecord(doc.anchorName, projectSlug, anchorType, "malformed", reasons, suggestedOperations);
  }
  if (relationOutcome.hasDangling) {
    return finalizeAnchorRecord(doc.anchorName, projectSlug, anchorType, "dangling", reasons, suggestedOperations);
  }
  if (relationOutcome.hasAmbiguous) {
    return finalizeAnchorRecord(doc.anchorName, projectSlug, anchorType, "ambiguous", reasons, suggestedOperations);
  }

  const noGraphParticipatingStructure =
    !hasValidAnchorId &&
    !hasSchemaVersion &&
    relationOutcome.totalRelationTargets === 0 &&
    !relationOutcome.hasAnyRelationsField;
  if (noGraphParticipatingStructure) {
    return finalizeAnchorRecord(doc.anchorName, projectSlug, anchorType, "prose_only", reasons, suggestedOperations);
  }

  const isFullyStructured =
    hasValidAnchorId &&
    hasSchemaVersion &&
    relationOutcome.allRelationTargetsTyped &&
    !relationOutcome.hasLegacyTarget;
  return finalizeAnchorRecord(
    doc.anchorName,
    projectSlug,
    anchorType,
    isFullyStructured ? "structured" : "partial",
    reasons,
    suggestedOperations,
  );
}

const MALFORMED_REASON_CODES = new Set([
  "front_matter_schema",
  "anchor_id_invalid",
  "anchor_id_duplicate",
  "relation_target_malformed",
  "relation_target_wrong_kind",
]);

function finalizeAnchorRecord(
  anchorName: string,
  projectSlug: string | undefined,
  anchorType: string,
  state: CoverageState,
  reasons: CoverageReason[],
  suggestedOperations: SuggestedOperation[],
): AnchorCoverageRecord {
  return {
    anchorName,
    ...(projectSlug ? { projectSlug } : {}),
    anchorType,
    state,
    reasons,
    suggestedOperations,
  };
}

type RelationAnalysisOutcome = {
  reasons: CoverageReason[];
  suggestedOperations: SuggestedOperation[];
  hasAnyRelationsField: boolean;
  totalRelationTargets: number;
  allRelationTargetsTyped: boolean;
  hasLegacyTarget: boolean;
  hasDangling: boolean;
  hasAmbiguous: boolean;
};

/** Walk every `relations.<key>` target and classify it (malformed / dangling / legacy / typed-resolved) against the typed vocabulary and tree resolvers. */
function analyzeAnchorRelations(doc: CoverageDocumentInput, ctx: CoverageAnalysisContext): RelationAnalysisOutcome {
  const reasons: CoverageReason[] = [];
  const suggestedOperations: SuggestedOperation[] = [];
  const relRaw = doc.frontmatter.relations;
  const outcome: RelationAnalysisOutcome = {
    reasons,
    suggestedOperations,
    hasAnyRelationsField: false,
    totalRelationTargets: 0,
    allRelationTargetsTyped: true,
    hasLegacyTarget: false,
    hasDangling: false,
    hasAmbiguous: false,
  };
  if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
    return outcome;
  }
  const rel = relRaw as Record<string, unknown>;
  outcome.hasAnyRelationsField = Object.keys(rel).length > 0;

  for (const key of Object.keys(rel)) {
    const values = rel[key];
    if (!Array.isArray(values)) {
      continue;
    }
    // goal_ids on milestones is untouched by this phase (plan decision 7):
    // not scored as a typed-relation target here.
    if (key === "goal_ids") {
      continue;
    }
    const vocabEntry = relationVocabularyEntry(key);
    let keyHasLegacyTarget = false;

    for (const target of values) {
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }
      outcome.totalRelationTargets += 1;

      const parseResult = parseRelationTarget(target);
      if (parseResult.legacy) {
        keyHasLegacyTarget = true;
        outcome.hasLegacyTarget = true;
        outcome.allRelationTargetsTyped = false;
        if (!ctx.resolveAnchorName(target)) {
          outcome.hasDangling = true;
          reasons.push({
            code: "relation_target_dangling",
            message: `relations.${key} target "${target}" does not resolve to a known anchor.`,
            anchorName: doc.anchorName,
          });
        }
        continue;
      }
      if (!parseResult.parsed) {
        outcome.allRelationTargetsTyped = false;
        reasons.push({
          code: "relation_target_malformed",
          message: `relations.${key} target "${target}" is not a well-formed typed reference${
            parseResult.malformedReason ? `: ${parseResult.malformedReason}` : "."
          }`,
          anchorName: doc.anchorName,
        });
        continue;
      }
      if (!vocabEntry) {
        // Unregistered key with an otherwise-well-formed typed-shaped target:
        // still not "structured" (nothing validates it belongs here), but not
        // malformed either — falls back to legacy anchor_anchor territory,
        // same as extract.ts.
        outcome.allRelationTargetsTyped = false;
        continue;
      }

      if (!relationTargetKindAllowed(vocabEntry, parseResult.parsed)) {
        // Mirrors extract.ts: a wrong-kind typed ref (e.g. depends_on ->
        // person:alice) never becomes a typed edge, so coverage must not
        // count it as resolved/structured either. Structured syntax is
        // present but invalid for this key -> a malformed finding.
        outcome.allRelationTargetsTyped = false;
        reasons.push({
          code: "relation_target_wrong_kind",
          message: `relations.${key} target "${target}" has kind "${parseResult.parsed.kind}", which relations.${key} does not allow.`,
          anchorName: doc.anchorName,
        });
        continue;
      }

      const resolution = resolveTypedTargetForCoverage(parseResult.parsed, ctx);
      if (resolution === "ambiguous") {
        outcome.hasAmbiguous = true;
        reasons.push({
          code: "relation_target_ambiguous",
          message: `relations.${key} target "${target}" resolves to more than one candidate.`,
          anchorName: doc.anchorName,
        });
        continue;
      }
      if (resolution === "dangling") {
        outcome.hasDangling = true;
        outcome.allRelationTargetsTyped = false;
        reasons.push({
          code: "relation_target_dangling",
          message: `relations.${key} target "${target}" does not resolve to a known node.`,
          anchorName: doc.anchorName,
        });
        if (parseResult.parsed.kind === "goal") {
          suggestedOperations.push({
            code: "scope_goal_reference",
            message: `Scope relations.${key} target "${target}" to a known project + goal id.`,
          });
        }
        continue;
      }
      // resolved: fully typed and resolved, contributes to "structured".
    }

    const keyHasStringTargets = values.some((value) => typeof value === "string" && value.length > 0);
    if (keyHasStringTargets && !vocabEntry) {
      suggestedOperations.push({
        code: "convert_relation",
        message: `Migrate unregistered relations.${key} to a supported relation key before converting its targets to canonical typed references.`,
      });
    } else if (keyHasLegacyTarget && vocabEntry) {
      // The primary migration case: a REGISTERED key (depends_on, owned_by,
      // ...) still pointing at legacy bare-string targets. These are exactly
      // the targets the guided migration converts to canonical typed refs.
      suggestedOperations.push({
        code: "convert_relation",
        message: `Convert relations.${key} legacy bare-string targets to canonical typed references.`,
      });
    }
  }

  return outcome;
}

type TypedTargetResolution = "resolved" | "dangling" | "ambiguous";

function resolveTypedTargetForCoverage(
  parsed: ReturnType<typeof parseRelationTarget>["parsed"],
  ctx: CoverageAnalysisContext,
): TypedTargetResolution {
  if (!parsed) {
    return "dangling";
  }
  switch (parsed.kind) {
    case "anchor": {
      const candidates = ctx.anchorNamesForAnchorId(parsed.id);
      if (candidates.length === 0) {
        return "dangling";
      }
      return candidates.length === 1 ? "resolved" : "ambiguous";
    }
    case "goal": {
      const resolvedSlug = ctx.resolveProjectSlug(parsed.projectSlug);
      if (!resolvedSlug) {
        return "dangling";
      }
      return ctx.goalExistsInProject(resolvedSlug, parsed.goalId) ? "resolved" : "dangling";
    }
    case "person":
      return ctx.personExists(parsed.id) ? "resolved" : "dangling";
    case "team":
      return ctx.teamExists(parsed.id) ? "resolved" : "dangling";
    default:
      return "dangling";
  }
}

function anchorTypeLabel(type: unknown): string {
  if (typeof type === "string" && type.trim().length > 0) {
    return type.trim();
  }
  if (Array.isArray(type)) {
    const values = type.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (values.length > 0) {
      return values.join("+");
    }
  }
  return "untyped";
}

// ---------------------------------------------------------------------------
// Per-claim analysis.
// ---------------------------------------------------------------------------

function analyzeClaimCoverage(anchorName: string, claim: AnchorClaim): ClaimCoverageRecord {
  const reasons: CoverageReason[] = [];
  const suggestedOperations: SuggestedOperation[] = [];

  if (claim.status === "malformed") {
    for (const error of claim.annotationErrors ?? []) {
      reasons.push({ code: "claim_annotation_malformed", message: error, anchorName, line: claim.line, heading: claim.section });
    }
    return {
      anchorName,
      line: claim.line,
      ...(claim.id ? { claimId: claim.id } : {}),
      text: claim.text,
      state: "malformed",
      reasons,
      suggestedOperations,
    };
  }

  if (!claim.id) {
    suggestedOperations.push({ code: "mint_claim_id", message: "Mint a stable id for this claim." });
    return {
      anchorName,
      line: claim.line,
      text: claim.text,
      state: "partial",
      reasons,
      suggestedOperations,
    };
  }

  if (claim.status === "unannotated") {
    // Id-only claim (WP4): has an id but no provenance — partial, not
    // structured (design doc: "an unannotated claim can have a stable
    // identity and appears as unverified rather than disappearing").
    return {
      anchorName,
      line: claim.line,
      claimId: claim.id,
      text: claim.text,
      state: "partial",
      reasons,
      suggestedOperations,
    };
  }

  // status === "annotated" with an id: has an id and its provenance parsed
  // (a malformed annotation would already be status "malformed", handled
  // above), so this claim is fully structured.
  return {
    anchorName,
    line: claim.line,
    claimId: claim.id,
    text: claim.text,
    state: "structured",
    reasons,
    suggestedOperations,
  };
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------

function emptyStateCounts(): Record<CoverageState, number> {
  return { structured: 0, partial: 0, prose_only: 0, ambiguous: 0, dangling: 0, malformed: 0 };
}

// ---------------------------------------------------------------------------
// Bounded paging (Goal 0 Phase 1 WP6: the read-only coverage endpoints must
// never return the unbounded record set by accident). Mirrors the clamp
// pattern `src/graph/neighbors.ts` already establishes for graphNeighbors.
// ---------------------------------------------------------------------------

export const GRAPH_COVERAGE_DEFAULT_LIMIT = 100;
export const GRAPH_COVERAGE_MAX_LIMIT = 500;

export function clampCoverageLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return GRAPH_COVERAGE_DEFAULT_LIMIT;
  }
  return Math.min(GRAPH_COVERAGE_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export type CoverageRecordKind =
  | ({ kind: "anchor" } & AnchorCoverageRecord)
  | ({ kind: "claim" } & ClaimCoverageRecord);

/**
 * Deterministic sort key: anchor name, then (for claims) line number, so
 * anchor records and their claims interleave in a stable, cursor-friendly
 * order. Newline is the field delimiter: it cannot appear in an anchor name
 * (single-line relative path) or a record kind, sorts below every printable
 * character, and — unlike a NUL byte — keeps this file plain text and keeps
 * cursors (which are these keys verbatim) transport-safe through URL
 * encoding and JSON.
 */
function coverageSortKey(record: CoverageRecordKind): string {
  const line = record.kind === "claim" ? record.line : -1;
  return `${record.anchorName}\n${String(line).padStart(10, "0")}\n${record.kind}`;
}

/** Code-unit ordering is stable across runtimes/locales and is also used when advancing a cursor. */
function compareCoverageSortKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type PageCoverageInput = {
  /** Restrict to these states; omit for every state. */
  states?: readonly CoverageState[];
  limit?: number;
  /** Opaque cursor: the sort key of the last record returned by the previous page. */
  cursor?: string;
};

export type PageCoverageResult = {
  records: CoverageRecordKind[];
  /** Cursor to pass as `cursor` for the next page, or undefined when this page reached the end. */
  nextCursor?: string;
  /** Total records matching the state filter, before pagination. */
  totalMatching: number;
  limit: number;
};

/**
 * Bound and paginate combined anchor + claim coverage records, filtered by
 * `states` when given. Ordering is deterministic (anchor name, then claim
 * line, then anchor-before-claim) so a cursor built from one page's last
 * record reliably resumes the next, and repeated calls against the same
 * analysis result always agree.
 */
export function pageCoverageRecords(
  result: CoverageAnalysisResult,
  input: PageCoverageInput,
): PageCoverageResult {
  const stateFilter = input.states && input.states.length > 0 ? new Set(input.states) : undefined;
  const limit = clampCoverageLimit(input.limit);

  const all: CoverageRecordKind[] = [
    ...result.anchors.map((anchor): CoverageRecordKind => ({ kind: "anchor" as const, ...anchor })),
    ...result.claims.map((claim): CoverageRecordKind => ({ kind: "claim" as const, ...claim })),
  ]
    .filter((record) => !stateFilter || stateFilter.has(record.state))
    .sort((left, right) => compareCoverageSortKeys(coverageSortKey(left), coverageSortKey(right)));

  const startIndex = input.cursor
    ? all.findIndex((record) => compareCoverageSortKeys(coverageSortKey(record), input.cursor!) > 0)
    : 0;
  const effectiveStart = startIndex === -1 ? all.length : startIndex;
  const page = all.slice(effectiveStart, effectiveStart + limit);
  const nextIndex = effectiveStart + page.length;

  return {
    records: page,
    ...(nextIndex < all.length ? { nextCursor: coverageSortKey(page[page.length - 1]) } : {}),
    totalMatching: all.length,
    limit,
  };
}

function summarizeCoverage(
  anchors: readonly AnchorCoverageRecord[],
  claims: readonly ClaimCoverageRecord[],
  duplicateAnchorIds: readonly DuplicateAnchorIdFinding[],
): CoverageSummary {
  const byState = emptyStateCounts();
  const byProject: Record<string, Partial<Record<CoverageState, number>>> = {};
  const byAnchorType: Record<string, Partial<Record<CoverageState, number>>> = {};

  for (const anchor of anchors) {
    byState[anchor.state] += 1;

    if (anchor.projectSlug) {
      const bucket = byProject[anchor.projectSlug] ?? {};
      bucket[anchor.state] = (bucket[anchor.state] ?? 0) + 1;
      byProject[anchor.projectSlug] = bucket;
    }

    const typeBucket = byAnchorType[anchor.anchorType] ?? {};
    typeBucket[anchor.state] = (typeBucket[anchor.state] ?? 0) + 1;
    byAnchorType[anchor.anchorType] = typeBucket;
  }

  return {
    totalAnchors: anchors.length,
    totalClaims: claims.length,
    byState,
    byProject,
    byAnchorType,
    duplicateAnchorIdCount: duplicateAnchorIds.length,
  };
}
