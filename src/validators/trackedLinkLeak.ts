import { maybeMigrationBlock } from "./types.js";
import type { Validator } from "./types.js";

const DISALLOWED_PATH_PATTERNS = [
  /(^|[(/'"`\s])\.agents\//i,
  /(^|[(/'"`\s])cursor-output\//i,
  /\/Users\/[^/\s]+\/(cursor-output|\.agents)\//i,
];

const DISALLOWED_LINK_PATTERNS = [/(^|\/)\.agents\//i, /(^|\/)cursor-output\//i];

export const validateTrackedLinkLeak: Validator = (context) => {
  const findings = new Set<string>();

  for (const pattern of DISALLOWED_PATH_PATTERNS) {
    const matches = context.newContent.match(new RegExp(pattern.source, "gi"));
    if (matches) {
      for (const match of matches) {
        findings.add(match.trim());
      }
    }
  }

  const markdownLinks = context.newContent.matchAll(/\[[^\]]+]\(([^)]+)\)/g);
  for (const link of markdownLinks) {
    const href = link[1] ?? "";
    if (DISALLOWED_LINK_PATTERNS.some((pattern) => pattern.test(href))) {
      findings.add(href);
    }
  }

  if (findings.size === 0) {
    return [];
  }

  const examples = [...findings].slice(0, 5).map((value) => `- ${value}`).join("\n");
  return [
    maybeMigrationBlock(
      context,
      "tracked_link_leak",
      `Found local/private path references (for example .agents/ or cursor-output/) that should not be shared:\n${examples}`,
    ),
  ];
};

