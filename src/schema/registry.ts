import * as z from "zod/v4";

import { isProjectMilestoneType } from "./milestoneTypes.js";
import {
  AGENT_RULE_PROPOSED_CHANGES_TYPE,
  PROJECT_PROPOSED_CHANGES_TYPE,
  isProposedChangesType,
} from "../proposedChanges.js";

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

const isoDateSchema = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.date()]);

const nullableIsoDateSchema = z.union([isoDateSchema, z.null()]);

const dateConfidenceSchema = z.enum(["committed", "internal_goal", "estimated"]);

const milestoneTaskStatusSchema = z.enum(["todo", "active", "blocked", "done", "cancelled"]);

const milestoneTaskSchema = z.object({
  id: z.string().regex(/^T-\d{1,6}$/),
  title: z.string().min(1).max(240),
  status: milestoneTaskStatusSchema,
  owner: z.string().min(1).max(160).optional(),
  goal_ids: z.array(z.string().regex(/^G-\d{1,6}$/)).optional(),
  due: nullableIsoDateSchema.optional(),
  completed_on: nullableIsoDateSchema.optional(),
  date_confidence: dateConfidenceSchema.optional(),
  notes: z.string().min(1).max(480).optional(),
});

const milestoneScheduleSchema = z.object({
  start: nullableIsoDateSchema.optional(),
  target: nullableIsoDateSchema.optional(),
  shipped: nullableIsoDateSchema.optional(),
  date_confidence: dateConfidenceSchema.optional(),
});

export const ProjectMilestoneTypedOverlaySchema = z
  .object({
    schema_version: z.union([z.literal(1), z.literal("1")]),
    theme: z.string().min(1).max(480),
    steel_thread: z.string().min(1).max(480).optional(),
    status: z.enum(["proposed", "active", "shipped", "cancelled"]),
    relations: z.object({
      goal_ids: z.array(z.string().regex(/^G-\d{1,6}$/)),
    }),
    milestone_id: milestoneIdSchema.optional(),
    sequence: sequenceSchema.optional(),
    schedule: milestoneScheduleSchema.optional(),
    tasks: z.array(milestoneTaskSchema).optional(),
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
    if (data.milestone_id !== "backlog" && data.relations.goal_ids.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "relations.goal_ids must include at least one goal id unless milestone_id is backlog",
        path: ["relations", "goal_ids"],
      });
    }
    if (data.schedule) {
      const hasPlannedScheduleDate = data.schedule.start !== undefined && data.schedule.start !== null;
      const hasTargetDate = data.schedule.target !== undefined && data.schedule.target !== null;
      if ((hasPlannedScheduleDate || hasTargetDate) && data.schedule.date_confidence === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "schedule.date_confidence is required when schedule.start or schedule.target is set",
          path: ["schedule", "date_confidence"],
        });
      }
    }

    const seenTaskIds = new Set<string>();
    const milestoneGoalIds = new Set(data.relations.goal_ids);
    for (const [index, task] of (data.tasks ?? []).entries()) {
      if (seenTaskIds.has(task.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate task id "${task.id}"`,
          path: ["tasks", index, "id"],
        });
      }
      seenTaskIds.add(task.id);

      if (task.due !== undefined && task.due !== null && task.date_confidence === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "task.date_confidence is required when task.due is set",
          path: ["tasks", index, "date_confidence"],
        });
      }
      if (task.status === "done" && (task.completed_on === undefined || task.completed_on === null)) {
        ctx.addIssue({
          code: "custom",
          message: "task.completed_on is required when task.status is done",
          path: ["tasks", index, "completed_on"],
        });
      }
      if (task.status !== "done" && task.completed_on !== undefined && task.completed_on !== null) {
        ctx.addIssue({
          code: "custom",
          message: "task.completed_on must only be set when task.status is done",
          path: ["tasks", index, "completed_on"],
        });
      }
      for (const [goalIndex, goalId] of (task.goal_ids ?? []).entries()) {
        if (!milestoneGoalIds.has(goalId)) {
          ctx.addIssue({
            code: "custom",
            message: `task goal_id "${goalId}" is not listed in relations.goal_ids`,
            path: ["tasks", index, "goal_ids", goalIndex],
          });
        }
      }
    }
  });

export type ProjectMilestoneTypedOverlay = z.infer<typeof ProjectMilestoneTypedOverlaySchema>;

const ProposalScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    project: z.string().min(1),
  }),
  z.object({
    kind: z.literal("agent-rules"),
  }),
]);

export const ProposedChangesTypedOverlaySchema = z
  .object({
    schema_version: z.union([z.literal(1), z.literal("1")]),
    proposal_scope: ProposalScopeSchema,
  });

function validateProposedChangesOverlay(frontmatter: Record<string, unknown>): {
  code: string;
  message: string;
}[] {
  const result = ProposedChangesTypedOverlaySchema.safeParse(frontmatter);
  if (!result.success) {
    return result.error.issues.map((issue) => ({
      code: "front_matter_typed_schema",
      message: `Typed front matter ${issue.path.join(".") || "root"}: ${issue.message}`,
    }));
  }

  const hasProjectType = typeIncludes(frontmatter.type, PROJECT_PROPOSED_CHANGES_TYPE);
  const hasAgentRulesType = typeIncludes(frontmatter.type, AGENT_RULE_PROPOSED_CHANGES_TYPE);
  const scope = result.data.proposal_scope;
  if (hasProjectType && hasAgentRulesType) {
    return [
      {
        code: "front_matter_typed_schema",
        message: "Typed front matter type must not include both proposed-change ledger types",
      },
    ];
  }
  if (hasProjectType && scope.kind !== "project") {
    return [
      {
        code: "front_matter_typed_schema",
        message: "Typed front matter proposal_scope.kind must be project for type: project-proposed-changes",
      },
    ];
  }
  if (hasAgentRulesType && scope.kind !== "agent-rules") {
    return [
      {
        code: "front_matter_typed_schema",
        message: "Typed front matter proposal_scope.kind must be agent-rules for type: agent-rule-proposed-changes",
      },
    ];
  }

  return [];
}

function typeIncludes(type: unknown, expected: string): boolean {
  if (typeof type === "string") {
    return type === expected;
  }
  if (Array.isArray(type)) {
    return type.includes(expected);
  }
  return false;
}

const TYPED_OVERLAY_SCHEMAS: Array<{
  matches: (frontmatter: Record<string, unknown>) => boolean;
  schema?: z.ZodTypeAny;
  validate?: (frontmatter: Record<string, unknown>) => { code: string; message: string }[];
}> = [
  {
    matches: (fm) => isProjectMilestoneType(fm.type),
    schema: ProjectMilestoneTypedOverlaySchema,
  },
  {
    matches: (fm) => isProposedChangesType(fm.type),
    validate: validateProposedChangesOverlay,
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
    if (entry.validate) {
      return entry.validate(frontmatter);
    }
    if (!entry.schema) {
      return [];
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
