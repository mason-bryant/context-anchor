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
  const content = stripClaimAnnotations(sectionBody)
    .split(/\r?\n/)
    .filter((line) => !/^###\s+/.test(line))
    .join("\n")
    .trim();
  return content || undefined;
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
