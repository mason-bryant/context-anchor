import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { ImportFile, Person, ProjectMapping } from "../db/importDocuments.js";
import { CliUsageError } from "./errors.js";

const run = promisify(execFile);

export const PROJECT_MAPPINGS_FILE = "project-mappings.json";
export const PEOPLE_REGISTRY_FILE = "people-registry.json";

export class DirtyWorkingTreeError extends CliUsageError {
  constructor(public readonly entries: string[]) {
    const shown = entries.slice(0, 10).join(", ");
    const more = entries.length > 10 ? `, and ${String(entries.length - 10)} more` : "";
    super(
      `The anchor repository has uncommitted changes: ${shown}${more}. ` +
        `An import is defined against a pinned commit, so importing now would record a commit sha ` +
        `that does not describe the content being imported. Commit first, or pass --allow-dirty to ` +
        `import the working tree anyway.`,
    );
    this.name = "DirtyWorkingTreeError";
  }
}

export type RepositorySnapshot = {
  repository: string;
  /** Full lowercase 40-hex HEAD sha. */
  commitSha: string;
  files: ImportFile[];
  projectMappings?: ProjectMapping[];
  people?: Person[];
  /** True when --allow-dirty was used, meaning file content does not match commitSha. */
  dirty: boolean;
};

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repoPath, ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Trailing newline only. `--porcelain` encodes staged/unstaged state in two leading
 * columns, so an unstaged edit is " M path" — trimming both ends would eat that leading
 * space and shift the filename out of alignment.
 */
async function gitLines(repoPath: string, args: string[]): Promise<string[]> {
  const { stdout } = await run("git", ["-C", repoPath, ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.split("\n").filter((line) => line.length > 0);
}

/** Markdown only, and never inside a dot-directory — `.git` above all, but also editor and tooling state. */
async function collectMarkdown(root: string, dir = root, out: ImportFile[] = []): Promise<ImportFile[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(root, absolute, out);
    } else if (entry.name.endsWith(".md")) {
      out.push({
        // Posix separators: the path is the document's identity in the database, and must not
        // differ between an import run on Windows and one on macOS.
        path: path.relative(root, absolute).split(path.sep).join("/"),
        content: await readFile(absolute, "utf8"),
      });
    }
  }
  return out;
}

async function readJsonFile(repoPath: string, fileName: string): Promise<unknown> {
  const file = path.join(repoPath, fileName);
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    // Name the file: a bare "Unexpected token" from deep inside an import is not actionable.
    throw new CliUsageError(
      `Could not parse ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type ProjectFirstMapping = {
  project?: unknown;
  repos?: Array<{ repo?: unknown; paths?: unknown; web?: unknown }>;
};

/**
 * `project-mappings.json` is project-first (one entry per project, each listing repos and
 * optional path prefixes); the importer wants one flat row per `(repository, pathPrefix)`,
 * because that pair is what routing matches on and what the live-unique index is keyed by.
 *
 * `name` becomes a component scope slug (`${project}-${name}`), so it has to be stable and
 * unique within a project: the repo name alone when a repo has no path prefixes, and
 * `${repo}-${path}` when it does, which keeps two repos contributing the same prefix apart.
 */
export function flattenProjectMappings(parsed: unknown): ProjectMapping[] | undefined {
  if (parsed === undefined) {
    return undefined;
  }

  // On disk the registry is `{ projects: [...] }` with sibling keys such as
  // `claimSourceTypes`; a bare array is also accepted because it is the shape the type
  // suggests and costs nothing to support.
  const entries = Array.isArray(parsed) ? parsed : (parsed as { projects?: unknown }).projects;
  if (!Array.isArray(entries)) {
    throw new CliUsageError(
      `${PROJECT_MAPPINGS_FILE} has no usable project mappings: expected an array of projects, ` +
        `or an object with a "projects" array. Routing scopes would be silently missing from the import.`,
    );
  }

  const mappings: ProjectMapping[] = [];
  for (const entry of entries as ProjectFirstMapping[]) {
    const project = typeof entry?.project === "string" ? entry.project : undefined;
    if (!project || !Array.isArray(entry.repos)) {
      continue;
    }
    for (const repoEntry of entry.repos) {
      const repository = typeof repoEntry?.repo === "string" ? repoEntry.repo : undefined;
      if (!repository) {
        continue;
      }
      const paths = Array.isArray(repoEntry.paths) ? repoEntry.paths.filter((p): p is string => typeof p === "string") : [];
      const webConfig = repoEntry.web && typeof repoEntry.web === "object" ? (repoEntry.web as Record<string, unknown>) : undefined;
      if (paths.length === 0) {
        mappings.push({
          repository,
          pathPrefix: "",
          project,
          name: repository,
          ...(webConfig ? { webConfig } : {}),
        });
        continue;
      }
      for (const pathPrefix of paths) {
        mappings.push({
          repository,
          pathPrefix,
          project,
          name: `${repository}-${pathPrefix.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}`,
          ...(webConfig ? { webConfig } : {}),
        });
      }
    }
  }

  if (mappings.length === 0) {
    throw new CliUsageError(
      `${PROJECT_MAPPINGS_FILE} produced no mappings; every entry was missing a project or repo name. ` +
        `Routing scopes would be silently missing from the import.`,
    );
  }
  return mappings;
}

export function mapPeople(parsed: unknown): Person[] | undefined {
  const people = (parsed as { people?: unknown })?.people;
  if (!Array.isArray(people)) {
    return undefined;
  }

  const mapped = people.flatMap((person: unknown) => {
    const { id, displayName, identities } = (person ?? {}) as {
      id?: unknown;
      displayName?: unknown;
      identities?: unknown;
    };
    if (typeof id !== "string" || typeof displayName !== "string") {
      return [];
    }
    return [
      {
        id,
        displayName,
        identities: Array.isArray(identities)
          ? identities.flatMap((identity: unknown) => {
              const { kind, value } = (identity ?? {}) as { kind?: unknown; value?: unknown };
              return typeof kind === "string" && typeof value === "string" ? [{ kind, value }] : [];
            })
          : [],
      },
    ];
  });

  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Reads an anchor repository into the payload `importDocuments` expects. Refuses a dirty
 * working tree by default: the import is defined against a pinned commit, and recording a
 * sha that does not describe the imported bytes makes every later "what was in this import"
 * question unanswerable.
 */
export async function collectRepositorySnapshot(
  repoPath: string,
  options: { allowDirty?: boolean; repository?: string } = {},
): Promise<RepositorySnapshot> {
  if (!existsSync(path.join(repoPath, ".git"))) {
    throw new CliUsageError(`${repoPath} is not a git repository, so there is no commit to pin the import to.`);
  }

  // `XY path`, where XY is the two-column staged/unstaged state; renames read as
  // `old -> new`, which is kept whole because it is what the operator needs to see.
  const dirtyEntries = (await gitLines(repoPath, ["status", "--porcelain"])).map((line) => line.slice(3).trim());
  if (dirtyEntries.length > 0 && !options.allowDirty) {
    throw new DirtyWorkingTreeError(dirtyEntries);
  }

  const commitSha = (await git(repoPath, ["rev-parse", "HEAD"])).toLowerCase();
  const files = await collectMarkdown(repoPath);
  if (files.length === 0) {
    throw new CliUsageError(`${repoPath} contains no markdown files; there is nothing to import.`);
  }

  const projectMappings = flattenProjectMappings(await readJsonFile(repoPath, PROJECT_MAPPINGS_FILE));
  const people = mapPeople(await readJsonFile(repoPath, PEOPLE_REGISTRY_FILE));

  return {
    // No remote is normal for a local anchor repository, so the directory name is the
    // fallback identity rather than an error.
    repository: options.repository ?? (await resolveRepositoryName(repoPath)),
    commitSha,
    files,
    ...(projectMappings ? { projectMappings } : {}),
    ...(people ? { people } : {}),
    dirty: dirtyEntries.length > 0,
  };
}

async function resolveRepositoryName(repoPath: string): Promise<string> {
  try {
    const url = await git(repoPath, ["remote", "get-url", "origin"]);
    const name = url.replace(/\.git$/, "").split(/[/:]/).pop();
    if (name) {
      return name;
    }
  } catch {
    // No remote configured — fall through to the directory name.
  }
  return path.basename(repoPath);
}
