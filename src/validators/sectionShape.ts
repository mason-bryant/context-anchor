import {
  ALWAYS_REQUIRED_SECTIONS,
  analyzeAnchorStructure,
  anchorStructureWarningsFromAnalysis,
} from "../anchorStructure.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateSectionShape: Validator = (context) => {
  const analysis = analyzeAnchorStructure(context.name, context.newContent);
  const sections = analysis.parsed.sections;
  const required = ALWAYS_REQUIRED_SECTIONS.filter((section) => !sections.has(section)).map((section) =>
    maybeMigrationBlock(context, "required_section", `Missing required section: ## ${section}`),
  );
  return [
    ...required,
    ...anchorStructureWarningsFromAnalysis(context.name, analysis),
  ];
};
