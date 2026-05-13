import { readFile } from "node:fs/promises";

import {
  appendToAnchorSection,
  deleteAnchorSection,
  mergeAnchorFrontmatter,
  replaceAnchorSection,
} from "./anchorPatch.js";
import { buildContextRoot } from "./contextRoot.js";
import {
  canonicalBuiltInAnchorName,
  isBuiltInAnchorName,
  listBuiltInAnchorMetas,
  readBuiltInAnchor,
} from "./builtin/serverPolicy.js";
import {
  buildLoadContextAnchor,
  decodeLoadContextCursor,
  encodeLoadContextCursor,
  jsonByteLength,
  LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS,
  LOAD_CONTEXT_DEFAULT_LIMIT,
  LOAD_CONTEXT_DEFAULT_MAX_BYTES,
  shrinkLoadContextAnchorToFit,
  toNextCursorPayload,
} from "./loadContext.js";
import {
  buildContextBundlePlan,
  collectMilestoneAcceptanceMissingSignals,
  collectRoadmapAcceptanceMissingSignals,
} from "./contextPlanner.js";
import type { AnchorRepository } from "./git/repo.js";
import { listRoadmapGoalDetails } from "./roadmap/analyzeRoadmap.js";
import { getRelatedAnchors } from "./relations/index.js";
import { isProjectMilestoneType } from "./schema/milestoneTypes.js";
import { countCompletedRows, parseAnchor } from "./storage/markdown.js";
import {
  SERVER_RULES_DISCOVERY_CATEGORY,
  classifyAnchorPath,
  type AnchorCategory,
  type DiscoveryCategory,
} from "./taxonomy.js";
import type {
  AnchorContentMode,
  AnchorMeta,
  AnchorRead,
  AnchorVersion,
  CompactionReport,
  ContextRootFormat,
  ContextRootResult,
  ConflictStatus,
  LoadContextAnchor,
  LoadContextInput,
  LoadContextResult,
  LoadContextSelectionReason,
  PlanContextBundleInput,
  PlanContextBundleResult,
  SearchHit,
  ValidationViolation,
  WriteAnchorInput,
  WriteAnchorResult,
} from "./types.js";
import { runValidators } from "./validators/pipeline.js";

export class AnchorService {
  constructor(
    private readonly repo: AnchorRepository,
    private readonly options: {
      pushOnWrite: boolean;
      migrationWarnOnly: boolean;
    },
  ) {}

  private resolveDiscoveryAnchorName(name: string): string {
    if (isBuiltInAnchorName(name)) {
      return canonicalBuiltInAnchorName(name);
    }
    return this.repo.resolveAnchor(name).name;
  }

  /** Ensures `name` resolves to a normal taxonomy anchor (not CONTEXT-ROOT.md, not an invalid path). */
  private validateTaxonomyAnchorPath(name: string, label: string): ValidationViolation | null {
    const resolved = this.repo.resolveAnchor(name);
    const classification = classifyAnchorPath(resolved.name);
    if (classification.kind === "generated") {
      return {
        severity: "BLOCK",
        code: "generated_file_reserved",
        message: `${label}: CONTEXT-ROOT.md is generated; use writeContextRoot instead of structural anchor tools.`,
        path: resolved.name,
      };
    }
    if (classification.kind === "invalid") {
      return {
        severity: "BLOCK",
        code: "directory_taxonomy",
        message: `${label}: ${classification.reason}`,
        path: resolved.name,
      };
    }
    return null;
  }

  private async mergeDiscoveryAnchors(filter: {
    project?: string;
    category?: DiscoveryCategory;
    tag?: string;
    since?: string;
    includeArchive?: boolean;
    runtime?: string;
  } = {}): Promise<AnchorMeta[]> {
    const built = listBuiltInAnchorMetas();
    if (filter.category === SERVER_RULES_DISCOVERY_CATEGORY) {
      return built;
    }

    const { category, ...rest } = filter;
    const repoMetas = await this.repo.listAnchors({
      ...rest,
      category: category as AnchorCategory | undefined,
    });

    if (category) {
      return repoMetas;
    }

    return [...built, ...repoMetas];
  }

  listAnchors(filter?: {
    project?: string;
    tag?: string;
    since?: string;
    category?: DiscoveryCategory;
    includeArchive?: boolean;
    runtime?: string;
  }): Promise<AnchorMeta[]> {
    return this.mergeDiscoveryAnchors(filter);
  }

  async readAnchor(name: string, version?: string): Promise<AnchorRead> {
    const built = readBuiltInAnchor(name);
    if (built) {
      if (version && version !== "latest") {
        throw new Error("Built-in policy anchors only support the latest revision.");
      }
      return built;
    }
    return this.repo.readAnchor(name, version);
  }

  readAnchorBatch(names: string[]): Promise<AnchorRead[]> {
    return Promise.all(names.map((name) => this.readAnchor(name)));
  }

  searchAnchors(query: string, scope?: string): Promise<SearchHit[]> {
    return this.repo.searchAnchors(query, scope);
  }

  listVersions(name: string, limit?: number): Promise<AnchorVersion[]> {
    if (isBuiltInAnchorName(name)) {
      return Promise.resolve([]);
    }
    return this.repo.listVersions(name, limit);
  }

  diffAnchor(name: string, fromVersion: string, toVersion: string): Promise<string> {
    if (isBuiltInAnchorName(name)) {
      return Promise.resolve("");
    }
    return this.repo.diffAnchor(name, fromVersion, toVersion);
  }

  async writeAnchor(input: WriteAnchorInput): Promise<WriteAnchorResult> {
    if (isBuiltInAnchorName(input.name)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "reserved_builtin",
            message: "Built-in server policy anchors cannot be edited through writeAnchor.",
          },
        ],
        requiresApproval: false,
      };
    }
    const resolved = this.repo.resolveAnchor(input.name);
    if (input.expectedFileCommit) {
      const current = await this.repo.lastCommitForFile(resolved.repoRelativePath);
      if (current !== input.expectedFileCommit) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: "stale_base",
              message: `Anchor file commit mismatch: expected ${input.expectedFileCommit}, found ${current ?? "none"}. Re-read the anchor and retry.`,
            },
          ],
          requiresApproval: false,
        };
      }
    }
    const oldContent = await this.repo.readRaw(input.name);
    const violations = await runValidators({
      name: resolved.name,
      repoRelativePath: resolved.repoRelativePath,
      oldContent,
      newContent: input.content,
      repo: this.repo,
      migrationWarnOnly: this.options.migrationWarnOnly,
      approved: input.approved ?? false,
    });
    const blocks = violations.filter((violation) => violation.severity === "BLOCK");
    const warnings = violations.filter((violation) => violation.severity === "WARN");

    if (blocks.length > 0) {
      const approvalBlock = blocks.some((violation) => violation.code === "requires_approval");
      return {
        warnings: [...blocks, ...warnings],
        requiresApproval: approvalBlock,
      };
    }

    const version = await this.repo.commitAnchor({
      name: input.name,
      content: input.content,
      message: input.message,
      sectionsChanged: oldContent ? changedSections(oldContent, input.content) : undefined,
      lastValidatedChanged: oldContent ? lastValidatedChanged(oldContent, input.content) : undefined,
      coAuthor: input.coAuthor,
      push: this.options.pushOnWrite,
    });

    return { version, warnings };
  }

  async deleteAnchor(input: {
    name: string;
    approved?: boolean;
    message?: string;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    if (!input.approved) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message:
              "deleteAnchor removes an anchor from the working tree as a git commit; retry with approved: true after explicit user confirmation.",
          },
        ],
        requiresApproval: true,
      };
    }

    if (isBuiltInAnchorName(input.name)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "reserved_builtin",
            message: "Built-in server policy anchors cannot be deleted.",
          },
        ],
        requiresApproval: false,
      };
    }

    const pathViolation = this.validateTaxonomyAnchorPath(input.name, "deleteAnchor");
    if (pathViolation) {
      return { warnings: [pathViolation], requiresApproval: false };
    }

    const resolved = this.repo.resolveAnchor(input.name);
    if (input.expectedFileCommit) {
      const current = await this.repo.lastCommitForFile(resolved.repoRelativePath);
      if (current !== input.expectedFileCommit) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: "stale_base",
              message: `Anchor file commit mismatch: expected ${input.expectedFileCommit}, found ${current ?? "none"}. Re-read the anchor and retry.`,
            },
          ],
          requiresApproval: false,
        };
      }
    }

    const oldContent = await this.repo.readRaw(input.name);
    if (oldContent === undefined) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Anchor not found: ${input.name}`,
          },
        ],
        requiresApproval: false,
      };
    }

    try {
      const version = await this.repo.deleteAnchorFile({
        name: input.name,
        message: input.message,
        coAuthor: input.coAuthor,
        push: this.options.pushOnWrite,
      });
      return { version, warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "delete_anchor_failed",
            message,
          },
        ],
        requiresApproval: false,
      };
    }
  }

  async renameAnchor(input: {
    from: string;
    to: string;
    approved?: boolean;
    message?: string;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    if (!input.approved) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message:
              "renameAnchor moves an anchor path with git mv; retry with approved: true after explicit user confirmation.",
          },
        ],
        requiresApproval: true,
      };
    }

    if (isBuiltInAnchorName(input.from) || isBuiltInAnchorName(input.to)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "reserved_builtin",
            message: "Built-in server policy anchors cannot be renamed or used as rename targets.",
          },
        ],
        requiresApproval: false,
      };
    }

    const fromViolation = this.validateTaxonomyAnchorPath(input.from, "renameAnchor (from)");
    if (fromViolation) {
      return { warnings: [fromViolation], requiresApproval: false };
    }
    const toViolation = this.validateTaxonomyAnchorPath(input.to, "renameAnchor (to)");
    if (toViolation) {
      return { warnings: [toViolation], requiresApproval: false };
    }

    const fromResolved = this.repo.resolveAnchor(input.from);
    const toResolved = this.repo.resolveAnchor(input.to);
    if (fromResolved.name === toResolved.name) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "rename_noop",
            message: "renameAnchor requires different source and destination paths.",
          },
        ],
        requiresApproval: false,
      };
    }

    if (input.expectedFileCommit) {
      const current = await this.repo.lastCommitForFile(fromResolved.repoRelativePath);
      if (current !== input.expectedFileCommit) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: "stale_base",
              message: `Anchor file commit mismatch: expected ${input.expectedFileCommit}, found ${current ?? "none"}. Re-read the anchor and retry.`,
            },
          ],
          requiresApproval: false,
        };
      }
    }

    const oldContent = await this.repo.readRaw(input.from);
    if (oldContent === undefined) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Anchor not found: ${input.from}`,
          },
        ],
        requiresApproval: false,
      };
    }

    try {
      const version = await this.repo.renameAnchorFile({
        from: input.from,
        to: input.to,
        message: input.message,
        coAuthor: input.coAuthor,
        push: this.options.pushOnWrite,
      });
      return { version, warnings: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "rename_anchor_failed",
            message,
          },
        ],
        requiresApproval: false,
      };
    }
  }

  async updateAnchorFrontmatter(input: {
    name: string;
    updates: Record<string, unknown>;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    if (isBuiltInAnchorName(input.name)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "reserved_builtin",
            message: "Built-in server policy anchors cannot be edited.",
          },
        ],
      };
    }
    const oldContent = await this.repo.readRaw(input.name);
    if (oldContent === undefined) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Anchor not found: ${input.name}`,
          },
        ],
      };
    }
    const newContent = mergeAnchorFrontmatter(oldContent, input.updates);
    return this.writeAnchor({
      name: input.name,
      content: newContent,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async updateAnchorSection(input: {
    name: string;
    heading: string;
    content: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => replaceAnchorSection(old, input.heading, input.content),
    });
  }

  async appendToAnchorSection(input: {
    name: string;
    heading: string;
    content: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => appendToAnchorSection(old, input.heading, input.content),
    });
  }

  async deleteAnchorSection(input: {
    name: string;
    heading: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => deleteAnchorSection(old, input.heading),
    });
  }

  private async applyAnchorContentPatch(input: {
    name: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
    mutate: (oldContent: string) => string;
  }): Promise<WriteAnchorResult> {
    if (isBuiltInAnchorName(input.name)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "reserved_builtin",
            message: "Built-in server policy anchors cannot be edited.",
          },
        ],
      };
    }
    const oldContent = await this.repo.readRaw(input.name);
    if (oldContent === undefined) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Anchor not found: ${input.name}`,
          },
        ],
      };
    }
    let newContent: string;
    try {
      newContent = input.mutate(oldContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "section_not_found",
            message,
          },
        ],
      };
    }

    return this.writeAnchor({
      name: input.name,
      content: newContent,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async revertAnchor(name: string, toVersion: string, message?: string): Promise<{ newVersion?: string }> {
    if (isBuiltInAnchorName(name)) {
      return { newVersion: undefined };
    }
    const newVersion = await this.repo.revertAnchor(name, toVersion, message, this.options.pushOnWrite);
    return { newVersion };
  }

  async contextRoot(input: {
    project?: string;
    category?: DiscoveryCategory;
    tag?: string;
    runtime?: string;
    includeArchive?: boolean;
    format?: ContextRootFormat;
  } = {}): Promise<ContextRootResult> {
    const anchors = await this.mergeDiscoveryAnchors({
      project: input.project,
      category: input.category,
      tag: input.tag,
      runtime: input.runtime,
      includeArchive: input.includeArchive,
    });

    return buildContextRoot(anchors, { format: input.format });
  }

  /**
   * One-call discovery + multi-anchor read: same index metadata as `contextRoot`, plus anchor bodies
   * (full, excerpt, or none) with byte/limit caps and cursor continuation.
   */
  async loadContext(input: LoadContextInput = {}): Promise<LoadContextResult> {
    const decoded = input.cursor ? decodeLoadContextCursor(input.cursor) : undefined;

    const limit = Math.min(500, Math.max(1, decoded?.limit ?? input.limit ?? LOAD_CONTEXT_DEFAULT_LIMIT));
    const maxBytes = Math.max(1024, decoded?.maxBytes ?? input.maxBytes ?? LOAD_CONTEXT_DEFAULT_MAX_BYTES);
    const includeContent: AnchorContentMode = decoded?.includeContent ?? input.includeContent ?? "excerpt";
    const excerptChars = Math.max(100, decoded?.excerptChars ?? input.excerptChars ?? LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS);
    const format = decoded?.format ?? input.format ?? "both";

    const filter = {
      project: decoded?.filter.project ?? input.project,
      category: decoded?.filter.category ?? input.category,
      tag: decoded?.filter.tag ?? input.tag,
      runtime: decoded?.filter.runtime ?? input.runtime,
      includeArchive: decoded?.filter.includeArchive ?? input.includeArchive ?? false,
    };

    const offset = decoded?.offset ?? 0;

    let selectionReason: LoadContextSelectionReason;
    let orderedNames: string[];

    if (decoded) {
      selectionReason = decoded.selectionReason;
      if (selectionReason === "explicit_names") {
        orderedNames = decoded.explicitNames ?? [];
      } else {
        const metas = await this.mergeDiscoveryAnchors(filter);
        const ordered = buildContextRoot(metas, { format: "json" });
        orderedNames = ordered.entries.map((entry) => entry.name);
      }
    } else if (input.names && input.names.length > 0) {
      selectionReason = "explicit_names";
      orderedNames = dedupePreserveOrder(input.names.map((name) => this.resolveDiscoveryAnchorName(name)));
    } else {
      selectionReason = "filter";
      const metas = await this.mergeDiscoveryAnchors(filter);
      const ordered = buildContextRoot(metas, { format: "json" });
      orderedNames = ordered.entries.map((entry) => entry.name);
    }

    const totalMatching = orderedNames.length;

    let entriesMetas: AnchorMeta[];
    if (selectionReason === "explicit_names") {
      const all = await this.mergeDiscoveryAnchors({});
      const byName = new Map(all.map((meta) => [meta.name, meta]));
      entriesMetas = orderedNames.map((name) => byName.get(name)).filter((meta): meta is AnchorMeta => Boolean(meta));
    } else {
      entriesMetas = await this.mergeDiscoveryAnchors(filter);
    }

    const root = buildContextRoot(entriesMetas, { format });

    const anchors: LoadContextAnchor[] = [];
    let index = offset;
    let stoppedForBytes = false;

    while (index < orderedNames.length) {
      if (anchors.length >= limit) {
        break;
      }

      const read = await this.readAnchor(orderedNames[index]);
      let row = buildLoadContextAnchor(read, includeContent, excerptChars);
      const trial = [...anchors, row];
      const bytes = jsonByteLength(trial);

      if (bytes > maxBytes && anchors.length > 0) {
        stoppedForBytes = true;
        break;
      }

      if (bytes > maxBytes && anchors.length === 0) {
        row = shrinkLoadContextAnchorToFit(read, includeContent, excerptChars, maxBytes);
      }

      anchors.push(row);
      index += 1;
    }

    const returnedCount = anchors.length;
    const nextOffset = offset + returnedCount;
    const truncated = nextOffset < totalMatching || stoppedForBytes;

    const nextCursor = truncated
      ? encodeLoadContextCursor(
          toNextCursorPayload({
            selectionReason,
            filter,
            explicitNames: selectionReason === "explicit_names" ? orderedNames : undefined,
            offset: nextOffset,
            limit,
            maxBytes,
            includeContent,
            excerptChars,
            format,
          }),
        )
      : undefined;

    return {
      generatedAt: root.generatedAt,
      entries: root.entries,
      markdown: root.markdown,
      anchors,
      truncated,
      nextCursor,
      selectionReason,
      totalMatching,
      returnedCount,
    };
  }

  async planContextBundle(input: PlanContextBundleInput): Promise<PlanContextBundleResult> {
    const anchors = await this.repo.listAnchors({
      category:
        input.category && input.category !== SERVER_RULES_DISCOVERY_CATEGORY
          ? (input.category as AnchorCategory)
          : undefined,
      tag: input.tag,
      runtime: input.runtime,
      includeArchive: input.includeArchive,
    });

    const plan = buildContextBundlePlan(anchors, input);
    const builtNames = listBuiltInAnchorMetas().map((meta) => meta.name);
    const names = [...builtNames.filter((name) => !plan.loadContext.names.includes(name)), ...plan.loadContext.names];
    const roadmapSignals = collectRoadmapAcceptanceMissingSignals(anchors);
    const milestoneSignals = collectMilestoneAcceptanceMissingSignals(anchors);

    return {
      ...plan,
      missingContext: [...plan.missingContext, ...roadmapSignals, ...milestoneSignals],
      loadContext: { ...plan.loadContext, names },
    };
  }

  async listMilestones(project?: string): Promise<
    Array<{
      name: string;
      path: string;
      status: string;
      theme: string;
      goalIds: string[];
      milestoneId?: string;
      sequence?: number;
      displayId?: string;
    }>
  > {
    const anchors = await this.repo.listAnchors({ project });
    const rows = anchors
      .filter((anchor) => anchor.name.includes("/milestones/") && anchor.milestone)
      .map((anchor) => {
        const m = anchor.milestone!;
        let displayId: string | undefined;
        if (m.milestoneId === "backlog") {
          displayId = "backlog";
        } else if (m.sequence !== undefined) {
          displayId = `M${m.sequence}`;
        } else if (m.milestoneId !== undefined && /^M\d+$/.test(m.milestoneId)) {
          displayId = m.milestoneId;
        }
        return {
          name: anchor.name,
          path: anchor.path,
          status: m.status,
          theme: m.theme,
          goalIds: m.goalIds,
          ...(m.milestoneId !== undefined ? { milestoneId: m.milestoneId } : {}),
          ...(m.sequence !== undefined ? { sequence: m.sequence } : {}),
          ...(displayId !== undefined ? { displayId } : {}),
        };
      });

    const group = (row: { milestoneId?: string; sequence?: number }) => {
      if (row.milestoneId === "backlog") {
        return 2;
      }
      if (row.sequence !== undefined) {
        return 0;
      }
      return 1;
    };

    rows.sort((a, b) => {
      const ga = group(a);
      const gb = group(b);
      if (ga !== gb) {
        return ga - gb;
      }
      if (ga === 0) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }
      return a.name.localeCompare(b.name);
    });

    return rows;
  }

  async readMilestone(name: string): Promise<{
    milestone: AnchorRead;
    roadmap: AnchorRead | null;
    goals: Array<{ id: string; title: string; hasAcceptanceCriteria: boolean }>;
  }> {
    const milestone = await this.readAnchor(name);
    const classification = classifyAnchorPath(milestone.name);
    if (classification.kind !== "anchor" || classification.category !== "projects" || !milestone.name.includes("/milestones/")) {
      throw new Error(`readMilestone requires a project milestone anchor under projects/<slug>/milestones/: ${milestone.name}`);
    }
    if (!isProjectMilestoneType(milestone.frontmatter.type)) {
      throw new Error(`readMilestone requires type: project-milestone: ${milestone.name}`);
    }

    const slug = classification.kind === "anchor" ? classification.projectSlug : undefined;
    let roadmap: AnchorRead | null = null;
    const goalMap = new Map<string, { title: string; hasAcceptanceCriteria: boolean }>();
    if (slug) {
      const roadmapName = `projects/${slug}/${slug}-roadmap.md`;
      try {
        roadmap = await this.readAnchor(roadmapName);
        for (const row of listRoadmapGoalDetails(roadmap.content)) {
          if (row.id) {
            goalMap.set(row.id, { title: row.title, hasAcceptanceCriteria: row.hasAcceptanceCriteria });
          }
        }
      } catch {
        roadmap = null;
      }
    }

    const rel = milestone.frontmatter.relations as { goal_ids?: unknown } | undefined;
    const goalIds = Array.isArray(rel?.goal_ids)
      ? rel.goal_ids.filter((item): item is string => typeof item === "string")
      : [];

    const goals = goalIds.map((id) => {
      const row = goalMap.get(id);
      return {
        id,
        title: row?.title ?? "(unknown)",
        hasAcceptanceCriteria: row?.hasAcceptanceCriteria ?? false,
      };
    });

    return { milestone, roadmap, goals };
  }

  getRelated(name: string, kind?: string): Promise<AnchorRead[]> {
    return getRelatedAnchors(this.repo, name, kind);
  }

  async migrateRoadmapGoalIds(input: {
    project: string;
    startFrom?: number;
    message?: string;
    approved?: boolean;
  }): Promise<{
    roadmap: string;
    assigned: Array<{ from: string; to: string }>;
    version?: string;
    warnings: ValidationViolation[];
    noChangesNeeded: boolean;
  }> {
    const slug = input.project;
    const roadmapName = `projects/${slug}/${slug}-roadmap.md`;

    const roadmapContent = await this.repo.readRaw(roadmapName);
    if (!roadmapContent) {
      return {
        roadmap: roadmapName,
        assigned: [],
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Roadmap not found: ${roadmapName}`,
            path: roadmapName,
          },
        ],
        noChangesNeeded: false,
      };
    }

    const details = listRoadmapGoalDetails(roadmapContent);
    const bareGoals = details.filter((g) => !g.id);

    if (bareGoals.length === 0) {
      return { roadmap: roadmapName, assigned: [], warnings: [], noChangesNeeded: true };
    }

    const maxExisting = details
      .filter((g) => g.id)
      .map((g) => parseInt((g.id as string).replace(/^G-0*/, ""), 10))
      .filter((n) => !isNaN(n))
      .reduce((max, n) => Math.max(max, n), 0);

    let nextNum = input.startFrom ?? maxExisting + 1;

    const assigned: Array<{ from: string; to: string }> = [];
    const replacements = new Map<string, string>();

    for (const goal of bareGoals) {
      const id = `G-${String(nextNum).padStart(3, "0")}`;
      nextNum += 1;
      const oldHeading = `### ${goal.title}`;
      const newHeading = `### ${rewriteGoalTitle(goal.title, id)}`;
      replacements.set(oldHeading, newHeading);
      assigned.push({ from: oldHeading, to: newHeading });
    }

    const newContent = roadmapContent
      .split(/\r?\n/)
      .map((line) => {
        const replacement = replacements.get(line.trimEnd());
        return replacement !== undefined ? replacement : line;
      })
      .join("\n");

    const result = await this.writeAnchor({
      name: roadmapName,
      content: newContent,
      message:
        input.message ??
        `anchor: assign stable G-### ids to ${bareGoals.length} goal(s) in ${slug} roadmap`,
      approved: input.approved ?? false,
    });

    return {
      roadmap: roadmapName,
      assigned,
      version: result.version,
      warnings: result.warnings ?? [],
      noChangesNeeded: false,
    };
  }

  async writeContextRoot(input: {
    project?: string;
    category?: DiscoveryCategory;
    tag?: string;
    runtime?: string;
    includeArchive?: boolean;
  } = {}): Promise<{ version?: string; generatedAt: string; path: string }> {
    const root = await this.contextRoot({ ...input, format: "markdown" });
    const markdown = root.markdown ?? "";
    const version = await this.repo.commitGeneratedContextRoot(markdown, this.options.pushOnWrite);

    return {
      version,
      generatedAt: root.generatedAt,
      path: "CONTEXT-ROOT.md",
    };
  }

  conflictStatus(): Promise<ConflictStatus> {
    return this.repo.conflictStatus();
  }

  async compactionReport(scope?: string): Promise<CompactionReport> {
    const anchors = await this.repo.listAnchors();
    const signals: ValidationViolation[] = [];
    const suggestedMoves: string[] = [];

    for (const anchor of anchors) {
      if (scope && !anchor.name.startsWith(scope)) {
        continue;
      }

      const resolved = this.repo.resolveAnchor(anchor.name);
      const content = await readFile(resolved.absolutePath, "utf8");
      const lineCount = content.split(/\r?\n/).length;
      const completedRows = countCompletedRows(content);

      if (anchor.name.toLowerCase().includes("roadmap") && lineCount > 400) {
        signals.push({
          severity: "WARN",
          code: "roadmap_line_count",
          message: `Roadmap ${anchor.name} has ${lineCount} lines.`,
          path: anchor.path,
        });
        suggestedMoves.push(`Compact completed or stale entries in ${anchor.name}.`);
      }

      if (completedRows > 10) {
        signals.push({
          severity: "WARN",
          code: "completed_row_count",
          message: `${anchor.name} has ${completedRows} rows in ## Completed.`,
          path: anchor.path,
        });
        suggestedMoves.push(`Move older completed rows from ${anchor.name} into history or a shipped log.`);
      }
    }

    return { signals, suggestedMoves };
  }
}

function changedSections(oldContent: string, newContent: string): string[] {
  const oldSections = parseAnchor(oldContent).sections;
  const newSections = parseAnchor(newContent).sections;
  const names = new Set([...oldSections.keys(), ...newSections.keys()]);
  return [...names].filter((name) => oldSections.get(name) !== newSections.get(name)).sort();
}

function lastValidatedChanged(oldContent: string, newContent: string): boolean {
  return dateKey(parseAnchor(oldContent).frontmatter.last_validated) !== dateKey(parseAnchor(newContent).frontmatter.last_validated);
}

function dateKey(value: unknown): unknown {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

/**
 * Given a bare goal heading title (the text after `### `) and an assigned stable id,
 * returns the rewritten title in canonical `Goal G-### -- Description` form.
 *
 * Handles three input shapes:
 *   "Goal N -- Description"  → "Goal G-00N -- Description"
 *   "Goal N"                 → "Goal G-00N"
 *   "Goal Description"       → "Goal G-00N -- Description"
 */
function rewriteGoalTitle(title: string, id: string): string {
  const withNumAndDesc = title.match(/^Goal\s+\d+\s+--\s+(.+)$/i);
  if (withNumAndDesc) {
    return `Goal ${id} -- ${withNumAndDesc[1]}`;
  }
  if (/^Goal\s+\d+$/i.test(title)) {
    return `Goal ${id}`;
  }
  const withDesc = title.match(/^Goal\s+(.+)$/i);
  if (withDesc) {
    return `Goal ${id} -- ${withDesc[1]}`;
  }
  return `Goal ${id} -- ${title}`;
}

function dedupePreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}
