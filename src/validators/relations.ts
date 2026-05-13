import { parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateRelationsShape: Validator = (context) => {
  const parsed = parseAnchor(context.newContent);
  const rel = parsed.frontmatter.relations;
  if (rel === undefined || rel === null) {
    return [];
  }

  if (typeof rel !== "object" || Array.isArray(rel)) {
    return [maybeMigrationBlock(context, "relations_shape", "relations must be a mapping object in front matter.")];
  }

  const violations = [];
  for (const [key, value] of Object.entries(rel as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      violations.push(
        maybeMigrationBlock(
          context,
          "relations_shape",
          `relations.${key} must be an array of strings.`,
        ),
      );
      continue;
    }

    for (const item of value) {
      if (typeof item !== "string" || item.length === 0) {
        violations.push(
          maybeMigrationBlock(
            context,
            "relations_shape",
            `relations.${key} contains a non-string or empty entry.`,
          ),
        );
      }
    }
  }

  return violations;
};
