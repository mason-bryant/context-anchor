import { parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";

export const validatePriorityApproval: Validator = (context) => {
  if (context.approved || !context.oldContent) {
    return [];
  }

  const oldPriority = parseAnchor(context.oldContent).frontmatter.priority;
  const newPriority = parseAnchor(context.newContent).frontmatter.priority;
  if (priorityKey(oldPriority) === priorityKey(newPriority)) {
    return [];
  }

  return [
    violation(
      "BLOCK",
      "requires_approval",
      "Project priority changes require an explicit approved human request. Retry with approved: true after user approval.",
      context.repoRelativePath,
    ),
  ];
};

function priorityKey(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : JSON.stringify(value);
}
