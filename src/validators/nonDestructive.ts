import { extractBullets, parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { violation } from "./types.js";

export const validateNonDestructive: Validator = (context) => {
  if (!context.oldContent) {
    return [];
  }

  const oldBullets = extractBullets(parseAnchor(context.oldContent).body);
  const newParsed = parseAnchor(context.newContent);
  const newBullets = extractBullets(newParsed.body);
  const history = newParsed.sections.get("History")?.toLowerCase() ?? "";
  const newBody = newParsed.body.toLowerCase();

  const removed = [...oldBullets].filter((bullet) => {
    if (newBullets.has(bullet)) {
      return false;
    }

    return !history.includes(bullet) && !newBody.includes(`${bullet} _superseded by_`);
  });

  if (removed.length === 0) {
    return [];
  }

  const examples = removed.slice(0, 5).map((bullet) => `- ${bullet}`).join("\n");
  return [
    violation(
      "WARN",
      "non_destructive_update",
      `Removed bullets should be relocated to ## History or marked superseded. Examples:\n${examples}`,
      context.repoRelativePath,
    ),
  ];
};

