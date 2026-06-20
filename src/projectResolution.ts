import { anchorMatchesProject } from "./projectAliases.js";
import type {
  AnchorMeta,
  ProjectResolution,
  ProjectResolutionCandidate,
  ProjectResolutionConfig,
} from "./types.js";

/** Default boost applied to projects mapped from a repository name. */
export const DEFAULT_REPO_BOOST = 10;
/** Default boost applied to projects matched by a file-path prefix. */
export const DEFAULT_PATH_PREFIX_BOOST = 8;

export type ProjectResolutionInput = {
  repo?: string;
  filePaths?: string[];
};

/**
 * Resolve a repository name and/or touched file paths to ranked candidate
 * projects using operator-supplied config. Returns `undefined` when there is no
 * repo or path signal to act on. An unrecognized repo degrades gracefully:
 * candidates from matching path prefixes are still returned, and the unknown
 * repo is surfaced for explanation rather than producing an empty result.
 */
export function resolveCandidateProjects(
  input: ProjectResolutionInput,
  config: ProjectResolutionConfig | undefined,
): ProjectResolution | undefined {
  const repo = input.repo?.trim();
  const filePaths = (input.filePaths ?? [])
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);

  if (!repo && filePaths.length === 0) {
    return undefined;
  }

  const candidates = new Map<string, ProjectResolutionCandidate>();
  let unknownRepo: string | undefined;

  const add = (project: string, boost: number, reason: string): void => {
    const slug = project.trim();
    if (!slug) {
      return;
    }
    const key = slug.toLowerCase();
    const existing = candidates.get(key);
    if (existing) {
      existing.boost += boost;
      existing.reasons.push(reason);
    } else {
      candidates.set(key, { project: slug, boost, reasons: [reason] });
    }
  };

  if (repo) {
    const mapped = lookupRepo(repo, config?.repoMap);
    if (mapped && mapped.length > 0) {
      for (const project of mapped) {
        add(project, DEFAULT_REPO_BOOST, `repo "${repo}" maps to project "${project}"`);
      }
    } else {
      unknownRepo = repo;
    }
  }

  const rules = config?.pathPrefixes ?? [];
  for (const filePath of filePaths) {
    const normalizedPath = normalizePath(filePath);
    if (!normalizedPath) {
      continue;
    }
    for (const rule of rules) {
      const prefix = normalizePath(rule.prefix);
      if (prefix.length > 0 && normalizedPath.startsWith(prefix)) {
        const boost = normalizeBoost(rule.boost, DEFAULT_PATH_PREFIX_BOOST);
        add(
          rule.project,
          boost,
          `path "${filePath}" matches prefix "${rule.prefix}" for project "${rule.project}"`,
        );
      }
    }
  }

  if (candidates.size === 0 && unknownRepo === undefined) {
    return undefined;
  }

  const sorted = [...candidates.values()].sort(
    (left, right) => right.boost - left.boost || left.project.localeCompare(right.project),
  );

  const explanations = sorted.map(
    (candidate) => `${candidate.project} (boost ${candidate.boost}): ${candidate.reasons.join("; ")}`,
  );
  if (unknownRepo !== undefined) {
    explanations.push(
      sorted.length > 0
        ? `Repository "${unknownRepo}" is not in the configured repo map; using path-derived candidate projects only.`
        : `Repository "${unknownRepo}" is not in the configured repo map and no path prefixes matched; no candidate projects were derived.`,
    );
  }

  return {
    candidates: sorted,
    ...(unknownRepo !== undefined ? { unknownRepo } : {}),
    explanations,
  };
}

/** Build a lowercase-slug to boost map for scoring from a resolution. */
export function candidateBoostMap(resolution: ProjectResolution | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!resolution) {
    return map;
  }
  for (const candidate of resolution.candidates) {
    map.set(candidate.project.toLowerCase(), candidate.boost);
  }
  return map;
}

/**
 * Match an anchor against a candidate-project boost map. Returns the highest
 * matching boost and the slug that matched, or `undefined` when nothing matches.
 */
export function anchorCandidateBoost(
  anchor: AnchorMeta,
  boosts: Map<string, number>,
): { project: string; boost: number } | undefined {
  if (boosts.size === 0) {
    return undefined;
  }
  let best: { project: string; boost: number } | undefined;
  for (const [slug, boost] of boosts) {
    if (anchorMatchesProject(anchor, slug) && (!best || boost > best.boost)) {
      best = { project: slug, boost };
    }
  }
  return best;
}

function lookupRepo(repo: string, repoMap: Record<string, string[]> | undefined): string[] | undefined {
  if (!repoMap) {
    return undefined;
  }
  const direct = repoMap[repo];
  if (direct) {
    return direct;
  }
  const needle = repo.toLowerCase();
  for (const [key, value] of Object.entries(repoMap)) {
    if (key.toLowerCase() === needle) {
      return value;
    }
  }
  return undefined;
}

function normalizePath(value: string): string {
  return value.trim().replace(/^\.?\/+/, "").toLowerCase();
}

function normalizeBoost(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}
