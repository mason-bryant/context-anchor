import type { ProjectMapping, ProjectMappings, ProjectRepoMapping } from "./types.js";

/**
 * Normalize and validate a raw project-mappings shape. Mirrors parsePeopleRegistry:
 * it is the single source of truth for registry shape, drops unmodeled fields, and
 * funnels every write path through one validator. Project slugs and repo names are
 * deduped case-insensitively (paths within a repo are unioned), so a malformed or
 * duplicated entry can never persist.
 */
export function parseProjectMappings(raw: unknown): ProjectMappings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { projects: [] };
  }
  const obj = raw as Record<string, unknown>;
  return { projects: parseProjectsArray(obj.projects) };
}

function parseProjectsArray(raw: unknown): ProjectMapping[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const byProject = new Map<string, ProjectMapping>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const project = stringValue(obj.project);
    if (!project) {
      continue;
    }
    const repos = parseReposArray(obj.repos);
    const key = project.toLowerCase();
    const existing = byProject.get(key);
    if (existing) {
      existing.repos = mergeRepos(existing.repos, repos);
    } else {
      byProject.set(key, { project, repos });
    }
  }
  return [...byProject.values()];
}

function parseReposArray(raw: unknown): ProjectRepoMapping[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const byRepo = new Map<string, ProjectRepoMapping>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const repo = stringValue(obj.repo);
    if (!repo) {
      continue;
    }
    const paths = parsePaths(obj.paths);
    const key = repo.toLowerCase();
    const existing = byRepo.get(key);
    if (existing) {
      existing.paths = dedupePaths([...existing.paths, ...paths]);
    } else {
      byRepo.set(key, { repo, paths });
    }
  }
  return [...byRepo.values()];
}

function parsePaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized = raw
    .filter((item): item is string => typeof item === "string")
    .map(normalizePathForStorage)
    .filter((item) => item.length > 0);
  return dedupePaths(normalized);
}

function mergeRepos(left: ProjectRepoMapping[], right: ProjectRepoMapping[]): ProjectRepoMapping[] {
  const byRepo = new Map<string, ProjectRepoMapping>();
  for (const entry of [...left, ...right]) {
    const key = entry.repo.toLowerCase();
    const existing = byRepo.get(key);
    if (existing) {
      existing.paths = dedupePaths([...existing.paths, ...entry.paths]);
    } else {
      byRepo.set(key, { repo: entry.repo, paths: [...entry.paths] });
    }
  }
  return [...byRepo.values()];
}

/** Strip leading `./` and surrounding slashes so paths are stored as bare directory prefixes. */
export function normalizePathForStorage(value: string): string {
  return value.trim().replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const key = path.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(path);
    }
  }
  return out;
}

function stringValue(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}
