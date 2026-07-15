/**
 * Write-time schema enforcement (Goal 0 Phase 2 slice 3b:
 * `goal0_phase2_enforcement_mode_plan.md`). Reads `anchorSchema.mode` off the
 * validation context and, for a graph-participating anchor whose OWN
 * structure is incomplete, emits WARN (`warn` mode) or BLOCK (`enforce`
 * mode). In `legacy` mode (the default, and undefined) it does nothing — every
 * pre-slice-3b behavior is preserved exactly.
 *
 * Structuredness is not reinvented here: it is derived from the exact same
 * `analyzeAnchorCoverage` (`src/graph/coverage.ts`) that the Coverage tab and
 * `graphCoverage` use, so an anchor that is "structured" in coverage can never
 * be simultaneously blocked by this gate, and vice versa. The coverage
 * analysis is run against a PERMISSIVE context (every relation target
 * resolves, no duplicate ids) so the only non-`structured`/non-`prose_only`
 * outcome a purely-structural gap can produce is `partial`: this validator is
 * about "is this anchor's own structure complete", not about whether its
 * targets exist in the tree (dangling/ambiguous) or its front matter parses
 * (malformed). `malformed` is deliberately NOT enforced here: a front-matter
 * schema failure is already a BLOCK from `validateFrontMatter`, and a malformed
 * typed-relation ref surfaces in coverage/migration rather than in any
 * validator — either way, re-reporting it here would just double-message a
 * shape problem, so this gate stays focused on structural completeness and
 * leaves malformedness to those surfaces. A `partial` record's `suggestedOperations`
 * (`mint_anchor_id` / `add_schema_version` / `convert_relation`) ARE the
 * structural gaps, so enforcing them keeps this gate and coverage in lockstep.
 *
 * Enforce-scoping rule (plan decision 5, "never retroactively block"): on a
 * CREATE, every gap is enforced (mint-on-create already fills
 * `anchor_id`/`schema_version`, so a normal new anchor is gap-free and passes;
 * the gate then only catches a legacy relation target the author hand-wrote,
 * or a hand-authored/imported anchor missing the minted fields). On an UPDATE,
 * only gaps that the write NEWLY INTRODUCES are enforced — a gap already
 * present in `oldContent` is left alone, so an unrelated prose edit to a
 * legacy anchor never starts blocking, while adding a fresh legacy relation
 * target (or otherwise regressing structure) does.
 */
import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import {
  analyzeAnchorCoverage,
  type AnchorCoverageRecord,
  type CoverageAnalysisContext,
  type CoverageDocumentInput,
} from "../graph/coverage.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";

/**
 * Permissive coverage context: every relation target resolves and no
 * `anchor_id` is duplicated, so `analyzeAnchorCoverage` can only report
 * `structured`, `prose_only`, `partial`, or `malformed` — never `dangling`
 * or `ambiguous`. Enforcement is about the anchor's OWN structural
 * completeness, independent of whether the rest of the tree currently
 * contains its targets, so no tree scan is needed (and this validator stays
 * pure and cheap on the write hot path).
 */
const PERMISSIVE_COVERAGE_CONTEXT: CoverageAnalysisContext = {
  anchorNames: new Set<string>(),
  resolveAnchorName: (value: string) => (value.trim() ? value.trim() : undefined),
  resolveProjectSlug: (slug: string) => (slug.trim() ? slug.trim() : undefined),
  anchorNamesForAnchorId: (anchorId: string) => (anchorId.trim() ? [anchorId.trim()] : []),
  goalExistsInProject: () => true,
  personExists: () => true,
  teamExists: () => true,
};

/** The structural-completeness gaps this gate enforces, keyed to a `partial` coverage record's `suggestedOperations`. */
function structuralGaps(content: string): AnchorCoverageRecord["suggestedOperations"] {
  const parsed = parseAnchor(content);
  const doc: CoverageDocumentInput = {
    // anchorName only affects reason `anchorName` labels, not the state or
    // suggestedOperations we key on; a stable placeholder is fine.
    anchorName: "enforcement-check",
    frontmatter: parsed.frontmatter as Record<string, unknown>,
    content,
  };
  const record = analyzeAnchorCoverage(doc, PERMISSIVE_COVERAGE_CONTEXT, new Set<string>());
  // Only `partial` means "graph-participating but incompletely structured".
  // `structured`/`prose_only` have nothing to enforce; `malformed` is owned
  // by the front-matter and relations-shape validators (don't double-block).
  return record.state === "partial" ? record.suggestedOperations : [];
}

export const validateAnchorSchemaEnforcement: Validator = (context) => {
  const mode = context.anchorSchemaMode ?? "legacy";
  if (mode === "legacy") {
    return [];
  }
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  if (classifyAnchorPath(context.name).kind !== "anchor") {
    return [];
  }

  const newGaps = structuralGaps(context.newContent);
  if (newGaps.length === 0) {
    return [];
  }

  // Update-scoping: enforce only gaps this write newly introduces, so an
  // unrelated edit to an already-legacy anchor never starts blocking it.
  let gapsToEnforce = newGaps;
  if (context.oldContent !== undefined) {
    const oldGapCodes = new Set(structuralGaps(context.oldContent).map((gap) => gap.code));
    gapsToEnforce = newGaps.filter((gap) => !oldGapCodes.has(gap.code));
  }
  if (gapsToEnforce.length === 0) {
    return [];
  }

  const severity = mode === "enforce" ? "BLOCK" : "WARN";
  return gapsToEnforce.map((gap) =>
    violation(
      severity,
      `anchor_schema_${gap.code}`,
      `${gap.message} (anchorSchema.mode=${mode}; preview the fix with previewAnchorMigration)`,
      context.path,
    ),
  );
};
