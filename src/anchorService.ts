import { randomBytes } from "node:crypto";
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
import { BM25Index } from "./bm25.js";
import {
  buildLoadContextAnchor,
  decodeLoadContextCursor,
  encodeLoadContextCursor,
  jsonByteLength,
  LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS,
  LOAD_CONTEXT_DEFAULT_LIMIT,
  LOAD_CONTEXT_DEFAULT_MAX_BYTES,
  shrinkLoadContextAnchorToFit,
  anchorBodyForSearchIndex,
  stripFrontMatterForExcerpt,
  toNextCursorPayload,
} from "./loadContext.js";
import {
  buildContextBundlePlan,
  collectMilestoneAcceptanceMissingSignals,
  collectRoadmapAcceptanceMissingSignals,
} from "./contextPlanner.js";
import type { AnchorListPage, AnchorListSort, AnchorRepository } from "./git/repo.js";
import { listRoadmapGoalDetails } from "./roadmap/analyzeRoadmap.js";
import {
  renderProjectUpdate as renderProjectUpdateFromSnapshot,
  sortUpdateTasks,
  toProjectUpdateTask,
} from "./projectUpdate.js";
import {
  addProposalReview,
  appendProposalRecord,
  applyProposalOperations,
  createProposalLedgerContent,
  isProposedChangesType,
  normalizeProposalScope,
  parseProposedChanges,
  proposalScopeMatchesLedger,
  proposedChangeLedgerName,
  renderProposalDiff,
  updateProposalRecord,
  validateProposalTarget,
} from "./proposedChanges.js";
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
  StartTaskInput,
  StartTaskResult,
  ApplyProposedChangeInput,
  ApplyProposedChangeResult,
  ProjectFilterResolution,
  ProjectUpdateMilestone,
  ProjectUpdateMilestoneStatus,
  ProjectUpdateSnapshot,
  ProjectUpdateSnapshotInput,
  ProposeChangeInput,
  ProposeChangeResult,
  ProposedChangeListInput,
  ProposedChangeListItem,
  ProposedChangePreview,
  ProposedChangeRead,
  ProposedChangeRecord,
  ProposedChangeScope,
  ProposedChangeStatus,
  ReviewProposedChangeInput,
  MilestoneScheduleMeta,
  MilestoneTaskMeta,
  RenderedProjectUpdate,
  RenderProjectUpdateInput,
  SearchHit,
  TaskDueRow,
  ListTasksDueInput,
  CreateTaskInput,
  CreateTaskResult,
  CompleteTaskInput,
  DeleteTaskInput,
  UpdateProjectPriorityInput,
  UpdateTaskDueInput,
  ValidationViolation,
  WriteAnchorInput,
  WriteAnchorResult,
  Person,
  Team,
  TeamWithMembers,
  PeopleRegistry,
  PeopleRegistryWithCommit,
  WritePeopleRegistryInput,
} from "./types.js";
import {
  buildProjectAliasIndex,
  resolveProjectFilter,
} from "./projectAliases.js";
import { buildPeopleIndex, parsePeopleRegistry } from "./peopleRegistry.js";
import { runValidators } from "./validators/pipeline.js";

const BM25_INDEX_READ_CONCURRENCY = 8;

type MilestoneListRow = {
  name: string;
  path: string;
  status: string;
  theme: string;
  steelThread?: string;
  goalIds: string[];
  milestoneId?: string;
  sequence?: number;
  displayId?: string;
  schedule?: MilestoneScheduleMeta;
  tasks?: MilestoneTaskMeta[];
};

export class AnchorService {
  private _peopleRegistry: PeopleRegistry | undefined;

  constructor(
    private readonly repo: AnchorRepository,
    private readonly options: {
      pushOnWrite: boolean;
      migrationWarnOnly: boolean;
      staleAfterDays: number;
    },
  ) {}

  private async loadPeopleRegistry(): Promise<PeopleRegistry> {
    if (this._peopleRegistry !== undefined) {
      return this._peopleRegistry;
    }
    const raw = await this.repo.readPeopleRegistryRaw();
    this._peopleRegistry = parsePeopleRegistry(raw);
    return this._peopleRegistry;
  }

  private invalidatePeopleRegistry(): void {
    this._peopleRegistry = undefined;
  }

  async listPeople(team?: string): Promise<{ people: Person[] }> {
    const registry = await this.loadPeopleRegistry();
    if (!team) {
      return { people: registry.people };
    }
    const needle = team.toLowerCase();
    const index = buildPeopleIndex(registry);
    const resolvedTeam = index.getTeam(needle);
    const teamId = resolvedTeam?.id ?? team;
    const members = index.getTeamMembers(teamId);
    return { people: members };
  }

  async readPerson(id: string): Promise<{ person: Person | null }> {
    const registry = await this.loadPeopleRegistry();
    const index = buildPeopleIndex(registry);
    // Prefer an exact id match so a colliding alias/email never shadows the
    // person whose canonical id was requested; fall back to fuzzy resolution.
    const person = index.getPersonById(id) ?? index.getPerson(id) ?? null;
    return { person };
  }

  async listTeams(): Promise<{ teams: Team[] }> {
    const registry = await this.loadPeopleRegistry();
    return { teams: registry.teams };
  }

  async readTeam(id: string): Promise<{ team: TeamWithMembers | null }> {
    const registry = await this.loadPeopleRegistry();
    const index = buildPeopleIndex(registry);
    // Exact id wins over synonym/handle matches for a requested id.
    const team = index.getTeamById(id) ?? index.getTeam(id);
    if (!team) return { team: null };
    const members = index.getTeamMembers(team.id);
    return { team: { ...team, members } };
  }

  async writePeopleRegistry(input: WritePeopleRegistryInput): Promise<void> {
    const normalized = parsePeopleRegistry(input.registry);
    await this.repo.writePeopleRegistryRaw(normalized, {
      message: input.message,
      coAuthor: input.coAuthor,
      push: this.options.pushOnWrite,
      expectedFileCommit: input.expectedFileCommit,
    });
    this.invalidatePeopleRegistry();
  }

  async getPeopleRegistry(): Promise<PeopleRegistryWithCommit> {
    const registry = await this.loadPeopleRegistry();
    const fileCommit = await this.repo.peopleRegistryCommit();
    return { ...registry, ...(fileCommit ? { fileCommit } : {}) };
  }

  private async buildBM25SearchIndex(anchors: AnchorMeta[]): Promise<{
    index: BM25Index;
    bodyCharCounts: Map<string, number>;
  }> {
    const bm25Index = new BM25Index();
    const bodyCharCounts = new Map<string, number>();
    let nextAnchorIndex = 0;
    const workerCount = Math.min(BM25_INDEX_READ_CONCURRENCY, anchors.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        for (;;) {
          const anchor = anchors[nextAnchorIndex];
          nextAnchorIndex += 1;
          if (!anchor) {
            return;
          }

          try {
            const read = await this.readAnchor(anchor.name);
            bodyCharCounts.set(anchor.name, stripFrontMatterForExcerpt(read.content).length);
            bm25Index.add({
              id: anchor.name,
              text: anchorBodyForSearchIndex(read.content),
            });
          } catch {
            // Skip unreadable anchors during BM25 indexing.
          }
        }
      }),
    );

    return { index: bm25Index, bodyCharCounts };
  }

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

  private async resolveProjectFilter(requested?: string): Promise<{
    projectFilter?: ProjectFilterResolution;
    effectiveProject?: string;
  }> {
    if (!requested?.trim()) {
      return {};
    }

    const allMetas = await this.repo.listAnchors({});
    const index = buildProjectAliasIndex(allMetas);
    const projectFilter = resolveProjectFilter(requested, allMetas, index);
    if (!projectFilter) {
      return {};
    }

    const effectiveProject =
      projectFilter.via === "unresolved" ? projectFilter.requested : projectFilter.resolved;
    return { projectFilter, effectiveProject };
  }

  private async mergeDiscoveryAnchors(filter: {
    project?: string;
    category?: DiscoveryCategory;
    tag?: string;
    since?: string;
    includeArchive?: boolean;
    runtime?: string;
  } = {}): Promise<AnchorMeta[]> {
    const { anchors } = await this.mergeDiscoveryAnchorsWithResolution(filter);
    return anchors;
  }

  private async mergeDiscoveryAnchorsWithResolution(filter: {
    project?: string;
    category?: DiscoveryCategory;
    tag?: string;
    since?: string;
    includeArchive?: boolean;
    runtime?: string;
  } = {}): Promise<{ anchors: AnchorMeta[]; projectFilter?: ProjectFilterResolution }> {
    const { projectFilter, effectiveProject } = await this.resolveProjectFilter(filter.project);
    const built = listBuiltInAnchorMetas();
    if (filter.category === SERVER_RULES_DISCOVERY_CATEGORY) {
      return { anchors: built, projectFilter };
    }

    const { category, project: _project, ...rest } = filter;
    const repoMetas = await this.repo.listAnchors({
      ...rest,
      ...(effectiveProject ? { project: effectiveProject } : {}),
      category: category as AnchorCategory | undefined,
    });

    if (category) {
      return { anchors: repoMetas, projectFilter };
    }

    return { anchors: [...built, ...repoMetas], projectFilter };
  }

  async listAnchorsDiscovery(filter?: {
    project?: string;
    tag?: string;
    since?: string;
    category?: DiscoveryCategory;
    includeArchive?: boolean;
    runtime?: string;
  }): Promise<{ anchors: AnchorMeta[]; projectFilter?: ProjectFilterResolution }> {
    return this.mergeDiscoveryAnchorsWithResolution(filter);
  }

  async listAnchorsDiscoveryPage(
    filter: {
      project?: string;
      tag?: string;
      since?: string;
      category?: DiscoveryCategory;
      includeArchive?: boolean;
      runtime?: string;
    } = {},
    page: { sort: AnchorListSort; offset?: number; limit?: number },
  ): Promise<AnchorListPage & { projectFilter?: ProjectFilterResolution }> {
    const { projectFilter, effectiveProject } = await this.resolveProjectFilter(filter.project);
    const built = listBuiltInAnchorMetas();

    if (filter.category === SERVER_RULES_DISCOVERY_CATEGORY) {
      return {
        ...pageAnchorMetas(built, page),
        ...(projectFilter ? { projectFilter } : {}),
      };
    }

    const { category, project: _project, ...rest } = filter;
    const repoFilter = {
      ...rest,
      ...(effectiveProject ? { project: effectiveProject } : {}),
      category: category as AnchorCategory | undefined,
    };

    if (category) {
      const repoPage = await this.repo.listAnchorsPage(repoFilter, page);
      return {
        ...repoPage,
        ...(projectFilter ? { projectFilter } : {}),
      };
    }

    const repoLimit = page.limit === undefined ? undefined : (page.offset ?? 0) + page.limit;
    const repoPage = await this.repo.listAnchorsPage(repoFilter, {
      sort: page.sort,
      offset: 0,
      ...(repoLimit !== undefined ? { limit: repoLimit } : {}),
    });
    const merged = pageAnchorMetas([...built, ...repoPage.anchors], page);
    const total = repoPage.total === undefined ? undefined : repoPage.total + built.length;
    const nextOffset =
      page.limit === undefined
        ? undefined
        : total !== undefined
          ? (page.offset ?? 0) + page.limit >= total
            ? undefined
            : (page.offset ?? 0) + page.limit
          : repoPage.nextOffset !== undefined || merged.anchors.length >= page.limit
            ? (page.offset ?? 0) + page.limit
            : undefined;

    return {
      ...merged,
      ...(total !== undefined ? { total } : {}),
      ...(nextOffset !== undefined ? { nextOffset } : {}),
      ...(projectFilter ? { projectFilter } : {}),
    };
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

  async updateProjectPriority(input: UpdateProjectPriorityInput): Promise<WriteAnchorResult> {
    if (!input.approved) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message:
              "Project priority changes require an explicit approved human request. Retry with approved: true after user approval.",
          },
        ],
        requiresApproval: true,
      };
    }

    const priorityViolation = validatePriorityValue(input.priority);
    if (priorityViolation) {
      return { warnings: [priorityViolation], requiresApproval: false };
    }

    const name = await this.resolveProjectPriorityAnchorName(input);
    if (!name) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "project_priority_anchor_not_found",
            message:
              "No project anchor was found for priority storage. Pass name for the project anchor to update, or create a project anchor first.",
          },
        ],
        requiresApproval: false,
      };
    }

    return this.updateAnchorFrontmatter({
      name,
      updates: { priority: input.priority },
      message: input.message,
      approved: true,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  private async resolveProjectPriorityAnchorName(input: UpdateProjectPriorityInput): Promise<string | undefined> {
    if (input.name?.trim()) {
      const resolved = this.repo.resolveAnchor(input.name).name;
      const classification = classifyAnchorPath(resolved);
      if (classification.kind !== "anchor" || classification.category !== "projects" || resolved.includes("/milestones/")) {
        return undefined;
      }
      if (input.project?.trim()) {
        const { effectiveProject } = await this.resolveProjectFilter(input.project);
        const project = effectiveProject ?? input.project.trim();
        const meta = (await this.repo.listAnchors({ project, includeArchive: true })).find((anchor) => anchor.name === resolved);
        return meta ? resolved : undefined;
      }
      return resolved;
    }

    if (!input.project?.trim()) {
      return undefined;
    }

    const { effectiveProject } = await this.resolveProjectFilter(input.project);
    const project = effectiveProject ?? input.project.trim();
    const metas = await this.repo.listAnchors({ project, includeArchive: true });
    const candidates = metas.filter((meta) => {
      const classification = classifyAnchorPath(meta.name);
      return classification.kind === "anchor" && classification.category === "projects" && classification.projectSlug === project;
    });

    return (
      candidates.find((meta) => meta.name === `projects/${project}/${project}.md`)?.name ??
      candidates.find((meta) => !meta.name.includes("/milestones/") && !frontmatterTypeIncludes(meta.type, "project-roadmap") && !isProposedChangesType(meta.type))
        ?.name ??
      candidates.find((meta) => !meta.name.includes("/milestones/") && frontmatterTypeIncludes(meta.type, "project-roadmap"))?.name
    );
  }

  async updateTaskDue(input: UpdateTaskDueInput): Promise<WriteAnchorResult> {
    if (input.due !== null && !input.dateConfidence) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_date_confidence",
            message: "date_confidence is required when due is set. Pass one of: committed, internal_goal, estimated.",
          },
        ],
      };
    }

    const rawContent = await this.repo.readRaw(input.name);
    if (rawContent === undefined) {
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

    const parsed = parseAnchor(rawContent);
    const rawTasks = parsed.frontmatter.tasks;
    if (!Array.isArray(rawTasks)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "no_tasks",
            message: `Anchor has no tasks array: ${input.name}`,
          },
        ],
      };
    }

    const taskIdx = rawTasks.findIndex(
      (t): t is Record<string, unknown> =>
        !!t && typeof t === "object" && !Array.isArray(t) && (t as Record<string, unknown>).id === input.taskId,
    );

    if (taskIdx === -1) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "task_not_found",
            message: `Task "${input.taskId}" not found in ${input.name}`,
          },
        ],
      };
    }

    const updatedTasks = rawTasks.map((t, i) => {
      if (i !== taskIdx || typeof t !== "object" || !t) return t;
      const task = { ...(t as Record<string, unknown>) };
      if (input.due === null) {
        delete task.due;
        delete task.date_confidence;
      } else {
        task.due = input.due;
        task.date_confidence = input.dateConfidence;
      }
      return task;
    });

    return this.updateAnchorFrontmatter({
      name: input.name,
      updates: { tasks: updatedTasks },
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  private static blockResult(code: string, message: string): WriteAnchorResult {
    return { warnings: [{ severity: "BLOCK", code, message }] };
  }

  private static today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Read a milestone anchor's raw front-matter tasks array. */
  private async readRawTasks(name: string): Promise<Record<string, unknown>[] | undefined> {
    const rawContent = await this.repo.readRaw(name);
    if (rawContent === undefined) return undefined;
    const parsed = parseAnchor(rawContent);
    const rawTasks = parsed.frontmatter.tasks;
    return Array.isArray(rawTasks) ? (rawTasks as Record<string, unknown>[]) : [];
  }

  /** Next project-wide task id (`T-<n>`), scanning every milestone so ids stay unique as tasks move. */
  private async nextTaskId(project?: string): Promise<string> {
    const milestones = await this.listMilestones(project);
    let max = 0;
    for (const milestone of milestones) {
      for (const task of milestone.tasks ?? []) {
        const match = /^T-(\d{1,6})$/.exec(task.id);
        if (match) max = Math.max(max, Number(match[1]));
      }
    }
    return `T-${max + 1}`;
  }

  /** Locate a task by id: within an explicit milestone anchor, or across a project's milestones. */
  private async findTaskMilestone(
    taskId: string,
    options: { name?: string; project?: string },
  ): Promise<string | undefined> {
    if (options.name) {
      const tasks = await this.readRawTasks(options.name);
      return tasks?.some((t) => t.id === taskId) ? options.name : undefined;
    }
    const milestones = await this.listMilestones(options.project);
    const match = milestones.find((m) => (m.tasks ?? []).some((t) => t.id === taskId));
    return match?.name;
  }

  /** Resolve (and lazily create) the backlog milestone anchor for a project slug. */
  private async ensureBacklogMilestone(projectSlug: string): Promise<string> {
    const name = `projects/${projectSlug}/milestones/backlog.md`;
    const existing = await this.repo.readRaw(name);
    if (existing !== undefined) return name;

    const content = `---
project:
  - ${projectSlug}
type: project-milestone
schema_version: 1
tags:
  - milestone
summary: "Backlog tasks for ${projectSlug}."
read_this_if:
  - "You are triaging or scheduling unplanned ${projectSlug} tasks."
last_validated: ${AnchorService.today()}
milestone_id: backlog
theme: "Backlog"
status: active
relations:
  goal_ids: []
tasks: []
---

# Backlog

## Current State

- Backlog of unscheduled tasks for ${projectSlug}.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`;
    const result = await this.writeAnchor({
      name,
      content,
      message: `chore: create backlog milestone for ${projectSlug}`,
    });
    if (hasBlock(result.warnings)) {
      throw new Error(`Failed to create backlog milestone for ${projectSlug}: ${blockMessages(result.warnings)}`);
    }
    return name;
  }

  async createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
    const title = input.title?.trim();
    if (!title) {
      return AnchorService.blockResult("missing_title", "title is required to create a task.");
    }
    if (input.due && !input.dateConfidence) {
      return AnchorService.blockResult(
        "missing_date_confidence",
        "date_confidence is required when due is set. Pass one of: committed, internal_goal, estimated.",
      );
    }

    const { effectiveProject } = await this.resolveProjectFilter(input.project);
    const projectSlug = effectiveProject ?? input.project;
    if (!projectSlug) {
      return AnchorService.blockResult("missing_project", "project is required to create a task.");
    }

    let targetName: string;
    try {
      targetName = input.milestone ?? (await this.ensureBacklogMilestone(projectSlug));
    } catch (error) {
      return AnchorService.blockResult("backlog_create_failed", error instanceof Error ? error.message : String(error));
    }

    const rawTasks = await this.readRawTasks(targetName);
    if (rawTasks === undefined) {
      return AnchorService.blockResult("missing_anchor", `Milestone anchor not found: ${targetName}`);
    }

    const status = input.status ?? "todo";
    const taskId = await this.nextTaskId(projectSlug);
    const task: Record<string, unknown> = { id: taskId, title, status };
    if (input.owner?.trim()) task.owner = input.owner.trim();
    if (input.goalIds && input.goalIds.length > 0) task.goal_ids = input.goalIds;
    if (input.due) {
      task.due = input.due;
      task.date_confidence = input.dateConfidence;
    }
    if (status === "done") {
      task.completed_on = AnchorService.today();
    }
    if (input.notes?.trim()) task.notes = input.notes.trim();

    const result = await this.updateAnchorFrontmatter({
      name: targetName,
      updates: { tasks: [...rawTasks, task] },
      message: input.message ?? `chore: add task ${taskId} to ${targetName}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
    });

    return {
      ...result,
      ...(hasBlock(result.warnings) ? {} : { taskId, milestoneName: targetName }),
    };
  }

  async completeTask(input: CompleteTaskInput): Promise<WriteAnchorResult> {
    const name = await this.findTaskMilestone(input.taskId, { name: input.name, project: input.project });
    if (!name) {
      return AnchorService.blockResult("task_not_found", `Task "${input.taskId}" not found.`);
    }
    const rawTasks = await this.readRawTasks(name);
    if (rawTasks === undefined) {
      return AnchorService.blockResult("missing_anchor", `Milestone anchor not found: ${name}`);
    }
    const completedOn = input.completedOn ?? AnchorService.today();
    const updatedTasks = rawTasks.map((t) =>
      t.id === input.taskId ? { ...t, status: "done", completed_on: completedOn } : t,
    );

    return this.updateAnchorFrontmatter({
      name,
      updates: { tasks: updatedTasks },
      message: input.message ?? `chore: complete task ${input.taskId}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async deleteTask(input: DeleteTaskInput): Promise<WriteAnchorResult> {
    const name = await this.findTaskMilestone(input.taskId, { name: input.name, project: input.project });
    if (!name) {
      return AnchorService.blockResult("task_not_found", `Task "${input.taskId}" not found.`);
    }
    const rawTasks = await this.readRawTasks(name);
    if (rawTasks === undefined) {
      return AnchorService.blockResult("missing_anchor", `Milestone anchor not found: ${name}`);
    }
    const updatedTasks = rawTasks.filter((t) => t.id !== input.taskId);

    return this.updateAnchorFrontmatter({
      name,
      updates: { tasks: updatedTasks },
      message: input.message ?? `chore: delete task ${input.taskId}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async listTasksDue(input: ListTasksDueInput): Promise<{ tasks: TaskDueRow[] }> {
    const milestones = await this.listMilestones(input.project);
    const DEFAULT_STATUSES = new Set(["active", "todo", "blocked"]);
    const statusFilter = input.status && input.status.length > 0 ? new Set(input.status) : DEFAULT_STATUSES;

    const registry = await this.loadPeopleRegistry();
    const peopleIndex = buildPeopleIndex(registry);

    const ownerFilter = input.owner ? peopleIndex.resolveOwner(input.owner) : undefined;
    const ownerFilterRaw = input.owner?.toLowerCase().trim();

    const rows: TaskDueRow[] = [];

    for (const milestone of milestones) {
      if (!milestone.tasks) continue;

      const classification = classifyAnchorPath(milestone.name);
      const projectSlug = classification.kind === "anchor" ? classification.projectSlug : undefined;

      for (const task of milestone.tasks) {
        if (!statusFilter.has(task.status)) continue;

        if (input.unassigned && task.owner && task.owner.trim().length > 0) continue;

        if (input.noDue) {
          if (task.due) continue;
        } else {
          if (input.dueBefore && task.due && task.due >= input.dueBefore) continue;
          if (input.dueAfter && (!task.due || task.due < input.dueAfter)) continue;
        }

        const taskOwnerResolved = task.owner ? peopleIndex.resolveOwner(task.owner) : undefined;

        if (ownerFilterRaw !== undefined) {
          if (ownerFilter) {
            if (!taskOwnerResolved) continue;
            if (ownerFilter.kind === "person" && taskOwnerResolved.kind === "person") {
              if (ownerFilter.person.id !== taskOwnerResolved.person.id) continue;
            } else if (ownerFilter.kind === "team" && taskOwnerResolved.kind === "team") {
              if (ownerFilter.team.id !== taskOwnerResolved.team.id) continue;
            } else {
              continue;
            }
          } else {
            if (!task.owner || task.owner.toLowerCase().trim() !== ownerFilterRaw) continue;
          }
        }

        rows.push({
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
          ...(task.owner ? { taskOwner: task.owner } : {}),
          ...(task.due ? { due: task.due } : {}),
          ...(task.dateConfidence ? { dateConfidence: task.dateConfidence } : {}),
          ...(task.notes ? { notes: task.notes } : {}),
          milestoneName: milestone.name,
          ...(milestone.displayId ? { milestoneDisplayId: milestone.displayId } : {}),
          milestoneStatus: milestone.status,
          ...(projectSlug ? { project: projectSlug } : {}),
          ...(taskOwnerResolved?.kind === "person"
            ? { resolvedPerson: { id: taskOwnerResolved.person.id, displayName: taskOwnerResolved.person.displayName } }
            : {}),
          ...(taskOwnerResolved?.kind === "team"
            ? { resolvedTeam: { id: taskOwnerResolved.team.id, displayName: taskOwnerResolved.team.displayName } }
            : {}),
        });
      }
    }

    rows.sort((a, b) => {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return a.milestoneName.localeCompare(b.milestoneName);
    });

    return { tasks: rows };
  }

  async updateAnchorSection(input: {
    name: string;
    heading: string;
    content: string;
    lastValidated?: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      lastValidated: input.lastValidated,
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
    lastValidated?: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      lastValidated: input.lastValidated,
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
    lastValidated?: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      lastValidated: input.lastValidated,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => deleteAnchorSection(old, input.heading),
    });
  }

  async proposeChange(input: ProposeChangeInput): Promise<ProposeChangeResult> {
    const scope = await this.resolveProposedChangeScope(input.scope);
    const target = this.repo.resolveAnchor(input.target).name;
    const placeholder = (code: string, message: string): ProposeChangeResult => ({
      proposal: placeholderProposalListItem(scope, target, input.summary, this.proposalLedgerPath(scope)),
      warnings: [
        {
          severity: "BLOCK",
          code,
          message,
        },
      ],
    });
    const targetViolation = validateProposalTarget(scope, target);
    if (targetViolation) {
      return placeholder("proposed_change_target_scope", targetViolation);
    }

    try {
      const oldContent = await this.repo.readRaw(target);
      applyProposalOperations(oldContent, input.operations);
    } catch (error) {
      return placeholder("proposed_change_operation", errorMessage(error));
    }

    let ledger: { read: AnchorRead };
    try {
      ledger = await this.ensureProposalLedger(scope);
    } catch (error) {
      return placeholder("proposed_change_ledger", errorMessage(error));
    }

    const resolvedTarget = this.repo.resolveAnchor(target);
    const oldContent = await this.repo.readRaw(target);
    const baseFileCommit = oldContent === undefined ? undefined : await this.repo.lastCommitForFile(resolvedTarget.repoRelativePath);
    const now = new Date().toISOString();
    const record: ProposedChangeRecord = {
      id: makeProposalId(input.summary, now),
      scope,
      status: "pending",
      summary: input.summary,
      target,
      ...(baseFileCommit ? { baseFileCommit } : {}),
      createdAt: now,
      updatedAt: now,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      ...(input.rationale ? { rationale: input.rationale } : {}),
      operations: input.operations,
    };

    let nextContent: string;
    try {
      nextContent = appendProposalRecord(ledger.read.content, record);
    } catch (error) {
      return {
        proposal: this.toProposalListItem(record, ledger.read),
        warnings: [
          {
            severity: "BLOCK",
            code: "proposed_change_ledger_malformed",
            message: errorMessage(error),
          },
        ],
      };
    }
    const write = await this.writeAnchor({
      name: ledger.read.name,
      content: nextContent,
      message: input.message ?? `anchor-mcp: propose change ${record.id}`,
      expectedFileCommit: ledger.read.fileCommit,
    });
    if (!write.version) {
      return {
        proposal: this.toProposalListItem(record, ledger.read),
        warnings: write.warnings,
      };
    }

    const reread = await this.readAnchor(ledger.read.name);
    const proposal = this.proposalListItemsFromLedger(reread).find((item) => item.id === record.id) ?? this.toProposalListItem(record, reread);
    return { proposal, version: write.version, warnings: write.warnings };
  }

  async listProposedChanges(input: ProposedChangeListInput = {}): Promise<{
    proposals: ProposedChangeListItem[];
    projectFilter?: ProjectFilterResolution;
  }> {
    const { projectFilter, effectiveProject } = await this.resolveProjectFilter(input.project);
    const ledgerNames: string[] = [];
    if (input.scope === "agent-rules") {
      ledgerNames.push(proposedChangeLedgerName({ kind: "agent-rules" }));
    } else if (effectiveProject) {
      ledgerNames.push(proposedChangeLedgerName({ kind: "project", project: effectiveProject }));
    } else {
      const metas = await this.repo.listAnchors({ includeArchive: true });
      ledgerNames.push(...metas.filter((meta) => isProposedChangesType(meta.type)).map((meta) => meta.name));
    }

    const proposals: ProposedChangeListItem[] = [];
    for (const name of dedupePreserveOrder(ledgerNames)) {
      const ledger = await this.readProposalLedger(name);
      if (!ledger) {
        continue;
      }
      proposals.push(...this.proposalListItemsFromLedger(ledger));
    }

    const filtered = input.status ? proposals.filter((proposal) => proposal.status === input.status) : proposals;
    filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return {
      proposals: filtered,
      ...(projectFilter ? { projectFilter } : {}),
    };
  }

  async readProposedChange(id: string): Promise<ProposedChangeRead> {
    return { proposal: await this.findProposedChange(id) };
  }

  async previewProposedChange(id: string): Promise<ProposedChangePreview> {
    const proposal = await this.findProposedChange(id);
    return this.previewProposal(proposal, false);
  }

  async reviewProposedChange(input: ReviewProposedChangeInput): Promise<ProposeChangeResult> {
    const proposal = await this.findProposedChange(input.id);
    if (input.expectedLedgerFileCommit && proposal.ledgerFileCommit !== input.expectedLedgerFileCommit) {
      return {
        proposal,
        warnings: [
          {
            severity: "BLOCK",
            code: "stale_base",
            message: `Proposal ledger commit mismatch: expected ${input.expectedLedgerFileCommit}, found ${proposal.ledgerFileCommit ?? "none"}. Re-read the proposal and retry.`,
          },
        ],
      };
    }

    const read = await this.readAnchor(proposal.ledgerName);
    const nextRecord = addProposalReview(proposal, {
      status: input.status,
      note: input.note,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date().toISOString(),
    });
    const nextContent = updateProposalRecord(read.content, nextRecord);
    const write = await this.writeAnchor({
      name: read.name,
      content: nextContent,
      message: input.message ?? `anchor-mcp: review proposed change ${proposal.id}`,
      expectedFileCommit: read.fileCommit,
    });
    const reread = write.version ? await this.readAnchor(read.name) : read;
    const nextProposal = this.proposalListItemsFromLedger(reread).find((item) => item.id === proposal.id) ?? proposal;
    return { proposal: nextProposal, version: write.version, warnings: write.warnings };
  }

  async applyProposedChange(input: ApplyProposedChangeInput): Promise<ApplyProposedChangeResult> {
    const proposal = await this.findProposedChange(input.id);
    if (!input.approved) {
      return {
        proposal,
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message: "applyProposedChange mutates the target anchor; retry with approved: true after explicit human approval.",
          },
        ],
        requiresApproval: true,
      };
    }
    if (proposal.status !== "pending") {
      return {
        proposal,
        warnings: [
          {
            severity: "BLOCK",
            code: "proposed_change_not_pending",
            message: `Only pending proposed changes can be applied; ${proposal.id} is ${proposal.status}.`,
          },
        ],
      };
    }
    if (input.expectedLedgerFileCommit && proposal.ledgerFileCommit !== input.expectedLedgerFileCommit) {
      return {
        proposal,
        warnings: [
          {
            severity: "BLOCK",
            code: "stale_base",
            message: `Proposal ledger commit mismatch: expected ${input.expectedLedgerFileCommit}, found ${proposal.ledgerFileCommit ?? "none"}. Re-read the proposal and retry.`,
          },
        ],
      };
    }

    const preview = await this.previewProposal(proposal, true);
    const blocks = preview.warnings.filter((warning) => warning.severity === "BLOCK");
    if (preview.stale || blocks.length > 0 || !preview.draftContent) {
      return {
        proposal,
        warnings: preview.warnings,
        requiresApproval: preview.requiresApproval,
      };
    }

    const targetWrite = await this.writeAnchor({
      name: proposal.target,
      content: preview.draftContent,
      message: input.message ?? `anchor-mcp: apply proposed change ${proposal.id}`,
      approved: true,
      coAuthor: input.coAuthor,
      expectedFileCommit: proposal.baseFileCommit,
    });
    if (!targetWrite.version) {
      return {
        proposal,
        warnings: targetWrite.warnings,
        requiresApproval: targetWrite.requiresApproval,
      };
    }

    const ledgerRead = await this.readAnchor(proposal.ledgerName);
    const appliedAt = new Date().toISOString();
    const appliedRecord: ProposedChangeRecord = {
      ...proposal,
      status: "applied",
      updatedAt: appliedAt,
      appliedAt,
      ...(input.appliedBy ? { appliedBy: input.appliedBy } : {}),
      appliedVersion: targetWrite.version,
      applyWarnings: targetWrite.warnings,
    };
    const nextContent = updateProposalRecord(ledgerRead.content, appliedRecord);
    const ledgerWrite = await this.writeAnchor({
      name: ledgerRead.name,
      content: nextContent,
      message: `anchor-mcp: mark proposed change ${proposal.id} applied`,
      expectedFileCommit: ledgerRead.fileCommit,
    });
    const reread = ledgerWrite.version ? await this.readAnchor(ledgerRead.name) : ledgerRead;
    const nextProposal = this.proposalListItemsFromLedger(reread).find((item) => item.id === proposal.id) ?? proposal;
    return {
      proposal: nextProposal,
      targetVersion: targetWrite.version,
      ledgerVersion: ledgerWrite.version,
      warnings: [...targetWrite.warnings, ...ledgerWrite.warnings],
      requiresApproval: targetWrite.requiresApproval || ledgerWrite.requiresApproval,
    };
  }

  private async applyAnchorContentPatch(input: {
    name: string;
    lastValidated?: string;
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

    if (input.lastValidated) {
      newContent = mergeAnchorFrontmatter(newContent, { last_validated: input.lastValidated });
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

  private async resolveProposedChangeScope(scope: ProposedChangeScope): Promise<ProposedChangeScope> {
    const normalized = normalizeProposalScope(scope);
    if (normalized.kind === "agent-rules") {
      return normalized;
    }
    const { effectiveProject } = await this.resolveProjectFilter(normalized.project);
    return { kind: "project", project: effectiveProject ?? normalized.project };
  }

  private async ensureProposalLedger(scope: ProposedChangeScope): Promise<{ read: AnchorRead }> {
    const name = proposedChangeLedgerName(scope);
    const existing = await this.readProposalLedger(name);
    if (existing) {
      if (!proposalScopeMatchesLedger(scope, existing)) {
        throw new Error(`Proposal ledger scope does not match requested scope: ${name}`);
      }
      return { read: existing };
    }

    const date = localDateKey();
    const write = await this.writeAnchor({
      name,
      content: createProposalLedgerContent(scope, date),
      message: `anchor-mcp: create proposed changes ledger ${name}`,
    });
    if (!write.version) {
      throw new Error(`Could not create proposal ledger ${name}: ${write.warnings.map((w) => w.message).join("; ")}`);
    }
    return { read: await this.readAnchor(name) };
  }

  private async readProposalLedger(name: string): Promise<AnchorRead | undefined> {
    try {
      const read = await this.readAnchor(name);
      return isProposedChangesType(read.frontmatter.type) ? read : undefined;
    } catch {
      return undefined;
    }
  }

  private proposalListItemsFromLedger(read: AnchorRead): ProposedChangeListItem[] {
    return parseProposedChanges(read.content).map((record) => this.toProposalListItem(record, read));
  }

  private toProposalListItem(record: ProposedChangeRecord, ledger: AnchorRead): ProposedChangeListItem {
    return {
      ...record,
      ledgerName: ledger.name,
      ledgerPath: ledger.path,
      ...(ledger.fileCommit ? { ledgerFileCommit: ledger.fileCommit } : {}),
    };
  }

  private proposalLedgerPath(scope: ProposedChangeScope): string {
    const name = proposedChangeLedgerName(scope);
    try {
      return this.repo.resolveAnchor(name).repoRelativePath;
    } catch {
      return name;
    }
  }

  private async findProposedChange(id: string): Promise<ProposedChangeListItem> {
    const all = await this.listProposedChanges();
    const match = all.proposals.find((proposal) => proposal.id === id);
    if (!match) {
      throw new Error(`Proposed change not found: ${id}`);
    }
    return match;
  }

  private async previewProposal(
    proposal: ProposedChangeListItem,
    approved: boolean,
  ): Promise<ProposedChangePreview> {
    const targetResolved = this.repo.resolveAnchor(proposal.target);
    const oldContent = await this.repo.readRaw(proposal.target);
    const targetFileCommit =
      oldContent === undefined ? undefined : await this.repo.lastCommitForFile(targetResolved.repoRelativePath);
    const stale = (proposal.baseFileCommit ?? undefined) !== (targetFileCommit ?? undefined);
    const warnings: ValidationViolation[] = [];
    if (stale) {
      warnings.push({
        severity: "BLOCK",
        code: "stale_base",
        message: `Target file commit mismatch: proposal expected ${proposal.baseFileCommit ?? "none"}, found ${targetFileCommit ?? "none"}.`,
        path: proposal.target,
      });
    }

    let draftContent: string | undefined;
    let diff: string | undefined;
    try {
      draftContent = applyProposalOperations(oldContent, proposal.operations);
      diff = renderProposalDiff(proposal.target, oldContent, draftContent);
      warnings.push(
        ...(await runValidators({
          name: targetResolved.name,
          repoRelativePath: targetResolved.repoRelativePath,
          oldContent,
          newContent: draftContent,
          repo: this.repo,
          migrationWarnOnly: this.options.migrationWarnOnly,
          approved,
        })),
      );
    } catch (error) {
      warnings.push({
        severity: "BLOCK",
        code: "proposed_change_operation",
        message: error instanceof Error ? error.message : String(error),
        path: proposal.target,
      });
    }

    return {
      proposal,
      targetExists: oldContent !== undefined,
      ...(targetFileCommit ? { targetFileCommit } : {}),
      ...(proposal.baseFileCommit ? { baseFileCommit: proposal.baseFileCommit } : {}),
      stale,
      ...(draftContent ? { draftContent } : {}),
      ...(diff ? { diff } : {}),
      warnings,
      requiresApproval: warnings.some((warning) => warning.code === "requires_approval"),
    };
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
    const { anchors, projectFilter } = await this.mergeDiscoveryAnchorsWithResolution({
      project: input.project,
      category: input.category,
      tag: input.tag,
      runtime: input.runtime,
      includeArchive: input.includeArchive,
    });

    return {
      ...buildContextRoot(anchors, { format: input.format }),
      ...(projectFilter ? { projectFilter } : {}),
    };
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
    const task = decoded?.task ?? input.task;
    const format = decoded?.format ?? input.format ?? "both";

    const filter = {
      project: decoded?.filter.project ?? input.project,
      category: decoded?.filter.category ?? input.category,
      tag: decoded?.filter.tag ?? input.tag,
      runtime: decoded?.filter.runtime ?? input.runtime,
      includeArchive: decoded?.filter.includeArchive ?? input.includeArchive ?? false,
    };

    const { projectFilter, effectiveProject } = await this.resolveProjectFilter(filter.project);
    const resolvedFilter = {
      ...filter,
      ...(effectiveProject ? { project: effectiveProject } : {}),
    };

    const offset = decoded?.offset ?? 0;

    let selectionReason: LoadContextSelectionReason;
    let orderedNames: string[];

    if (decoded) {
      selectionReason = decoded.selectionReason;
      if (selectionReason === "explicit_names") {
        orderedNames = decoded.explicitNames ?? [];
      } else {
        const { anchors: metas } = await this.mergeDiscoveryAnchorsWithResolution(resolvedFilter);
        const ordered = buildContextRoot(metas, { format: "json" });
        orderedNames = ordered.entries.map((entry) => entry.name);
      }
    } else if (input.names && input.names.length > 0) {
      selectionReason = "explicit_names";
      orderedNames = dedupePreserveOrder(input.names.map((name) => this.resolveDiscoveryAnchorName(name)));
    } else {
      selectionReason = "filter";
      const { anchors: metas } = await this.mergeDiscoveryAnchorsWithResolution(resolvedFilter);
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
      entriesMetas = await this.mergeDiscoveryAnchors(resolvedFilter);
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
      let row = buildLoadContextAnchor(read, includeContent, excerptChars, task);
      const trial = [...anchors, row];
      const bytes = jsonByteLength(trial);

      if (bytes > maxBytes && anchors.length > 0) {
        stoppedForBytes = true;
        break;
      }

      if (bytes > maxBytes && anchors.length === 0) {
        row = shrinkLoadContextAnchorToFit(read, includeContent, excerptChars, maxBytes, task);
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
            task,
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
      ...(projectFilter ? { projectFilter } : {}),
    };
  }

  async planContextBundle(input: PlanContextBundleInput): Promise<PlanContextBundleResult> {
    const anchorsRaw =
      input.category === SERVER_RULES_DISCOVERY_CATEGORY
        ? listBuiltInAnchorMetas()
        : [...(await this.repo.listAnchors({
            category: input.category ? (input.category as AnchorCategory) : undefined,
            tag: input.tag,
            runtime: input.runtime,
            includeArchive: input.includeArchive,
          })), ...listBuiltInAnchorMetas()];
    const anchors = anchorsRaw.filter((anchor) => !isProposedChangesType(anchor.type));

    const index = buildProjectAliasIndex(anchors);
    const projectFilter = resolveProjectFilter(input.project, anchors, index);
    const effectiveInput =
      projectFilter && projectFilter.via !== "unresolved"
        ? { ...input, project: projectFilter.resolved }
        : input;

    const { index: bm25Index, bodyCharCounts } = await this.buildBM25SearchIndex(anchors);
    const plan = buildContextBundlePlan(
      anchors,
      effectiveInput,
      bm25Index,
      undefined,
      projectFilter,
      bodyCharCounts,
      this.options.staleAfterDays,
    );
    const names = plan.loadContext.names;
    const roadmapSignals = collectRoadmapAcceptanceMissingSignals(anchors);
    const milestoneSignals = collectMilestoneAcceptanceMissingSignals(anchors);

    return {
      ...plan,
      missingContext: [...plan.missingContext, ...roadmapSignals, ...milestoneSignals],
      loadContext: { ...plan.loadContext, names },
      ...(projectFilter ? { projectFilter } : {}),
    };
  }

  /** Session-start orchestration: plan a task-aware bundle and load suggested anchor excerpts in one call. */
  async startTask(input: StartTaskInput): Promise<StartTaskResult> {
    const plan = await this.planContextBundle({
      task: input.task,
      project: input.project,
      budgetTokens: input.budgetTokens,
      maxAnchors: input.maxAnchors,
      includeArchive: input.includeArchive,
    });

    const loaded = await this.loadContext({
      names: plan.loadContext.names,
      includeContent: plan.loadContext.includeContent,
      maxBytes: plan.loadContext.maxBytes,
      task: input.task,
      ...(plan.loadContext.project ? { project: plan.loadContext.project } : {}),
    });

    const activeMilestones =
      input.project !== undefined
        ? (await this.listMilestones(input.project))
            .filter((milestone) => milestone.status === "active")
            .map((milestone) => ({
              name: milestone.name,
              theme: milestone.theme,
              goalIds: milestone.goalIds,
              ...(milestone.displayId ? { displayId: milestone.displayId } : {}),
            }))
        : [];

    const staleIncluded = plan.included
      .filter((anchor) => anchor.stale)
      .map((anchor) => ({
        name: anchor.name,
        ...(anchor.lastValidatedAgeDays !== undefined ? { lastValidatedAgeDays: anchor.lastValidatedAgeDays } : {}),
      }));

    return {
      task: input.task,
      plan: {
        budgetTokens: plan.budgetTokens,
        estimatedTokens: plan.estimatedTokens,
        included: plan.included,
        excluded: plan.excluded,
        missingContext: plan.missingContext,
        ...(plan.projectFilter ? { projectFilter: plan.projectFilter } : {}),
      },
      anchors: loaded.anchors,
      truncated: loaded.truncated,
      ...(loaded.nextCursor ? { nextCursor: loaded.nextCursor } : {}),
      staleness: {
        staleAfterDays: this.options.staleAfterDays,
        staleIncluded,
      },
      activeMilestones,
      suggestedFollowUp: {
        readAnchor: plan.included.map((anchor) => anchor.name),
        note: "Use readAnchor for full anchor bodies when excerpts are insufficient or truncated is true.",
      },
    };
  }

  async listMilestones(project?: string): Promise<MilestoneListRow[]> {
    const { effectiveProject } = await this.resolveProjectFilter(project);
    const anchors = await this.repo.listAnchors({
      ...(effectiveProject ? { project: effectiveProject } : {}),
    });
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
          ...(m.steelThread !== undefined ? { steelThread: m.steelThread } : {}),
          goalIds: m.goalIds,
          ...(m.milestoneId !== undefined ? { milestoneId: m.milestoneId } : {}),
          ...(m.sequence !== undefined ? { sequence: m.sequence } : {}),
          ...(displayId !== undefined ? { displayId } : {}),
          ...(m.schedule !== undefined ? { schedule: m.schedule } : {}),
          ...(m.tasks !== undefined ? { tasks: m.tasks } : {}),
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

  async projectUpdateSnapshot(input: ProjectUpdateSnapshotInput): Promise<ProjectUpdateSnapshot> {
    const generatedAt = new Date().toISOString();
    const asOf = input.asOf ?? generatedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new Error("projectUpdateSnapshot asOf must be YYYY-MM-DD when provided.");
    }

    const { projectFilter, effectiveProject } = await this.resolveProjectFilter(input.project);
    const project = effectiveProject ?? input.project;
    const warnings: string[] = [];
    const anchors = await this.repo.listAnchors({ project });
    const projectAnchor = findProjectAnchor(anchors, project);
    const roadmap = findProjectRoadmap(anchors, project);
    if (!projectAnchor) {
      warnings.push(`No project context anchor found for project "${project}".`);
    }
    if (!roadmap) {
      warnings.push(`No project roadmap anchor found for project "${project}".`);
    }

    const allRows = await this.listMilestones(project);
    const backlogRow = allRows.find(isBacklogRow);
    const selectedRows = selectProjectUpdateRows(allRows.filter((row) => !isBacklogRow(row)), input, warnings);

    let backlog: ProjectUpdateMilestone | undefined;
    const shouldIncludeBacklog =
      Boolean(input.includeBacklog) ||
      input.milestone?.toLowerCase() === "backlog" ||
      Boolean(backlogRow && (backlogRow.tasks?.length ?? 0) > 0);
    if (backlogRow && shouldIncludeBacklog) {
      backlog = await this.projectUpdateMilestoneFromRow(backlogRow, warnings);
    } else if (input.milestone?.toLowerCase() === "backlog") {
      warnings.push(`No backlog milestone found for project "${project}".`);
    }

    const milestones = [];
    for (const row of selectedRows) {
      milestones.push(await this.projectUpdateMilestoneFromRow(row, warnings));
    }

    const snapshotMilestones = [...milestones, ...(backlog ? [backlog] : [])];
    for (const milestone of snapshotMilestones) {
      addMilestoneUpdateWarnings(milestone, warnings);
    }

    return {
      generatedAt,
      asOf,
      project,
      ...(projectFilter ? { projectFilter } : {}),
      ...(roadmap ? { roadmap: { name: roadmap.name, ...(roadmap.title ? { title: roadmap.title } : {}) } } : {}),
      ...(projectAnchor
        ? { projectAnchor: { name: projectAnchor.name, ...(projectAnchor.title ? { title: projectAnchor.title } : {}) } }
        : {}),
      progress: computeProjectUpdateProgress(snapshotMilestones),
      milestones,
      ...(backlog ? { backlog } : {}),
      warnings: dedupeStrings(warnings),
    };
  }

  async renderProjectUpdate(input: RenderProjectUpdateInput): Promise<RenderedProjectUpdate> {
    const snapshot = await this.projectUpdateSnapshot(input);
    return renderProjectUpdateFromSnapshot(snapshot, input.format);
  }

  private async projectUpdateMilestoneFromRow(
    row: MilestoneListRow,
    warnings: string[],
  ): Promise<ProjectUpdateMilestone> {
    let resolvedGoals = row.goalIds.map((id) => ({ id, title: "(unknown)", hasAcceptanceCriteria: false }));
    try {
      const resolved = await this.readMilestone(row.name);
      resolvedGoals = resolved.goals;
    } catch (error) {
      warnings.push(`Could not resolve milestone "${row.name}": ${error instanceof Error ? error.message : String(error)}.`);
    }

    const tasks = sortUpdateTasks((row.tasks ?? []).map((task) => toProjectUpdateTask(task, row.name)));
    return {
      name: row.name,
      path: row.path,
      ...(row.displayId ? { displayId: row.displayId } : {}),
      ...(row.milestoneId ? { milestoneId: row.milestoneId } : {}),
      ...(row.sequence !== undefined ? { sequence: row.sequence } : {}),
      status: row.status as ProjectUpdateMilestoneStatus,
      theme: row.theme,
      ...(row.steelThread ? { steelThread: row.steelThread } : {}),
      goalIds: row.goalIds,
      ...(row.schedule ? { schedule: row.schedule } : {}),
      goals: resolvedGoals.map((goal) => ({
        ...goal,
        tasks: tasks.filter((task) => task.goalIds?.includes(goal.id)),
      })),
      tasks,
    };
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

function hasBlock(warnings: ValidationViolation[]): boolean {
  return warnings.some((warning) => warning.severity === "BLOCK");
}

function blockMessages(warnings: ValidationViolation[]): string {
  return warnings
    .filter((warning) => warning.severity === "BLOCK")
    .map((warning) => warning.message)
    .join("; ");
}

function findProjectAnchor(anchors: AnchorMeta[], project: string): AnchorMeta | undefined {
  const exact = anchors.find((anchor) => anchor.name === `projects/${project}/${project}.md`);
  if (exact) {
    return exact;
  }
  return anchors
    .filter((anchor) => anchor.category === "projects" && !anchor.name.includes("/milestones/"))
    .find((anchor) => frontmatterTypeIncludes(anchor.type, "context-anchor"));
}

function findProjectRoadmap(anchors: AnchorMeta[], project: string): AnchorMeta | undefined {
  const exact = anchors.find((anchor) => anchor.name === `projects/${project}/${project}-roadmap.md`);
  if (exact) {
    return exact;
  }
  return anchors
    .filter((anchor) => anchor.category === "projects" && !anchor.name.includes("/milestones/"))
    .find((anchor) => frontmatterTypeIncludes(anchor.type, "project-roadmap"));
}

function frontmatterTypeIncludes(raw: unknown, expected: string): boolean {
  if (raw === expected) {
    return true;
  }
  return Array.isArray(raw) && raw.some((item) => item === expected);
}

function isBacklogRow(row: MilestoneListRow): boolean {
  return row.milestoneId === "backlog" || row.displayId === "backlog";
}

function selectProjectUpdateRows(
  rows: MilestoneListRow[],
  input: ProjectUpdateSnapshotInput,
  warnings: string[],
): MilestoneListRow[] {
  const selector = input.milestone?.trim();
  if (selector?.toLowerCase() === "backlog") {
    return [];
  }
  if (selector && selector.toLowerCase() !== "active" && selector.toLowerCase() !== "backlog") {
    const matches = rows.filter(
      (row) =>
        row.name === selector ||
        row.milestoneId?.toLowerCase() === selector.toLowerCase() ||
        row.displayId?.toLowerCase() === selector.toLowerCase(),
    );
    if (matches.length === 0) {
      warnings.push(`No milestone matched selector "${selector}".`);
    }
    return matches;
  }

  const statuses = selector?.toLowerCase() === "active" ? ["active"] : input.statuses ?? ["shipped", "active", "proposed"];
  return rows.filter((row) => statuses.includes(row.status as ProjectUpdateMilestoneStatus));
}

function computeProjectUpdateProgress(milestones: ProjectUpdateMilestone[]): ProjectUpdateSnapshot["progress"] {
  const progress: ProjectUpdateSnapshot["progress"] = {
    milestones: { shipped: 0, active: 0, proposed: 0, cancelled: 0, backlog: 0, total: 0 },
    tasks: { done: 0, active: 0, blocked: 0, todo: 0, cancelled: 0, total: 0 },
  };

  for (const milestone of milestones) {
    if (milestone.milestoneId === "backlog") {
      progress.milestones.backlog += 1;
    } else {
      progress.milestones.total += 1;
      if (milestone.status === "shipped") {
        progress.milestones.shipped += 1;
      } else if (milestone.status === "active") {
        progress.milestones.active += 1;
      } else if (milestone.status === "proposed") {
        progress.milestones.proposed += 1;
      } else if (milestone.status === "cancelled") {
        progress.milestones.cancelled += 1;
      }
    }
    for (const task of milestone.tasks) {
      progress.tasks.total += 1;
      progress.tasks[task.status] += 1;
    }
  }

  return progress;
}

function addMilestoneUpdateWarnings(milestone: ProjectUpdateMilestone, warnings: string[]): void {
  if (milestone.milestoneId === "backlog") {
    if (milestone.sequence !== undefined) {
      warnings.push(`Backlog milestone "${milestone.name}" should not have a sequence.`);
    }
    return;
  }

  if (milestone.status === "shipped" && !milestone.schedule?.shipped) {
    warnings.push(`Shipped milestone "${milestone.name}" has no schedule.shipped date.`);
  }
  for (const task of milestone.tasks) {
    if (task.status === "done" && !task.completedOn) {
      warnings.push(`Completed task "${task.id}" in "${milestone.name}" has no completed_on date.`);
    }
    if ((task.status === "active" || task.status === "todo" || task.status === "blocked") && !task.due) {
      warnings.push(`Incomplete task "${task.id}" in "${milestone.name}" has no due date.`);
    }
    if (task.due && !task.dateConfidence) {
      warnings.push(`Task "${task.id}" in "${milestone.name}" has a due date without date_confidence.`);
    }
  }
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function pageAnchorMetas(
  anchors: AnchorMeta[],
  page: { sort: AnchorListSort; offset?: number; limit?: number },
): AnchorListPage {
  const offset = page.offset ?? 0;
  const sorted = sortAnchorMetas(anchors, page.sort);
  const pageAnchors = sorted.slice(offset, page.limit === undefined ? undefined : offset + page.limit);
  const nextOffset =
    page.limit === undefined || offset + page.limit >= sorted.length ? undefined : offset + page.limit;

  return {
    anchors: pageAnchors,
    offset,
    ...(page.limit !== undefined ? { limit: page.limit } : {}),
    total: sorted.length,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
  };
}

function sortAnchorMetas(anchors: AnchorMeta[], sort: AnchorListSort): AnchorMeta[] {
  return anchors.slice().sort((left, right) => compareAnchorMetas(left, right, sort));
}

function compareAnchorMetas(left: AnchorMeta, right: AnchorMeta, sort: AnchorListSort): number {
  if (sort === "updated") {
    return compareAnchorTimestamp(right, left, "updatedAt", true) || left.name.localeCompare(right.name);
  }
  if (sort === "created") {
    return compareAnchorTimestamp(right, left, "createdAt", false) || left.name.localeCompare(right.name);
  }
  if (sort === "priority") {
    return compareAnchorPriority(left, right) || left.name.localeCompare(right.name);
  }
  return left.name.localeCompare(right.name);
}

function compareAnchorPriority(left: AnchorMeta, right: AnchorMeta): number {
  const leftPriority = typeof left.priority === "number" && Number.isFinite(left.priority) ? left.priority : Number.POSITIVE_INFINITY;
  const rightPriority = typeof right.priority === "number" && Number.isFinite(right.priority) ? right.priority : Number.POSITIVE_INFINITY;
  return leftPriority === rightPriority ? 0 : leftPriority < rightPriority ? -1 : 1;
}

function compareAnchorTimestamp(
  left: AnchorMeta,
  right: AnchorMeta,
  field: "updatedAt" | "createdAt",
  allowValidatedFallback: boolean,
): number {
  const leftTime = anchorTimestamp(left, field, allowValidatedFallback);
  const rightTime = anchorTimestamp(right, field, allowValidatedFallback);
  return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
}

function anchorTimestamp(anchor: AnchorMeta, field: "updatedAt" | "createdAt", allowValidatedFallback: boolean): number {
  const raw = anchor[field] ?? (allowValidatedFallback ? anchor.last_validated : undefined);
  const parsed = Date.parse(String(raw ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function validatePriorityValue(value: number | null): ValidationViolation | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return undefined;
  }
  return {
    severity: "BLOCK",
    code: "project_priority_invalid",
    message: "Project priority must be a finite number or null to clear it.",
  };
}

function placeholderProposalListItem(
  scope: ProposedChangeScope,
  target: string,
  summary: string,
  ledgerPath: string,
): ProposedChangeListItem {
  const now = new Date().toISOString();
  return {
    id: makeProposalId(summary, now),
    scope,
    status: "pending",
    summary,
    target,
    createdAt: now,
    updatedAt: now,
    operations: [],
    ledgerName: proposedChangeLedgerName(scope),
    ledgerPath,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeProposalId(summary: string, isoDate: string): string {
  const date = isoDate.slice(0, 10).replaceAll("-", "");
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16)
    .replace(/-$/g, "") || "change";
  return `PC-${date}-${slug}-${randomBytes(3).toString("hex")}`;
}

function localDateKey(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
