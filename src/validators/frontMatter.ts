import * as z from "zod/v4";

import { validateTypedFrontmatterOverlay } from "../schema/registry.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import { ANCHOR_ID_PATTERN } from "../graph/identity.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

const StringOrStringArray = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const LastValidated = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.date()]);
const LoadingInstruction = z.string().min(1).max(160);
/**
 * Same shape the milestone typed overlay's `schema_version` uses
 * (`src/schema/registry.ts`), but generalized to any positive integer rather
 * than pinned to `1` — Goal 0 Phase 1 WP2 (`goal0_semantic_substrate_implementation_plan.md`):
 * a universal, optional `schema_version` field so any anchor can declare which
 * version of its (typed or untyped) shape it conforms to. Presence stays
 * optional in this phase; a missing value is a WP5 coverage finding, never a
 * validator violation (see the plan's "Validation posture" decision).
 */
const SchemaVersion = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^\d+$/)
    .refine((value) => Number(value) > 0, { message: "schema_version must be a positive integer" }),
]);
/** Format validated only when present (Goal 0 Phase 1 WP1/WP2): see `ANCHOR_ID_PATTERN` in `src/graph/identity.ts`. */
const AnchorId = z.string().regex(ANCHOR_ID_PATTERN, "anchor_id must match ^a-[0-9a-z]{6,8}$");

/**
 * Exported so `src/graph/coverage.ts` (Goal 0 Phase 1 WP5) can reuse the exact
 * same universal schema for its "front matter fails the universal schema"
 * malformed check, rather than duplicating a second copy that could drift.
 */
export const AnchorFrontmatterSchema = z
  .object({
    type: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    tags: z.array(z.string()),
    summary: z.string().min(1).max(240),
    read_this_if: z.array(LoadingInstruction).min(1).max(5),
    last_validated: LastValidated,
    project: StringOrStringArray.optional(),
    priority: z.number().finite().optional(),
    anchor_id: AnchorId.optional(),
    schema_version: SchemaVersion.optional(),
  })
  .passthrough();

export const validateFrontMatter: Validator = (context) => {
  const classification = classifyAnchorPath(context.name);
  if (classification.kind === "generated") {
    return [];
  }

  const parsed = parseAnchor(context.newContent);
  const result = AnchorFrontmatterSchema.safeParse(parsed.frontmatter);
  const violations = [];
  if (result.success) {
    if (classification.kind === "anchor" && classification.category === "projects") {
      const project = result.data.project;
      if (!project) {
        violations.push(
          maybeMigrationBlock(
            context,
            "project_required",
            "Project anchors require front matter project containing the projects/<project-slug> slug.",
          ),
        );
      } else if (!frontmatterProjectIncludes(project, classification.projectSlug)) {
        violations.push(
          maybeMigrationBlock(
            context,
            "project_slug_mismatch",
            `Project front matter must include slug "${classification.projectSlug}".`,
          ),
        );
      }
    }

    violations.push(
      ...validateTypedFrontmatterOverlay(parsed.frontmatter as Record<string, unknown>).map((issue) =>
        maybeMigrationBlock(context, issue.code, issue.message),
      ),
    );

    return violations;
  }

  violations.push(
    ...result.error.issues.map((issue) =>
      maybeMigrationBlock(
        context,
        "front_matter_schema",
        `Front matter ${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    ),
  );

  return violations;
};

function frontmatterProjectIncludes(project: string | string[], slug: string | undefined): boolean {
  if (!slug) {
    return false;
  }

  if (Array.isArray(project)) {
    return project.includes(slug);
  }

  return project === slug;
}
