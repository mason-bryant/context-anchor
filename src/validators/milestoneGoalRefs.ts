import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { listRoadmapGoalDetails } from "../roadmap/analyzeRoadmap.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock, violation } from "./types.js";

function expectedRoadmapName(projectSlug: string): string {
  return `projects/${projectSlug}/${projectSlug}-roadmap.md`;
}

export const validateMilestoneGoalRefs: Validator = async (context) => {
  if (isBuiltInAnchorName(context.name)) {
    return [];
  }

  const classification = classifyAnchorPath(context.name);
  if (classification.kind !== "anchor") {
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

  const rel = parsed.frontmatter.relations as { goal_ids?: unknown } | undefined;
  const goalIds = Array.isArray(rel?.goal_ids) ? rel!.goal_ids.filter((x): x is string => typeof x === "string") : [];

  const roadmapName = expectedRoadmapName(slug);
  const roadmapContent = await context.repo.readRaw(roadmapName);
  if (!roadmapContent) {
    return [
      maybeMigrationBlock(
        context,
        "milestone_roadmap_missing",
        `Sibling roadmap "${roadmapName}" not found for milestone goal references.`,
      ),
    ];
  }

  const details = listRoadmapGoalDetails(roadmapContent);
  const duplicateIds = findDuplicateGoalIds(details);
  if (duplicateIds.length > 0) {
    return duplicateIds.map((id) =>
      maybeMigrationBlock(
        context,
        "roadmap_goal_duplicate_id",
        `Sibling roadmap "${roadmapName}" contains duplicate goal id "${id}".`,
      ),
    );
  }

  const byId = new Map(details.filter((g) => g.id).map((g) => [g.id as string, g]));

  const violations = [];
  for (const gid of goalIds) {
    const row = byId.get(gid);
    if (!row) {
      violations.push(
        maybeMigrationBlock(
          context,
          "milestone_goal_unknown",
          `relations.goal_ids references unknown roadmap goal "${gid}" in ${roadmapName}.`,
        ),
      );
      continue;
    }
    if (!row.hasAcceptanceCriteria) {
      violations.push(
        violation(
          "WARN",
          "milestone_goal_missing_ac",
          `Roadmap goal "${gid}" (${row.title}) is referenced by this milestone but has no #### Acceptance Criteria block.`,
          context.repoRelativePath,
        ),
      );
    }
  }

  return violations;
};

function findDuplicateGoalIds(details: Array<{ id?: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const detail of details) {
    if (!detail.id) {
      continue;
    }
    if (seen.has(detail.id)) {
      duplicates.add(detail.id);
    } else {
      seen.add(detail.id);
    }
  }
  return [...duplicates].sort();
}
