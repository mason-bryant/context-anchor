import type {
  AnchorMeta,
  PlanContextBundleInput,
  PlanContextBundleItem,
  PlanContextBundleResult,
} from "./types.js";
import { ANCHOR_CATEGORIES } from "./taxonomy.js";

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

  const scored = anchors
    .map((anchor) => scoreAnchor(anchor, input, taskTerms))
    .sort(compareScoredAnchors);

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

function scoreAnchor(anchor: AnchorMeta, input: PlanContextBundleInput, taskTerms: string[]): ScoredAnchor {
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

function compareScoredAnchors(left: ScoredAnchor, right: ScoredAnchor): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.projectMatches !== right.projectMatches) {
    return left.projectMatches ? -1 : 1;
  }

  const categoryDelta = ANCHOR_CATEGORIES.indexOf(left.category) - ANCHOR_CATEGORIES.indexOf(right.category);
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
