import { classifyAnchorPath } from "../taxonomy.js";
import { parseAnchor } from "../storage/markdown.js";
import type { AnchorMeta, AnchorRead, ValidationSeverity } from "../types.js";

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

export function toAnchorUiDetail(anchor: AnchorRead, meta?: AnchorMeta): AnchorUiDetail {
  const displayMeta = meta ?? anchorReadToMeta(anchor);
  const sections = requiredSectionStatus(anchor.content);

  return {
    ...anchor,
    ui: {
      label: displayMeta.title || anchor.name,
      health: summarizeAnchorHealth(displayMeta, sections),
      sections,
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

  return {
    name: anchor.name,
    path: anchor.path,
    category: classification.kind === "anchor" ? classification.category : "shared",
    projectSlug: classification.kind === "anchor" ? classification.projectSlug : undefined,
    title: titleFromMarkdown(anchor.content),
    project: frontmatter.project,
    type: frontmatter.type,
    tags: frontmatter.tags,
    summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
    read_this_if: Array.isArray(frontmatter.read_this_if)
      ? frontmatter.read_this_if.filter((item): item is string => typeof item === "string")
      : [],
    last_validated: frontmatter.last_validated,
    origin: "repo",
  };
}

function titleFromMarkdown(content: string): string | undefined {
  return content.match(/^#\s+(.+?)\s*$/m)?.[1];
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
