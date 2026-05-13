import type {
  AnchorMeta,
  PlanContextBundleInput,
  PlanContextBundleItem,
  PlanContextBundleResult,
} from "./types.js";
import { discoveryCategoryIndex } from "./taxonomy.js";

const DEFAULT_BUDGET_TOKENS = 4000;
const DEFAULT_MAX_ANCHORS = 12;
const DEFAULT_MAX_EXCLUDED = 20;
const MIN_RELEVANCE_SCORE = 4;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "need",
  "of",
  "on",
  "or",
  "our",
  "please",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

type ScoredAnchor = PlanContextBundleItem & {
  projectMatches: boolean;
  exclusionReason?: string;
};

export function buildContextBundlePlan(
  anchors: AnchorMeta[],
  input: PlanContextBundleInput,
  generatedAt = new Date().toISOString(),
): PlanContextBundleResult {
  const budgetTokens = Math.max(1, Math.floor(input.budgetTokens ?? DEFAULT_BUDGET_TOKENS));
  const maxAnchors = Math.max(1, Math.floor(input.maxAnchors ?? DEFAULT_MAX_ANCHORS));
  const maxExcluded = Math.max(0, Math.floor(input.maxExcluded ?? DEFAULT_MAX_EXCLUDED));
  const taskTerms = tokenize(input.task);
  const activeGoalIdsBySlug = buildActiveMilestoneGoalSetBySlug(anchors);

  const scored = anchors
    .map((anchor) => scoreAnchor(anchor, input, taskTerms, activeGoalIdsBySlug))
    .sort((left, right) => compareScoredAnchors(left, right, taskTerms, activeGoalIdsBySlug));

  const included: ScoredAnchor[] = [];
  const excluded: ScoredAnchor[] = [];
  let estimatedTokens = 0;

  for (const anchor of scored) {
    if (anchor.score < MIN_RELEVANCE_SCORE) {
      excluded.push({ ...anchor, exclusionReason: "below relevance threshold" });
      continue;
    }

    if (included.length >= maxAnchors) {
      excluded.push({ ...anchor, exclusionReason: "max anchor count reached" });
      continue;
    }

    if (estimatedTokens + anchor.estimatedTokens > budgetTokens) {
      excluded.push({ ...anchor, exclusionReason: "outside token budget" });
      continue;
    }

    included.push(anchor);
    estimatedTokens += anchor.estimatedTokens;
  }

  return {
    generatedAt,
    task: input.task,
    budgetTokens,
    estimatedTokens,
    totalCandidates: anchors.length,
    included: included.map(stripPlannerFields),
    excluded: excluded.slice(0, maxExcluded).map((anchor) =>
      stripPlannerFields({
        ...anchor,
        reason: `${anchor.reason}; excluded because ${anchor.exclusionReason ?? "it was not selected"}`,
      }),
    ),
    missingContext: buildMissingContextSignals({
      input,
      anchors,
      included,
      excluded,
      taskTerms,
    }),
    loadContext: {
      names: included.map((anchor) => anchor.name),
      includeContent: "excerpt",
      maxBytes: budgetTokens * 4,
    },
  };
}

function buildActiveMilestoneGoalSetBySlug(anchors: AnchorMeta[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const anchor of anchors) {
    if (anchor.projectSlug !== undefined && anchor.milestone?.status === "active") {
      if (!map.has(anchor.projectSlug)) {
        map.set(anchor.projectSlug, new Set());
      }
      for (const gid of anchor.milestone.goalIds) {
        map.get(anchor.projectSlug)!.add(gid.toLowerCase());
      }
    }
  }
  return map;
}

function scoreAnchor(
  anchor: AnchorMeta,
  input: PlanContextBundleInput,
  taskTerms: string[],
  activeGoalIdsBySlug: Map<string, Set<string>>,
): ScoredAnchor {
  let score = 0;
  const matchedTerms = new Set<string>();
  const reasons: string[] = [];
  const projectMatches = Boolean(input.project && anchorProjectIncludes(anchor, input.project));

  if (projectMatches) {
    score += 16;
    reasons.push(`project matches "${input.project}"`);
  } else if (input.project && anchor.category === "projects") {
    score -= 12;
    reasons.push(`different project than "${input.project}"`);
  }

  if (input.category && anchor.category === input.category) {
    score += 6;
    reasons.push(`category matches "${input.category}"`);
  }

  if (input.tag && frontmatterValueIncludes(anchor.tags, input.tag)) {
    score += 6;
    reasons.push(`tag matches "${input.tag}"`);
  }

  const weightedFields = [
    { label: "name", text: anchor.name, weight: 6 },
    { label: "title", text: anchor.title ?? "", weight: 6 },
    { label: "summary", text: anchor.summary, weight: 5 },
    { label: "read_this_if", text: anchor.read_this_if.join(" "), weight: 5 },
    { label: "tags", text: stringifyValue(anchor.tags), weight: 4 },
    { label: "project", text: stringifyValue(anchor.project), weight: 4 },
    { label: "type", text: stringifyValue(anchor.type), weight: 3 },
    { label: "category", text: anchor.category, weight: 2 },
  ];

  const fieldMatches = new Map<string, string[]>();

  for (const term of taskTerms) {
    for (const field of weightedFields) {
      if (containsTerm(field.text, term)) {
        score += field.weight;
        matchedTerms.add(term);
        const current = fieldMatches.get(field.label) ?? [];
        current.push(term);
        fieldMatches.set(field.label, current);
      }
    }
  }

  for (const [field, terms] of fieldMatches) {
    reasons.push(`${field} matched ${dedupe(terms).slice(0, 5).join(", ")}`);
  }

  if (anchor.category === "conflicts" && taskTerms.some((term) => ["conflict", "contradiction", "disagree"].includes(term))) {
    score += 8;
    reasons.push("conflict anchor matches task intent");
  }

  if (anchor.category === "invariants" && taskTerms.some((term) => ["invariant", "constraint", "rule"].includes(term))) {
    score += 8;
    reasons.push("invariant anchor matches task intent");
  }

  if (anchor.milestone) {
    const m = anchor.milestone;
    const themeTerms = tokenize(m.theme);
    for (const term of taskTerms) {
      if (anchor.name.toLowerCase().includes(term)) {
        score += 10;
        reasons.push("task term matched milestone anchor path");
        break;
      }
    }
    for (const term of taskTerms) {
      if (themeTerms.includes(term)) {
        score += 9;
        reasons.push(`milestone theme matched task term "${term}"`);
        break;
      }
    }
    if (taskTerms.some((t) => m.goalIds.some((g) => g.toLowerCase() === t))) {
      score += 14;
      reasons.push("task matched a milestone goal id");
    }
  }

  if (
    anchor.projectSlug &&
    anchor.name === `projects/${anchor.projectSlug}/${anchor.projectSlug}-roadmap.md`
  ) {
    const gset = activeGoalIdsBySlug.get(anchor.projectSlug);
    if (gset && taskTerms.some((t) => gset.has(t))) {
      score += 12;
      reasons.push("task matched goal id linked from an active milestone");
    }
  }

  return {
    name: anchor.name,
    path: anchor.path,
    category: anchor.category,
    title: anchor.title,
    projectSlug: anchor.projectSlug,
    summary: anchor.summary,
    score,
    estimatedTokens: estimateAnchorTokens(anchor),
    matchedTerms: [...matchedTerms].sort(),
    reason: reasons.length > 0 ? reasons.join("; ") : "no strong metadata match",
    projectMatches,
  };
}

function buildMissingContextSignals(params: {
  input: PlanContextBundleInput;
  anchors: AnchorMeta[];
  included: ScoredAnchor[];
  excluded: ScoredAnchor[];
  taskTerms: string[];
}): string[] {
  const signals: string[] = [];
  const { input, anchors, included, excluded, taskTerms } = params;

  if (included.length === 0) {
    signals.push("No anchors fit the task and budget. Increase budgetTokens, raise maxAnchors, or loosen filters.");
  }

  const project = input.project;
  if (project && !anchors.some((anchor) => anchorProjectIncludes(anchor, project))) {
    signals.push(`No candidate anchor declares project "${project}".`);
  }

  if (included.length > 0 && included.every((anchor) => anchor.matchedTerms.length === 0)) {
    signals.push("Included anchors matched filters, but none matched task terms directly.");
  }

  if (excluded.some((anchor) => anchor.exclusionReason === "outside token budget" && anchor.score >= MIN_RELEVANCE_SCORE)) {
    signals.push("Some relevant anchors were excluded by the token budget.");
  }

  if (taskTerms.some((term) => ["conflict", "contradiction", "disagree"].includes(term)) && !included.some((anchor) => anchor.category === "conflicts")) {
    signals.push("The task mentions conflict or contradiction, but no conflict anchor was included.");
  }

  return signals;
}

/** Extra missing-context lines when project roadmaps lack per-goal acceptance criteria. */
export function collectRoadmapAcceptanceMissingSignals(anchors: AnchorMeta[]): string[] {
  const out: string[] = [];
  for (const anchor of anchors) {
    const ac = anchor.acceptanceCriteria;
    if (!ac || ac.goalsMissingCriteria.length === 0) {
      continue;
    }
    out.push(
      `Roadmap "${anchor.name}" has goal(s) without #### Acceptance Criteria under ## Goals: ${ac.goalsMissingCriteria.join("; ")}.`,
    );
  }
  return out;
}

/** Missing-context lines when milestones reference roadmap goals without acceptance criteria. */
export function collectMilestoneAcceptanceMissingSignals(anchors: AnchorMeta[]): string[] {
  const out: string[] = [];
  for (const anchor of anchors) {
    if (!anchor.milestone?.goalIds.length || !anchor.projectSlug) {
      continue;
    }
    const roadmap = anchors.find(
      (a) => a.name === `projects/${anchor.projectSlug}/${anchor.projectSlug}-roadmap.md`,
    );
    const missingIds = roadmap?.acceptanceCriteria?.goalsMissingCriteriaIds ?? [];
    const hit = anchor.milestone.goalIds.filter((gid) => missingIds.includes(gid));
    if (hit.length > 0) {
      out.push(`Milestone "${anchor.name}" has goal(s) without acceptance criteria: ${hit.join(", ")}.`);
    }
  }
  return out;
}

function estimateAnchorTokens(anchor: AnchorMeta): number {
  const metadataText = [
    anchor.name,
    anchor.title,
    anchor.summary,
    anchor.read_this_if.join(" "),
    stringifyValue(anchor.tags),
    stringifyValue(anchor.project),
    stringifyValue(anchor.type),
  ].join(" ");

  return Math.max(120, Math.ceil(metadataText.length / 4) + 220);
}

function activeCanonicalRoadmapBoost(
  anchor: ScoredAnchor,
  taskTerms: string[],
  activeGoalIdsBySlug: Map<string, Set<string>>,
): number {
  if (
    !anchor.projectSlug ||
    anchor.name !== `projects/${anchor.projectSlug}/${anchor.projectSlug}-roadmap.md`
  ) {
    return 0;
  }
  const gset = activeGoalIdsBySlug.get(anchor.projectSlug);
  if (!gset) {
    return 0;
  }
  return taskTerms.some((t) => gset.has(t)) ? 1 : 0;
}

function compareScoredAnchors(
  left: ScoredAnchor,
  right: ScoredAnchor,
  taskTerms: string[],
  activeGoalIdsBySlug: Map<string, Set<string>>,
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.projectMatches !== right.projectMatches) {
    return left.projectMatches ? -1 : 1;
  }

  const leftRoadmapBoost = activeCanonicalRoadmapBoost(left, taskTerms, activeGoalIdsBySlug);
  const rightRoadmapBoost = activeCanonicalRoadmapBoost(right, taskTerms, activeGoalIdsBySlug);
  if (leftRoadmapBoost !== rightRoadmapBoost) {
    return rightRoadmapBoost - leftRoadmapBoost;
  }

  const categoryDelta = discoveryCategoryIndex(left.category) - discoveryCategoryIndex(right.category);
  if (categoryDelta !== 0) {
    return categoryDelta;
  }

  return left.name.localeCompare(right.name);
}

function stripPlannerFields(anchor: ScoredAnchor): PlanContextBundleItem {
  return {
    name: anchor.name,
    path: anchor.path,
    category: anchor.category,
    title: anchor.title,
    projectSlug: anchor.projectSlug,
    summary: anchor.summary,
    score: anchor.score,
    estimatedTokens: anchor.estimatedTokens,
    matchedTerms: anchor.matchedTerms,
    reason: anchor.reason,
  };
}

function anchorProjectIncludes(anchor: AnchorMeta, project: string): boolean {
  return anchor.projectSlug === project || frontmatterValueIncludes(anchor.project, project);
}

function frontmatterValueIncludes(value: unknown, needle: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => String(item).toLowerCase() === needle.toLowerCase());
  }

  return String(value ?? "").toLowerCase() === needle.toLowerCase();
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join(" ");
  }

  return typeof value === "string" ? value : "";
}

function containsTerm(text: string, term: string): boolean {
  return tokenize(text).includes(term);
}

function tokenize(text: string): string[] {
  return dedupe(
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 1)
      .filter((term) => !STOPWORDS.has(term)),
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
