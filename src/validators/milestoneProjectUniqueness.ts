import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

function normalizeAnchorName(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

function parseMilestoneIdAndSequence(
  frontmatter: Record<string, unknown>,
): { milestoneId?: string; sequence?: number } {
  const mid = frontmatter.milestone_id;
  const milestoneId = typeof mid === "string" && mid.length > 0 ? mid : undefined;

  const seqRaw = frontmatter.sequence;
  let sequence: number | undefined;
  if (typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw > 0) {
    sequence = seqRaw;
  } else if (typeof seqRaw === "string" && /^\d+$/.test(seqRaw)) {
    const n = parseInt(seqRaw, 10);
    if (Number.isInteger(n) && n > 0) {
      sequence = n;
    }
  }

  return { milestoneId, sequence };
}

export const validateMilestoneProjectUniqueness: Validator = async (context) => {
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }

  const classification = classifyAnchorPath(normalizeAnchorName(context.name));
  if (classification.kind !== "anchor" || classification.category !== "projects") {
    return [];
  }

  if (!context.name.includes("/milestones/")) {
    return [];
  }

  const parsed = parseAnchor(context.newContent);
  if (!isProjectMilestoneType(parsed.frontmatter.type)) {
    return [];
  }

  const slug = classification.projectSlug;
  if (!slug) {
    return [];
  }

  const { milestoneId: myMilestoneId, sequence: mySequence } = parseMilestoneIdAndSequence(parsed.frontmatter);
  if (myMilestoneId === undefined) {
    return [];
  }

  const selfName = normalizeAnchorName(context.repoRelativePath);
  const siblings = await context.repo.listAnchors({ project: slug });

  for (const anchor of siblings) {
    if (!anchor.name.includes("/milestones/")) {
      continue;
    }
    if (normalizeAnchorName(anchor.name) === selfName) {
      continue;
    }

    const raw = await context.repo.readRaw(anchor.name);
    if (!raw) {
      continue;
    }
    const otherParsed = parseAnchor(raw);
    if (!isProjectMilestoneType(otherParsed.frontmatter.type)) {
      continue;
    }

    const { milestoneId: otherMilestoneId, sequence: otherSequence } = parseMilestoneIdAndSequence(
      otherParsed.frontmatter,
    );

    if (otherMilestoneId !== undefined && myMilestoneId === otherMilestoneId) {
      return [
        maybeMigrationBlock(
          context,
          "milestone_duplicate_id",
          `milestone_id "${myMilestoneId}" is already used by "${anchor.name}".`,
        ),
      ];
    }

    if (
      mySequence !== undefined &&
      otherSequence !== undefined &&
      mySequence === otherSequence
    ) {
      return [
        maybeMigrationBlock(
          context,
          "milestone_duplicate_sequence",
          `sequence ${mySequence} is already used by "${anchor.name}".`,
        ),
      ];
    }
  }

  return [];
};
