import { parseAnchor } from "../storage/markdown.js";
import { ALWAYS_REQUIRED_SECTIONS, designHeaderWarnings } from "../anchorStructure.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateSectionShape: Validator = (context) => {
  const sections = parseAnchor(context.newContent).sections;
  const required = ALWAYS_REQUIRED_SECTIONS.filter((section) => !sections.has(section)).map((section) =>
    maybeMigrationBlock(context, "required_section", `Missing required section: ## ${section}`),
  );
  return [...required, ...designHeaderWarnings(context.name, context.newContent)];
};
