import {
  appendToAnchorSection,
  deleteAnchorSection,
  mergeAnchorFrontmatter,
  replaceAnchorSection,
} from "./anchorPatch.js";
import { parseAnchor } from "./storage/markdown.js";
import { classifyAnchorPath } from "./taxonomy.js";
import type {
  AnchorRead,
  ProposedChangeOperation,
  ProposedChangeRecord,
  ProposedChangeReview,
  ProposedChangeScope,
  ProposedChangeStatus,
} from "./types.js";

export const PROJECT_PROPOSED_CHANGES_TYPE = "project-proposed-changes" as const;
export const AGENT_RULE_PROPOSED_CHANGES_TYPE = "agent-rule-proposed-changes" as const;
export const PROPOSED_CHANGE_FENCE_INFO = "json anchor-mcp-proposed-change";

export function isProposedChangesType(type: unknown): boolean {
  if (type === PROJECT_PROPOSED_CHANGES_TYPE || type === AGENT_RULE_PROPOSED_CHANGES_TYPE) {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some(isProposedChangesType);
  }
  return false;
}

export function proposedChangeLedgerName(scope: ProposedChangeScope): string {
  if (scope.kind === "project") {
    return `projects/${scope.project}/${scope.project}-proposed-changes.md`;
  }
  return "agent-rules/agent-rules-proposed-changes.md";
}

export function normalizeProposalScope(scope: ProposedChangeScope): ProposedChangeScope {
  if (scope.kind === "project") {
    const project = scope.project.trim();
    if (!project) {
      throw new Error("Project proposal scope requires a non-empty project slug.");
    }
    return { kind: "project", project };
  }
  return { kind: "agent-rules" };
}

export function createProposalLedgerContent(scope: ProposedChangeScope, dateKey: string): string {
  if (scope.kind === "project") {
    return `---
project:
  - ${scope.project}
type: ${PROJECT_PROPOSED_CHANGES_TYPE}
tags:
  - proposed-changes
summary: "Reviewable proposed changes for project ${scope.project}."
read_this_if:
  - "You are reviewing pending proposed changes for project ${scope.project}."
last_validated: ${dateKey}
schema_version: 1
proposal_scope:
  kind: project
  project: ${scope.project}
---

# Proposed Changes -- ${scope.project}

## Current State

- This ledger stores proposed changes for project \`${scope.project}\`.
- Proposed records are draft write intent and do not become durable context until applied.

## Decisions

- Review proposed changes through the proposal tools before mutating target anchors.

## Constraints

- Pending proposals must not be treated as current project truth.
- Applying a proposal re-runs the normal target-anchor validators and approval gates.

## Proposed Changes

None.

## PRs

None.
`;
  }

  return `---
type: ${AGENT_RULE_PROPOSED_CHANGES_TYPE}
tags:
  - proposed-changes
summary: "Reviewable proposed changes for agent rules."
read_this_if:
  - "You are reviewing pending proposed changes to agent rules."
last_validated: ${dateKey}
schema_version: 1
proposal_scope:
  kind: agent-rules
---

# Proposed Changes -- Agent Rules

## Current State

- This ledger stores proposed changes for repository-backed agent rules.
- Proposed records are draft write intent and do not become durable context until applied.

## Decisions

- Review proposed changes through the proposal tools before mutating target agent-rule anchors.

## Constraints

- Pending proposals must not be treated as active agent behavior rules.
- Applying a proposal re-runs the normal target-anchor validators and approval gates.

## Proposed Changes

None.

## PRs

None.
`;
}

export function parseProposedChanges(content: string): ProposedChangeRecord[] {
  const parsed = parseAnchor(content);
  const section = parsed.sections.get("Proposed Changes") ?? "";
  const records: ProposedChangeRecord[] = [];
  const fence = /```[^\n`]*anchor-mcp-proposed-change[^\n`]*\n([\s\S]*?)\n```/g;
  for (const match of section.matchAll(fence)) {
    const json = match[1];
    if (!json) {
      continue;
    }
    try {
      const record = JSON.parse(json) as ProposedChangeRecord;
      if (isProposalRecord(record)) {
        records.push(record);
      }
    } catch {
      // Ignore malformed records here; validation reports them during writes.
    }
  }
  return records;
}

export function proposalParseViolations(content: string): string[] {
  const parsed = parseAnchor(content);
  const section = parsed.sections.get("Proposed Changes");
  if (section === undefined) {
    return ["Missing required section: ## Proposed Changes"];
  }

  const violations: string[] = [];
  const fence = /```[^\n`]*anchor-mcp-proposed-change[^\n`]*\n([\s\S]*?)\n```/g;
  const ids = new Set<string>();
  for (const match of section.matchAll(fence)) {
    const json = match[1];
    if (!json) {
      continue;
    }
    try {
      const record = JSON.parse(json) as ProposedChangeRecord;
      if (!isProposalRecord(record)) {
        violations.push("Proposal fence does not contain a valid proposed-change record.");
        continue;
      }
      if (ids.has(record.id)) {
        violations.push(`Duplicate proposed change id: ${record.id}`);
      }
      ids.add(record.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      violations.push(`Invalid proposed change JSON: ${message}`);
    }
  }

  return violations;
}

export function renderProposalSection(records: ProposedChangeRecord[]): string {
  if (records.length === 0) {
    return "None.";
  }

  return records.map(renderProposalRecord).join("\n\n");
}

export function appendProposalRecord(content: string, record: ProposedChangeRecord): string {
  const records = parseProposedChanges(content);
  records.push(record);
  return replaceAnchorSection(content, "Proposed Changes", renderProposalSection(records));
}

export function updateProposalRecord(content: string, record: ProposedChangeRecord): string {
  const records = parseProposedChanges(content);
  const index = records.findIndex((candidate) => candidate.id === record.id);
  if (index < 0) {
    throw new Error(`Proposed change not found: ${record.id}`);
  }
  const next = [...records.slice(0, index), record, ...records.slice(index + 1)];
  return replaceAnchorSection(content, "Proposed Changes", renderProposalSection(next));
}

export function proposalScopeMatchesLedger(scope: ProposedChangeScope, read: AnchorRead): boolean {
  const fmScope = read.frontmatter.proposal_scope as Record<string, unknown> | undefined;
  if (!fmScope || typeof fmScope !== "object" || Array.isArray(fmScope)) {
    return false;
  }
  if (scope.kind === "project") {
    return fmScope.kind === "project" && fmScope.project === scope.project;
  }
  return fmScope.kind === "agent-rules";
}

export function validateProposalTarget(scope: ProposedChangeScope, target: string): string | undefined {
  const classification = classifyAnchorPath(target);
  if (classification.kind !== "anchor") {
    return "Proposed change target must be a taxonomy-valid anchor path.";
  }
  if (isProposedChangesLedgerPath(target)) {
    return "Proposal ledgers cannot target proposal ledger files.";
  }
  if (scope.kind === "project") {
    if (classification.category !== "projects" || classification.projectSlug !== scope.project) {
      return `Project proposals for "${scope.project}" may only target anchors under projects/${scope.project}/.`;
    }
    return undefined;
  }
  if (classification.category !== "agent-rules") {
    return "Agent-rule proposals may only target repository-backed agent-rules/*.md anchors.";
  }
  return undefined;
}

export function validateProposalRecord(record: ProposedChangeRecord, ledgerScope: ProposedChangeScope): string[] {
  const violations: string[] = [];
  if (!record.id.match(/^PC-\d{8}-[A-Za-z0-9_-]{4,32}$/)) {
    violations.push(`Proposed change id must match PC-YYYYMMDD-<slug>: ${record.id}`);
  }
  if (!isProposalScope(record.scope)) {
    violations.push(`Proposed change ${record.id} must include a valid scope.`);
  } else if (record.scope.kind !== ledgerScope.kind) {
    violations.push(`Proposed change ${record.id} scope does not match ledger scope.`);
  } else if (
    record.scope.kind === "project" &&
    ledgerScope.kind === "project" &&
    record.scope.project !== ledgerScope.project
  ) {
    violations.push(`Proposed change ${record.id} project scope does not match ledger project.`);
  }
  const targetViolation = validateProposalTarget(ledgerScope, record.target);
  if (targetViolation) {
    violations.push(`Proposed change ${record.id}: ${targetViolation}`);
  }
  if (!Array.isArray(record.operations) || record.operations.length === 0) {
    violations.push(`Proposed change ${record.id} must include at least one operation.`);
  }
  if (Array.isArray(record.operations)) {
    for (const [index, operation] of record.operations.entries()) {
      violations.push(...validateProposalOperation(record.id, index, operation));
    }
  }
  return violations;
}

export function proposalScopeFromFrontmatter(frontmatter: Record<string, unknown>): ProposedChangeScope | undefined {
  const raw = frontmatter.proposal_scope;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const scope = raw as Record<string, unknown>;
  if (scope.kind === "project" && typeof scope.project === "string" && scope.project.trim()) {
    return { kind: "project", project: scope.project };
  }
  if (scope.kind === "agent-rules") {
    return { kind: "agent-rules" };
  }
  return undefined;
}

export function isProposedChangesLedgerPath(name: string): boolean {
  const clean = name.endsWith(".md") ? name : `${name}.md`;
  return clean === "agent-rules/agent-rules-proposed-changes.md" || /^projects\/[^/]+\/[^/]+-proposed-changes\.md$/.test(clean);
}

function validateProposalOperation(id: string, index: number, operation: ProposedChangeOperation): string[] {
  const prefix = `Proposed change ${id} operation ${index + 1}`;
  if (!operation || typeof operation !== "object") {
    return [`${prefix} must be an object.`];
  }

  switch (operation.type) {
    case "frontmatter.merge":
      return isPlainObject(operation.updates) ? [] : [`${prefix} frontmatter.merge requires object updates.`];
    case "section.replace":
    case "section.append":
      return [
        ...(isNonEmptyString(operation.heading) ? [] : [`${prefix} ${operation.type} requires heading.`]),
        ...(typeof operation.content === "string" ? [] : [`${prefix} ${operation.type} requires string content.`]),
        ...(operation.lastValidated === undefined || /^\d{4}-\d{2}-\d{2}$/.test(operation.lastValidated)
          ? []
          : [`${prefix} ${operation.type} lastValidated must be YYYY-MM-DD.`]),
      ];
    case "section.delete":
      return [
        ...(isNonEmptyString(operation.heading) ? [] : [`${prefix} section.delete requires heading.`]),
        ...(operation.lastValidated === undefined || /^\d{4}-\d{2}-\d{2}$/.test(operation.lastValidated)
          ? []
          : [`${prefix} section.delete lastValidated must be YYYY-MM-DD.`]),
      ];
    case "anchor.create":
    case "document.replace":
      return typeof operation.content === "string" && operation.content.length > 0
        ? []
        : [`${prefix} ${operation.type} requires non-empty content.`];
    default:
      return [`${prefix} has unsupported type: ${(operation as { type?: unknown }).type}`];
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function applyProposalOperations(baseContent: string | undefined, operations: ProposedChangeOperation[]): string {
  let content = baseContent;
  for (const operation of operations) {
    switch (operation.type) {
      case "anchor.create":
        if (content !== undefined) {
          throw new Error("anchor.create can only target a missing anchor.");
        }
        content = operation.content;
        break;
      case "document.replace":
        content = operation.content;
        break;
      case "frontmatter.merge":
        content = requireExistingContent(content, operation.type);
        content = mergeAnchorFrontmatter(content, operation.updates);
        break;
      case "section.replace":
        content = requireExistingContent(content, operation.type);
        content = replaceAnchorSection(content, operation.heading, operation.content);
        if (operation.lastValidated) {
          content = mergeAnchorFrontmatter(content, { last_validated: operation.lastValidated });
        }
        break;
      case "section.append":
        content = requireExistingContent(content, operation.type);
        content = appendToAnchorSection(content, operation.heading, operation.content);
        if (operation.lastValidated) {
          content = mergeAnchorFrontmatter(content, { last_validated: operation.lastValidated });
        }
        break;
      case "section.delete":
        content = requireExistingContent(content, operation.type);
        content = deleteAnchorSection(content, operation.heading);
        if (operation.lastValidated) {
          content = mergeAnchorFrontmatter(content, { last_validated: operation.lastValidated });
        }
        break;
      default:
        assertNever(operation);
    }
  }

  return requireExistingContent(content, "proposal operations");
}

export function renderProposalDiff(targetName: string, before: string | undefined, after: string): string {
  const beforeLines = before?.split(/\r?\n/) ?? [];
  const afterLines = after.split(/\r?\n/);
  if (before === after) {
    return "";
  }
  if (before === undefined) {
    return [
      `--- /dev/null`,
      `+++ b/${targetName}`,
      "@@",
      ...afterLines.map((line) => `+${line}`),
      "",
    ].join("\n");
  }

  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextStart = Math.max(0, prefix - 3);
  const beforeEnd = beforeLines.length - suffix;
  const afterEnd = afterLines.length - suffix;
  const contextSuffixAfter = Math.min(afterLines.length, afterEnd + 3);

  const lines = [`--- a/${targetName}`, `+++ b/${targetName}`, "@@"];
  for (const line of beforeLines.slice(contextStart, prefix)) {
    lines.push(` ${line}`);
  }
  for (const line of beforeLines.slice(prefix, beforeEnd)) {
    lines.push(`-${line}`);
  }
  for (const line of afterLines.slice(prefix, afterEnd)) {
    lines.push(`+${line}`);
  }
  const suffixStart = Math.max(afterEnd, afterLines.length - (contextSuffixAfter - afterEnd));
  for (const line of afterLines.slice(suffixStart, contextSuffixAfter)) {
    lines.push(` ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function addProposalReview(
  record: ProposedChangeRecord,
  input: {
    status: ProposedChangeStatus;
    note?: string;
    reviewedBy?: string;
    reviewedAt: string;
  },
): ProposedChangeRecord {
  const review: ProposedChangeReview = {
    status: input.status,
    reviewedAt: input.reviewedAt,
    ...(input.reviewedBy ? { reviewedBy: input.reviewedBy } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  return {
    ...record,
    status: input.status,
    updatedAt: input.reviewedAt,
    reviews: [...(record.reviews ?? []), review],
  };
}

function renderProposalRecord(record: ProposedChangeRecord): string {
  const heading = `### ${record.id} -- ${record.summary.replace(/\r?\n/g, " ").trim()}`;
  const metadata = [
    `Status: \`${record.status}\``,
    `Target: \`${record.target}\``,
    `Created: \`${record.createdAt}\``,
  ];
  return `${heading}

${metadata.join("; ")}.

\`\`\`${PROPOSED_CHANGE_FENCE_INFO}
${JSON.stringify(record, null, 2)}
\`\`\``;
}

function requireExistingContent(content: string | undefined, operation: string): string {
  if (content === undefined) {
    throw new Error(`${operation} requires the target anchor to exist.`);
  }
  return content;
}

function isProposalRecord(value: unknown): value is ProposedChangeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<ProposedChangeRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.summary === "string" &&
    typeof record.target === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    isProposalStatus(record.status) &&
    isProposalScope(record.scope) &&
    Array.isArray(record.operations)
  );
}

function isProposalScope(value: unknown): value is ProposedChangeScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const scope = value as Partial<ProposedChangeScope>;
  if (scope.kind === "project") {
    return typeof scope.project === "string" && scope.project.trim().length > 0;
  }
  return scope.kind === "agent-rules";
}

function isProposalStatus(value: unknown): value is ProposedChangeStatus {
  return (
    value === "pending" ||
    value === "applied" ||
    value === "rejected" ||
    value === "changes_requested" ||
    value === "superseded"
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported proposal operation: ${JSON.stringify(value)}`);
}
