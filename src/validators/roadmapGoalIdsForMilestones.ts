import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import type { AnchorRepository } from "../git/repo.js";
import { analyzeRoadmapFromContent } from "../roadmap/analyzeRoadmap.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

function isProjectRoadmapType(type: unknown): boolean {
  if (type === "project-roadmap") {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some((item) => item === "project-roadmap");
  }
  return false;
}

function expectedRoadmapName(projectSlug: string): string {
  return `projects/${projectSlug}/${projectSlug}-roadmap.md`;
}

async function projectHasMilestoneWithGoalIds(repo: AnchorRepository, slug: string): Promise<boolean> {
  const metas = await repo.listAnchors();
  for (const meta of metas) {
    if (!meta.name.startsWith(`projects/${slug}/milestones/`)) {
      continue;
    }
    const raw = await repo.readRaw(meta.name);
    if (!raw) {
      continue;
    }
    const fm = parseAnchor(raw).frontmatter;
    if (!isProjectMilestoneType(fm.type)) {
      continue;
    }
    const rel = fm.relations as { goal_ids?: unknown } | undefined;
    if (!rel || !Array.isArray(rel.goal_ids)) {
      continue;
    }
    if (rel.goal_ids.some((x) => typeof x === "string" && x.length > 0)) {
      return true;
    }
  }
  return false;
}

export const validateRoadmapGoalIdsForMilestones: Validator = async (context) => {
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }
  const classification = classifyAnchorPath(context.name);
  if (classification.kind !== "anchor" || classification.category !== "projects") {
    return [];
  }

  const slug = classification.projectSlug;
  if (!slug) {
    return [];
  }

  if (context.name !== expectedRoadmapName(slug)) {
    return [];
  }

  const parsed = parseAnchor(context.newContent);
  if (!isProjectRoadmapType(parsed.frontmatter.type)) {
    return [];
  }

  const hasMilestoneGoals = await projectHasMilestoneWithGoalIds(context.repo, slug);
  if (!hasMilestoneGoals) {
    return [];
  }

  const analysis = analyzeRoadmapFromContent(context.newContent, { isProjectRoadmap: true });
  const duplicateIds = analysis.goalsDuplicateStableIds ?? [];
  const missing = analysis.goalsWithoutStableIds ?? [];
  if (duplicateIds.length > 0) {
    return duplicateIds.map((id) =>
      maybeMigrationBlock(
        context,
        "roadmap_goal_duplicate_id",
        `Roadmap goal id "${id}" is used by more than one heading.`,
      ),
    );
  }

  if (missing.length === 0) {
    return [];
  }

  return missing.map((title) =>
    maybeMigrationBlock(
      context,
      "roadmap_goal_stable_id_required",
      `Roadmap goal "${title}" must use heading form "### Goal G-<digits> -- Name" because a project milestone lists goal_ids.`,
    ),
  );
};
