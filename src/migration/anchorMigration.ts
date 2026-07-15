/**
 * Previewable anchor migration write operations (Goal 0 Phase 2 slice 2:
 * `goal0_phase2_migration_write_ops_plan.md`; background design in
 * `knowledge_graph_visualization_design_and_roadmap.md`, "Migration
 * strategy" step 3: "Add previewable MCP and UI migration actions that mint
 * IDs, scope goals, and convert recognized relations without rewriting
 * narrative prose").
 *
 * Pure planning core, no I/O: `planAnchorMigration(content, ctx, operations?)`
 * takes one anchor's already-read raw content plus a resolver context (mirror
 * of `CoverageAnalysisContext` in `src/graph/coverage.ts`, extended with the
 * minting sets migration needs) and returns the exact byte-level `newContent`
 * plus a per-operation outcome list. Every operation reuses the coverage
 * module's exact eligibility rules so a migrated anchor's coverage state
 * genuinely improves through the real `analyzeCoverage` path — this module
 * never invents its own notion of "structured".
 *
 * Front-matter changes go through `mergeAnchorFrontmatter` (never hand-rolled
 * YAML). Body changes are line-insertions of id-only claim annotation rows
 * only (`mint_claim_ids`), following the exact standalone-annotation grammar
 * `src/claims.ts` establishes (`  {id: c-xxxxxx}`, two-space indent, directly
 * under the claim bullet). Everything else in the document is byte-identical
 * before/after every operation — callers must assert this by diffing (see
 * `test/anchorMigration.test.ts`).
 */

import { mergeAnchorFrontmatter } from "../anchorPatch.js";
import { extractClaims, mintClaimId } from "../claims.js";
import { mintAnchorId, isValidAnchorId, anchorIdFromFrontmatter } from "../graph/identity.js";
import { parseRelationTarget, relationVocabularyEntry } from "../relations/vocabulary.js";
import { parseAnchor } from "../storage/markdown.js";

/** The five migration operation codes (plan decision 3): reuses coverage's `suggestedOperations` vocabulary plus the new `mint_claim_ids` batch operation. */
export type MigrationOperationCode =
  | "mint_anchor_id"
  | "add_schema_version"
  | "convert_relation"
  | "scope_goal_reference"
  | "mint_claim_ids";

export const MIGRATION_OPERATION_CODES: readonly MigrationOperationCode[] = [
  "mint_anchor_id",
  "add_schema_version",
  "convert_relation",
  "scope_goal_reference",
  "mint_claim_ids",
] as const;

/**
 * Canonical, deduplicated operation list in `MIGRATION_OPERATION_CODES`
 * order. Callers treat `operations` as an unordered SET (and may repeat
 * codes), so both the planner and the preview/apply cache comparison
 * normalize through this — otherwise a reordered-but-identical request
 * would miss the preview cache and re-plan with fresh random mints,
 * committing different ids than the preview showed.
 */
export function normalizeMigrationOperations(
  operations?: readonly MigrationOperationCode[],
): MigrationOperationCode[] {
  if (!operations) {
    return [...MIGRATION_OPERATION_CODES];
  }
  const requested = new Set(operations);
  return MIGRATION_OPERATION_CODES.filter((code) => requested.has(code));
}

export type MigrationOperationStatus = "applied" | "skipped" | "not_applicable";

/**
 * Stable skip-reason codes (HANDOFF.md's "skip-reason inventory" documents
 * each). Two members are RESERVED and not emitted by any current code path:
 * `key_wrong_target_kind` (a wrong-kind TYPED ref is a coverage-time
 * `malformed` finding, never a legacy string migration inspects) and
 * `not_an_anchor` (the service only invokes the planner on resolved anchor
 * names today). They are kept so adding the corresponding guard later is
 * not a breaking type change — do not generate exhaustive UI text from this
 * union without handling that.
 */
export type MigrationSkipReason =
  | "already_present"
  | "target_missing_anchor_id"
  | "target_not_legacy"
  | "key_not_registered"
  | "key_wrong_target_kind"
  | "target_unparseable"
  | "goal_unknown"
  | "goal_ambiguous"
  | "no_unannotated_claims"
  | "not_an_anchor";

export type MigrationOperationOutcome = {
  code: MigrationOperationCode;
  status: MigrationOperationStatus;
  reason?: MigrationSkipReason;
  detail: string;
};

export type PlanAnchorMigrationResult = {
  newContent: string;
  outcomes: MigrationOperationOutcome[];
};

/** Resolver context the planner needs — no I/O of its own; the caller (AnchorService) assembles this from tree-wide scans and the graph index, same shape `CoverageAnalysisContext` establishes. */
export type AnchorMigrationContext = {
  /** Every `anchor_id` already present in the tree (this anchor excluded), for `mintAnchorId`'s collision check. */
  treeAnchorIds: ReadonlySet<string>;
  /** Every claim id already present in the tree (this anchor excluded), for `mintClaimId`'s collision check. */
  treeClaimIds: ReadonlySet<string>;
  /** Resolve a legacy bare relation target (anchor path/name) to its canonical anchor name, or undefined if unresolvable — mirrors `CoverageAnalysisContext.resolveAnchorName`. */
  resolveAnchorName: (value: string) => string | undefined;
  /** The `anchor_id` a resolved anchor name declares, or undefined if it has none. */
  anchorIdForAnchorName: (anchorName: string) => string | undefined;
  /** Canonical project slug(s) whose roadmap defines this goal id — zero, one, or many. */
  projectsForGoalId: (goalId: string) => readonly string[];
};

/**
 * Plan a migration over one anchor's raw content: apply every requested
 * operation (default: all of `MIGRATION_OPERATION_CODES`) in a fixed,
 * deterministic order, and return the resulting content plus ONE OR MORE
 * outcomes per requested operation — single-shot operations
 * (`mint_anchor_id`, `add_schema_version`, `mint_claim_ids`) report exactly
 * one, while per-target operations (`convert_relation`,
 * `scope_goal_reference`) report one outcome per inspected relation target.
 * Pure — no I/O, no git, no filesystem, mirroring
 * `src/graph/extract.ts` / `src/graph/coverage.ts`'s purity pattern.
 *
 * Order matters for two reasons: (1) `add_schema_version` and
 * `mint_anchor_id` both touch front matter via `mergeAnchorFrontmatter`, so
 * they are batched into a single merge call to avoid re-stringifying YAML
 * twice; (2) `mint_claim_ids` touches the body via line splices and must run
 * after all front-matter operations so line numbers it computes reflect the
 * final body (front-matter merges never change body line numbers, but this
 * keeps the invariant explicit and future-proof).
 */
export function planAnchorMigration(
  content: string,
  ctx: AnchorMigrationContext,
  operations: readonly MigrationOperationCode[] = MIGRATION_OPERATION_CODES,
): PlanAnchorMigrationResult {
  const requested = new Set(operations);
  const outcomes: MigrationOperationOutcome[] = [];

  const parsed = parseAnchor(content);
  const frontmatterUpdates: Record<string, unknown> = {};

  if (requested.has("mint_anchor_id")) {
    outcomes.push(planMintAnchorId(parsed.frontmatter, ctx, frontmatterUpdates));
  }
  if (requested.has("add_schema_version")) {
    outcomes.push(planAddSchemaVersion(parsed.frontmatter, frontmatterUpdates));
  }
  if (requested.has("convert_relation")) {
    outcomes.push(...planConvertRelations(parsed.frontmatter, ctx, frontmatterUpdates));
  }
  if (requested.has("scope_goal_reference")) {
    outcomes.push(...planScopeGoalReferences(parsed.frontmatter, ctx, frontmatterUpdates));
  }

  let newContent = content;
  if (Object.keys(frontmatterUpdates).length > 0) {
    newContent = mergeAnchorFrontmatter(newContent, frontmatterUpdates);
  }

  if (requested.has("mint_claim_ids")) {
    const claimResult = planMintClaimIds(newContent, ctx);
    newContent = claimResult.content;
    outcomes.push(claimResult.outcome);
  }

  return { newContent, outcomes };
}

// ---------------------------------------------------------------------------
// mint_anchor_id
// ---------------------------------------------------------------------------

function planMintAnchorId(
  frontmatter: Record<string, unknown>,
  ctx: AnchorMigrationContext,
  updates: Record<string, unknown>,
): MigrationOperationOutcome {
  const existing = anchorIdFromFrontmatter(frontmatter);
  if (existing && isValidAnchorId(existing)) {
    return {
      code: "mint_anchor_id",
      status: "not_applicable",
      reason: "already_present",
      detail: `anchor_id "${existing}" already present.`,
    };
  }
  const minted = mintAnchorId(ctx.treeAnchorIds);
  updates.anchor_id = minted;
  return {
    code: "mint_anchor_id",
    status: "applied",
    detail: `Minted anchor_id "${minted}".`,
  };
}

// ---------------------------------------------------------------------------
// add_schema_version
// ---------------------------------------------------------------------------

function planAddSchemaVersion(
  frontmatter: Record<string, unknown>,
  updates: Record<string, unknown>,
): MigrationOperationOutcome {
  const value = frontmatter.schema_version;
  // Same validity rule as writeAnchor's create-path policy (a positive
  // integer, or an all-digits string encoding one): an INVALID supplied
  // value is treated as absent and replaced with 1 — matching
  // `planMintAnchorId`'s treatment of an invalid anchor_id above —
  // otherwise migration would leave the anchor malformed while reporting
  // already_present.
  const valid =
    (typeof value === "number" && Number.isInteger(value) && value > 0) ||
    (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0);
  if (valid) {
    return {
      code: "add_schema_version",
      status: "not_applicable",
      reason: "already_present",
      detail: `schema_version "${String(value)}" already present.`,
    };
  }
  updates.schema_version = 1;
  return {
    code: "add_schema_version",
    status: "applied",
    detail: "Set schema_version to 1.",
  };
}

// ---------------------------------------------------------------------------
// convert_relation (anchor-targeted registered keys: depends_on, supersedes,
// related_to — legacy bare-string target -> anchor:<anchor-id>, only when the
// target resolves to exactly one anchor that already has a valid anchor_id).
// ---------------------------------------------------------------------------

function planConvertRelations(
  frontmatter: Record<string, unknown>,
  ctx: AnchorMigrationContext,
  updates: Record<string, unknown>,
): MigrationOperationOutcome[] {
  const rel = relationsRecord(frontmatter);
  if (!rel) {
    return [];
  }
  const outcomes: MigrationOperationOutcome[] = [];
  let relUpdates: Record<string, unknown> | undefined;

  for (const key of Object.keys(rel)) {
    if (key === "goal_ids") {
      continue;
    }
    const values = rel[key];
    if (!Array.isArray(values)) {
      continue;
    }
    const vocabEntry = relationVocabularyEntry(key);
    if (!vocabEntry) {
      outcomes.push({
        code: "convert_relation",
        status: "skipped",
        reason: "key_not_registered",
        detail: `relations.${key} is not a registered relation key.`,
      });
      continue;
    }
    // scope_goal_reference owns goal-targeted keys (e.g. implements) —
    // convert_relation only handles anchor-targeted keys, per the plan's
    // "resolves to exactly one anchor" wording.
    if (!vocabEntry.targetKinds.includes("anchor")) {
      continue;
    }

    const nextValues = [...values];
    let changed = false;
    for (let index = 0; index < nextValues.length; index += 1) {
      const target = nextValues[index];
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }
      const parseResult = parseRelationTarget(target);
      if (!parseResult.legacy) {
        outcomes.push({
          code: "convert_relation",
          status: "not_applicable",
          reason: "target_not_legacy",
          detail: `relations.${key} target "${target}" is already a canonical typed reference.`,
        });
        continue;
      }
      const resolvedAnchorName = ctx.resolveAnchorName(target);
      if (!resolvedAnchorName) {
        outcomes.push({
          code: "convert_relation",
          status: "skipped",
          reason: "target_unparseable",
          detail: `relations.${key} target "${target}" does not resolve to a known anchor.`,
        });
        continue;
      }
      const targetAnchorId = ctx.anchorIdForAnchorName(resolvedAnchorName);
      if (!targetAnchorId || !isValidAnchorId(targetAnchorId)) {
        outcomes.push({
          code: "convert_relation",
          status: "skipped",
          reason: "target_missing_anchor_id",
          detail: `relations.${key} target "${target}" resolves to "${resolvedAnchorName}", which has no anchor_id yet — migrate the target first.`,
        });
        continue;
      }
      nextValues[index] = `anchor:${targetAnchorId}`;
      changed = true;
      outcomes.push({
        code: "convert_relation",
        status: "applied",
        detail: `Converted relations.${key} target "${target}" to "anchor:${targetAnchorId}".`,
      });
    }
    if (changed) {
      relUpdates ??= {};
      relUpdates[key] = nextValues;
    }
  }

  if (relUpdates) {
    updates.relations = { ...(updates.relations as Record<string, unknown> | undefined), ...relUpdates };
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// scope_goal_reference (implements: legacy bare goal id -> goal:<project-slug>:<goal-id>,
// only when the goal id is defined by exactly one project's roadmap).
// ---------------------------------------------------------------------------

function planScopeGoalReferences(
  frontmatter: Record<string, unknown>,
  ctx: AnchorMigrationContext,
  updates: Record<string, unknown>,
): MigrationOperationOutcome[] {
  const rel = relationsRecord(frontmatter);
  if (!rel) {
    return [];
  }
  const outcomes: MigrationOperationOutcome[] = [];
  let relUpdates: Record<string, unknown> | undefined;

  for (const key of Object.keys(rel)) {
    if (key === "goal_ids") {
      continue;
    }
    const values = rel[key];
    if (!Array.isArray(values)) {
      continue;
    }
    const vocabEntry = relationVocabularyEntry(key);
    if (!vocabEntry) {
      // convert_relation already reports key_not_registered for this key;
      // avoid a duplicate finding here.
      continue;
    }
    if (!vocabEntry.targetKinds.includes("goal")) {
      continue;
    }

    const nextValues = [...values];
    let changed = false;
    for (let index = 0; index < nextValues.length; index += 1) {
      const target = nextValues[index];
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }
      const parseResult = parseRelationTarget(target);
      if (!parseResult.legacy) {
        outcomes.push({
          code: "scope_goal_reference",
          status: "not_applicable",
          reason: "target_not_legacy",
          detail: `relations.${key} target "${target}" is already a canonical typed reference.`,
        });
        continue;
      }
      const goalId = target.trim();
      const owners = ctx.projectsForGoalId(goalId);
      if (owners.length === 0) {
        outcomes.push({
          code: "scope_goal_reference",
          status: "skipped",
          reason: "goal_unknown",
          detail: `relations.${key} target "${target}" is not defined by any known project's roadmap.`,
        });
        continue;
      }
      if (owners.length > 1) {
        outcomes.push({
          code: "scope_goal_reference",
          status: "skipped",
          reason: "goal_ambiguous",
          detail: `relations.${key} target "${target}" is defined by more than one project's roadmap (${owners.join(", ")}); scope it manually.`,
        });
        continue;
      }
      const projectSlug = owners[0];
      nextValues[index] = `goal:${projectSlug}:${goalId}`;
      changed = true;
      outcomes.push({
        code: "scope_goal_reference",
        status: "applied",
        detail: `Scoped relations.${key} target "${target}" to "goal:${projectSlug}:${goalId}".`,
      });
    }
    if (changed) {
      relUpdates ??= {};
      relUpdates[key] = nextValues;
    }
  }

  if (relUpdates) {
    updates.relations = { ...(updates.relations as Record<string, unknown> | undefined), ...relUpdates };
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// mint_claim_ids (id-only annotation rows for unannotated, id-less claims).
// ---------------------------------------------------------------------------

function planMintClaimIds(
  content: string,
  ctx: AnchorMigrationContext,
): { content: string; outcome: MigrationOperationOutcome } {
  const claims = extractClaims(content);
  // Only UNANNOTATED claims get id-only rows: an annotated claim lacking an
  // id is already handled by the ordinary write path (`mintMissingClaimIds`
  // in writeAnchor mints onto its source row), and a malformed claim should
  // be repaired, not decorated.
  const candidates = claims.filter((claim) => claim.status === "unannotated" && !claim.id);
  if (candidates.length === 0) {
    return {
      content,
      outcome: {
        code: "mint_claim_ids",
        status: "not_applicable",
        reason: "no_unannotated_claims",
        detail: "No unannotated claims lack an id.",
      },
    };
  }

  const usedIds = new Set(ctx.treeClaimIds);
  for (const claim of claims) {
    if (claim.id) {
      usedIds.add(claim.id);
    }
  }

  const minted: { text: string; id: string }[] = [];
  // Split on "\n" ONLY, leaving any "\r" attached to its line, so
  // join("\n") reproduces the original bytes exactly for LF, CRLF, and even
  // mixed-ending files — splitting on /\r?\n/ and re-joining with "\n"
  // would silently convert a CRLF file to LF, breaking the byte-preservation
  // guarantee. Line indices are identical either way (same delimiter
  // count), so extractClaims' line numbers still address the right rows.
  const usesCrlf = content.includes("\r\n");
  const lines = content.split("\n");
  // Insert bottom-up (highest line first) so earlier insertions never shift
  // the line number a later insertion targets.
  for (const claim of [...candidates].sort((left, right) => right.line - left.line)) {
    const id = mintClaimId(usedIds);
    usedIds.add(id);
    // Inserted lines are CRLF-terminated when the file contains ANY CRLF
    // sequence (a deliberate all-or-nothing heuristic, not a per-line or
    // majority test): existing lines keep whatever ending they carried, and
    // a uniformly-CRLF file stays uniformly CRLF.
    lines.splice(claim.line, 0, `  {id: ${id}}${usesCrlf ? "\r" : ""}`);
    minted.push({ text: claim.text, id });
  }
  minted.reverse();

  const detail = `Minted id-only annotations for ${minted.length} claim(s): ${minted
    .map((entry) => `"${truncate(entry.text)}" -> ${entry.id}`)
    .join("; ")}.`;

  return {
    content: lines.join("\n"),
    outcome: {
      code: "mint_claim_ids",
      status: "applied",
      detail,
    },
  };
}

function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function relationsRecord(frontmatter: Record<string, unknown>): Record<string, unknown> | undefined {
  const relRaw = frontmatter.relations;
  if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
    return undefined;
  }
  return relRaw as Record<string, unknown>;
}
