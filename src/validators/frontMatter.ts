import * as z from "zod/v4";

import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

const StringOrStringArray = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const LastValidated = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.date()]);
const LoadingInstruction = z.string().min(1).max(160);

const AnchorFrontmatterSchema = z
  .object({
    type: z.string().min(1),
    tags: z.array(z.string()),
    summary: z.string().min(1).max(240),
    read_this_if: z.array(LoadingInstruction).min(1).max(5),
    last_validated: LastValidated,
    project: StringOrStringArray.optional(),
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
