import path from "node:path";

import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateAgentsSibling: Validator = async (context) => {
  if (path.basename(context.repoRelativePath) !== "CLAUDE.md") {
    return [];
  }

  const siblingPath = path.posix.join(path.posix.dirname(context.name), "AGENTS.md");
  const content = await context.repo.readRaw(siblingPath);
  if (content?.trim() === "@CLAUDE.md") {
    return [];
  }

  return [
    maybeMigrationBlock(
      context,
      "agents_sibling",
      "Creating or updating CLAUDE.md requires a sibling AGENTS.md containing @CLAUDE.md.",
    ),
  ];
};

