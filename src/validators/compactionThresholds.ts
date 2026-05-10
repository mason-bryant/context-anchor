import path from "node:path";

import { countCompletedRows, parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";

export const validateCompactionThresholds: Validator = (context) => {
  const warnings = [];
  const lineCount = context.newContent.split(/\r?\n/).length;
  const basename = path.basename(context.repoRelativePath).toLowerCase();
  const isRoadmap = basename.includes("roadmap");

  if (isRoadmap && lineCount > 400) {
    warnings.push(
      violation(
        "WARN",
        "roadmap_line_count",
        `Roadmap has ${lineCount} lines; consider compacting when it exceeds 400.`,
        context.repoRelativePath,
      ),
    );
  }

  const completedRows = countCompletedRows(parseAnchor(context.newContent).body);
  if (completedRows > 10) {
    warnings.push(
      violation(
        "WARN",
        "completed_row_count",
        `## Completed has ${completedRows} rows; consider compacting when it exceeds 10.`,
        context.repoRelativePath,
      ),
    );
  }

  return warnings;
};

