import type { Stats } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { simpleGit, type SimpleGit } from "simple-git";

import { AnchorParseCache } from "../storage/cache.js";
import type {
  AnchorListFilter,
  AnchorListPage,
  AnchorListSort,
  AnchorStore,
  CommitAnchorInput,
  ResolvedAnchorPath,
  SyncableAnchorStore,
  WritePeopleRegistryOptions,
  WriteProjectMappingsOptions,
} from "../storage/store.js";
import { analyzeRoadmapFromContent } from "../roadmap/analyzeRoadmap.js";
import { parseProjectAliases, anchorMatchesProject } from "../projectAliases.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath, CONTEXT_ROOT_FILE, type AnchorCategory } from "../taxonomy.js";
import {
  normalizedMilestoneId,
  normalizedScheduleFromFm,
  normalizedSequenceFromFm,
  normalizedTasksFromFm,
} from "../milestoneFrontmatter.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import type {
  AnchorMeta,
  AnchorRead,
  AnchorVersion,
  ConflictStatus,
  MilestonePlannerMeta,
  SearchHit,
} from "../types.js";
import { assertInside, normalizeRelative, toPosix } from "../utils/path.js";
import { buildAnchorCommitMessage } from "./commit.js";
import { AsyncLock } from "./lock.js";
import { GitMetadataCache } from "./metadataCache.js";

type AnchorFileCandidate = {
  absolutePath: string;
  anchorRelativePath: string;
  repoRelativePath: string;
  category: AnchorCategory;
  projectSlug?: string;
  stats: Stats;
  createdAt?: string;
  createdTimeMs?: number;
};

type AnchorMetaWithFrontmatter = {
  meta: AnchorMeta;
  frontmatter: Record<string, unknown>;
};

type ResolvedGitAnchorPath = ResolvedAnchorPath & {
  absolutePath: string;
  anchorRelativePath: string;
  repoRelativePath: string;
};

type CachedFileContent = {
  mtimeMs: number;
  size: number;
  content: string;
};

type CachedAnchorMeta = {
  mtimeMs: number;
  size: number;
  row: AnchorMetaWithFrontmatter;
};

const MAX_CACHED_FILE_CONTENT_BYTES = 1_000_000;
const MAX_FILE_CONTENT_CACHE_BYTES = 16_000_000;

export class PeopleRegistryConflictError extends Error {
  readonly code = "people_registry_conflict";
  constructor(
    readonly expectedFileCommit: string,
    readonly currentFileCommit: string | undefined,
  ) {
    super(
      `People registry commit mismatch: expected ${expectedFileCommit || "none"}, found ${
        currentFileCommit ?? "none"
      }. Re-load the registry and retry.`,
    );
    this.name = "PeopleRegistryConflictError";
  }
}

export class ProjectMappingsConflictError extends Error {
  readonly code = "project_mappings_conflict";
  constructor(
    readonly expectedFileCommit: string,
    readonly currentFileCommit: string | undefined,
  ) {
    super(
      `Project mappings commit mismatch: expected ${expectedFileCommit || "none"}, found ${
        currentFileCommit ?? "none"
      }. Re-load the mappings and retry.`,
    );
    this.name = "ProjectMappingsConflictError";
  }
}

export class AnchorRepository implements AnchorStore, SyncableAnchorStore {
  readonly repoPath: string;
  readonly anchorRoot: string;
  readonly anchorRootPath: string;
  readonly git: SimpleGit;

  private readonly cache = new AnchorParseCache();
  private readonly fileContentCache = new Map<string, CachedFileContent>();
  private fileContentCacheBytes = 0;
  private readonly metaCache = new Map<string, CachedAnchorMeta>();
  private readonly gitMetadata: GitMetadataCache;
  private readonly lock = new AsyncLock();

  constructor(options: { repoPath: string; anchorRoot?: string }) {
    this.repoPath = path.resolve(options.repoPath);
    this.anchorRoot = normalizeRelative(options.anchorRoot ?? ".");
    this.anchorRootPath = path.resolve(this.repoPath, this.anchorRoot || ".");
    assertInside(this.repoPath, this.anchorRootPath);
    this.git = simpleGit({ baseDir: this.repoPath, binary: "git", maxConcurrentProcesses: 1 });
    this.gitMetadata = new GitMetadataCache(this.git, this.repoPath);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.anchorRootPath, { recursive: true });
    const gitDir = path.join(this.repoPath, ".git");
    try {
      await stat(gitDir);
    } catch {
      await this.git.init();
    }
  }

  resolveAnchor(name: string): ResolvedAnchorPath {
    const resolved = this.resolveGitAnchor(name);
    return {
      name: resolved.name,
      path: resolved.repoRelativePath,
      revisionKey: resolved.repoRelativePath,
    };
  }

  private resolveGitAnchor(name: string): ResolvedGitAnchorPath {
    const clean = normalizeRelative(name);
    if (!clean || clean === "." || clean.includes("\0")) {
      throw new Error("Anchor name must be a non-empty relative path");
    }

    const anchorRelativePath = clean.endsWith(".md") ? clean : `${clean}.md`;
    const absolutePath = path.resolve(this.anchorRootPath, anchorRelativePath);
    assertInside(this.anchorRootPath, absolutePath);
    const repoRelativePath = toPosix(path.relative(this.repoPath, absolutePath));

    return {
      name: anchorRelativePath,
      path: repoRelativePath,
      revisionKey: repoRelativePath,
      absolutePath,
      anchorRelativePath,
      repoRelativePath,
    };
  }

  async listAnchors(filter?: AnchorListFilter): Promise<AnchorMeta[]> {
    const candidates = await this.listAnchorFileCandidates(filter, "name");
    const metas: AnchorMeta[] = [];

    for (const candidate of candidates) {
      const row = await this.anchorMetaFromCandidate(candidate);
      if (!anchorMatchesFrontmatterFilters(row, filter)) {
        continue;
      }

      metas.push(row.meta);
    }

    return metas.sort((left, right) => left.name.localeCompare(right.name));
  }

  async listAnchorsPage(
    filter: AnchorListFilter = {},
    page: { sort: AnchorListSort; offset?: number; limit?: number },
  ): Promise<AnchorListPage> {
    const offset = page.offset ?? 0;
    const candidates = await this.listAnchorFileCandidates(filter, page.sort);
    const needsFrontmatterFiltering = Boolean(filter.project || filter.tag || filter.runtime);

    if (page.sort === "priority") {
      const anchors: AnchorMeta[] = [];
      for (const candidate of candidates) {
        const row = await this.anchorMetaFromCandidate(candidate);
        if (!anchorMatchesFrontmatterFilters(row, filter)) {
          continue;
        }
        anchors.push(row.meta);
      }

      anchors.sort(compareAnchorMetasByPriority);
      const pageAnchors = anchors.slice(offset, page.limit === undefined ? undefined : offset + page.limit);
      const nextOffset =
        page.limit === undefined || offset + page.limit >= anchors.length ? undefined : offset + page.limit;
      return {
        anchors: pageAnchors,
        offset,
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        total: anchors.length,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
      };
    }

    if (!needsFrontmatterFiltering) {
      const pageCandidates = candidates.slice(offset, page.limit === undefined ? undefined : offset + page.limit);
      const anchors: AnchorMeta[] = [];
      for (const candidate of pageCandidates) {
        anchors.push((await this.anchorMetaFromCandidate(candidate)).meta);
      }

      const nextOffset =
        page.limit === undefined || offset + page.limit >= candidates.length ? undefined : offset + page.limit;
      return {
        anchors,
        offset,
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        total: candidates.length,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
      };
    }

    const anchors: AnchorMeta[] = [];
    let matched = 0;
    let scannedAll = true;
    let nextOffset: number | undefined;

    for (const candidate of candidates) {
      const row = await this.anchorMetaFromCandidate(candidate);
      if (!anchorMatchesFrontmatterFilters(row, filter)) {
        continue;
      }

      if (matched < offset) {
        matched += 1;
        continue;
      }

      if (page.limit !== undefined && anchors.length >= page.limit) {
        nextOffset = matched;
        scannedAll = false;
        break;
      }

      anchors.push(row.meta);
      matched += 1;
    }

    return {
      anchors,
      offset,
      ...(page.limit !== undefined ? { limit: page.limit } : {}),
      ...(scannedAll ? { total: matched } : {}),
      ...(nextOffset !== undefined ? { nextOffset } : {}),
    };
  }

  async readAnchor(name: string, version?: string): Promise<AnchorRead> {
    const resolved = this.resolveGitAnchor(name);
    const isLatest = !version || version === "latest";
    const stats = isLatest ? await stat(resolved.absolutePath) : undefined;
    const content = isLatest
      ? await this.readFileCached(resolved.absolutePath, stats)
      : await this.git.show([`${version}:${resolved.repoRelativePath}`]);
    const parsed = isLatest
      ? await this.cache.parse(resolved.absolutePath, content, stats)
      : parseAnchor(content);

    const fileCommit = isLatest ? await this.lastRevisionForPath(resolved.repoRelativePath) : undefined;

    return {
      name: resolved.name,
      path: resolved.repoRelativePath,
      content,
      frontmatter: parsed.frontmatter,
      version: isLatest ? await this.gitMetadata.currentHead() : version,
      fileCommit,
    };
  }

  /** Latest commit hash that touched this repo-relative path (undefined if no commits yet). */
  async lastCommitForFile(repoRelativePath: string): Promise<string | undefined> {
    return this.lastRevisionForPath(repoRelativePath);
  }

  /** Latest backend revision that touched this anchor (git commit hash for this store). */
  async lastRevisionForAnchor(name: string): Promise<string | undefined> {
    const resolved = this.resolveGitAnchor(name);
    return this.lastRevisionForPath(resolved.repoRelativePath);
  }

  /** Latest backend revision that touched this repo-relative path (git commit hash for this store). */
  async lastRevisionForPath(repoRelativePath: string): Promise<string | undefined> {
    return this.gitMetadata.lastCommitForPath(repoRelativePath);
  }

  async readAnchorBatch(names: string[]): Promise<AnchorRead[]> {
    return Promise.all(names.map((name) => this.readAnchor(name)));
  }

  async searchAnchors(query: string, scope?: string): Promise<SearchHit[]> {
    const needle = query.toLowerCase();
    const files = await this.listMarkdownFiles(scope ? this.resolveScope(scope) : this.anchorRootPath);
    const hits: SearchHit[] = [];

    for (const absolutePath of files) {
      const stats = await stat(absolutePath);
      const content = await this.readFileCached(absolutePath, stats);
      const lines = content.split(/\r?\n/);
      const anchorRelativePath = toPosix(path.relative(this.anchorRootPath, absolutePath));
      const repoRelativePath = toPosix(path.relative(this.repoPath, absolutePath));

      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(needle)) {
          hits.push({
            name: anchorRelativePath,
            path: repoRelativePath,
            line: index + 1,
            preview: line.trim(),
          });
        }
      });
    }

    return hits;
  }

  async commitAnchor(input: CommitAnchorInput): Promise<string | undefined> {
    return this.lock.runExclusive(async () => {
      const resolved = this.resolveGitAnchor(input.name);
      await mkdir(path.dirname(resolved.absolutePath), { recursive: true });

      const tmpPath = `${resolved.absolutePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, input.content, "utf8");
      await rename(tmpPath, resolved.absolutePath);
      this.invalidateReadIndex(resolved.absolutePath);

      await this.git.add(resolved.repoRelativePath);

      const status = await this.git.status();
      if (!status.files.some((file) => file.path === resolved.repoRelativePath)) {
        return this.currentVersion().catch(() => undefined);
      }

      const args = [
        "-c",
        "user.name=anchor-mcp",
        "-c",
        "user.email=anchor-mcp@local",
        "commit",
        ...buildAnchorCommitMessage({
          action: input.action ?? "write",
          name: resolved.name,
          message: input.message,
          sectionsChanged: input.sectionsChanged,
          lastValidatedChanged: input.lastValidatedChanged,
          coAuthor: input.coAuthor,
        }),
      ];
      await this.git.raw(args);
      const version = await this.currentVersion();
      this.gitMetadata.recordCommit(version, new Date().toISOString(), [resolved.repoRelativePath]);

      if (input.push) {
        await this.push().catch(() => undefined);
      }

      return version;
    });
  }

  async commitGeneratedContextRoot(content: string, push?: boolean): Promise<string | undefined> {
    return this.lock.runExclusive(async () => {
      const absolutePath = path.resolve(this.anchorRootPath, CONTEXT_ROOT_FILE);
      assertInside(this.anchorRootPath, absolutePath);

      const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, absolutePath);
      this.invalidateReadIndex(absolutePath);

      const repoRelativePath = toPosix(path.relative(this.repoPath, absolutePath));
      await this.git.add(repoRelativePath);

      const status = await this.git.status();
      if (!status.files.some((file) => file.path === repoRelativePath)) {
        return this.currentVersion().catch(() => undefined);
      }

      await this.git.raw([
        "-c",
        "user.name=anchor-mcp",
        "-c",
        "user.email=anchor-mcp@local",
        "commit",
        "-m",
        "anchor-mcp: generate CONTEXT-ROOT.md",
        "-m",
        "Generated from anchor front matter.",
      ]);
      const version = await this.currentVersion();
      this.gitMetadata.recordCommit(version, new Date().toISOString(), [repoRelativePath]);

      if (push) {
        await this.push().catch(() => undefined);
      }

      return version;
    });
  }

  async listVersions(name: string, limit = 20): Promise<AnchorVersion[]> {
    const resolved = this.resolveGitAnchor(name);
    const log = await this.git.log({
      file: resolved.repoRelativePath,
      maxCount: limit,
    });

    return log.all.map((entry) => ({
      version: entry.hash,
      author: entry.author_name,
      date: entry.date,
      message: entry.message,
    }));
  }

  async diffAnchor(name: string, fromVersion: string, toVersion: string): Promise<string> {
    const resolved = this.resolveGitAnchor(name);
    return this.git.diff([`${fromVersion}..${toVersion}`, "--", resolved.repoRelativePath]);
  }

  async revertAnchor(name: string, toVersion: string, message?: string, push?: boolean): Promise<string | undefined> {
    const resolved = this.resolveGitAnchor(name);
    const content = await this.git.show([`${toVersion}:${resolved.repoRelativePath}`]);
    return this.commitAnchor({
      name,
      content,
      message: message || `anchor-mcp: revert ${resolved.name} to ${toVersion.slice(0, 12)}`,
      action: "revert",
      push,
    });
  }

  async conflictStatus(): Promise<ConflictStatus> {
    const status = await this.git.status();
    if (status.conflicted.length > 0) {
      return { state: "conflicted", paths: status.conflicted };
    }

    return { state: "clean" };
  }

  async currentUpstream(): Promise<string | undefined> {
    try {
      const upstream = await this.git.revparse(["--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
      return upstream.trim() || undefined;
    } catch (error) {
      if (isExpectedMissingUpstreamError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Remove an anchor file from the working tree and record a git commit.
   * The path must already exist on disk.
   */
  async deleteAnchorFile(input: {
    name: string;
    message?: string;
    coAuthor?: string;
    push?: boolean;
  }): Promise<string | undefined> {
    return this.lock.runExclusive(async () => {
      const resolved = this.resolveGitAnchor(input.name);
      try {
        await stat(resolved.absolutePath);
      } catch (error) {
        if (isNodeFsErrorCode(error, "ENOENT")) {
          throw new Error(`Anchor file not found: ${resolved.name}`);
        }
        throw error;
      }

      await unlink(resolved.absolutePath);
      this.invalidateReadIndex(resolved.absolutePath);

      await this.git.add(resolved.repoRelativePath);

      const status = await this.git.status();
      if (!status.files.some((file) => file.path === resolved.repoRelativePath)) {
        return this.currentVersion().catch(() => undefined);
      }

      const args = [
        "-c",
        "user.name=anchor-mcp",
        "-c",
        "user.email=anchor-mcp@local",
        "commit",
        ...buildAnchorCommitMessage({
          action: "delete",
          name: resolved.name,
          message: input.message,
          coAuthor: input.coAuthor,
        }),
      ];
      await this.git.raw(args);
      const version = await this.currentVersion();
      this.gitMetadata.recordCommit(version, new Date().toISOString(), [resolved.repoRelativePath]);

      if (input.push) {
        await this.push().catch(() => undefined);
      }

      return version;
    });
  }

  /**
   * Move an anchor file within the repo (`git mv`). Destination parent directories are created as needed.
   */
  async renameAnchorFile(input: {
    from: string;
    to: string;
    message?: string;
    coAuthor?: string;
    push?: boolean;
  }): Promise<string | undefined> {
    return this.lock.runExclusive(async () => {
      const fromResolved = this.resolveGitAnchor(input.from);
      const toResolved = this.resolveGitAnchor(input.to);

      try {
        await stat(fromResolved.absolutePath);
      } catch (error) {
        if (isNodeFsErrorCode(error, "ENOENT")) {
          throw new Error(`Anchor file not found: ${fromResolved.name}`);
        }
        throw error;
      }

      let destinationExists = true;
      try {
        await stat(toResolved.absolutePath);
      } catch (error) {
        if (isNodeFsErrorCode(error, "ENOENT")) {
          destinationExists = false;
        } else {
          throw error;
        }
      }
      if (destinationExists) {
        throw new Error(`Destination already exists: ${toResolved.name}`);
      }

      await mkdir(path.dirname(toResolved.absolutePath), { recursive: true });

      await this.git.raw(["mv", "--", fromResolved.repoRelativePath, toResolved.repoRelativePath]);

      this.invalidateReadIndex(fromResolved.absolutePath);
      this.invalidateReadIndex(toResolved.absolutePath);

      const args = [
        "-c",
        "user.name=anchor-mcp",
        "-c",
        "user.email=anchor-mcp@local",
        "commit",
        ...buildAnchorCommitMessage({
          action: "rename",
          name: fromResolved.name,
          renameTo: toResolved.name,
          message: input.message,
          coAuthor: input.coAuthor,
        }),
      ];
      await this.git.raw(args);
      const version = await this.currentVersion();
      this.gitMetadata.recordRename(
        version,
        new Date().toISOString(),
        fromResolved.repoRelativePath,
        toResolved.repoRelativePath,
      );

      if (input.push) {
        await this.push().catch(() => undefined);
      }

      return version;
    });
  }

  async pullRebase(): Promise<void> {
    // Under the repo's exclusive lock so a pull can never interleave with a
    // commit's internals. Callers that must also be atomic with respect to
    // a SERVICE-level write (identity snapshot + duplicate check + commit)
    // additionally serialize on AnchorService's write lock — see AutoSync's
    // runExclusive wiring in src/runtime.ts.
    await this.lock.runExclusive(async () => {
      await this.git.pull(["--rebase"]);
      this.invalidateReadIndex();
    });
  }

  async push(): Promise<void> {
    await this.git.push();
  }

  async currentVersion(): Promise<string> {
    return this.git.revparse(["HEAD"]);
  }

  async hasFile(anchorName: string): Promise<boolean> {
    const resolved = this.resolveGitAnchor(anchorName);
    try {
      await stat(resolved.absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async readRaw(anchorName: string): Promise<string | undefined> {
    const resolved = this.resolveGitAnchor(anchorName);
    try {
      const stats = await stat(resolved.absolutePath);
      return await this.readFileCached(resolved.absolutePath, stats);
    } catch {
      return undefined;
    }
  }

  private resolveScope(scope: string): string {
    const clean = normalizeRelative(scope);
    const absolutePath = path.resolve(this.anchorRootPath, clean);
    assertInside(this.anchorRootPath, absolutePath);
    return absolutePath;
  }

  private async listAnchorFileCandidates(
    filter: {
      since?: string;
      category?: AnchorCategory;
      includeArchive?: boolean;
    } = {},
    sort: AnchorListSort,
  ): Promise<AnchorFileCandidate[]> {
    const files = await this.listMarkdownFiles(this.anchorRootPath);
    const candidates: AnchorFileCandidate[] = [];
    const sinceDate = filter.since ? new Date(filter.since) : undefined;

    for (const absolutePath of files) {
      const anchorRelativePath = toPosix(path.relative(this.anchorRootPath, absolutePath));
      const classification = classifyAnchorPath(anchorRelativePath);
      if (classification.kind !== "anchor") {
        continue;
      }

      if (classification.category === "archive" && !filter.includeArchive && filter.category !== "archive") {
        continue;
      }

      if (filter.category && classification.category !== filter.category) {
        continue;
      }

      const stats = await stat(absolutePath);
      if (sinceDate && stats.mtime < sinceDate) {
        continue;
      }

      const repoRelativePath = toPosix(path.relative(this.repoPath, absolutePath));
      const createdAt = sort === "created" ? await this.firstCommitDateForFileCached(repoRelativePath) : undefined;
      const createdTimeMs = Date.parse(createdAt ?? stats.birthtime.toISOString());
      candidates.push({
        absolutePath,
        anchorRelativePath,
        repoRelativePath,
        category: classification.category,
        projectSlug: classification.projectSlug,
        stats,
        ...(createdAt ? { createdAt } : {}),
        createdTimeMs: Number.isNaN(createdTimeMs) ? stats.birthtimeMs : createdTimeMs,
      });
    }

    return candidates.sort((left, right) => compareAnchorFileCandidates(left, right, sort));
  }

  private async anchorMetaFromCandidate(candidate: AnchorFileCandidate): Promise<AnchorMetaWithFrontmatter> {
    const cached = this.metaCache.get(candidate.absolutePath);
    if (cached && cached.mtimeMs === candidate.stats.mtimeMs && cached.size === candidate.stats.size) {
      return cached.row;
    }

    const content = await this.readFileCached(candidate.absolutePath, candidate.stats);
    const parsed = await this.cache.parse(candidate.absolutePath, content, candidate.stats);
    const createdAt =
      candidate.createdAt ??
      (await this.firstCommitDateForFileCached(candidate.repoRelativePath)) ??
      candidate.stats.birthtime.toISOString();
    const meta: AnchorMeta = {
      name: candidate.anchorRelativePath,
      path: candidate.repoRelativePath,
      category: candidate.category,
      title: parsed.title,
      project: parsed.frontmatter.project,
      projectSlug: candidate.projectSlug,
      type: parsed.frontmatter.type,
      tags: parsed.frontmatter.tags,
      summary: stringValue(parsed.frontmatter.summary),
      read_this_if: stringArrayValue(parsed.frontmatter.read_this_if),
      last_validated: parsed.frontmatter.last_validated,
      updatedAt: candidate.stats.mtime.toISOString(),
      createdAt,
      ...(numberValue(parsed.frontmatter.priority) !== undefined
        ? { priority: numberValue(parsed.frontmatter.priority) }
        : {}),
      origin: "repo",
    };

    const aliases = parseProjectAliases(parsed.frontmatter.aliases);
    if (aliases.length > 0) {
      meta.aliases = aliases;
    }

    if (isProjectRoadmapType(parsed.frontmatter.type)) {
      const analysis = analyzeRoadmapFromContent(content, { isProjectRoadmap: true });
      meta.acceptanceCriteria = {
        activeGoals: analysis.activeGoals,
        goalsWithCriteria: analysis.goalsWithCriteria,
        goalsMissingCriteria: analysis.goalsMissingCriteria,
        goalsMissingCriteriaIds:
          (analysis.goalsMissingCriteriaIds?.length ?? 0) > 0 ? analysis.goalsMissingCriteriaIds : undefined,
        goalsWithoutStableIds:
          (analysis.goalsWithoutStableIds?.length ?? 0) > 0 ? analysis.goalsWithoutStableIds : undefined,
        goalsDuplicateStableIds:
          (analysis.goalsDuplicateStableIds?.length ?? 0) > 0 ? analysis.goalsDuplicateStableIds : undefined,
        hasProposedCriteria: analysis.hasProposedCriteria,
        criteriaViolations: analysis.criteriaViolations.length > 0 ? analysis.criteriaViolations : undefined,
      };
    }

    if (isProjectMilestoneType(parsed.frontmatter.type)) {
      const status = parsed.frontmatter.status;
      const theme = stringValue(parsed.frontmatter.theme);
      const steelThread = parsed.frontmatter.steel_thread;
      const rel = parsed.frontmatter.relations as { goal_ids?: unknown } | undefined;
      const goalIds = Array.isArray(rel?.goal_ids)
        ? rel!.goal_ids.filter((item): item is string => typeof item === "string")
        : [];
      const milestoneId = normalizedMilestoneId(parsed.frontmatter.milestone_id);
      const sequence = normalizedSequenceFromFm(parsed.frontmatter);
      const schedule = normalizedScheduleFromFm(parsed.frontmatter);
      const tasks = normalizedTasksFromFm(parsed.frontmatter);
      if (
        typeof status === "string" &&
        ["proposed", "active", "shipped", "cancelled"].includes(status) &&
        theme.length > 0
      ) {
        meta.milestone = {
          status: status as MilestonePlannerMeta["status"],
          theme,
          steelThread: typeof steelThread === "string" && steelThread.length > 0 ? steelThread : undefined,
          goalIds,
          ...(milestoneId !== undefined ? { milestoneId } : {}),
          ...(sequence !== undefined ? { sequence } : {}),
          ...(schedule !== undefined ? { schedule } : {}),
          ...(tasks !== undefined ? { tasks } : {}),
        };
      }
    }

    const row = { meta, frontmatter: parsed.frontmatter };
    this.metaCache.set(candidate.absolutePath, {
      mtimeMs: candidate.stats.mtimeMs,
      size: candidate.stats.size,
      row,
    });
    return row;
  }

  private async readFileCached(absolutePath: string, knownStats?: Pick<Stats, "mtimeMs" | "size">): Promise<string> {
    const stats = knownStats ?? (await stat(absolutePath));
    const cached = this.fileContentCache.get(absolutePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      this.fileContentCache.delete(absolutePath);
      this.fileContentCache.set(absolutePath, cached);
      return cached.content;
    }

    const content = await readFile(absolutePath, "utf8");
    this.setFileContentCacheEntry(absolutePath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      content,
    });
    return content;
  }

  private setFileContentCacheEntry(absolutePath: string, entry: CachedFileContent): void {
    this.deleteFileContentCacheEntry(absolutePath);
    if (entry.size > MAX_CACHED_FILE_CONTENT_BYTES) {
      return;
    }

    this.fileContentCache.set(absolutePath, entry);
    this.fileContentCacheBytes += entry.size;
    this.trimFileContentCache();
  }

  private deleteFileContentCacheEntry(absolutePath: string): void {
    const cached = this.fileContentCache.get(absolutePath);
    if (!cached) {
      return;
    }
    this.fileContentCache.delete(absolutePath);
    this.fileContentCacheBytes = Math.max(0, this.fileContentCacheBytes - cached.size);
  }

  private trimFileContentCache(): void {
    while (this.fileContentCacheBytes > MAX_FILE_CONTENT_CACHE_BYTES) {
      const oldest = this.fileContentCache.keys().next().value;
      if (oldest === undefined) {
        this.fileContentCacheBytes = 0;
        return;
      }
      this.deleteFileContentCacheEntry(oldest);
    }
  }

  private invalidateReadIndex(absolutePath?: string): void {
    if (absolutePath) {
      this.cache.invalidate(absolutePath);
      this.deleteFileContentCacheEntry(absolutePath);
      this.metaCache.delete(absolutePath);
      // Git metadata is HEAD-keyed: per-path invalidation is unnecessary here
      // because the pending commit is folded in via recordCommit/recordRename,
      // and any out-of-band HEAD change is caught by the freshness check.
      return;
    }

    this.cache.invalidate();
    this.fileContentCache.clear();
    this.fileContentCacheBytes = 0;
    this.metaCache.clear();
    this.gitMetadata.invalidate();
  }

  private async listMarkdownFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const absolutePath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listMarkdownFiles(absolutePath)));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(absolutePath);
      }
    }

    return files;
  }

  private async firstCommitDateForFileCached(repoRelativePath: string): Promise<string | undefined> {
    return this.gitMetadata.firstCommitDateForPath(repoRelativePath);
  }

  static readonly PEOPLE_REGISTRY_FILE = "people-registry.json";

  private peopleRegistryRepoRelativePath(): string {
    const filePath = path.join(this.anchorRootPath, AnchorRepository.PEOPLE_REGISTRY_FILE);
    return toPosix(path.relative(this.repoPath, filePath));
  }

  async peopleRegistryCommit(): Promise<string | undefined> {
    return this.lastCommitForFile(this.peopleRegistryRepoRelativePath());
  }

  async readPeopleRegistryRaw(): Promise<unknown> {
    const filePath = path.join(this.anchorRootPath, AnchorRepository.PEOPLE_REGISTRY_FILE);
    try {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }

  async writePeopleRegistryRaw(
    registry: unknown,
    options: WritePeopleRegistryOptions = {},
  ): Promise<void> {
    const filePath = path.join(this.anchorRootPath, AnchorRepository.PEOPLE_REGISTRY_FILE);
    assertInside(this.anchorRootPath, filePath);
    const repoRelativePath = toPosix(path.relative(this.repoPath, filePath));
    const content = JSON.stringify(registry, null, 2) + "\n";

    await this.lock.runExclusive(async () => {
      if (options.expectedFileCommit !== undefined) {
        const current = await this.lastCommitForFile(repoRelativePath);
        if ((current ?? "") !== options.expectedFileCommit) {
          throw new PeopleRegistryConflictError(options.expectedFileCommit, current);
        }
      }
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, filePath);

      await this.git.add(repoRelativePath);
      const status = await this.git.status();
      if (!status.files.some((file) => file.path === repoRelativePath)) {
        return;
      }

      const commitMessage = options.message ?? "chore: update people registry";
      const args: string[] = [
        "-c", "user.name=anchor-mcp",
        "-c", "user.email=anchor-mcp@local",
        "commit",
        "-m", commitMessage,
      ];
      if (options.coAuthor) {
        args.push("-m", `Co-authored-by: ${options.coAuthor}`);
      }
      await this.git.raw(args);
      const version = await this.currentVersion().catch(() => undefined);
      if (version) {
        this.gitMetadata.recordCommit(version, new Date().toISOString(), [repoRelativePath]);
      }

      if (options.push) {
        await this.push().catch(() => undefined);
      }
    });
  }

  static readonly PROJECT_MAPPINGS_FILE = "project-mappings.json";

  private projectMappingsRepoRelativePath(): string {
    const filePath = path.join(this.anchorRootPath, AnchorRepository.PROJECT_MAPPINGS_FILE);
    return toPosix(path.relative(this.repoPath, filePath));
  }

  async projectMappingsCommit(): Promise<string | undefined> {
    return this.lastCommitForFile(this.projectMappingsRepoRelativePath());
  }

  async readProjectMappingsRaw(): Promise<unknown> {
    const filePath = path.join(this.anchorRootPath, AnchorRepository.PROJECT_MAPPINGS_FILE);
    try {
      const content = await readFile(filePath, "utf8");
      return JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }

  async writeProjectMappingsRaw(
    mappings: unknown,
    options: WriteProjectMappingsOptions = {},
  ): Promise<void> {
    const filePath = path.join(this.anchorRootPath, AnchorRepository.PROJECT_MAPPINGS_FILE);
    assertInside(this.anchorRootPath, filePath);
    const repoRelativePath = toPosix(path.relative(this.repoPath, filePath));
    const content = JSON.stringify(mappings, null, 2) + "\n";

    await this.lock.runExclusive(async () => {
      if (options.expectedFileCommit !== undefined) {
        const current = await this.lastCommitForFile(repoRelativePath);
        if ((current ?? "") !== options.expectedFileCommit) {
          throw new ProjectMappingsConflictError(options.expectedFileCommit, current);
        }
      }
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, filePath);

      await this.git.add(repoRelativePath);
      const status = await this.git.status();
      if (!status.files.some((file) => file.path === repoRelativePath)) {
        return;
      }

      const commitMessage = options.message ?? "chore: update project mappings";
      const args: string[] = [
        "-c", "user.name=anchor-mcp",
        "-c", "user.email=anchor-mcp@local",
        "commit",
        "-m", commitMessage,
      ];
      if (options.coAuthor) {
        args.push("-m", `Co-authored-by: ${options.coAuthor}`);
      }
      await this.git.raw(args);
      const version = await this.currentVersion().catch(() => undefined);
      if (version) {
        this.gitMetadata.recordCommit(version, new Date().toISOString(), [repoRelativePath]);
      }

      if (options.push) {
        await this.push().catch(() => undefined);
      }
    });
  }
}

function isNodeFsErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isExpectedMissingUpstreamError(error: unknown): boolean {
  const message = errorText(error);
  return (
    message.includes("no upstream configured") ||
    message.includes("HEAD does not point to a branch") ||
    message.includes("no such branch")
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isProjectRoadmapType(type: unknown): boolean {
  if (type === "project-roadmap") {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some((item) => item === "project-roadmap");
  }
  return false;
}

function compareAnchorFileCandidates(
  left: AnchorFileCandidate,
  right: AnchorFileCandidate,
  sort: AnchorListSort,
): number {
  if (sort === "updated") {
    return compareNumbersDescending(left.stats.mtimeMs, right.stats.mtimeMs) || left.anchorRelativePath.localeCompare(right.anchorRelativePath);
  }
  if (sort === "created") {
    return (
      compareNumbersDescending(left.createdTimeMs ?? left.stats.birthtimeMs, right.createdTimeMs ?? right.stats.birthtimeMs) ||
      left.anchorRelativePath.localeCompare(right.anchorRelativePath)
    );
  }
  if (sort === "priority") {
    return left.anchorRelativePath.localeCompare(right.anchorRelativePath);
  }
  return left.anchorRelativePath.localeCompare(right.anchorRelativePath);
}

function compareNumbersDescending(left: number, right: number): number {
  const leftValue = Number.isFinite(left) ? left : 0;
  const rightValue = Number.isFinite(right) ? right : 0;
  return rightValue - leftValue;
}

function compareAnchorMetasByPriority(left: AnchorMeta, right: AnchorMeta): number {
  const leftPriority = typeof left.priority === "number" && Number.isFinite(left.priority) ? left.priority : Number.POSITIVE_INFINITY;
  const rightPriority = typeof right.priority === "number" && Number.isFinite(right.priority) ? right.priority : Number.POSITIVE_INFINITY;
  return leftPriority === rightPriority
    ? left.name.localeCompare(right.name)
    : leftPriority < rightPriority
      ? -1
      : 1;
}

function anchorMatchesFrontmatterFilters(
  row: AnchorMetaWithFrontmatter,
  filter?: {
    project?: string;
    tag?: string;
    runtime?: string;
  },
): boolean {
  if (filter?.project && !anchorMatchesProject(row.meta, filter.project)) {
    return false;
  }

  if (filter?.tag && !frontmatterValueIncludes(row.meta.tags, filter.tag)) {
    return false;
  }

  if (filter?.runtime && !runtimeMatches(row.frontmatter, filter.runtime)) {
    return false;
  }

  return true;
}

function frontmatterValueIncludes(value: unknown, needle: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => String(item) === needle);
  }

  return String(value ?? "") === needle;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function runtimeMatches(frontmatter: Record<string, unknown>, runtime: string): boolean {
  return (
    frontmatterValueIncludes(frontmatter.runtime, runtime) ||
    frontmatterValueIncludes(frontmatter.runtimes, runtime) ||
    frontmatterValueIncludes(frontmatter.applies_to, runtime) ||
    frontmatterValueIncludes(frontmatter.tags, runtime)
  );
}
