import { analyzeRoadmapFromContent, parsePolicyWeaken } from "../roadmap/analyzeRoadmap.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock, violation } from "./types.js";
import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";

function isProjectRoadmapType(type: unknown): boolean {
  if (type === "project-roadmap") {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some((item) => item === "project-roadmap");
  }
  return false;
}

export const validateRoadmapAcceptanceShape: Validator = (context) => {
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  if (classifyAnchorPath(context.name).kind !== "anchor") {
    return [];
  }

  const parsed = parseAnchor(context.newContent);
  if (!isProjectRoadmapType(parsed.frontmatter.type)) {
    return [];
  }

  const weaken = parsePolicyWeaken(parsed.frontmatter);
  const skipEvidence = weaken.has("require_evidence");

  const analysis = analyzeRoadmapFromContent(context.newContent, { isProjectRoadmap: true });
  const violations: string[] = [];

  for (const goal of analysis.goalsMissingCriteria) {
    violations.push(`Goal "${goal}" is missing #### Acceptance Criteria under ## Goals.`);
  }

  for (const msg of analysis.criteriaViolations ?? []) {
    if (skipEvidence && msg.includes("Evidence:")) {
      continue;
    }
    violations.push(msg);
  }

  if (analysis.activeGoals === 0) {
    return [];
  }

  return violations.map((message) =>
    maybeMigrationBlock(context, "roadmap_acceptance_shape", message),
  );
};

/** Warn when a project roadmap opts into weakened enforcement. */
export const validatePolicyWeakeningActiveWarn: Validator = (context) => {
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  if (classifyAnchorPath(context.name).kind !== "anchor") {
    return [];
  }

  const parsed = parseAnchor(context.newContent);
  if (!isProjectRoadmapType(parsed.frontmatter.type)) {
    return [];
  }

  const weaken = parsePolicyWeaken(parsed.frontmatter);
  if (weaken.size === 0) {
    return [];
  }

  return [
    violation(
      "WARN",
      "policy_weaken_active",
      `anchor_mcp_policy.weaken is active (${[...weaken].join(", ")}). Default enforcement is relaxed for this roadmap.`,
      context.repoRelativePath,
    ),
  ];
};
