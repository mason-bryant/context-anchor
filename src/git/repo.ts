import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { simpleGit, type SimpleGit } from "simple-git";

import { AnchorParseCache } from "../storage/cache.js";
import { analyzeRoadmapFromContent } from "../roadmap/analyzeRoadmap.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath, CONTEXT_ROOT_FILE, type AnchorCategory } from "../taxonomy.js";
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

type ResolvedAnchorPath = {
  name: string;
  absolutePath: string;
  repoRelativePath: string;
  anchorRelativePath: string;
};

export type CommitAnchorInput = {
  name: string;
  content: string;
  message?: string;
  action?: "write" | "revert";
  sectionsChanged?: string[];
  lastValidatedChanged?: boolean;
  coAuthor?: string;
  push?: boolean;
};

export class AnchorRepository {
  readonly repoPath: string;
  readonly anchorRoot: string;
  readonly anchorRootPath: string;
  readonly git: SimpleGit;

  private readonly cache = new AnchorParseCache();
  private readonly lock = new AsyncLock();

  constructor(options: { repoPath: string; anchorRoot?: string }) {
    this.repoPath = path.resolve(options.repoPath);
    this.anchorRoot = normalizeRelative(options.anchorRoot ?? ".");
    this.anchorRootPath = path.resolve(this.repoPath, this.anchorRoot || ".");
    assertInside(this.repoPath, this.anchorRootPath);
    this.git = simpleGit({ baseDir: this.repoPath, binary: "git", maxConcurrentProcesses: 1 });
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
    const clean = normalizeRelative(name);
    if (!clean || clean === "." || clean.includes("\0")) {
      throw new Error("Anchor name must be a non-empty relative path");
    }

    const anchorRelativePath = clean.endsWith(".md") ? clean : `${clean}.md`;
    const absolutePath = path.resolve(this.anchorRootPath, anchorRelativePath);
    assertInside(this.anchorRootPath, absolutePath);

    return {
      name: anchorRelativePath,
      absolutePath,
      anchorRelativePath,
      repoRelativePath: toPosix(path.relative(this.repoPath, absolutePath)),
    };
  }

  async listAnchors(filter?: {
    project?: string;
    tag?: string;
    since?: string;
    category?: AnchorCategory;
    includeArchive?: boolean;
    runtime?: string;
  }): Promise<AnchorMeta[]> {
    const files = await this.listMarkdownFiles(this.anchorRootPath);
    const metas: AnchorMeta[] = [];

    for (const absolutePath of files) {
      const content = await readFile(absolutePath, "utf8");
      const parsed = await this.cache.parse(absolutePath, content);
      const stats = await stat(absolutePath);
      const anchorRelativePath = toPosix(path.relative(this.anchorRootPath, absolutePath));
      const classification = classifyAnchorPath(anchorRelativePath);
      if (classification.kind !== "anchor") {
        continue;
      }

      if (classification.category === "archive" && !filter?.includeArchive && filter?.category !== "archive") {
        continue;
      }

      if (filter?.category && classification.category !== filter.category) {
        continue;
      }

      const repoRelativePath = toPosix(path.relative(this.repoPath, absolutePath));
      const meta: AnchorMeta = {
        name: anchorRelativePath,
        path: repoRelativePath,
        category: classification.category,
        title: parsed.title,
        project: parsed.frontmatter.project,
        projectSlug: classification.projectSlug,
        type: parsed.frontmatter.type,
        tags: parsed.frontmatter.tags,
        summary: stringValue(parsed.frontmatter.summary),
        read_this_if: stringArrayValue(parsed.frontmatter.read_this_if),
        last_validated: parsed.frontmatter.last_validated,
        updatedAt: stats.mtime.toISOString(),
        origin: "repo",
      };

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
          criteriaViolations:
            analysis.criteriaViolations.length > 0 ? analysis.criteriaViolations : undefined,
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
        const milestoneIdRaw = parsed.frontmatter.milestone_id;
        const milestoneId =
          typeof milestoneIdRaw === "string" && milestoneIdRaw.length > 0 ? milestoneIdRaw : undefined;
        const seqRaw = parsed.frontmatter.sequence;
        let sequence: number | undefined;
        if (typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw > 0) {
          sequence = seqRaw;
        } else if (typeof seqRaw === "string" && /^\d+$/.test(seqRaw)) {
          const n = parseInt(seqRaw, 10);
          if (Number.isInteger(n) && n > 0) {
            sequence = n;
          }
        }
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
          };
        }
      }

      if (filter?.project && !frontmatterValueIncludes(meta.project, filter.project)) {
        continue;
      }

      if (filter?.tag && !frontmatterValueIncludes(meta.tags, filter.tag)) {
        continue;
      }

      if (filter?.runtime && !runtimeMatches(parsed.frontmatter, filter.runtime)) {
        continue;
      }

      if (filter?.since && stats.mtime < new Date(filter.since)) {
        continue;
      }

      metas.push(meta);
    }

    return metas.sort((left, right) => left.name.localeCompare(right.name));
  }

  async readAnchor(name: string, version?: string): Promise<AnchorRead> {
    const resolved = this.resolveAnchor(name);
    const isLatest = !version || version === "latest";
    const content = isLatest
      ? await readFile(resolved.absolutePath, "utf8")
      : await this.git.show([`${version}:${resolved.repoRelativePath}`]);
    const parsed = isLatest
      ? await this.cache.parse(resolved.absolutePath, content)
      : parseAnchor(content);

    const fileCommit = isLatest ? await this.lastCommitForFile(resolved.repoRelativePath) : undefined;

    return {
      name: resolved.name,
      path: resolved.repoRelativePath,
      content,
      frontmatter: parsed.frontmatter,
      version: isLatest ? await this.currentVersion().catch(() => undefined) : version,
      fileCommit,
    };
  }

  /** Latest commit hash that touched this repo-relative path (undefined if no commits yet). */
  async lastCommitForFile(repoRelativePath: string): Promise<string | undefined> {
    try {
      const log = await this.git.log({ file: repoRelativePath, maxCount: 1 });
      return log.latest?.hash;
    } catch {
      return undefined;
    }
  }

  async readAnchorBatch(names: string[]): Promise<AnchorRead[]> {
    return Promise.all(names.map((name) => this.readAnchor(name)));
  }

  async searchAnchors(query: string, scope?: string): Promise<SearchHit[]> {
    const needle = query.toLowerCase();
    const files = await this.listMarkdownFiles(scope ? this.resolveScope(scope) : this.anchorRootPath);
    const hits: SearchHit[] = [];

    for (const absolutePath of files) {
      const content = await readFile(absolutePath, "utf8");
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
      const resolved = this.resolveAnchor(input.name);
      await mkdir(path.dirname(resolved.absolutePath), { recursive: true });

      const tmpPath = `${resolved.absolutePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, input.content, "utf8");
      await rename(tmpPath, resolved.absolutePath);
      this.cache.invalidate(resolved.absolutePath);

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

      if (input.push) {
        await this.push().catch(() => undefined);
      }

      return this.currentVersion();
    });
  }

  async commitGeneratedContextRoot(content: string, push?: boolean): Promise<string | undefined> {
    return this.lock.runExclusive(async () => {
      const absolutePath = path.resolve(this.anchorRootPath, CONTEXT_ROOT_FILE);
      assertInside(this.anchorRootPath, absolutePath);

      const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, content, "utf8");
      await rename(tmpPath, absolutePath);
      this.cache.invalidate(absolutePath);

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

      if (push) {
        await this.push().catch(() => undefined);
      }

      return this.currentVersion();
    });
  }

  async listVersions(name: string, limit = 20): Promise<AnchorVersion[]> {
    const resolved = this.resolveAnchor(name);
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
    const resolved = this.resolveAnchor(name);
    return this.git.diff([`${fromVersion}..${toVersion}`, "--", resolved.repoRelativePath]);
  }

  async revertAnchor(name: string, toVersion: string, message?: string, push?: boolean): Promise<string | undefined> {
    const resolved = this.resolveAnchor(name);
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

  async pullRebase(): Promise<void> {
    await this.git.pull(["--rebase"]);
    this.cache.invalidate();
  }

  async push(): Promise<void> {
    await this.git.push();
  }

  async currentVersion(): Promise<string> {
    return this.git.revparse(["HEAD"]);
  }

  async hasFile(anchorName: string): Promise<boolean> {
    const resolved = this.resolveAnchor(anchorName);
    try {
      await stat(resolved.absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async readRaw(anchorName: string): Promise<string | undefined> {
    const resolved = this.resolveAnchor(anchorName);
    try {
      return await readFile(resolved.absolutePath, "utf8");
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

function runtimeMatches(frontmatter: Record<string, unknown>, runtime: string): boolean {
  return (
    frontmatterValueIncludes(frontmatter.runtime, runtime) ||
    frontmatterValueIncludes(frontmatter.runtimes, runtime) ||
    frontmatterValueIncludes(frontmatter.applies_to, runtime) ||
    frontmatterValueIncludes(frontmatter.tags, runtime)
  );
}
