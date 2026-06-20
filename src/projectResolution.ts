import { anchorMatchesProject } from "./projectAliases.js";
import type {
  AnchorMeta,
  ProjectMappings,
  ProjectResolution,
  ProjectResolutionCandidate,
} from "./types.js";

/** Boost applied when a project is mapped to the supplied repository. */
export const REPO_MATCH_BOOST = 10;
/** Boost applied when a supplied file path falls under a project's configured path. */
export const PATH_MATCH_BOOST = 8;

export type ProjectResolutionInput = {
  repo?: string;
  filePaths?: string[];
};

/**
 * Resolve a repository name and/or touched file paths to ranked candidate
 * projects using the project-first `project-mappings.json` registry. Returns
 * `undefined` when there is no repo or path signal to act on.
 *
 * A repo with no matching project degrades gracefully: candidates derived from
 * path matches are still returned and the unknown repo is surfaced for
 * explanation rather than silently yielding nothing. When neither the repo nor
 * any file path matches a mapping, resolution returns `undefined` (no candidates,
 * and — for a no-repo request — nothing to explain).
 */
export function resolveCandidateProjects(
  input: ProjectResolutionInput,
  mappings: ProjectMappings,
): ProjectResolution | undefined {
  const repo = input.repo?.trim();
  const filePaths = (input.filePaths ?? [])
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);

  if (!repo && filePaths.length === 0) {
    return undefined;
  }

  const candidates = new Map<string, ProjectResolutionCandidate>();
  const add = (project: string, boost: number, reason: string): void => {
    const key = project.toLowerCase();
    const existing = candidates.get(key);
    if (existing) {
      existing.boost += boost;
      existing.reasons.push(reason);
    } else {
      candidates.set(key, { project, boost, reasons: [reason] });
    }
  };

  const repoMatchedProjects = new Set<string>();
  let repoMatchedAny = false;

  if (repo) {
    const needle = repo.toLowerCase();
    for (const mapping of mappings.projects) {
      const entry = mapping.repos.find((repoMapping) => repoMapping.repo.toLowerCase() === needle);
      if (!entry) {
        continue;
      }
      repoMatchedAny = true;
      repoMatchedProjects.add(mapping.project.toLowerCase());
      add(mapping.project, REPO_MATCH_BOOST, `repo "${repo}" is mapped to project "${mapping.project}"`);
      // Narrow within the matched repo's configured paths.
      for (const path of entry.paths) {
        for (const filePath of filePaths) {
          if (isWithinPath(filePath, path)) {
            add(mapping.project, PATH_MATCH_BOOST, `file "${filePath}" is under "${path}" in repo "${repo}"`);
          }
        }
      }
    }
  }

  // Path-only matching for projects not already matched by repo. Covers the
  // no-repo case and the unknown-repo fallback (still derive path candidates).
  if (filePaths.length > 0) {
    for (const mapping of mappings.projects) {
      if (repoMatchedProjects.has(mapping.project.toLowerCase())) {
        continue;
      }
      for (const entry of mapping.repos) {
        for (const path of entry.paths) {
          for (const filePath of filePaths) {
            if (isWithinPath(filePath, path)) {
              add(mapping.project, PATH_MATCH_BOOST, `file "${filePath}" is under "${path}"`);
            }
          }
        }
      }
    }
  }

  const unknownRepo = repo && !repoMatchedAny ? repo : undefined;

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
        ? `Repository "${unknownRepo}" is not mapped to any project; using path-derived candidate projects only.`
        : `Repository "${unknownRepo}" is not mapped to any project and no file paths matched; no candidate projects were derived.`,
    );
  }

  return {
    candidates: sorted,
    ...(unknownRepo !== undefined ? { unknownRepo } : {}),
    explanations,
  };
}

/**
 * True when `filePath` is the directory `dirPath` or sits inside it. Plain prefix
 * matching at a directory boundary (no globs): `services/payments` matches
 * `services/payments/charge.ts` but not `services/payments-v2/x.ts`.
 */
export function isWithinPath(filePath: string, dirPath: string): boolean {
  const file = normalizeForMatch(filePath);
  const dir = normalizeForMatch(dirPath);
  if (!dir) {
    return false;
  }
  return file === dir || file.startsWith(`${dir}/`);
}

function normalizeForMatch(value: string): string {
  return value.trim().replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
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
