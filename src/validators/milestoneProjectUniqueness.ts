import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import type { AnchorRepository } from "../git/repo.js";
import { normalizedMilestoneId, normalizedSequenceFromFm } from "../milestoneFrontmatter.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { AnchorMeta } from "../types.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

function normalizeAnchorName(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

/**
 * Prefer `listAnchors` milestone metadata; only read/parse disk when meta has no
 * `milestone` block (e.g. incomplete front matter) but the file is still a milestone path.
 */
async function siblingMilestoneIdAndSequence(
  anchor: AnchorMeta,
  repo: AnchorRepository,
): Promise<{ milestoneId?: string; sequence?: number }> {
  if (anchor.milestone) {
    return {
      milestoneId: anchor.milestone.milestoneId,
      sequence: anchor.milestone.sequence,
    };
  }

  if (!isProjectMilestoneType(anchor.type) || !anchor.name.includes("/milestones/")) {
    return {};
  }

  const raw = await repo.readRaw(anchor.name);
  if (!raw) {
    return {};
  }
  const otherParsed = parseAnchor(raw);
  if (!isProjectMilestoneType(otherParsed.frontmatter.type)) {
    return {};
  }
  const fm = otherParsed.frontmatter;
  return {
    milestoneId: normalizedMilestoneId(fm.milestone_id),
    sequence: normalizedSequenceFromFm(fm),
  };
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

  const myMilestoneId = normalizedMilestoneId(parsed.frontmatter.milestone_id);
  const mySequence = normalizedSequenceFromFm(parsed.frontmatter);
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

    const { milestoneId: otherMilestoneId, sequence: otherSequence } = await siblingMilestoneIdAndSequence(
      anchor,
      context.repo,
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
