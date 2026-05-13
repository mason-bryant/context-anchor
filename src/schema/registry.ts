import * as z from "zod/v4";

import { isProjectMilestoneType } from "./milestoneTypes.js";

/**
 * Extra front-matter fields for `type: project-milestone` (beyond universal anchor fields).
 * Parsed with the full front matter object so unknown keys are ignored.
 */
export const ProjectMilestoneTypedOverlaySchema = z.object({
  schema_version: z.union([z.literal(1), z.literal("1")]),
  theme: z.string().min(1).max(480),
  steel_thread: z.string().min(1).max(480).optional(),
  status: z.enum(["proposed", "active", "shipped", "cancelled"]),
  relations: z.object({
    goal_ids: z.array(z.string().regex(/^G-\d{1,6}$/)).min(1),
  }),
});

export type ProjectMilestoneTypedOverlay = z.infer<typeof ProjectMilestoneTypedOverlaySchema>;

const TYPED_OVERLAY_SCHEMAS: Array<{
  matches: (frontmatter: Record<string, unknown>) => boolean;
  schema: z.ZodTypeAny;
}> = [
  {
    matches: (fm) => isProjectMilestoneType(fm.type),
    schema: ProjectMilestoneTypedOverlaySchema,
  },
];

export function validateTypedFrontmatterOverlay(frontmatter: Record<string, unknown>): {
  code: string;
  message: string;
}[] {
  const issues: { code: string; message: string }[] = [];

  for (const entry of TYPED_OVERLAY_SCHEMAS) {
    if (!entry.matches(frontmatter)) {
      continue;
    }
    const result = entry.schema.safeParse(frontmatter);
    if (result.success) {
      return [];
    }
    for (const issue of result.error.issues) {
      issues.push({
        code: "front_matter_typed_schema",
        message: `Typed front matter ${issue.path.join(".") || "root"}: ${issue.message}`,
      });
    }
    return issues;
  }

  return [];
}
