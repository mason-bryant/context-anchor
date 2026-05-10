import { extractBullets, parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";

const APPROVAL_SECTIONS = ["Decisions", "Constraints"];

export const validateApprovalGate: Validator = (context) => {
  if (context.approved || !context.oldContent) {
    return [];
  }

  const oldParsed = parseAnchor(context.oldContent);
  const newParsed = parseAnchor(context.newContent);
  const sensitiveSectionChanged = APPROVAL_SECTIONS.some(
    (section) => oldParsed.sections.get(section) !== newParsed.sections.get(section),
  );
  const oldBullets = extractBullets(oldParsed.body);
  const newBullets = extractBullets(newParsed.body);
  const removedContent = [...oldBullets].some((bullet) => !newBullets.has(bullet));

  if (!sensitiveSectionChanged && !removedContent) {
    return [];
  }

  return [
    violation(
      "BLOCK",
      "requires_approval",
      "This write changes Decisions or Constraints, or removes existing bullets. Retry with approved: true after user approval.",
      context.repoRelativePath,
    ),
  ];
};

