import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { SimpleGit } from "simple-git";

export type PathCommitMetadata = {
  lastCommit: string;
  firstCommitDate?: string;
};

const COMMIT_MARKER = "\u0001";
const HASH_PATTERN = /^[0-9a-f]{40,64}$/i;

type FsHeadResolution = { ok: true; head: string | undefined } | { ok: false };

/**
 * HEAD-keyed cache of per-path git metadata (last commit touching a path,
 * first commit date for a path) built from a single `git log --name-status`
 * walk instead of one `git log` subprocess per path per request.
 *
 * Freshness is checked on every access by resolving HEAD from the filesystem
 * (`.git/HEAD` plus loose/packed refs), so out-of-band commits are picked up
 * without spawning a process. In-process commits update the cache
 * incrementally via `recordCommit`/`recordRename`; pulls call `invalidate`.
 *
 * Rename following approximates `git log --follow`: `R` entries in the walk
 * re-key older history onto the present-day path. Merge commits list no
 * paths in `--name-status` output, matching the history simplification
 * behavior of the per-path `git log` calls this cache replaces.
 */
export class GitMetadataCache {
  private head: string | undefined;
  private built = false;
  private buildFailed = false;
  private byPath = new Map<string, PathCommitMetadata>();
  private refreshing: Promise<void> | undefined;
  // Bumped whenever cache state changes outside a rebuild (invalidate,
  // recordCommit/recordRename) so an in-flight rebuild that raced the change
  // discards its result instead of clobbering the newer state.
  private generation = 0;

  constructor(
    private readonly git: SimpleGit,
    private readonly repoPath: string,
  ) {}

  /** Latest commit hash that touched this repo-relative path (undefined if never committed). */
  async lastCommitForPath(repoRelativePath: string): Promise<string | undefined> {
    await this.ensureFresh();
    if (this.buildFailed) {
      return this.lastCommitDirect(repoRelativePath);
    }
    return this.byPath.get(repoRelativePath)?.lastCommit;
  }

  /** ISO date of the first commit that touched this repo-relative path, following renames. */
  async firstCommitDateForPath(repoRelativePath: string): Promise<string | undefined> {
    await this.ensureFresh();
    if (this.buildFailed) {
      return this.firstCommitDateDirect(repoRelativePath);
    }
    return this.byPath.get(repoRelativePath)?.firstCommitDate;
  }

  /** Current HEAD commit hash (undefined for an unborn branch / empty repo). */
  async currentHead(): Promise<string | undefined> {
    await this.ensureFresh();
    if (this.buildFailed) {
      try {
        return (await this.git.revparse(["HEAD"])).trim() || undefined;
      } catch {
        return undefined;
      }
    }
    return this.head;
  }

  /** Fold an in-process commit into the cache without rebuilding. */
  recordCommit(commit: string, isoDate: string, repoRelativePaths: string[]): void {
    if (!this.built || this.buildFailed) {
      return;
    }
    this.generation += 1;
    this.head = commit;
    for (const repoRelativePath of repoRelativePaths) {
      const existing = this.byPath.get(repoRelativePath);
      if (existing) {
        existing.lastCommit = commit;
      } else {
        this.byPath.set(repoRelativePath, { lastCommit: commit, firstCommitDate: isoDate });
      }
    }
  }

  /** Fold an in-process rename commit into the cache, carrying the origin's first commit date. */
  recordRename(commit: string, isoDate: string, fromRepoRelativePath: string, toRepoRelativePath: string): void {
    if (!this.built || this.buildFailed) {
      return;
    }
    this.generation += 1;
    this.head = commit;
    const existing = this.byPath.get(fromRepoRelativePath);
    this.byPath.delete(fromRepoRelativePath);
    this.byPath.set(toRepoRelativePath, {
      lastCommit: commit,
      firstCommitDate: existing?.firstCommitDate ?? isoDate,
    });
  }

  /** Drop everything; the next access rebuilds from the current HEAD. */
  invalidate(): void {
    this.generation += 1;
    this.head = undefined;
    this.built = false;
    this.buildFailed = false;
    this.byPath = new Map();
  }

  private async ensureFresh(): Promise<void> {
    for (;;) {
      while (this.refreshing) {
        await this.refreshing;
      }

      const head = await this.resolveHead();
      if (this.built && head === this.head) {
        return;
      }

      if (!this.refreshing) {
        this.refreshing = this.rebuild(head, this.generation).finally(() => {
          this.refreshing = undefined;
        });
      }
      await this.refreshing;
      // Loop to re-verify: the rebuild may have been discarded because an
      // invalidate or recordCommit raced it, or HEAD may have moved again.
    }
  }

  private async rebuild(head: string | undefined, generation: number): Promise<void> {
    let byPath = new Map<string, PathCommitMetadata>();
    let buildFailed = false;

    if (head) {
      try {
        const output = await this.git.raw([
          "-c",
          "core.quotepath=false",
          "log",
          "--name-status",
          "--find-renames",
          `--format=${COMMIT_MARKER}%H%x09%aI`,
        ]);
        byPath = parseNameStatusLog(output);
      } catch {
        buildFailed = true;
      }
    }

    if (generation !== this.generation) {
      // State changed while the walk ran; discard so the caller re-checks.
      return;
    }

    this.head = head;
    this.built = true;
    this.buildFailed = buildFailed;
    this.byPath = byPath;
  }

  private async resolveHead(): Promise<string | undefined> {
    const resolution = await resolveHeadFromFs(this.repoPath);
    if (resolution.ok) {
      return resolution.head;
    }

    try {
      return (await this.git.revparse(["HEAD"])).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async lastCommitDirect(repoRelativePath: string): Promise<string | undefined> {
    try {
      const log = await this.git.log({ file: repoRelativePath, maxCount: 1 });
      return log.latest?.hash;
    } catch {
      return undefined;
    }
  }

  private async firstCommitDateDirect(repoRelativePath: string): Promise<string | undefined> {
    try {
      const output = await this.git.raw(["log", "--follow", "--format=%aI", "--reverse", "--", repoRelativePath]);
      const firstDate = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (!firstDate) {
        return undefined;
      }

      const timestamp = Date.parse(firstDate);
      return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
    } catch {
      return undefined;
    }
  }
}

/**
 * Parse `git log --name-status --format=<marker>%H%x09%aI` output (newest
 * commit first) into per-path metadata keyed by present-day path. The first
 * commit seen for a path is its latest touching commit; the last commit seen
 * (oldest, following rename entries backwards) supplies the first commit date.
 */
export function parseNameStatusLog(output: string): Map<string, PathCommitMetadata> {
  const byPath = new Map<string, PathCommitMetadata>();
  // Maps a path's older historical name to the present-day path it became.
  const trackedName = new Map<string, string>();
  let commit = "";
  let commitDate: string | undefined;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith(COMMIT_MARKER)) {
      const body = line.slice(COMMIT_MARKER.length);
      const tab = body.indexOf("\t");
      commit = tab === -1 ? body.trim() : body.slice(0, tab).trim();
      const rawDate = tab === -1 ? "" : body.slice(tab + 1).trim();
      const timestamp = rawDate ? Date.parse(rawDate) : Number.NaN;
      commitDate = Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
      continue;
    }

    if (!line || !commit) {
      continue;
    }

    const parts = line.split("\t");
    if (parts.length < 2) {
      continue;
    }

    const status = parts[0];
    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
      const oldPath = parts[1];
      const newPath = parts[2];
      const tracked = trackedName.get(newPath) ?? newPath;
      recordOccurrence(byPath, tracked, commit, commitDate);
      if (status.startsWith("R")) {
        trackedName.delete(newPath);
        trackedName.set(oldPath, tracked);
      }
      continue;
    }

    const filePath = parts[1];
    const tracked = trackedName.get(filePath) ?? filePath;
    recordOccurrence(byPath, tracked, commit, commitDate);
  }

  return byPath;
}

function recordOccurrence(
  byPath: Map<string, PathCommitMetadata>,
  filePath: string,
  commit: string,
  commitDate: string | undefined,
): void {
  const existing = byPath.get(filePath);
  if (existing) {
    if (commitDate) {
      existing.firstCommitDate = commitDate;
    }
    return;
  }
  byPath.set(filePath, { lastCommit: commit, ...(commitDate ? { firstCommitDate: commitDate } : {}) });
}

async function resolveHeadFromFs(repoPath: string): Promise<FsHeadResolution> {
  try {
    const gitPath = path.join(repoPath, ".git");
    let gitDir = gitPath;
    const gitPathStats = await stat(gitPath);
    if (gitPathStats.isFile()) {
      const pointer = await readFile(gitPath, "utf8");
      const match = /^gitdir:\s*(.+)\s*$/m.exec(pointer);
      if (!match) {
        return { ok: false };
      }
      gitDir = path.resolve(repoPath, match[1].trim());
    }

    // Worktrees keep HEAD in their own gitdir but refs in the common dir.
    let refsDir = gitDir;
    try {
      const common = (await readFile(path.join(gitDir, "commondir"), "utf8")).trim();
      refsDir = path.resolve(gitDir, common);
    } catch (error) {
      if (!isEnoent(error)) {
        return { ok: false };
      }
    }

    const headContent = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    const refMatch = /^ref:\s*(.+)$/.exec(headContent);
    if (!refMatch) {
      return HASH_PATTERN.test(headContent) ? { ok: true, head: headContent } : { ok: false };
    }

    const ref = refMatch[1].trim();
    try {
      const refContent = (await readFile(path.join(refsDir, ref), "utf8")).trim();
      return HASH_PATTERN.test(refContent) ? { ok: true, head: refContent } : { ok: false };
    } catch (error) {
      if (!isEnoent(error)) {
        return { ok: false };
      }
    }

    try {
      const packed = await readFile(path.join(refsDir, "packed-refs"), "utf8");
      for (const line of packed.split(/\r?\n/)) {
        if (!line || line.startsWith("#") || line.startsWith("^")) {
          continue;
        }
        const space = line.indexOf(" ");
        if (space === -1) {
          continue;
        }
        if (line.slice(space + 1).trim() === ref && HASH_PATTERN.test(line.slice(0, space))) {
          return { ok: true, head: line.slice(0, space) };
        }
      }
    } catch (error) {
      if (!isEnoent(error)) {
        return { ok: false };
      }
    }

    // HEAD points at a ref that exists nowhere: unborn branch (empty repo).
    return { ok: true, head: undefined };
  } catch {
    return { ok: false };
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
