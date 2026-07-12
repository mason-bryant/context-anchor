import {
  extractHeadingSections,
  findHeadingSectionInIndex,
  parseAnchor,
  parseBodyH2Segments,
  stringifyBodyH2Segments,
} from "./storage/markdown.js";
import type { AnchorFrontmatter, ValidationViolation } from "./types.js";

export const ANCHOR_SECTION_SCHEMA = {
  Introduction: {
    level: 2,
    required: "project-context",
    definition: "A brief orientation to why the project exists, what it aims to achieve, who it serves, and what it intentionally excludes.",
    claimBearing: true,
    substantive: true,
    approvalRequired: false,
  },
  Purpose: {
    level: 3,
    parent: "Introduction",
    required: "project-context",
    definition: "The problem the project exists to solve and why the work matters.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  Goals: {
    level: 3,
    parent: "Introduction",
    required: "project-context",
    definition: "The outcomes the project intends to achieve.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  Users: {
    level: 3,
    parent: "Introduction",
    required: "project-context",
    definition: "The primary users, operators, reviewers, or stakeholders the project serves.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  "Non-goals": {
    level: 3,
    parent: "Introduction",
    required: "project-context",
    definition: "Explicit scope boundaries: outcomes or capabilities the project is not trying to deliver.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  Invariants: {
    level: 2,
    required: "project-context",
    definition: "Intentional, architecture-level guarantees that must always remain true.",
    claimBearing: true,
    substantive: true,
    approvalRequired: true,
  },
  "Current State": {
    level: 2,
    required: "all",
    definition: "Observable facts about what exists and how the project behaves today.",
    claimBearing: true,
    substantive: true,
    approvalRequired: false,
  },
  Architecture: {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "The implemented system boundaries, major components, and relationships that exist today.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  Capabilities: {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "User- or operator-visible behavior that is implemented and available today.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  Interfaces: {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "Current APIs, protocols, commands, and integration boundaries.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  "Data and Persistence": {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "Current data models, storage backends, indexing, and durability behavior.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  "Operations and Security": {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "Current deployment, observability, access-control, and operational behavior.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  "Quality and Performance": {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "Verified quality characteristics, performance measurements, and test coverage.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  "Known Limitations": {
    level: 3,
    parent: "Current State",
    required: "optional",
    definition: "Observed gaps or limitations in the current implementation, without forward-looking plans.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
  Decisions: {
    level: 2,
    required: "all",
    definition: "Settled choices already made, including rationale when it is useful.",
    claimBearing: true,
    substantive: true,
    approvalRequired: true,
  },
  Constraints: {
    level: 2,
    required: "all",
    definition: "Limits imposed by the current environment, technology, organization, or operating context.",
    claimBearing: true,
    substantive: true,
    approvalRequired: true,
  },
  PRs: {
    level: 2,
    required: "all",
    definition: "Related pull requests, grouped by status and linked with the required PR title and number format.",
    claimBearing: false,
    substantive: false,
    approvalRequired: false,
  },
} as const;

export type AnchorSectionName = keyof typeof ANCHOR_SECTION_SCHEMA;
export type DesignHeaderSection = "Introduction" | "Invariants";
export type IntroductionField = "Purpose" | "Goals" | "Users" | "Non-goals";
export type AlwaysRequiredSectionName = "Current State" | "Decisions" | "Constraints" | "PRs";

const schemaEntries = Object.entries(ANCHOR_SECTION_SCHEMA) as Array<
  [AnchorSectionName, (typeof ANCHOR_SECTION_SCHEMA)[AnchorSectionName]]
>;

export const ANCHOR_SECTION_DEFINITIONS = Object.fromEntries(
  schemaEntries.map(([name, definition]) => [name, definition.definition]),
) as Record<AnchorSectionName, string>;
export const DESIGN_HEADER_SECTIONS = schemaEntries
  .filter(([, definition]) => definition.required === "project-context" && definition.level === 2)
  .map(([name]) => name) as DesignHeaderSection[];
export const INTRODUCTION_FIELDS = schemaEntries
  .filter(([, definition]) => "parent" in definition && definition.parent === "Introduction")
  .map(([name]) => name) as IntroductionField[];
export const CURRENT_STATE_TOPICS = schemaEntries
  .filter(([, definition]) => "parent" in definition && definition.parent === "Current State")
  .map(([name]) => name);
export const ALWAYS_REQUIRED_SECTIONS = schemaEntries
  .filter(([, definition]) => definition.required === "all")
  .map(([name]) => name) as AlwaysRequiredSectionName[];
export const CLAIM_BEARING_SECTIONS = schemaEntries
  .filter(([, definition]) => definition.level === 2 && definition.claimBearing)
  .map(([name]) => name);
export const APPROVAL_REQUIRED_SECTIONS = schemaEntries
  .filter(([, definition]) => definition.level === 2 && definition.approvalRequired)
  .map(([name]) => name);
export const SUBSTANTIVE_SECTIONS = schemaEntries
  .filter(([, definition]) => definition.level === 2 && definition.substantive)
  .map(([name]) => name);

export function anchorSectionGuidance(): string {
  return schemaEntries.map(([name, definition]) => `${name}: ${definition.definition}`).join(" ");
}

/** Insert a new top-level bullet immediately below a defined H2/H3 heading. */
export function insertAnchorSectionBullet(content: string, heading: string, text: string): string {
  const definition = ANCHOR_SECTION_SCHEMA[heading as AnchorSectionName];
  if (!definition) {
    throw new Error(`Unknown structured anchor section: ${heading}`);
  }
  const bulletText = text.trim();
  if (!bulletText) {
    throw new Error("Section content is required.");
  }
  if (/[\r\n]/.test(bulletText)) {
    throw new Error("Section content must be a single line.");
  }

  const parsed = parseAnchor(content);
  if (!content.endsWith(parsed.body)) {
    throw new Error(`Could not preserve front matter while adding content to ${heading}.`);
  }
  const newline = parsed.body.includes("\r\n") ? "\r\n" : "\n";
  const lines = parsed.body.split(/\r?\n/);
  let fence: { char: string; length: number } | undefined;
  let target = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch?.[1]) {
      const char = fenceMatch[1][0] ?? "`";
      if (!fence) {
        fence = { char, length: fenceMatch[1].length };
      } else if (fence.char === char && fenceMatch[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) {
        fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match?.[1]?.length === definition.level && match[2]?.trim() === heading) {
      target = index;
      break;
    }
  }

  if (target < 0) {
    throw new Error(`Structured anchor section not found: ${"#".repeat(definition.level)} ${heading}`);
  }

  const insertion = ["", `- ${bulletText}`];
  if ((lines[target + 1] ?? "").trim() !== "") {
    insertion.push("");
  }
  lines.splice(target + 1, 0, ...insertion);
  const nextBody = lines.join(newline);
  return `${content.slice(0, content.length - parsed.body.length)}${nextBody}`;
}

export type DesignHeaderStatus = {
  applies: boolean;
  sections: Record<DesignHeaderSection, boolean>;
  introduction: Record<IntroductionField, boolean>;
  isAtTop: boolean;
};

/** The design header applies to the durable context anchor for a project, not its roadmap or milestones. */
export function isProjectContextAnchor(name: string, frontmatter: AnchorFrontmatter): boolean {
  return /^projects\/[^/]+\/[^/]+\.md$/.test(name) && frontmatterTypeIncludes(frontmatter.type, "context-anchor");
}

export function designHeaderStatus(name: string, content: string): DesignHeaderStatus {
  const parsed = parseAnchor(content);
  const applies = isProjectContextAnchor(name, parsed.frontmatter);
  const introduction = parsed.sections.get("Introduction");
  const h2Titles = parseBodyH2Segments(parsed.body)
    .filter((segment) => segment.kind === "section")
    .map((segment) => segment.title);
  const introIndex = h2Titles.indexOf("Introduction");
  const invariantsIndex = h2Titles.indexOf("Invariants");

  return {
    applies,
    sections: {
      Introduction: parsed.sections.has("Introduction"),
      Invariants: parsed.sections.has("Invariants"),
    },
    introduction: Object.fromEntries(
      INTRODUCTION_FIELDS.map((field) => [field, introduction !== undefined && extractH3Titles(introduction).has(field)]),
    ) as Record<IntroductionField, boolean>,
    isAtTop: introIndex === 0 && invariantsIndex === 1,
  };
}

export function designHeaderWarnings(name: string, content: string): ValidationViolation[] {
  const status = designHeaderStatus(name, content);
  if (!status.applies) {
    return [];
  }

  const warnings: ValidationViolation[] = [];
  for (const section of DESIGN_HEADER_SECTIONS) {
    if (!status.sections[section]) {
      warnings.push({
        severity: "WARN",
        code: "design_header_section_missing",
        message: `Project context anchor is missing design header section: ## ${section}.`,
        path: name,
      });
    }
  }
  if (status.sections.Introduction) {
    for (const field of INTRODUCTION_FIELDS) {
      if (!status.introduction[field]) {
        warnings.push({
          severity: "WARN",
          code: "design_header_field_missing",
          message: `Project context anchor Introduction is missing: ### ${field}.`,
          path: name,
        });
      }
    }
  }
  if (status.sections.Introduction && status.sections.Invariants && !status.isAtTop) {
    warnings.push({
      severity: "WARN",
      code: "design_header_not_at_top",
      message: "## Introduction and ## Invariants should be the first two H2 sections, in that order.",
      path: name,
    });
  }
  return warnings;
}

const UNSTRUCTURED_CURRENT_STATE_CLAIMS = 8;
const OVERSIZED_CURRENT_STATE_TOPIC_CLAIMS = 12;
const CHANGELOG_HEAVY_CURRENT_STATE_CLAIMS = 3;

export type CurrentStateOrganizationStatus = {
  applies: boolean;
  status: "not-applicable" | "concise" | "organized" | "needs-attention";
  claimCount: number;
  ungroupedClaimCount: number;
  historyClaimCount: number;
  topics: Array<{ title: string; path: string; claimCount: number }>;
  suggestedTopics: string[];
};

/** Summarize the same organization signals shown by validation and the UI. */
export function currentStateOrganizationStatus(name: string, content: string): CurrentStateOrganizationStatus {
  const parsed = parseAnchor(content);
  if (!isProjectContextAnchor(name, parsed.frontmatter)) {
    return {
      applies: false,
      status: "not-applicable",
      claimCount: 0,
      ungroupedClaimCount: 0,
      historyClaimCount: 0,
      topics: [],
      suggestedTopics: [...CURRENT_STATE_TOPICS],
    };
  }

  const sections = extractHeadingSections(parsed.body);
  const currentState = findHeadingSectionInIndex(sections, ["Current State"]);
  if (!currentState) {
    return {
      applies: true,
      status: "needs-attention",
      claimCount: 0,
      ungroupedClaimCount: 0,
      historyClaimCount: 0,
      topics: [],
      suggestedTopics: [...CURRENT_STATE_TOPICS],
    };
  }

  const claimLines = currentState.bodyLines.filter(isCurrentStateBullet);
  const currentStateEndLine = currentState.startLine + currentState.bodyLines.length;
  const topicSections = sections.filter(
    (section) => section.level === 3
      && section.path[0] === "Current State"
      && section.startLine > currentState.startLine
      && section.startLine <= currentStateEndLine,
  );
  const firstTopic = topicSections[0];
  const ungroupedBodyLineCount = firstTopic
    ? Math.max(0, firstTopic.startLine - currentState.startLine - 1)
    : currentState.bodyLines.length;
  const ungroupedClaimCount = currentState.bodyLines
    .slice(0, ungroupedBodyLineCount)
    .filter(isCurrentStateBullet).length;
  const topics = topicSections.map((topic) => ({
    title: topic.title,
    path: topic.path.join(" > "),
    claimCount: topic.bodyLines.filter(isCurrentStateBullet).length,
  }));
  const historyClaimCount = claimLines.filter((line) =>
    /\b(?:shipped|merged|landed|implemented locally)\b|\bPR\s*#\d+/i.test(line)
  ).length;
  const needsAttention = (
    (claimLines.length >= UNSTRUCTURED_CURRENT_STATE_CLAIMS && ungroupedClaimCount > 0)
    || topics.some((topic) => topic.claimCount > OVERSIZED_CURRENT_STATE_TOPIC_CLAIMS)
    || historyClaimCount >= CHANGELOG_HEAVY_CURRENT_STATE_CLAIMS
  );

  return {
    applies: true,
    status: needsAttention ? "needs-attention" : topics.length > 0 ? "organized" : "concise",
    claimCount: claimLines.length,
    ungroupedClaimCount,
    historyClaimCount,
    topics,
    suggestedTopics: [...CURRENT_STATE_TOPICS],
  };
}

function isCurrentStateBullet(line: string): boolean {
  return /^\s*[-*]\s+\S/.test(line);
}

/**
 * Quality guardrails for project context anchors. These remain warnings so
 * existing anchors can migrate incrementally without blocking durable facts.
 */
export function currentStateOrganizationWarnings(name: string, content: string): ValidationViolation[] {
  const organization = currentStateOrganizationStatus(name, content);
  if (!organization.applies) return [];
  const warnings: ValidationViolation[] = [];

  if (
    organization.claimCount >= UNSTRUCTURED_CURRENT_STATE_CLAIMS
    && organization.ungroupedClaimCount > 0
  ) {
    warnings.push({
      severity: "WARN",
      code: "current_state_unstructured",
      message:
        `Project Current State has ${organization.ungroupedClaimCount} ungrouped claims out of ${organization.claimCount}. Group durable facts under H3 topic headings `
        + `(for example ${CURRENT_STATE_TOPICS.slice(0, 4).join(", ")}) so humans and agents can retrieve them selectively.`,
      path: name,
    });
  }

  for (const topic of organization.topics) {
    if (topic.claimCount > OVERSIZED_CURRENT_STATE_TOPIC_CLAIMS) {
      warnings.push({
        severity: "WARN",
        code: "current_state_topic_oversized",
        message:
          `Current State topic "${topic.title}" has ${topic.claimCount} claims; split it into narrower H3 topics or a sibling detail anchor.`,
        path: name,
      });
    }
  }

  if (organization.historyClaimCount >= CHANGELOG_HEAVY_CURRENT_STATE_CLAIMS) {
    warnings.push({
      severity: "WARN",
      code: "current_state_changelog_heavy",
      message:
        `Project Current State has ${organization.historyClaimCount} release-history-style claims. Describe the resulting present behavior here and move chronological PR history to ## PRs.`,
      path: name,
    });
  }

  return warnings;
}

/** Add missing design-header sections/fields to persisted Markdown and move the header to the top. */
export function migrateDesignHeaderContent(name: string, content: string): string {
  const parsed = parseAnchor(content);
  const status = designHeaderStatus(name, content);
  if (!status.applies || (status.isAtTop && allPresent(status))) {
    return content;
  }

  const sourceSegments = parseBodyH2Segments(parsed.body);
  const preamble = sourceSegments.find((segment) => segment.kind === "preamble") ?? { kind: "preamble" as const, lines: [] };
  const sections = sourceSegments.filter((segment) => segment.kind === "section");
  const introduction = sections.find((segment) => segment.title === "Introduction");
  const invariants = sections.find((segment) => segment.title === "Invariants");
  const remainder = sections.filter((segment) => segment !== introduction && segment !== invariants);

  const introductionBody = introduction ? [...introduction.bodyLines] : [];
  const presentFields = extractH3Titles(introductionBody.join("\n"));
  for (const field of INTRODUCTION_FIELDS) {
    if (!presentFields.has(field)) {
      introductionBody.push("", `### ${field}`, "");
    }
  }

  const nextBody = stringifyBodyH2Segments([
    preamble,
    {
      kind: "section",
      headingLine: introduction?.headingLine ?? "## Introduction",
      title: "Introduction",
      bodyLines: introductionBody,
    },
    {
      kind: "section",
      headingLine: invariants?.headingLine ?? "## Invariants",
      title: "Invariants",
      bodyLines: invariants ? invariants.bodyLines : [""],
    },
    ...remainder,
  ]);
  if (!content.endsWith(parsed.body)) {
    throw new Error(`Could not preserve front matter while migrating design header: ${name}`);
  }
  return `${content.slice(0, content.length - parsed.body.length)}${nextBody}`;
}

function extractH3Titles(markdown: string): Set<string> {
  const titles = new Set<string>();
  let fence: { char: string; length: number } | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch?.[1]) {
      const char = fenceMatch[1][0] ?? "`";
      if (!fence) {
        fence = { char, length: fenceMatch[1].length };
      } else if (fence.char === char && fenceMatch[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) {
        fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    const match = line.match(/^###\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) titles.add(match[1].trim());
  }
  return titles;
}

function allPresent(status: DesignHeaderStatus): boolean {
  return DESIGN_HEADER_SECTIONS.every((section) => status.sections[section])
    && INTRODUCTION_FIELDS.every((field) => status.introduction[field]);
}

function frontmatterTypeIncludes(value: unknown, expected: string): boolean {
  return typeof value === "string"
    ? value === expected
    : Array.isArray(value) && value.some((entry) => entry === expected);
}
