import type { ProjectMapping, ProjectMappings, ProjectRepoMapping, ProjectRepoWeb } from "./types.js";

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
  // A project with no repos is not a mapping; drop it so the stored registry only
  // ever holds real mappings (the UI lists unmapped projects separately).
  return [...byProject.values()].filter((mapping) => mapping.repos.length > 0);
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
    const web = parseWeb(obj.web);
    const key = repo.toLowerCase();
    const existing = byRepo.get(key);
    if (existing) {
      existing.paths = dedupePaths([...existing.paths, ...paths]);
      if (!existing.web && web) {
        existing.web = web;
      }
    } else {
      byRepo.set(key, { repo, paths, ...(web ? { web } : {}) });
    }
  }
  return [...byRepo.values()];
}

function parseWeb(raw: unknown): ProjectRepoWeb | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const url = stringValue(obj.url);
  if (!url) {
    // A web block with no url cannot build a link, so drop it entirely.
    return undefined;
  }
  const branch = stringValue(obj.branch);
  const fileTemplate = stringValue(obj.fileTemplate);
  return {
    url,
    ...(branch ? { branch } : {}),
    ...(fileTemplate ? { fileTemplate } : {}),
  };
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
      if (!existing.web && entry.web) {
        existing.web = entry.web;
      }
    } else {
      byRepo.set(key, { repo: entry.repo, paths: [...entry.paths], ...(entry.web ? { web: entry.web } : {}) });
    }
  }
  return [...byRepo.values()];
}

const DEFAULT_FILE_URL_TEMPLATE = "{url}/blob/{branch}/{path}";
const DEFAULT_BRANCH = "main";

/**
 * Build a web URL to a specific repo-relative file from a repo mapping's `web`
 * info, e.g. `https://github.com/owner/repo/blob/main/src/index.ts`. Returns
 * `undefined` when the repo has no `web.url` or the path is empty. Substitutes
 * `{url}`, `{branch}`, and `{path}` in `web.fileTemplate` (default GitHub-style),
 * and appends `#L<line>` when a line is given.
 */
export function repoFileUrl(
  repo: Pick<ProjectRepoMapping, "web">,
  filePath: string,
  line?: number,
): string | undefined {
  const web = repo.web;
  if (!web?.url) {
    return undefined;
  }
  const cleanPath = filePath.trim().replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!cleanPath) {
    return undefined;
  }
  const base = web.url.trim().replace(/\/+$/, "");
  const branch = web.branch?.trim() || DEFAULT_BRANCH;
  const template = web.fileTemplate?.trim() || DEFAULT_FILE_URL_TEMPLATE;
  let url = template
    .replace(/\{url\}/g, base)
    .replace(/\{branch\}/g, encodeRefOrPath(branch))
    .replace(/\{path\}/g, encodeRefOrPath(cleanPath));
  if (line !== undefined && Number.isFinite(line) && line > 0) {
    url += `#L${Math.floor(line)}`;
  }
  return url;
}

/** Encode each path/ref segment while preserving the slashes between them. */
function encodeRefOrPath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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
