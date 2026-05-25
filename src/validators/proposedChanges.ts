import {
  isProposedChangesLedgerPath,
  isProposedChangesType,
  parseProposedChanges,
  proposalParseViolations,
  proposalScopeFromFrontmatter,
  validateProposalRecord,
} from "../proposedChanges.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateProposedChanges: Validator = (context) => {
  const parsed = parseAnchor(context.newContent);
  if (!isProposedChangesType(parsed.frontmatter.type)) {
    return [];
  }

  const violations: string[] = [];
  const scope = proposalScopeFromFrontmatter(parsed.frontmatter);
  if (!scope) {
    violations.push("Proposal ledgers require proposal_scope front matter.");
  }

  const classification = classifyAnchorPath(context.name);
  if (!isProposedChangesLedgerPath(context.name)) {
    violations.push("Proposal ledgers must use the dedicated proposed-changes path for their scope.");
  } else if (scope?.kind === "project") {
    if (classification.kind !== "anchor" || classification.category !== "projects") {
      violations.push("Project proposal ledgers must live under projects/<slug>/.");
    } else if (classification.projectSlug !== scope.project) {
      violations.push(`Project proposal ledger path must match proposal_scope.project "${scope.project}".`);
    } else if (context.name !== `projects/${scope.project}/${scope.project}-proposed-changes.md`) {
      violations.push(`Project proposal ledger must be projects/${scope.project}/${scope.project}-proposed-changes.md.`);
    }
  } else if (scope?.kind === "agent-rules" && context.name !== "agent-rules/agent-rules-proposed-changes.md") {
    violations.push("Agent-rule proposal ledger must be agent-rules/agent-rules-proposed-changes.md.");
  }

  violations.push(...proposalParseViolations(context.newContent));
  if (scope) {
    for (const record of parseProposedChanges(context.newContent)) {
      violations.push(...validateProposalRecord(record, scope));
    }
  }

  return violations.map((message) => maybeMigrationBlock(context, "proposed_changes_shape", message));
};
