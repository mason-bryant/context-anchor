import { extractMarkdownLinks, parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

const PR_LINK_TEXT = /^PR .+ - #\d+$/;

export const validatePrFormat: Validator = (context) => {
  const prs = parseAnchor(context.newContent).sections.get("PRs");
  if (!prs) {
    return [];
  }

  return extractMarkdownLinks(prs)
    .filter((link) => !PR_LINK_TEXT.test(link.text))
    .map((link) =>
      maybeMigrationBlock(
        context,
        "pr_link_format",
        `PR link text must match "PR <title> - #<number>": ${link.text}`,
      ),
    );
};

