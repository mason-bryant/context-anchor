import { parseAnchor } from "../storage/markdown.js";
import { parsePolicyWeaken, policyWeakenSetsEqual } from "../roadmap/analyzeRoadmap.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";
import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";

/** Changing `anchor_mcp_policy.weaken` requires explicit human approval. */
export const validatePolicyWeakeningDeclaration: Validator = (context) => {
  if (context.approved) {
    return [];
  }
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  if (classifyAnchorPath(context.name).kind !== "anchor") {
    return [];
  }

  const oldFm = context.oldContent ? parseAnchor(context.oldContent).frontmatter : {};
  const newFm = parseAnchor(context.newContent).frontmatter;
  const oldSet = parsePolicyWeaken(oldFm);
  const newSet = parsePolicyWeaken(newFm);
  if (policyWeakenSetsEqual(oldSet, newSet)) {
    return [];
  }

  return [
    violation(
      "BLOCK",
      "requires_approval",
      "anchor_mcp_policy.weaken changed. Retry with approved: true after the user confirms weakening default enforcement.",
      context.repoRelativePath,
    ),
  ];
};
