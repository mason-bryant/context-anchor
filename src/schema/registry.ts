import * as z from "zod/v4";

import { isProjectMilestoneType } from "./milestoneTypes.js";

/**
 * Extra front-matter fields for `type: project-milestone` (beyond universal anchor fields).
 * Parsed with the full front matter object so unknown keys are ignored.
 */
const milestoneIdSchema = z.union([z.string().regex(/^M\d+$/), z.literal("backlog")]);

const sequenceSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().positive()),
]);

export const ProjectMilestoneTypedOverlaySchema = z
  .object({
    schema_version: z.union([z.literal(1), z.literal("1")]),
    theme: z.string().min(1).max(480),
    steel_thread: z.string().min(1).max(480).optional(),
    status: z.enum(["proposed", "active", "shipped", "cancelled"]),
    relations: z.object({
      goal_ids: z.array(z.string().regex(/^G-\d{1,6}$/)).min(1),
    }),
    milestone_id: milestoneIdSchema.optional(),
    sequence: sequenceSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.milestone_id !== undefined && data.milestone_id !== "backlog") {
      if (data.sequence === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "sequence is required when milestone_id is set and not backlog",
          path: ["sequence"],
        });
      }
    }
    if (data.milestone_id === "backlog" && data.sequence !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "sequence must not be set when milestone_id is backlog",
        path: ["sequence"],
      });
    }
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
