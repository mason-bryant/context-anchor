import { stripClaimAnnotations } from "../claims.js";
import { SUBSTANTIVE_SECTIONS } from "../anchorStructure.js";
import { parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateLastValidatedBump: Validator = (context) => {
  if (!context.oldContent) {
    return [];
  }

  const oldParsed = parseAnchor(context.oldContent);
  const newParsed = parseAnchor(context.newContent);
  const substantiveChanged = SUBSTANTIVE_SECTIONS.some(
    (section) =>
      sectionForSubstantiveComparison(oldParsed.sections.get(section)) !==
      sectionForSubstantiveComparison(newParsed.sections.get(section)),
  );

  if (!substantiveChanged) {
    return [];
  }

  const oldDate = dateKey(oldParsed.frontmatter.last_validated);
  const newDate = dateKey(newParsed.frontmatter.last_validated);
  if (oldDate !== newDate || newDate === currentLocalDateKey()) {
    return [];
  }

  return [
    maybeMigrationBlock(
      context,
      "last_validated_bump",
      "Substantive section changes require last_validated to change or already match today's date.",
    ),
  ];
};

function sectionForSubstantiveComparison(sectionBody: string | undefined): string | undefined {
  if (sectionBody === undefined) return undefined;
  const content = stripH3HeadingsOutsideFences(stripClaimAnnotations(sectionBody)).trim();
  return content || undefined;
}

function stripH3HeadingsOutsideFences(markdown: string): string {
  let fence: { char: string; length: number } | undefined;
  return markdown
    .split(/\r?\n/)
    .filter((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fenceMatch?.[1]) {
        const marker = fenceMatch[1];
        const char = marker[0] ?? "`";
        if (!fence) {
          fence = { char, length: marker.length };
        } else if (fence.char === char && marker.length >= fence.length && (fenceMatch[2] ?? "").trim() === "") {
          fence = undefined;
        }
        return true;
      }
      return Boolean(fence) || !/^ {0,3}###\s+/.test(line);
    })
    .join("\n");
}

function dateKey(value: unknown): unknown {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function currentLocalDateKey(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
