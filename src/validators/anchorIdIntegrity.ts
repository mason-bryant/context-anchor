/**
 * `anchor_id` integrity (Goal 0 Phase 2 WP-A:
 * `goal0_phase2_mint_on_create_and_coverage_ui_plan.md`). Mint-on-create
 * itself lives in `AnchorService.writeAnchor` (it needs to inject front
 * matter before validation runs, and validators are read-only over
 * `oldContent`/`newContent`); this validator enforces the two BLOCK
 * invariants that make minted/supplied ids trustworthy as a stable identity:
 *
 *   1. **Immutability on update** (`anchor_id_immutable`): an anchor that
 *      already has an `anchor_id` can never have it changed or removed by a
 *      later write. Adding an id where none existed is allowed (that's how
 *      migration will work), subject to the duplicate check below.
 *   2. **Tree-wide uniqueness** (`anchor_id_duplicate`): whether the id came
 *      from a fresh mint, a caller-supplied id on create, or an id added to a
 *      previously id-less legacy anchor, it can never collide with another
 *      anchor's id.
 *
 * Same identity domain as claim ids (`duplicateClaimIdViolations` in
 * `src/anchorService.ts`), so this mirrors that: an always-BLOCK, not gated
 * behind `migrationWarnOnly` — an id collision or a mutated immutable id is a
 * correctness break, not a legacy-shape migration nicety.
 */
import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import { anchorIdFromFrontmatter } from "../graph/identity.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";

export const validateAnchorIdIntegrity: Validator = async (context) => {
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  if (classifyAnchorPath(context.name).kind !== "anchor") {
    return [];
  }

  const newId = anchorIdFromFrontmatter(parseAnchor(context.newContent).frontmatter);

  if (context.oldContent !== undefined) {
    const oldId = anchorIdFromFrontmatter(parseAnchor(context.oldContent).frontmatter);
    if (oldId && oldId !== newId) {
      return [
        violation(
          "BLOCK",
          "anchor_id_immutable",
          newId
            ? `This write changes anchor_id from "${oldId}" to "${newId}". anchor_id is immutable once set; it cannot be changed or removed.`
            : `This write removes anchor_id "${oldId}". anchor_id is immutable once set; it cannot be changed or removed.`,
          context.path,
        ),
      ];
    }
  }

  if (!newId) {
    return [];
  }

  const metas = await context.repo.listAnchors();
  for (const meta of metas) {
    if (isBuiltInAnchorName(meta.name) || meta.name === context.name) {
      continue;
    }
    const raw = await context.repo.readRaw(meta.name);
    if (raw === undefined) {
      continue;
    }
    const otherId = anchorIdFromFrontmatter(parseAnchor(raw).frontmatter);
    if (otherId && otherId === newId) {
      return [
        violation(
          "BLOCK",
          "anchor_id_duplicate",
          `anchor_id "${newId}" already exists on "${meta.name}". anchor_id must be unique across the tree.`,
          context.path,
        ),
      ];
    }
  }

  return [];
};
