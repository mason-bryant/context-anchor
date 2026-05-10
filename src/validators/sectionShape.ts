import { parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

const REQUIRED_SECTIONS = ["Current State", "Decisions", "Constraints", "PRs"];

export const validateSectionShape: Validator = (context) => {
  const sections = parseAnchor(context.newContent).sections;
  return REQUIRED_SECTIONS.filter((section) => !sections.has(section)).map((section) =>
    maybeMigrationBlock(context, "required_section", `Missing required section: ## ${section}`),
  );
};

