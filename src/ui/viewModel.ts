import { classifyAnchorPath, SERVER_RULES_DISCOVERY_CATEGORY } from "../taxonomy.js";
import {
  normalizedMilestoneId,
  normalizedScheduleFromFm,
  normalizedSequenceFromFm,
  normalizedTasksFromFm,
} from "../milestoneFrontmatter.js";
import { analyzeRoadmapFromContent } from "../roadmap/analyzeRoadmap.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { parseAnchor } from "../storage/markdown.js";
import type { AnchorMeta, AnchorRead, MilestonePlannerMeta, ValidationSeverity } from "../types.js";
import type { ClaimWithCertainty } from "../certainty.js";
import type { MermaidBlock } from "../mermaidBlocks.js";
import type { AnchorQuestion } from "../questions.js";

const REQUIRED_SECTIONS = ["Current State", "Decisions", "Constraints", "PRs"] as const;

export type RequiredSectionName = (typeof REQUIRED_SECTIONS)[number];
export type AnchorHealthStatus = "ok" | "warn" | "block";

export type AnchorHealthIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
};

export type RequiredSectionStatus = Record<RequiredSectionName, boolean>;

export type AnchorUiHealth = {
  status: AnchorHealthStatus;
  issues: AnchorHealthIssue[];
};

export type AnchorUiMeta = AnchorMeta & {
  ui: {
    label: string;
    health: AnchorUiHealth;
  };
};

export type AnchorUiDetail = AnchorRead & {
  ui: {
    label: string;
    health: AnchorUiHealth;
    sections: RequiredSectionStatus;
    claims: (ClaimWithCertainty & { anchor: string })[];
    mermaidBlocks: (MermaidBlock & { anchor: string })[];
    questions: (AnchorQuestion & { anchor: string })[];
  };
};

export function toAnchorUiMeta(anchor: AnchorMeta): AnchorUiMeta {
  return {
    ...anchor,
    ui: {
      label: anchor.title || anchor.name,
      health: summarizeAnchorHealth(anchor),
    },
  };
}

export function toAnchorUiDetail(
  anchor: AnchorRead,
  meta?: AnchorMeta,
  claims: (ClaimWithCertainty & { anchor: string })[] = [],
  questions: (AnchorQuestion & { anchor: string })[] = [],
  mermaidBlocks: (MermaidBlock & { anchor: string })[] = [],
): AnchorUiDetail {
  const displayMeta = meta ?? anchorReadToMeta(anchor);
  const sections = requiredSectionStatus(anchor.content);

  return {
    ...anchor,
    ui: {
      label: displayMeta.title || anchor.name,
      health: summarizeAnchorHealth(displayMeta, sections),
      sections,
      claims,
      mermaidBlocks,
      questions,
    },
  };
}

export function requiredSectionStatus(content: string): RequiredSectionStatus {
  const sections = parseAnchor(content).sections;

  return {
    "Current State": sections.has("Current State"),
    Decisions: sections.has("Decisions"),
    Constraints: sections.has("Constraints"),
    PRs: sections.has("PRs"),
  };
}

export function summarizeAnchorHealth(anchor: AnchorMeta, sections?: RequiredSectionStatus): AnchorUiHealth {
  const issues: AnchorHealthIssue[] = [];

  if (!isNonEmptyString(anchor.summary)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_summary",
      message: "Missing non-empty summary front matter.",
    });
  }

  if (!Array.isArray(anchor.read_this_if) || anchor.read_this_if.length === 0) {
    issues.push({
      severity: "BLOCK",
      code: "missing_read_this_if",
      message: "Missing read_this_if front matter.",
    });
  }

  if (!isNonEmptyString(anchor.type)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_type",
      message: "Missing non-empty type front matter.",
    });
  }

  if (!Array.isArray(anchor.tags)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_tags",
      message: "Missing tags array front matter.",
    });
  }

  if (!isValidDateLike(anchor.last_validated)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_last_validated",
      message: "Missing strict YYYY-MM-DD last_validated front matter.",
    });
  }

  const classification = classifyAnchorPath(anchor.name);
  if (classification.kind === "anchor" && classification.projectSlug) {
    if (!frontmatterValueIncludes(anchor.project, classification.projectSlug)) {
      issues.push({
        severity: "BLOCK",
        code: "project_slug_mismatch",
        message: `Project front matter must include "${classification.projectSlug}".`,
      });
    }
  }

  if (sections) {
    for (const section of REQUIRED_SECTIONS) {
      if (!sections[section]) {
        issues.push({
          severity: "BLOCK",
          code: "required_section",
          message: `Missing required section: ## ${section}.`,
        });
      }
    }
  }

  const acceptance = anchor.acceptanceCriteria;
  if (acceptance?.criteriaViolations?.length) {
    for (const message of acceptance.criteriaViolations) {
      issues.push({
        severity: "BLOCK",
        code: "roadmap_acceptance_criteria",
        message,
      });
    }
  }

  if (acceptance?.goalsMissingCriteria.length) {
    issues.push({
      severity: "WARN",
      code: "roadmap_missing_acceptance_criteria",
      message: `${acceptance.goalsMissingCriteria.length} active roadmap goal(s) are missing acceptance criteria.`,
    });
  }

  if (acceptance?.goalsWithoutStableIds?.length) {
    issues.push({
      severity: "WARN",
      code: "roadmap_goal_stable_id",
      message: `${acceptance.goalsWithoutStableIds.length} roadmap goal(s) are missing stable G-### ids.`,
    });
  }

  if (acceptance?.hasProposedCriteria) {
    issues.push({
      severity: "WARN",
      code: "roadmap_proposed_acceptance_criteria",
      message: "Roadmap contains proposed acceptance criteria.",
    });
  }

  const status: AnchorHealthStatus = issues.some((issue) => issue.severity === "BLOCK")
    ? "block"
    : issues.some((issue) => issue.severity === "WARN")
      ? "warn"
      : "ok";

  return { status, issues };
}

function anchorReadToMeta(anchor: AnchorRead): AnchorMeta {
  const classification = classifyAnchorPath(anchor.name);
  const frontmatter = anchor.frontmatter;
  const parsed = parseAnchor(anchor.content);
  const meta: AnchorMeta = {
    name: anchor.name,
    path: anchor.path,
    category: anchor.name.startsWith("server-rules/")
      ? SERVER_RULES_DISCOVERY_CATEGORY
      : classification.kind === "anchor"
        ? classification.category
        : "shared",
    projectSlug: classification.kind === "anchor" ? classification.projectSlug : undefined,
    title: parsed.title,
    project: frontmatter.project,
    type: frontmatter.type,
    tags: frontmatter.tags,
    summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
    read_this_if: Array.isArray(frontmatter.read_this_if)
      ? frontmatter.read_this_if.filter((item): item is string => typeof item === "string")
      : [],
    last_validated: frontmatter.last_validated,
    origin: anchor.name.startsWith("server-rules/") ? "built-in" : "repo",
  };

  if (isProjectRoadmapType(frontmatter.type)) {
    const analysis = analyzeRoadmapFromContent(anchor.content, { isProjectRoadmap: true });
    meta.acceptanceCriteria = {
      activeGoals: analysis.activeGoals,
      goalsWithCriteria: analysis.goalsWithCriteria,
      goalsMissingCriteria: analysis.goalsMissingCriteria,
      goalsMissingCriteriaIds:
        (analysis.goalsMissingCriteriaIds?.length ?? 0) > 0 ? analysis.goalsMissingCriteriaIds : undefined,
      goalsWithoutStableIds:
        (analysis.goalsWithoutStableIds?.length ?? 0) > 0 ? analysis.goalsWithoutStableIds : undefined,
      goalsDuplicateStableIds:
        (analysis.goalsDuplicateStableIds?.length ?? 0) > 0 ? analysis.goalsDuplicateStableIds : undefined,
      hasProposedCriteria: analysis.hasProposedCriteria,
      criteriaViolations: analysis.criteriaViolations.length > 0 ? analysis.criteriaViolations : undefined,
    };
  }

  if (isProjectMilestoneType(frontmatter.type)) {
    meta.milestone = milestoneMetaFromFrontmatter(frontmatter);
  }

  return meta;
}

function milestoneMetaFromFrontmatter(frontmatter: Record<string, unknown>): MilestonePlannerMeta | undefined {
  const status = frontmatter.status;
  const theme = frontmatter.theme;
  if (
    typeof status !== "string" ||
    !["proposed", "active", "shipped", "cancelled"].includes(status) ||
    typeof theme !== "string" ||
    theme.length === 0
  ) {
    return undefined;
  }

  const rel = frontmatter.relations as { goal_ids?: unknown } | undefined;
  const goalIds = Array.isArray(rel?.goal_ids)
    ? rel.goal_ids.filter((item): item is string => typeof item === "string")
    : [];
  const milestoneId = normalizedMilestoneId(frontmatter.milestone_id);
  const sequence = normalizedSequenceFromFm(frontmatter);
  const schedule = normalizedScheduleFromFm(frontmatter);
  const tasks = normalizedTasksFromFm(frontmatter);
  const steelThread = frontmatter.steel_thread;

  return {
    status: status as MilestonePlannerMeta["status"],
    theme,
    steelThread: typeof steelThread === "string" && steelThread.length > 0 ? steelThread : undefined,
    goalIds,
    ...(milestoneId !== undefined ? { milestoneId } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
    ...(tasks !== undefined ? { tasks } : {}),
  };
}

function isProjectRoadmapType(type: unknown): boolean {
  if (type === "project-roadmap") {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some((item) => item === "project-roadmap");
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateLike(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.valueOf());
  }

  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function frontmatterValueIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    return value === expected;
  }

  return Array.isArray(value) && value.includes(expected);
}
