import { parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

const SUBSTANTIVE_SECTIONS = ["Current State", "Decisions", "Constraints"];

export const validateLastValidatedBump: Validator = (context) => {
  if (!context.oldContent) {
    return [];
  }

  const oldParsed = parseAnchor(context.oldContent);
  const newParsed = parseAnchor(context.newContent);
  const substantiveChanged = SUBSTANTIVE_SECTIONS.some(
    (section) => oldParsed.sections.get(section) !== newParsed.sections.get(section),
  );

  if (!substantiveChanged) {
    return [];
  }

  if (dateKey(oldParsed.frontmatter.last_validated) !== dateKey(newParsed.frontmatter.last_validated)) {
    return [];
  }

  return [
    maybeMigrationBlock(
      context,
      "last_validated_bump",
      "Substantive section changes require a last_validated date bump.",
    ),
  ];
};

function dateKey(value: unknown): unknown {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
