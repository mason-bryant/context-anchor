import { extractAcceptanceCriteriaSpansNormalized } from "../roadmap/analyzeRoadmap.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";
import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";

export const validateAcceptanceCriteriaWriteGate: Validator = (context) => {
  if (context.approved) {
    return [];
  }
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  if (classifyAnchorPath(context.name).kind !== "anchor") {
    return [];
  }

  const oldNorm = context.oldContent ? extractAcceptanceCriteriaSpansNormalized(context.oldContent) : "";
  const newNorm = extractAcceptanceCriteriaSpansNormalized(context.newContent);
  if (oldNorm === newNorm) {
    return [];
  }

  return [
    violation(
      "BLOCK",
      "requires_approval",
      "Acceptance criteria changed. Retry with approved: true after the user explicitly confirms this update.",
      context.repoRelativePath,
    ),
  ];
};
