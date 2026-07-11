import { randomBytes } from "node:crypto";
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
import type { AnchorListPage, AnchorListSort, AnchorStore } from "./storage/store.js";
import {
  listRoadmapGoalDetails,
  listRoadmapGoalsWithStatus,
  type RoadmapGoalRow,
  type RoadmapGoalStatus,
} from "./roadmap/analyzeRoadmap.js";
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
  ClaimSourceType,
  ClaimProvenanceMode,
  AnchorClaimProvenance,
  ContextProvenanceSummary,
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
  ProjectMapping,
  ProjectMappings,
  ProjectMappingsWithCommit,
  ProjectRepoMapping,
  ProjectUpdateMilestone,
  ProjectUpdateMilestoneStatus,
  ProjectUpdateSnapshot,
  ProjectUpdateSnapshotInput,
  PersonSearchMatch,
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
  ListQuestionsInput,
  ListQuestionsResult,
  CreateTaskInput,
  CreateTaskResult,
  CompleteTaskInput,
  ReopenTaskInput,
  DeleteTaskInput,
  ResolveQuestionInput,
  ReopenQuestionInput,
  UpdateBulletTextInput,
  UpdateQuestionTextInput,
  UpdateProjectPriorityInput,
  UpdateTaskDueInput,
  UpdateTaskOwnerInput,
  UpdateTaskPriorityInput,
  UpdateTaskNotesInput,
  ValidationViolation,
  MarkdownLinkSuggestionResult,
  WriteAnchorInput,
  WriteAnchorResult,
  Person,
  Team,
  TeamWithMembers,
  PeopleRegistry,
  PeopleRegistryWithCommit,
  WritePeopleRegistryInput,
  WriteProjectMappingsInput,
} from "./types.js";
import {
  buildProjectAliasIndex,
  resolveProjectFilter,
} from "./projectAliases.js";
import { candidateBoostMap, isWithinPath, resolveCandidateProjects } from "./projectResolution.js";
import { parseProjectMappings, repoFileUrl, repoPullRequestUrl } from "./projectMappings.js";
import {
  isHttpUrl,
  parseFileSource,
  parsePullRequestSource,
  parseRepoPrefixedSource,
} from "./graph/sourceParsing.js";
import { parseClaimSource, type ParseClaimSourceContext } from "./graph/sourceId.js";
import { GraphIndex } from "./graph/index.js";
import {
  clampDepth,
  clampLimit,
  resolveGraphNode,
  traverseGraphNeighbors,
  type GraphNeighborsDirection,
  type GraphNeighborsInput,
  type GraphNeighborsResult,
  type GraphNeighborsResultNode,
} from "./graph/neighbors.js";
import { buildPeopleIndex, parsePeopleRegistry, type PeopleIndex } from "./peopleRegistry.js";
import { findMarkdownLinkSuggestions, suggestMarkdownLinks } from "./markdownLinks.js";
import {
  extractMermaidBlocks,
  replaceMermaidBlockText,
  upsertMermaidBlockSources,
  type MermaidBlock,
} from "./mermaidBlocks.js";
import { runValidators } from "./validators/pipeline.js";
import {
  carryClaimAnnotations,
  collectClaimIds,
  deleteClaim,
  extractClaims,
  formatAnnotationBody,
  locateClaim,
  locateClaimByLine,
  mergeClaimProvenanceSummaries,
  mintMissingClaimIds,
  newlyAddedUnannotatedClaims,
  parseAnnotationBody,
  replaceClaimText,
  summarizeClaimProvenance,
  TRUST_ME_BRO_KIND,
  TRUST_ME_BRO_SOURCE,
  upsertClaimSources,
  type AnchorClaim,
  type ClaimAnnotation,
  type ClaimSource,
  type ClaimStatus,
} from "./claims.js";
import {
  deleteQuestion,
  extractQuestions,
  locateQuestion,
  replaceQuestionText,
  setQuestionStatus,
  type QuestionStatus,
  type QuestionTarget,
} from "./questions.js";
import { deleteEditableBullet, locateEditableBullet, replaceEditableBulletText } from "./editableBullets.js";

const BM25_INDEX_READ_CONCURRENCY = 8;

type MilestoneListRow = {
  name: string;
  path: string;
  status: string;
  theme: string;
  project?: string;
  projectPriority?: number;
  steelThread?: string;
  goalIds: string[];
  milestoneId?: string;
  sequence?: number;
  displayId?: string;
  updatedAt?: string;
  createdAt?: string;
  schedule?: MilestoneScheduleMeta;
  tasks?: MilestoneTaskMeta[];
};

/** Precomputed inputs for resolving a claim's source links, built once per request and reused so claim enrichment never reloads the whole tree per claim. */
type ClaimResolutionInputs = {
  mappings: ProjectMappings;
  anchorNames: Set<string>;
  peopleIndex: PeopleIndex;
};

export class AnchorService {
  private _peopleRegistry: PeopleRegistry | undefined;
  /** Git commit the cached registry was parsed from; used to detect out-of-band changes (e.g. AutoSync rebases). */
  private _peopleRegistryCommit: string | undefined;
  private _projectMappings: ProjectMappings | undefined;
  /** Git commit the cached project mappings were parsed from. */
  private _projectMappingsCommit: string | undefined;
  /**
   * Derived knowledge graph (WP3), built lazily on first graph-consuming
   * call and reused across calls — pattern-matches `_peopleRegistry`/
   * `_projectMappings` above. Never constructed in the constructor (stdio
   * spawns one process per session; no session should pay for the graph
   * unless it asks a graph question). Its own `ensureBuilt()` is HEAD-keyed
   * and self-refreshing, so this field just needs to exist once.
   */
  private _graphIndex: GraphIndex | undefined;

  constructor(
    private readonly repo: AnchorStore,
    private readonly options: {
      pushOnWrite: boolean;
      migrationWarnOnly: boolean;
      staleAfterDays: number;
    },
  ) {}

  private async loadPeopleRegistry(): Promise<PeopleRegistry> {
    // Key the cache on the registry file's last commit so a background AutoSync
    // rebase (or any out-of-band change) is picked up instead of served stale.
    const commit = await this.repo.peopleRegistryCommit();
    if (this._peopleRegistry !== undefined && this._peopleRegistryCommit === commit) {
      return this._peopleRegistry;
    }
    const raw = await this.repo.readPeopleRegistryRaw();
    this._peopleRegistry = parsePeopleRegistry(raw);
    this._peopleRegistryCommit = commit;
    return this._peopleRegistry;
  }

  private invalidatePeopleRegistry(): void {
    this._peopleRegistry = undefined;
    this._peopleRegistryCommit = undefined;
  }

  /** Lazily construct (once) and return the derived graph index. Does not force a build — `GraphIndex` itself builds on first query. */
  private getGraphIndex(): GraphIndex {
    if (!this._graphIndex) {
      this._graphIndex = new GraphIndex(this.repo, {
        loadPeopleRegistry: () => this.loadPeopleRegistry(),
        loadProjectMappings: () => this.loadProjectMappings(),
      });
    }
    return this._graphIndex;
  }

  /**
   * Fold a write/delete/rename into the graph index without forcing a build:
   * only touch it if some earlier call already constructed it (mirrors the
   * `GitMetadataCache`-style laziness other caches in this class use — an
   * anchor write before anyone has ever queried the graph should not pay for
   * a whole-tree graph build just to invalidate one document of a graph
   * nobody has built yet). Awaited by callers so the graph is consistent
   * before the write result returns; `invalidateDocument` itself is a no-op
   * (returns immediately) if the graph was never built.
   */
  private async invalidateGraphDocument(anchorName: string): Promise<void> {
    if (this._graphIndex) {
      await this._graphIndex.invalidateDocument(anchorName);
    }
  }

  async listPeople(team?: string): Promise<{ people: Person[] }> {
    const registry = await this.loadPeopleRegistry();
    if (!team) {
      return { people: registry.people };
    }
    const needle = team.toLowerCase().trim();
    const index = buildPeopleIndex(registry);
    const resolvedTeam = index.getTeam(needle);
    const teamId = resolvedTeam?.id ?? needle;
    const members = index.getTeamMembers(teamId);
    return { people: members };
  }

  async searchPeople(query: string, limit = 10): Promise<{ people: PersonSearchMatch[] }> {
    const registry = await this.loadPeopleRegistry();
    const needle = query.toLowerCase().trim();
    if (!needle) {
      return { people: [] };
    }

    const matches = registry.people.flatMap((person): Array<PersonSearchMatch & { score: number }> => {
      const aliases = person.identities?.names ?? [];
      const candidates = [person.displayName, person.id, ...aliases];
      let best: { value: string; score: number } | undefined;

      for (const candidate of candidates) {
        const normalized = candidate.toLowerCase();
        let score: number | undefined;
        if (normalized === needle) {
          score = 0;
        } else if (normalized.startsWith(needle)) {
          score = 1;
        } else if (normalized.includes(needle)) {
          score = 2;
        }
        if (score !== undefined && (!best || score < best.score || (score === best.score && candidate.length < best.value.length))) {
          best = { value: candidate, score };
        }
      }

      if (!best) {
        return [];
      }

      return [
        {
          id: person.id,
          displayName: person.displayName,
          aliases,
          matched: best.value,
          value: person.displayName,
          score: best.score,
        },
      ];
    });

    matches.sort((left, right) => left.score - right.score || left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));

    return {
      people: matches.slice(0, Math.max(1, Math.min(limit, 25))).map(({ score: _score, ...match }) => match),
    };
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
    // Registry-derived graph edges (person/team -> project RACI) live only in
    // GraphIndex's whole-tree registryEdges, which invalidateDocument cannot
    // refresh (it only re-extracts one anchor document's edges). A registry
    // write DOES also advance repo HEAD, so GraphIndex's own HEAD-keyed
    // ensureBuilt() would eventually rebuild anyway on the next query — but
    // that is an implicit, easy-to-break coincidence, not an enforced
    // invariant. Invalidate explicitly, mirroring invalidatePeopleRegistry
    // above, so registry-derived edges are never served stale even if a
    // future change decouples registry commits from anchor-tree HEAD.
    this._graphIndex?.invalidate();
  }

  async getPeopleRegistry(): Promise<PeopleRegistryWithCommit> {
    const registry = await this.loadPeopleRegistry();
    const fileCommit = await this.repo.peopleRegistryCommit();
    return { ...registry, ...(fileCommit ? { fileCommit } : {}) };
  }

  private async loadProjectMappings(): Promise<ProjectMappings> {
    // Cache keyed on the file's last commit so out-of-band changes (e.g. an
    // AutoSync rebase) are picked up instead of served stale.
    const commit = await this.repo.projectMappingsCommit();
    if (this._projectMappings !== undefined && this._projectMappingsCommit === commit) {
      return this._projectMappings;
    }
    const raw = await this.repo.readProjectMappingsRaw();
    this._projectMappings = parseProjectMappings(raw);
    this._projectMappingsCommit = commit;
    return this._projectMappings;
  }

  private invalidateProjectMappings(): void {
    this._projectMappings = undefined;
    this._projectMappingsCommit = undefined;
  }

  async getProjectMappings(): Promise<ProjectMappingsWithCommit> {
    const mappings = await this.loadProjectMappings();
    const fileCommit = await this.repo.projectMappingsCommit();
    return { ...mappings, ...(fileCommit ? { fileCommit } : {}) };
  }

  async writeProjectMappings(input: WriteProjectMappingsInput): Promise<void> {
    const normalized = parseProjectMappings(input.mappings);
    await this.repo.writeProjectMappingsRaw(normalized, {
      message: input.message,
      coAuthor: input.coAuthor,
      push: this.options.pushOnWrite,
      expectedFileCommit: input.expectedFileCommit,
    });
    this.invalidateProjectMappings();
    // See the matching comment in writePeopleRegistry: project-mappings
    // writes feed GraphIndex's registryEdges (project -> repo -> path),
    // which invalidateDocument cannot refresh. Invalidate explicitly.
    this._graphIndex?.invalidate();
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
            const content = isBuiltInAnchorName(anchor.name)
              ? readBuiltInAnchor(anchor.name)?.content
              : await this.repo.readRaw(anchor.name);
            if (content === undefined) {
              continue;
            }
            bodyCharCounts.set(anchor.name, stripFrontMatterForExcerpt(content).length);
            bm25Index.add({
              id: anchor.name,
              text: anchorBodyForSearchIndex(content),
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

  async readAnchor(
    name: string,
    version?: string,
    options: { includeProvenance?: ClaimProvenanceMode; task?: string } = {},
  ): Promise<AnchorRead> {
    const built = readBuiltInAnchor(name);
    let read: AnchorRead;
    if (built) {
      if (version && version !== "latest") {
        throw new Error("Built-in policy anchors only support the latest revision.");
      }
      read = built;
    } else {
      read = await this.repo.readAnchor(name, version);
    }
    return await this.withOptionalClaimProvenance(read, options.includeProvenance ?? "none", options.task);
  }

  /** Return a reviewable Markdown-link rewrite without mutating the anchor. */
  async suggestMarkdownLinks(name: string): Promise<MarkdownLinkSuggestionResult & { name: string; fileCommit?: string }> {
    const read = await this.readAnchor(name);
    return { name: read.name, ...(read.fileCommit ? { fileCommit: read.fileCommit } : {}), ...suggestMarkdownLinks(read.content) };
  }

  readAnchorBatch(
    names: string[],
    options: { includeProvenance?: ClaimProvenanceMode; task?: string } = {},
  ): Promise<AnchorRead[]> {
    return Promise.all(names.map((name) => this.readAnchor(name, undefined, options)));
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
      const current = await this.repo.lastRevisionForAnchor(input.name);
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

    // Provenance annotations are indented lines under claim bullets, so a
    // section rewrite that regenerates bullets silently drops them. Carry
    // valid annotations onto byte-identical unannotated bullets, and gate
    // writes that would lose annotations behind explicit approval.
    // annotateClaim opts out: it is the sanctioned single-annotation editor.
    let content = input.content;
    const carryWarnings: ValidationViolation[] = [];
    if (oldContent !== undefined && input.carryClaimAnnotations !== false) {
      const carry = carryClaimAnnotations(oldContent, content);
      content = carry.content;
      for (const entry of carry.carried) {
        carryWarnings.push({
          severity: "WARN",
          code: "claim_annotation_carried",
          message: `Carried provenance ${formatAnnotationBody(entry.annotation)} onto unchanged claim "${entry.text}"; include annotations in rewrites to avoid relying on carry-over.`,
        });
      }
      if (carry.lost.length > 0) {
        const lostList = carry.lost
          .map((entry) => `"${entry.text}" ${formatAnnotationBody(entry.annotation)}`)
          .join("; ");
        if (!input.approved) {
          return {
            warnings: [
              {
                severity: "BLOCK",
                code: "claim_annotation_lost",
                message: `This write drops provenance from ${carry.lost.length} claim(s) whose text changed or was removed: ${lostList}. Carry the annotation onto the reworded claim (re-verify if the meaning changed), use annotateClaim with clear: true, or retry with approved: true to drop it deliberately.`,
              },
              ...carryWarnings,
            ],
            requiresApproval: true,
          };
        }
        carryWarnings.push({
          severity: "WARN",
          code: "claim_annotation_lost",
          message: `Dropped provenance (approved) from: ${lostList}.`,
        });
      }
    }

    // Nudge writers to record provenance for statements they are adding now
    // (not for pre-existing legacy claims): one WARN listing the new
    // unannotated claims, so the feedback arrives while the writer still has
    // the source (PR, file, conversation) in context.
    if (input.carryClaimAnnotations !== false) {
      const missing = newlyAddedUnannotatedClaims(oldContent, content);
      if (missing.length > 0) {
        const shown = missing
          .slice(0, 5)
          .map((claim) => `"${truncateClaimText(claim.text)}"`)
          .join("; ");
        const more = missing.length > 5 ? ` (and ${missing.length - 5} more)` : "";
        carryWarnings.push({
          severity: "WARN",
          code: "claim_annotation_missing",
          message: `This write adds ${missing.length} claim(s) without provenance: ${shown}${more}. Record where each fact came from while you still have the source: append "  {src: <PR #N | repo path | anchor name | URL | person:<id>>; observed: <YYYY-MM-DD>; conf: high|medium|low}" or "  {src: trust me bro; kind: trust-me-bro; person: <id>; observed: <YYYY-MM-DD>; conf: high}" under the bullet, or use annotateClaim afterwards.`,
        });
      }
    }

    const linkSuggestions = findMarkdownLinkSuggestions(content);
    if (linkSuggestions.length > 0) {
      const shown = linkSuggestions.slice(0, 3).map((item) => `\`${item.reference}\``).join(", ");
      const more = linkSuggestions.length > 3 ? ` (and ${linkSuggestions.length - 3} more)` : "";
      carryWarnings.push({
        severity: "WARN",
        code: "markdown_link_suggested",
        message: `Found ${linkSuggestions.length} inline-code reference(s) with an unambiguous URL already in this anchor: ${shown}${more}. Use suggestMarkdownLinks to preview explicit [label](url) replacements; inline code remains literal by design.`,
      });
    }

    // Stable claim ids (WP1): every annotated claim leaves a write with an
    // immutable, tree-unique id. Mint one for any annotated claim that still
    // lacks it after carry — carried-by-id claims already have one, so this
    // only mints for genuinely new or never-annotated-before rows. Skip the
    // tree-wide walk entirely when this write touches no claims that need
    // minting or duplicate-checking (no annotated-without-id claims and no
    // ids present at all) so ordinary writes stay cheap.
    const contentClaims = extractClaims(content);
    // Only pay the tree-wide id walk when this write actually changes id state:
    // an annotated claim still needs minting, or an id appears in `content`
    // that was not already committed (so it needs a cross-tree duplicate
    // check). Frontmatter-only or unrelated-section edits leave the id set
    // untouched and skip the walk entirely, even once most anchors carry ids.
    const priorIds = oldContent !== undefined ? collectClaimIds(extractClaims(oldContent)) : new Set<string>();
    const needsMint = contentClaims.some((claim) => claim.status === "annotated" && !claim.id);
    const hasNewOrChangedId = [...collectClaimIds(contentClaims)].some((id) => !priorIds.has(id));
    const needsIdWork = needsMint || hasNewOrChangedId;
    if (needsIdWork) {
      // Uniqueness set is every id already in the tree, this anchor excluded
      // (its own ids come from `content`, which reflects the in-flight write).
      const treeIdsExcludingThisAnchor = await this.collectTreeClaimIds(resolved.name);
      const mintResult = mintMissingClaimIds(content, treeIdsExcludingThisAnchor);
      content = mintResult.content;
      for (const entry of mintResult.minted) {
        carryWarnings.push({
          severity: "WARN",
          code: "claim_id_minted",
          message: `Minted claim id ${entry.id} for claim "${truncateClaimText(entry.text)}" (no id was present after this write).`,
        });
      }

      // Duplicate ids block: within this write's own content, or colliding
      // with an id that already exists elsewhere in the tree.
      const idBlocks = duplicateClaimIdViolations(content, treeIdsExcludingThisAnchor);
      if (idBlocks.length > 0) {
        return {
          warnings: [...idBlocks, ...carryWarnings],
          requiresApproval: false,
        };
      }
    }

    const violations = await runValidators({
      name: resolved.name,
      path: resolved.path,
      oldContent,
      newContent: content,
      repo: this.repo,
      migrationWarnOnly: this.options.migrationWarnOnly,
      approved: input.approved ?? false,
    });
    const blocks = violations.filter((violation) => violation.severity === "BLOCK");
    const warnings = [...violations.filter((violation) => violation.severity === "WARN"), ...carryWarnings];

    if (blocks.length > 0) {
      const approvalBlock = blocks.some((violation) => violation.code === "requires_approval");
      return {
        warnings: [...blocks, ...warnings],
        requiresApproval: approvalBlock,
      };
    }

    const version = await this.repo.commitAnchor({
      name: input.name,
      content,
      message: input.message,
      sectionsChanged: oldContent !== undefined ? changedSections(oldContent, content) : undefined,
      lastValidatedChanged: oldContent !== undefined ? lastValidatedChanged(oldContent, content) : undefined,
      coAuthor: input.coAuthor,
      push: this.options.pushOnWrite,
    });
    await this.invalidateGraphDocument(resolved.name);

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
      const current = await this.repo.lastRevisionForAnchor(input.name);
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
      await this.invalidateGraphDocument(resolved.name);
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
      const current = await this.repo.lastRevisionForAnchor(input.from);
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
      await this.invalidateGraphDocument(fromResolved.name);
      await this.invalidateGraphDocument(toResolved.name);
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

    return this.updateTaskInMilestone(input, (task) => {
      if (input.due === null) {
        delete task.due;
        delete task.date_confidence;
      } else {
        task.due = input.due;
        task.date_confidence = input.dateConfidence;
      }
      return task;
    });
  }

  async updateTaskOwner(input: UpdateTaskOwnerInput): Promise<WriteAnchorResult> {
    return this.updateTaskInMilestone(input, (task) => {
      const owner = input.owner?.trim() ?? "";
      if (owner) {
        task.owner = owner;
      } else {
        delete task.owner;
      }
      return task;
    });
  }

  async updateTaskPriority(input: UpdateTaskPriorityInput): Promise<WriteAnchorResult> {
    const priorityViolation = validateTaskPriorityValue(input.priority);
    if (priorityViolation) {
      return { warnings: [priorityViolation], requiresApproval: false };
    }

    return this.updateTaskInMilestone(input, (task) => {
      if (input.priority === null) {
        delete task.priority;
      } else {
        task.priority = input.priority;
      }
      return task;
    });
  }

  async updateTaskNotes(input: UpdateTaskNotesInput): Promise<WriteAnchorResult> {
    return this.updateTaskInMilestone(input, (task) => {
      const notes = input.notes?.trim() ?? "";
      if (notes) {
        task.notes = notes;
      } else {
        delete task.notes;
      }
      return task;
    });
  }

  private async updateTaskInMilestone(
    input: {
      name: string;
      taskId: string;
      message?: string;
      approved?: boolean;
      coAuthor?: string;
      expectedFileCommit?: string;
    },
    updateTask: (task: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<WriteAnchorResult> {
    if (!AnchorService.isMilestonePath(input.name)) {
      return AnchorService.blockResult(
        "invalid_milestone",
        `name must be a project milestone anchor under .../milestones/: ${input.name}`,
      );
    }
    const rawContent = await this.repo.readRaw(input.name);
    if (rawContent === undefined) {
      return AnchorService.blockResult("missing_anchor", `Anchor not found: ${input.name}`);
    }

    const parsed = parseAnchor(rawContent);
    const rawTasks = parsed.frontmatter.tasks;
    if (!Array.isArray(rawTasks)) {
      return AnchorService.blockResult("no_tasks", `Anchor has no tasks array: ${input.name}`);
    }

    const taskIdx = rawTasks.findIndex(
      (t): t is Record<string, unknown> =>
        !!t && typeof t === "object" && !Array.isArray(t) && (t as Record<string, unknown>).id === input.taskId,
    );

    if (taskIdx === -1) {
      return AnchorService.blockResult("task_not_found", `Task "${input.taskId}" not found in ${input.name}`);
    }

    const updatedTasks = rawTasks.map((t, i) => {
      if (i !== taskIdx || typeof t !== "object" || !t) return t;
      return updateTask({ ...(t as Record<string, unknown>) });
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

  /**
   * True when `name` is a project milestone anchor (`projects/<slug>/milestones/...`).
   * Optionally require it to belong to `projectSlug`. Task mutations are restricted
   * to milestone anchors so they stay visible to listTasksDue and share its id space.
   */
  private static isMilestonePath(name: string, projectSlug?: string): boolean {
    const c = classifyAnchorPath(name);
    if (c.kind !== "anchor" || c.category !== "projects" || !name.includes("/milestones/")) return false;
    if (projectSlug && c.projectSlug !== projectSlug) return false;
    return true;
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
    const priorityViolation = validateTaskPriorityValue(input.priority);
    if (priorityViolation) {
      return {
        ...AnchorService.blockResult(priorityViolation.code, priorityViolation.message),
        requiresApproval: false,
      };
    }

    const { effectiveProject } = await this.resolveProjectFilter(input.project);
    const projectSlug = effectiveProject ?? input.project;
    if (!projectSlug) {
      return AnchorService.blockResult("missing_project", "project is required to create a task.");
    }

    // An explicit milestone target must be a project milestone for this project,
    // otherwise the task would be invisible to listTasksDue and outside the
    // project's task-id space (risking duplicate ids).
    if (input.milestone && !AnchorService.isMilestonePath(input.milestone, projectSlug)) {
      return AnchorService.blockResult(
        "invalid_milestone",
        `milestone must be a project milestone under projects/${projectSlug}/milestones/: ${input.milestone}`,
      );
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
    if (input.priority !== undefined) task.priority = input.priority;
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
    if (input.name && !AnchorService.isMilestonePath(input.name)) {
      return AnchorService.blockResult(
        "invalid_milestone",
        `name must be a project milestone anchor under .../milestones/: ${input.name}`,
      );
    }
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

  async reopenTask(input: ReopenTaskInput): Promise<WriteAnchorResult> {
    if (input.name && !AnchorService.isMilestonePath(input.name)) {
      return AnchorService.blockResult(
        "invalid_milestone",
        `name must be a project milestone anchor under .../milestones/: ${input.name}`,
      );
    }
    const name = await this.findTaskMilestone(input.taskId, { name: input.name, project: input.project });
    if (!name) {
      return AnchorService.blockResult("task_not_found", `Task "${input.taskId}" not found.`);
    }
    const rawTasks = await this.readRawTasks(name);
    if (rawTasks === undefined) {
      return AnchorService.blockResult("missing_anchor", `Milestone anchor not found: ${name}`);
    }
    const updatedTasks = rawTasks.map((t) => {
      if (t.id !== input.taskId) return t;
      const reopened: Record<string, unknown> = { ...t, status: "todo" };
      delete reopened.completed_on;
      return reopened;
    });

    return this.updateAnchorFrontmatter({
      name,
      updates: { tasks: updatedTasks },
      message: input.message ?? `chore: reopen task ${input.taskId}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async deleteTask(input: DeleteTaskInput): Promise<WriteAnchorResult> {
    if (input.name && !AnchorService.isMilestonePath(input.name)) {
      return AnchorService.blockResult(
        "invalid_milestone",
        `name must be a project milestone anchor under .../milestones/: ${input.name}`,
      );
    }
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
    const hasCompletedWindow = Boolean(input.completedAfter || input.completedBefore);
    const hasDueWindow = Boolean(input.noDue || input.dueAfter || input.dueBefore);
    const defaultStatuses = hasCompletedWindow
      ? new Set(["active", "todo", "blocked", "done"])
      : DEFAULT_STATUSES;
    const statusFilter = input.status && input.status.length > 0 ? new Set(input.status) : defaultStatuses;

    const registry = await this.loadPeopleRegistry();
    const peopleIndex = buildPeopleIndex(registry);

    const ownerFilter = input.owner ? peopleIndex.resolveOwner(input.owner) : undefined;
    const ownerFilterRaw = input.owner?.toLowerCase().trim();

    const rows: TaskDueRow[] = [];

    for (const milestone of milestones) {
      if (!milestone.tasks) continue;

      const classification = classifyAnchorPath(milestone.name);
      const projectSlug = classification.kind === "anchor" ? classification.projectSlug : undefined;
      if (input.maxProjectPriority !== undefined) {
        if (milestone.projectPriority === undefined || milestone.projectPriority > input.maxProjectPriority) {
          continue;
        }
      }
      if (input.modifiedAfter !== undefined) {
        if (!milestone.updatedAt || milestone.updatedAt.slice(0, 10) < input.modifiedAfter) {
          continue;
        }
      }

      for (const task of milestone.tasks) {
        if (!statusFilter.has(task.status)) continue;

        if (input.unassigned && task.owner && task.owner.trim().length > 0) continue;
        if (input.maxTaskPriority !== undefined) {
          if (task.priority === undefined || task.priority > input.maxTaskPriority) continue;
        }

        const matchesDueWindow = taskMatchesDueWindow(task, input);
        const matchesCompletedWindow = taskMatchesCompletedWindow(task, input);
        if (hasDueWindow && hasCompletedWindow && !input.noDue) {
          if (!matchesDueWindow && !matchesCompletedWindow) continue;
        } else {
          if (!matchesDueWindow || !matchesCompletedWindow) continue;
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
          ...(task.priority !== undefined ? { taskPriority: task.priority } : {}),
          ...(task.due ? { due: task.due } : {}),
          ...(task.completedOn ? { completedOn: task.completedOn } : {}),
          ...(task.dateConfidence ? { dateConfidence: task.dateConfidence } : {}),
          ...(task.notes ? { notes: task.notes } : {}),
          milestoneName: milestone.name,
          ...(milestone.displayId ? { milestoneDisplayId: milestone.displayId } : {}),
          milestoneStatus: milestone.status,
          ...(milestone.updatedAt ? { milestoneUpdatedAt: milestone.updatedAt } : {}),
          ...(milestone.createdAt ? { milestoneCreatedAt: milestone.createdAt } : {}),
          ...(projectSlug ? { project: projectSlug } : {}),
          ...(milestone.projectPriority !== undefined ? { projectPriority: milestone.projectPriority } : {}),
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

  /**
   * Every claim id currently in the tree, for id-minting uniqueness checks
   * (WP1). Walks all anchors the same way `listClaims` does. `excludeAnchor`
   * skips one anchor's on-disk content (the anchor currently being written,
   * whose ids the caller supplies separately from its in-flight content).
   */
  private async collectTreeClaimIds(excludeAnchor?: string): Promise<Set<string>> {
    const metas = await this.repo.listAnchors();
    const ids = new Set<string>();
    for (const meta of metas) {
      if (isBuiltInAnchorName(meta.name) || meta.name === excludeAnchor) {
        continue;
      }
      const content = await this.repo.readRaw(meta.name);
      if (content === undefined) {
        continue;
      }
      for (const id of collectClaimIds(extractClaims(content))) {
        ids.add(id);
      }
    }
    return ids;
  }

  async listClaims(input: {
    name?: string;
    project?: string;
    status?: ClaimStatus;
    section?: string;
    conf?: string;
    q?: string;
    observedBefore?: string;
    observedAfter?: string;
  } = {}): Promise<{
    claims: (AnchorClaim & { anchor: string })[];
    summary: { total: number; annotated: number; unannotated: number; malformed: number };
    projectFilter?: ProjectFilterResolution;
  }> {
    let names: string[];
    let projectFilter: ProjectFilterResolution | undefined;

    if (input.name) {
      names = [this.repo.resolveAnchor(input.name).name];
    } else {
      const resolved = await this.resolveProjectFilter(input.project);
      projectFilter = resolved.projectFilter;
      const metas = await this.repo.listAnchors(
        resolved.effectiveProject ? { project: resolved.effectiveProject } : {},
      );
      names = metas.map((meta) => meta.name);
    }

    const allClaims: (AnchorClaim & { anchor: string })[] = [];
    const mappings = await this.loadProjectMappings();
    const anchorNames = new Set((await this.repo.listAnchors()).map((meta) => meta.name));
    const peopleIndex = buildPeopleIndex(await this.loadPeopleRegistry());
    for (const name of names) {
      if (isBuiltInAnchorName(name)) {
        continue;
      }
      const content = await this.repo.readRaw(name);
      if (content === undefined) {
        continue;
      }
      for (const claim of extractClaims(content)) {
        allClaims.push({ anchor: name, ...this.withResolvedSourceLinks(name, claim, mappings, anchorNames, peopleIndex) });
      }
    }

    // Coverage summary always reflects the full scope; filters apply only to the returned list.
    const summary = {
      total: allClaims.length,
      annotated: allClaims.filter((claim) => claim.status === "annotated").length,
      unannotated: allClaims.filter((claim) => claim.status === "unannotated").length,
      malformed: allClaims.filter((claim) => claim.status === "malformed").length,
    };

    const needle = input.q?.trim().toLowerCase();
    const claims = allClaims.filter((claim) => {
      if (input.status && claim.status !== input.status) {
        return false;
      }
      if (input.section && claim.section !== input.section) {
        return false;
      }
      if (input.conf && !claim.sources.some((source) => source.conf === input.conf)) {
        return false;
      }
      if (
        needle &&
        !claim.text.toLowerCase().includes(needle) &&
        !claim.sources.some((source) => claimSourceSearchText(source).includes(needle))
      ) {
        return false;
      }
      if (input.observedBefore) {
        const cutoff = input.observedBefore;
        if (!claim.sources.some((source) => source.observed < cutoff)) {
          return false;
        }
      }
      if (input.observedAfter) {
        const cutoff = input.observedAfter;
        if (!claim.sources.some((source) => source.observed >= cutoff)) {
          return false;
        }
      }
      return true;
    });

    return { claims, summary, ...(projectFilter ? { projectFilter } : {}) };
  }

  async listQuestions(input: ListQuestionsInput = {}): Promise<ListQuestionsResult> {
    let names: string[];
    let projectFilter: ProjectFilterResolution | undefined;

    if (input.name) {
      names = [this.repo.resolveAnchor(input.name).name];
    } else {
      const resolved = await this.resolveProjectFilter(input.project);
      projectFilter = resolved.projectFilter;
      const metas = await this.repo.listAnchors(
        resolved.effectiveProject ? { project: resolved.effectiveProject } : {},
      );
      names = metas.map((meta) => meta.name);
    }

    const allQuestions: ListQuestionsResult["questions"] = [];
    for (const name of names) {
      if (isBuiltInAnchorName(name)) {
        continue;
      }
      const content = await this.repo.readRaw(name);
      if (content === undefined) {
        continue;
      }
      for (const question of extractQuestions(content)) {
        allQuestions.push({ anchor: name, ...question });
      }
    }

    const summary = questionSummary(allQuestions);
    const needle = input.q?.trim().toLowerCase();
    const questions = allQuestions.filter((question) => {
      if (input.status && question.status !== input.status) {
        return false;
      }
      if (needle && !questionSearchText(question).includes(needle)) {
        return false;
      }
      return true;
    });

    return { questions, summary, ...(projectFilter ? { projectFilter } : {}) };
  }

  async resolveQuestion(input: ResolveQuestionInput): Promise<WriteAnchorResult> {
    const target = questionTargetFromInput(input);
    if (!target) {
      return AnchorService.blockResult(
        "question_target_missing",
        "resolveQuestion requires a line number, question id, or question text fragment.",
      );
    }
    const status = input.status ?? "resolved";
    const resolvedOn = input.resolvedOn ?? AnchorService.today();
    const existing = await this.repo.readRaw(input.name);
    if (existing !== undefined) {
      const location = locateQuestion(existing, target);
      if (!location.ok) {
        return questionLocationBlock(input.name, target, location);
      }
    }

    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message ?? `chore: ${status} question in ${input.name}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) =>
        setQuestionStatus(old, target, {
          status,
          ...(input.resolution ? { resolution: input.resolution } : {}),
          resolvedOn,
          ...(input.owner ? { owner: input.owner } : {}),
        }),
    });
  }

  async reopenQuestion(input: ReopenQuestionInput): Promise<WriteAnchorResult> {
    const target = questionTargetFromInput(input);
    if (!target) {
      return AnchorService.blockResult(
        "question_target_missing",
        "reopenQuestion requires a line number, question id, or question text fragment.",
      );
    }
    const existing = await this.repo.readRaw(input.name);
    if (existing !== undefined) {
      const location = locateQuestion(existing, target);
      if (!location.ok) {
        return questionLocationBlock(input.name, target, location);
      }
    }

    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message ?? `chore: reopen question in ${input.name}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) =>
        setQuestionStatus(old, target, {
          status: "open",
          ...(input.owner ? { owner: input.owner } : {}),
        }),
    });
  }

  async updateQuestionText(input: UpdateQuestionTextInput): Promise<WriteAnchorResult> {
    const target = questionTextTargetFromInput(input);
    if (!target) {
      return AnchorService.blockResult(
        "question_target_missing",
        "updateQuestionText requires a line number, question id, or question text fragment.",
      );
    }
    if (input.delete && !input.approved) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message:
              "updateQuestionText delete removes a question bullet and its attached metadata lines; retry with approved: true after explicit confirmation.",
          },
        ],
        requiresApproval: true,
      };
    }

    const text = input.text?.trim();
    if (!input.delete) {
      if (!text) {
        return AnchorService.blockResult("question_text_missing", "Question text is required.");
      }
      if (/[\r\n]/.test(text)) {
        return AnchorService.blockResult("question_text_multiline", "Question text must be a single line.");
      }
    }

    const existing = await this.repo.readRaw(input.name);
    if (existing !== undefined) {
      const location = locateQuestion(existing, target);
      if (!location.ok) {
        return questionLocationBlock(input.name, target, location);
      }
    }

    return this.applyAnchorContentPatch({
      name: input.name,
      message:
        input.message ??
        (input.delete ? `chore: delete question in ${input.name}` : `chore: update question text in ${input.name}`),
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => (input.delete ? deleteQuestion(old, target) : replaceQuestionText(old, target, text as string)),
    });
  }

  async updateBulletText(input: UpdateBulletTextInput): Promise<WriteAnchorResult> {
    if (!Number.isInteger(input.line) || input.line < 1) {
      return AnchorService.blockResult("editable_bullet_line_invalid", "Line must be a positive integer.");
    }
    if (input.delete && !input.approved) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message:
              "updateBulletText delete removes a rendered bullet and its attached continuation lines; retry with approved: true after explicit confirmation.",
          },
        ],
        requiresApproval: true,
      };
    }

    const text = input.text?.trim();
    if (!input.delete) {
      if (!text) {
        return AnchorService.blockResult("editable_bullet_text_missing", "Bullet text is required.");
      }
      if (/[\r\n]/.test(text)) {
        return AnchorService.blockResult("editable_bullet_text_multiline", "Bullet text must be a single line.");
      }
    }

    const existing = await this.repo.readRaw(input.name);
    if (existing !== undefined) {
      const location = locateEditableBullet(existing, input.line);
      if (!location.ok) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: location.code,
              message:
                location.code === "editable_bullet_not_allowed"
                  ? `Line ${input.line} in ${input.name} is not in an editable rendered-bullet section.`
                  : `No editable rendered bullet found at line ${input.line} in ${input.name}.`,
            },
          ],
        };
      }
    }

    return this.applyAnchorContentPatch({
      name: input.name,
      message:
        input.message ??
        (input.delete ? `chore: delete rendered bullet in ${input.name}` : `chore: update rendered bullet in ${input.name}`),
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) =>
        input.delete ? deleteEditableBullet(old, input.line) : replaceEditableBulletText(old, input.line, text as string),
    });
  }

  private withResolvedSourceLinks(
    anchorName: string,
    claim: AnchorClaim,
    mappings: ProjectMappings,
    anchorNames: Set<string>,
    peopleIndex: PeopleIndex,
  ): AnchorClaim {
    const sources = claim.sources.map((source) => {
      const person = source.person
        ? peopleIndex.getPersonById(source.person) ?? peopleIndex.getPerson(source.person)
        : undefined;
      const href =
        source.kind === TRUST_ME_BRO_KIND
          ? undefined
          : this.resolveClaimSourceHref(anchorName, source.src, mappings, anchorNames, peopleIndex);
      return {
        ...source,
        ...(person ? { person: person.id, personName: person.displayName } : {}),
        ...(href ? { href } : {}),
      };
    });
    return {
      ...claim,
      sources,
      ...(sources[0] ? { annotation: sources[0] } : {}),
    };
  }

  private withResolvedMermaidSourceLinks(
    anchorName: string,
    block: MermaidBlock,
    mappings: ProjectMappings,
    anchorNames: Set<string>,
    peopleIndex: PeopleIndex,
  ): MermaidBlock {
    const sources = block.sources.map((source) => {
      const person = source.person
        ? peopleIndex.getPersonById(source.person) ?? peopleIndex.getPerson(source.person)
        : undefined;
      const href =
        source.kind === TRUST_ME_BRO_KIND
          ? undefined
          : this.resolveClaimSourceHref(anchorName, source.src, mappings, anchorNames, peopleIndex);
      return {
        ...source,
        ...(person ? { person: person.id, personName: person.displayName } : {}),
        ...(href ? { href } : {}),
      };
    });
    return {
      ...block,
      sources,
      ...(sources[0] ? { annotation: sources[0] } : {}),
    };
  }

  private async withOptionalClaimProvenance(
    read: AnchorRead,
    mode: ClaimProvenanceMode,
    task?: string,
  ): Promise<AnchorRead> {
    if (mode === "none") {
      return read;
    }
    return {
      ...read,
      claimProvenance: await this.buildAnchorClaimProvenance(read.name, read.content, mode, task),
    };
  }

  private async withLoadContextProvenance(
    row: LoadContextAnchor,
    read: AnchorRead,
    mode: ClaimProvenanceMode,
    task?: string,
  ): Promise<LoadContextAnchor> {
    if (mode === "none") {
      return row;
    }
    return {
      ...row,
      claimProvenance: await this.buildAnchorClaimProvenance(read.name, read.content, mode, task),
    };
  }

  private async buildAnchorClaimProvenance(
    anchorName: string,
    content: string,
    mode: Exclude<ClaimProvenanceMode, "none">,
    task?: string,
  ): Promise<AnchorClaimProvenance> {
    const claims = await this.extractResolvedClaims(anchorName, content);
    const summary = summarizeClaimProvenance(claims);
    if (mode === "summary") {
      return { mode, summary };
    }

    const selectedClaims = mode === "full" ? claims : selectRelevantProvenanceClaims(claims, task);
    return {
      mode,
      summary,
      claims: selectedClaims,
      ...(mode === "relevant" && selectedClaims.length < claims.length ? { claimsTruncated: true } : {}),
    };
  }

  private async extractResolvedClaims(anchorName: string, content: string): Promise<AnchorClaim[]> {
    const mappings = await this.loadProjectMappings();
    const anchorNames = new Set((await this.repo.listAnchors()).map((meta) => meta.name));
    const peopleIndex = buildPeopleIndex(await this.loadPeopleRegistry());
    return extractClaims(content).map((claim) =>
      this.withResolvedSourceLinks(anchorName, claim, mappings, anchorNames, peopleIndex),
    );
  }

  private async buildContextProvenanceSummary(names: string[]): Promise<ContextProvenanceSummary> {
    const anchors: ContextProvenanceSummary["anchors"] = [];
    for (const name of names) {
      if (isBuiltInAnchorName(name)) {
        continue;
      }
      const content = await this.repo.readRaw(name);
      if (content === undefined) {
        continue;
      }
      const summary = summarizeClaimProvenance(await this.extractResolvedClaims(name, content));
      anchors.push({ name, summary });
    }
    return {
      mode: "summary",
      summary: mergeClaimProvenanceSummaries(anchors.map((anchor) => anchor.summary)),
      anchors,
    };
  }

  /**
   * Resolve a claim source's UI/API href. Delegates node classification to
   * `parseClaimSource` (the single source-string classifier, `src/graph/sourceId.ts`)
   * so links and canonical node ids can never diverge; this method only turns
   * the resulting node into a concrete href (repo web URL, or a `/ui?anchor=`
   * deep link for anchor/section nodes).
   */
  private resolveClaimSourceHref(
    anchorName: string,
    src: string,
    mappings: ProjectMappings,
    anchorNames: Set<string>,
    peopleIndex?: PeopleIndex,
  ): string | undefined {
    const value = src.trim();
    if (!value) {
      return undefined;
    }

    const parsed = parseClaimSource(
      { src: value },
      this.claimSourceContext(anchorName, mappings, anchorNames, peopleIndex),
    );
    const node = parsed.node;
    if (!node) {
      return undefined;
    }

    switch (node.type) {
      case "url":
        return isHttpUrl(value) ? value : undefined;
      case "anchor":
        return `/ui?anchor=${encodeURIComponent(node.nodeId.slice("anchor:".length))}`;
      case "section":
        return `/ui?anchor=${encodeURIComponent(sectionNodeAnchorName(node.nodeId))}`;
      case "pr": {
        const projectMapping = this.projectMappingForAnchorName(anchorName, mappings);
        if (!projectMapping) {
          return undefined;
        }
        const prefixed = parseRepoPrefixedSource(value);
        const prNumber = parsePullRequestSource(prefixed.path);
        if (prNumber === undefined) {
          return undefined;
        }
        const repo = this.selectMappedRepo(projectMapping.repos, prefixed.repo, undefined);
        return repo ? repoPullRequestUrl(repo, prNumber) : undefined;
      }
      case "file": {
        const projectMapping = this.projectMappingForAnchorName(anchorName, mappings);
        if (!projectMapping) {
          return undefined;
        }
        const prefixed = parseRepoPrefixedSource(value);
        const parsedFile = parseFileSource(prefixed.path);
        if (!parsedFile) {
          return undefined;
        }
        const repo = this.selectMappedRepo(projectMapping.repos, prefixed.repo, parsedFile.path);
        return repo ? repoFileUrl(repo, parsedFile.path, parsedFile.line) : undefined;
      }
      case "person":
        return undefined;
    }
  }

  private projectMappingForAnchorName(
    anchorName: string,
    mappings: ProjectMappings,
  ): ProjectMapping | undefined {
    const anchorClassification = classifyAnchorPath(anchorName);
    const anchorProject = anchorClassification.kind === "anchor" ? anchorClassification.projectSlug : undefined;
    return anchorProject
      ? mappings.projects.find((mapping) => mapping.project.toLowerCase() === anchorProject.toLowerCase())
      : undefined;
  }

  /**
   * Build the shared `parseClaimSource` context for one anchor's claim sources.
   * `sectionTitlesByAnchor` is an optional pre-loaded map (resolved anchor name
   * -> its H2 section titles) for callers that need dangling-heading detection
   * (the write-path validator); read-path link resolution omits it since a
   * dangling heading still links to the anchor page.
   */
  private claimSourceContext(
    anchorName: string,
    mappings: ProjectMappings,
    anchorNames: Set<string>,
    peopleIndex?: PeopleIndex,
    sectionTitlesByAnchor?: ReadonlyMap<string, ReadonlySet<string>>,
  ): ParseClaimSourceContext {
    return {
      anchorName,
      anchorNames,
      resolveAnchorName: (value: string) => this.resolveSourceAnchorName(value, anchorNames),
      getAnchorSectionTitles: (resolvedAnchorName: string) => sectionTitlesByAnchor?.get(resolvedAnchorName),
      mappings,
      resolvePersonId: (rawPerson: string) => {
        const person = peopleIndex?.getPersonById(rawPerson) ?? peopleIndex?.getPerson(rawPerson);
        return person?.id;
      },
    };
  }

  private resolveSourceAnchorName(value: string, anchorNames: Set<string>): string | undefined {
    try {
      const resolved = this.repo.resolveAnchor(value).name;
      return anchorNames.has(resolved) ? resolved : undefined;
    } catch {
      return undefined;
    }
  }

  private selectMappedRepo(
    repos: ProjectRepoMapping[],
    requestedRepo: string | undefined,
    filePath: string | undefined,
  ): ProjectRepoMapping | undefined {
    const webRepos = requestedRepo
      ? repos.filter((repo) => repo.repo.toLowerCase() === requestedRepo.toLowerCase() && repo.web?.url)
      : repos.filter((repo) => repo.web?.url);
    if (webRepos.length === 0) {
      return undefined;
    }
    if (requestedRepo) {
      return webRepos.length === 1 ? webRepos[0] : undefined;
    }
    if (filePath) {
      const pathMatches = webRepos.filter((repo) =>
        repo.paths.length > 0 && repo.paths.some((dirPath) => isWithinPath(filePath, dirPath)),
      );
      if (pathMatches.length === 1) {
        return pathMatches[0];
      }
    }
    return webRepos.length === 1 ? webRepos[0] : undefined;
  }

  async annotateClaim(input: {
    name: string;
    claim: string;
    src?: string;
    observed?: string;
    conf?: string;
    id?: string;
    kind?: string;
    person?: string;
    derivedFrom?: string;
    contradicts?: string;
    clear?: boolean;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.setClaimSources({
      name: input.name,
      claim: input.claim,
      sources: input.clear
        ? []
        : [
            {
              src: input.src ?? "",
              observed: input.observed ?? "",
              conf: input.conf ?? "",
              ...(input.id ? { id: input.id } : {}),
              ...(input.kind ? { kind: input.kind } : {}),
              ...(input.person ? { person: input.person } : {}),
              ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
              ...(input.contradicts ? { contradicts: input.contradicts } : {}),
            },
          ],
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async setClaimSources(input: {
    name: string;
    claim?: string;
    line?: number;
    sources: Array<{
      src?: string;
      observed?: string;
      conf?: string;
      id?: string;
      kind?: string;
      person?: string;
      derivedFrom?: string;
      contradicts?: string;
    }>;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    const parsedSources = parseClaimSourceInputs(input.sources);
    if (!parsedSources.ok) {
      return {
        warnings: parsedSources.errors.map((error) => ({
          severity: "BLOCK" as const,
          code: "claim_annotation_invalid",
          message: error,
        })),
      };
    }
    const normalizedSources = await this.normalizeClaimSources(parsedSources.sources);
    if (!normalizedSources.ok) {
      return {
        warnings: normalizedSources.errors.map((error) => ({
          severity: "BLOCK" as const,
          code: "claim_annotation_invalid",
          message: error,
        })),
      };
    }

    let target: { line: number } | { claim: string } | undefined;
    if (input.line !== undefined) {
      target = { line: input.line };
    } else if (input.claim) {
      target = { claim: input.claim };
    }
    if (!target) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "claim_target_missing",
            message: "setClaimSources requires either a claim text fragment or a line number.",
          },
        ],
      };
    }

    const content = await this.repo.readRaw(input.name);
    let existingId: string | undefined;
    if (content !== undefined) {
      const location = "line" in target ? locateClaimByLine(content, target.line) : locateClaim(content, target.claim);
      if (!location.ok) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: location.code,
              message:
                location.code === "claim_not_found"
                  ? `No claim in ${input.name} matches ${
                      "line" in target ? `line ${target.line}` : `"${target.claim}"`
                    }. Claims are top-level bullets in Current State, Decisions, or Constraints.`
                  : `Claim match "${"claim" in target ? target.claim : `line ${target.line}`}" is ambiguous in ${input.name}. Matches: ${location.candidates
                      .map((candidate) => `"${candidate}"`)
                      .join(", ")}. Use a longer unique fragment.`,
            },
          ],
        };
      }
      existingId = location.claim.id;
    }

    // Stable claim ids are immutable (WP1): re-supplying the same id or
    // omitting it (preserved below) is fine, but changing an existing id would
    // break already-published `<anchor>#<id>` references. Block an attempted
    // change; the sanctioned way to drop an id is to clear the provenance
    // (`sources: []`) first and then re-add.
    if (existingId && normalizedSources.sources.some((source) => source.id && source.id !== existingId)) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "claim_id_immutable",
            message: `Claim already has stable id "${existingId}"; ids are immutable so cross-anchor "<anchor>#<id>" references stay valid. To change it, clear the provenance (sources: []) first, then re-add.`,
          },
        ],
      };
    }

    // Preserve the claim's existing id across a source replacement (WP1):
    // setClaimSources overwrites the full row set, so an id the caller did
    // not resupply must be re-attached rather than silently dropped and
    // re-minted as a new (different) id. An explicit empty `sources: []`
    // (clear) still drops the id with the rest of the provenance by design.
    const sourcesWithId =
      existingId && normalizedSources.sources.length > 0 && !normalizedSources.sources.some((source) => source.id)
        ? [{ ...normalizedSources.sources[0], id: existingId }, ...normalizedSources.sources.slice(1)]
        : normalizedSources.sources;

    return this.applyAnchorContentPatch({
      name: input.name,
      message:
        input.message ??
        (normalizedSources.sources.length === 0
          ? `chore: clear claim provenance in ${input.name}`
          : `chore: set claim provenance in ${input.name}`),
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      // This is the sanctioned source editor: carry/loss guarding would
      // resurrect cleared annotations or block intentional source changes.
      carryClaimAnnotations: false,
      mutate: (old) => upsertClaimSources(old, target, sourcesWithId),
    });
  }

  async listMermaidBlocks(input: { name: string }): Promise<{ blocks: (MermaidBlock & { anchor: string })[] }> {
    const content = await this.repo.readRaw(input.name);
    if (content === undefined) {
      return { blocks: [] };
    }
    const mappings = await this.loadProjectMappings();
    const anchorNames = new Set((await this.repo.listAnchors()).map((meta) => meta.name));
    const peopleIndex = buildPeopleIndex(await this.loadPeopleRegistry());
    return {
      blocks: extractMermaidBlocks(content).map((block) => ({
        ...this.withResolvedMermaidSourceLinks(input.name, block, mappings, anchorNames, peopleIndex),
        anchor: input.name,
      })),
    };
  }

  async setMermaidBlockSources(input: {
    name: string;
    line: number;
    sources: Array<{ src?: string; observed?: string; conf?: string; id?: string; kind?: string; person?: string }>;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    const parsedSources = parseClaimSourceInputs(input.sources);
    if (!parsedSources.ok) {
      return {
        warnings: parsedSources.errors.map((error) => ({
          severity: "BLOCK" as const,
          code: "claim_annotation_invalid",
          message: error,
        })),
      };
    }
    const normalizedSources = await this.normalizeClaimSources(parsedSources.sources);
    if (!normalizedSources.ok) {
      return {
        warnings: normalizedSources.errors.map((error) => ({
          severity: "BLOCK" as const,
          code: "claim_annotation_invalid",
          message: error,
        })),
      };
    }

    return this.applyAnchorContentPatch({
      name: input.name,
      message:
        input.message ??
        (normalizedSources.sources.length === 0
          ? `chore: clear Mermaid provenance in ${input.name}`
          : `chore: set Mermaid provenance in ${input.name}`),
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      carryClaimAnnotations: false,
      mutate: (old) => upsertMermaidBlockSources(old, input.line, normalizedSources.sources),
    });
  }

  async updateMermaidBlockText(input: {
    name: string;
    line: number;
    text?: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    const text = input.text?.trim();
    if (!text) {
      return AnchorService.blockResult("mermaid_text_missing", "Mermaid diagram text is required.");
    }
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message ?? `chore: update Mermaid diagram in ${input.name}`,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => replaceMermaidBlockText(old, input.line, text),
    });
  }

  async updateClaimText(input: {
    name: string;
    claim?: string;
    line?: number;
    text?: string;
    delete?: boolean;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    let target: { line: number } | { claim: string } | undefined;
    if (input.line !== undefined) {
      target = { line: input.line };
    } else if (input.claim) {
      target = { claim: input.claim };
    }
    if (!target) {
      return AnchorService.blockResult(
        "claim_target_missing",
        "updateClaimText requires either a claim text fragment or a line number.",
      );
    }
    if (input.delete && !input.approved) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "requires_approval",
            message:
              "updateClaimText delete removes a claim bullet and its attached provenance lines; retry with approved: true after explicit confirmation.",
          },
        ],
        requiresApproval: true,
      };
    }

    const text = input.text?.trim();
    if (!input.delete) {
      if (!text) {
        return AnchorService.blockResult("claim_text_missing", "Claim text is required.");
      }
      if (/[\r\n]/.test(text)) {
        return AnchorService.blockResult("claim_text_multiline", "Claim text must be a single line.");
      }
    }

    const content = await this.repo.readRaw(input.name);
    if (content !== undefined) {
      const location = "line" in target ? locateClaimByLine(content, target.line) : locateClaim(content, target.claim);
      if (!location.ok) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: location.code,
              message:
                location.code === "claim_not_found"
                  ? `No claim in ${input.name} matches ${
                      "line" in target ? `line ${target.line}` : `"${target.claim}"`
                    }. Claims are top-level bullets in Current State, Decisions, or Constraints.`
                  : `Claim match "${"claim" in target ? target.claim : `line ${target.line}`}" is ambiguous in ${input.name}. Matches: ${location.candidates
                      .map((candidate) => `"${candidate}"`)
                      .join(", ")}. Use a longer unique fragment.`,
            },
          ],
        };
      }
    }

    return this.applyAnchorContentPatch({
      name: input.name,
      lastValidated: localDateKey(),
      message:
        input.message ??
        (input.delete ? `chore: delete claim in ${input.name}` : `chore: update claim text in ${input.name}`),
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      // This sanctioned claim editor preserves sources on text edits and
      // deliberately removes them on deletes, so carry/loss guarding would be
      // noisy rather than helpful.
      carryClaimAnnotations: false,
      mutate: (old) => (input.delete ? deleteClaim(old, target) : replaceClaimText(old, target, text as string)),
    });
  }

  private async normalizeClaimSources(
    sources: ClaimAnnotation[],
  ): Promise<{ ok: true; sources: ClaimAnnotation[] } | { ok: false; errors: string[] }> {
    const mappings = await this.loadProjectMappings();
    const sourceTypes = claimSourceTypesById(mappings.claimSourceTypes);
    const needsPeople = sources.some((source) => {
      const type = sourceTypes.get(claimSourceKindId(source));
      return Boolean(source.person || type?.requiresPerson);
    });
    const peopleIndex = needsPeople ? buildPeopleIndex(await this.loadPeopleRegistry()) : undefined;
    const errors: string[] = [];
    const normalized = sources.map((source, index) => {
      const kind = claimSourceKindId(source);
      const type = sourceTypes.get(kind);
      if (!type) {
        errors.push(`sources[${index}]: unknown claim source type "${kind}". Configure it in project-mappings.json first.`);
        return source;
      }
      if (type.lockedConfidence && source.conf !== type.lockedConfidence) {
        errors.push(`sources[${index}]: ${kind} sources require conf: ${type.lockedConfidence}.`);
        return source;
      }
      let personId = source.person;
      if (source.person || type.requiresPerson) {
        const personKey = source.person ?? "";
        const person = peopleIndex?.getPersonById(personKey) ?? peopleIndex?.getPerson(personKey);
        if (!person) {
          errors.push(`sources[${index}]: ${kind} person "${personKey}" was not found in the people registry.`);
          return source;
        }
        personId = person.id;
      }
      const { kind: _incomingKind, ...sourceWithoutKind } = source;
      return {
        ...sourceWithoutKind,
        ...(kind === "url" ? {} : { kind }),
        ...(kind === TRUST_ME_BRO_KIND ? { src: TRUST_ME_BRO_SOURCE } : {}),
        ...(personId ? { person: personId } : {}),
      };
    });

    return errors.length > 0 ? { ok: false, errors } : { ok: true, sources: normalized };
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

    const oldContent = await this.repo.readRaw(target);
    const baseFileCommit =
      oldContent === undefined ? undefined : await this.repo.lastRevisionForAnchor(target);
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
    carryClaimAnnotations?: boolean;
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
      ...(input.carryClaimAnnotations !== undefined
        ? { carryClaimAnnotations: input.carryClaimAnnotations }
        : {}),
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
      return this.repo.resolveAnchor(name).path;
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
      oldContent === undefined ? undefined : await this.repo.lastRevisionForAnchor(proposal.target);
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
          path: targetResolved.path,
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
    if (newVersion) {
      await this.invalidateGraphDocument(this.repo.resolveAnchor(name).name);
    }
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
    const includeProvenance = decoded?.includeProvenance ?? input.includeProvenance ?? (task ? "relevant" : "none");

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
      let row = await this.withLoadContextProvenance(
        buildLoadContextAnchor(read, includeContent, excerptChars, task),
        read,
        includeProvenance,
        task,
      );
      const trial = [...anchors, row];
      const bytes = jsonByteLength(trial);

      if (bytes > maxBytes && anchors.length > 0) {
        stoppedForBytes = true;
        break;
      }

      if (bytes > maxBytes && anchors.length === 0) {
        row = shrinkLoadContextAnchorToFit(read, includeContent, excerptChars, maxBytes, task);
        row = await this.withLoadContextProvenance(row, read, includeProvenance === "full" ? "summary" : includeProvenance, task);
        if (jsonByteLength(row) > maxBytes) {
          const withoutProvenance = { ...row };
          delete withoutProvenance.claimProvenance;
          row = withoutProvenance;
        }
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
            includeProvenance,
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
      ...(includeProvenance !== "none"
        ? { provenance: await this.buildContextProvenanceSummary(anchors.map((anchor) => anchor.name)) }
        : {}),
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

    // Repo/path resolution is a fallback for when the project is not named
    // directly, so skip it when the caller passes an explicit project: an
    // explicit filter should not be diluted by candidate-project boosts. Also
    // skip when there is no repo/path signal at all (nothing to resolve), which
    // avoids the registry read on the common path.
    const hasResolutionSignal =
      !input.project?.trim() &&
      (Boolean(input.repo?.trim()) || (input.filePaths?.some((filePath) => filePath.trim().length > 0) ?? false));
    const resolution = hasResolutionSignal
      ? resolveCandidateProjects(
          { repo: input.repo, filePaths: input.filePaths },
          await this.loadProjectMappings(),
        )
      : undefined;
    const candidateBoosts = candidateBoostMap(resolution);

    const { index: bm25Index, bodyCharCounts } = await this.buildBM25SearchIndex(anchors);
    const plan = buildContextBundlePlan(
      anchors,
      effectiveInput,
      bm25Index,
      undefined,
      projectFilter,
      bodyCharCounts,
      this.options.staleAfterDays,
      new Date(),
      candidateBoosts,
    );
    const names = plan.loadContext.names;
    const includeProvenance = input.includeProvenance ?? "summary";
    const provenance = includeProvenance === "none" ? undefined : await this.buildContextProvenanceSummary(names);
    const roadmapSignals = collectRoadmapAcceptanceMissingSignals(anchors);
    const milestoneSignals = collectMilestoneAcceptanceMissingSignals(anchors);
    // Surface an unmapped repo as a freshness signal whether or not file paths
    // produced fallback candidates, so the caller always learns the repo itself
    // resolved to nothing.
    const resolutionSignals =
      resolution?.unknownRepo !== undefined
        ? [
            resolution.candidates.length === 0
              ? `Repository "${resolution.unknownRepo}" did not resolve to any candidate projects.`
              : `Repository "${resolution.unknownRepo}" is not mapped to any project; using file-path-derived candidate projects only.`,
          ]
        : [];

    return {
      ...plan,
      missingContext: [
        ...plan.missingContext,
        ...roadmapSignals,
        ...milestoneSignals,
        ...resolutionSignals,
        ...provenanceMissingContextSignals(provenance),
      ],
      loadContext: { ...plan.loadContext, names, includeProvenance: includeProvenance === "none" ? "none" : "summary" },
      ...(projectFilter ? { projectFilter } : {}),
      ...(resolution ? { projectResolution: resolution } : {}),
      ...(provenance ? { provenance } : {}),
    };
  }

  /** Session-start orchestration: plan a task-aware bundle and load suggested anchor excerpts in one call. */
  async startTask(input: StartTaskInput): Promise<StartTaskResult> {
    const plan = await this.planContextBundle({
      task: input.task,
      project: input.project,
      repo: input.repo,
      filePaths: input.filePaths,
      budgetTokens: input.budgetTokens,
      maxAnchors: input.maxAnchors,
      includeArchive: input.includeArchive,
      includeProvenance: input.includeProvenance,
    });

    const loaded = await this.loadContext({
      names: plan.loadContext.names,
      includeContent: plan.loadContext.includeContent,
      maxBytes: plan.loadContext.maxBytes,
      includeProvenance: plan.loadContext.includeProvenance ?? "summary",
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
        ...(plan.projectResolution ? { projectResolution: plan.projectResolution } : {}),
        ...(plan.provenance ? { provenance: plan.provenance } : {}),
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

  /**
   * Structured, sorted roadmap goal listing. Status is derived from the region
   * a goal appears in (Goals = active, Completed/Cancelled = history); a goal
   * id can appear in more than one region (active goal with a shipped phase).
   * Default sort groups by status (active, completed, cancelled) with the
   * newest goal id first within each group, so current work leads instead of
   * document order surfacing the oldest goals.
   */
  async listRoadmapGoals(input: {
    project: string;
    status?: RoadmapGoalStatus;
    sort?: "status" | "id" | "recent";
  }): Promise<{
    roadmap: string;
    goals: (RoadmapGoalRow & { milestones: { name: string; displayId?: string; status: string }[] })[];
    summary: { total: number; active: number; completed: number; cancelled: number };
    note?: string;
    projectFilter?: ProjectFilterResolution;
  }> {
    const { projectFilter, effectiveProject } = await this.resolveProjectFilter(input.project);
    const slug = effectiveProject ?? input.project;
    const roadmapName = `projects/${slug}/${slug}-roadmap.md`;

    const roadmapContent = await this.repo.readRaw(roadmapName);
    if (roadmapContent === undefined) {
      return {
        roadmap: roadmapName,
        goals: [],
        summary: { total: 0, active: 0, completed: 0, cancelled: 0 },
        note: `Roadmap not found: ${roadmapName}`,
        ...(projectFilter ? { projectFilter } : {}),
      };
    }

    const allRows = listRoadmapGoalsWithStatus(roadmapContent);
    const summary = {
      total: allRows.length,
      active: allRows.filter((row) => row.status === "active").length,
      completed: allRows.filter((row) => row.status === "completed").length,
      cancelled: allRows.filter((row) => row.status === "cancelled").length,
    };

    const milestonesByGoalId = new Map<string, { name: string; displayId?: string; status: string }[]>();
    for (const milestone of await this.listMilestones(slug)) {
      for (const goalId of milestone.goalIds) {
        const entry = {
          name: milestone.name,
          ...(milestone.displayId !== undefined ? { displayId: milestone.displayId } : {}),
          status: milestone.status,
        };
        const existing = milestonesByGoalId.get(goalId);
        if (existing) {
          existing.push(entry);
        } else {
          milestonesByGoalId.set(goalId, [entry]);
        }
      }
    }

    const statusOrder: Record<RoadmapGoalStatus, number> = { active: 0, completed: 1, cancelled: 2 };
    // Missing/unparseable ids sort last in every mode: -1 for the descending
    // comparisons, +Infinity for the ascending id sort.
    const goalNumber = (id?: string): number => {
      const parsed = id ? Number.parseInt(id.slice(2), 10) : Number.NaN;
      return Number.isNaN(parsed) ? -1 : parsed;
    };
    const goalNumberAscending = (id?: string): number => {
      const parsed = goalNumber(id);
      return parsed === -1 ? Number.POSITIVE_INFINITY : parsed;
    };
    const sort = input.sort ?? "status";

    const goals = allRows
      .filter((row) => !input.status || row.status === input.status)
      .map((row) => ({ ...row, milestones: row.id ? (milestonesByGoalId.get(row.id) ?? []) : [] }))
      .sort((left, right) => {
        if (sort === "id") {
          return goalNumberAscending(left.id) - goalNumberAscending(right.id) || left.title.localeCompare(right.title);
        }
        if (sort === "recent") {
          return goalNumber(right.id) - goalNumber(left.id) || left.title.localeCompare(right.title);
        }
        return (
          statusOrder[left.status] - statusOrder[right.status] ||
          goalNumber(right.id) - goalNumber(left.id) ||
          left.title.localeCompare(right.title)
        );
      });

    return { roadmap: roadmapName, goals, summary, ...(projectFilter ? { projectFilter } : {}) };
  }

  async listMilestones(project?: string): Promise<MilestoneListRow[]> {
    const { effectiveProject } = await this.resolveProjectFilter(project);
    const anchors = await this.repo.listAnchors({
      ...(effectiveProject ? { project: effectiveProject } : {}),
    });
    const projectPriorityBySlug = projectPriorityMap(anchors);
    const rows = anchors
      .filter((anchor) => anchor.name.includes("/milestones/") && anchor.milestone)
      .map((anchor) => {
        const m = anchor.milestone!;
        const classification = classifyAnchorPath(anchor.name);
        const projectSlug = classification.kind === "anchor" ? classification.projectSlug : undefined;
        const projectPriority = projectSlug ? projectPriorityBySlug.get(projectSlug) : undefined;
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
          ...(projectSlug !== undefined ? { project: projectSlug } : {}),
          ...(projectPriority !== undefined ? { projectPriority } : {}),
          ...(m.steelThread !== undefined ? { steelThread: m.steelThread } : {}),
          goalIds: m.goalIds,
          ...(m.milestoneId !== undefined ? { milestoneId: m.milestoneId } : {}),
          ...(m.sequence !== undefined ? { sequence: m.sequence } : {}),
          ...(displayId !== undefined ? { displayId } : {}),
          ...(anchor.updatedAt !== undefined ? { updatedAt: anchor.updatedAt } : {}),
          ...(anchor.createdAt !== undefined ? { createdAt: anchor.createdAt } : {}),
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

  /**
   * Read-only traversal surface over the derived graph (WP4). Resolves
   * `node` via `resolveGraphNode` (anchor name / `G-###` / `<anchor>#<claim-id>`
   * / person-team fuzzy / canonical passthrough — ambiguous input returns
   * `candidates` instead of guessing), then BFS-traverses the `GraphIndex`
   * up to `depth` hops (clamped 1-3), optionally filtered by `edgeTypes` and
   * `direction`, capped at `limit` result nodes (clamped 1-200, default 50).
   * Every result node carries its hop path from the origin; claim nodes
   * additionally embed the same per-claim provenance shape
   * `includeProvenance` sidecars use (`buildAnchorClaimProvenance`'s
   * resolved `AnchorClaim`), so a claim result is never just an opaque id.
   */
  async graphNeighbors(input: GraphNeighborsInput): Promise<GraphNeighborsResult> {
    const graph = this.getGraphIndex();
    await graph.ensureBuilt();

    const metas = await this.repo.listAnchors();
    const anchorNames = new Set(metas.map((meta) => meta.name));
    const metaByName = new Map(metas.map((meta) => [meta.name, meta]));
    const peopleRegistry = await this.loadPeopleRegistry();
    const peopleIndex = buildPeopleIndex(peopleRegistry);

    // Pre-read the ids of the one anchor a `<anchor>#<claim-id>` input might
    // reference (resolveGraphNode's claim-ref branch needs a synchronous
    // existence check). Anchor resolution runs the same normalization
    // resolveGraphNode itself uses; a non-claim-shaped or unresolvable input
    // leaves the cache empty and resolveGraphNode falls through to its next
    // resolution strategy exactly as if this anchor had zero claim ids.
    const claimIdCache = new Map<string, ReadonlySet<string>>();
    const claimRefMatch = /^(.+)#([a-z0-9][a-z0-9-]*)$/i.exec(input.node.trim());
    if (claimRefMatch) {
      const resolvedAnchor = this.resolveAnchorNameOrUndefined(claimRefMatch[1].trim(), anchorNames);
      if (resolvedAnchor) {
        const content = await this.repo.readRaw(resolvedAnchor);
        if (content !== undefined) {
          claimIdCache.set(resolvedAnchor, collectClaimIds(extractClaims(content)));
        }
      }
    }
    const anchorHasClaimId = (anchorName: string, claimId: string): boolean =>
      claimIdCache.get(anchorName)?.has(claimId) ?? false;

    const resolution = resolveGraphNode(input.node, {
      anchorNames,
      resolveAnchorName: (value) => this.resolveAnchorNameOrUndefined(value, anchorNames),
      anchorMetaByName: (name) => metaByName.get(name),
      anchorHasClaimId,
      peopleIndex,
      peopleRegistry,
    });

    if ("candidates" in resolution) {
      return { candidates: resolution.candidates };
    }

    const depth = clampDepth(input.depth);
    const limit = clampLimit(input.limit);
    const direction = normalizeGraphDirection(input.direction);

    const { nodes, edges } = await traverseGraphNeighbors(graph, resolution.resolved, {
      depth,
      edgeTypes: input.edgeTypes,
      direction,
      limit,
    });

    // Enrich claim nodes with resolved provenance. Build the shared resolution
    // inputs ONCE (reusing the anchorNames/peopleIndex already computed above,
    // plus project mappings) and cache resolved claims per anchor for the rest
    // of this request, so each anchor's content is read/parsed at most once even
    // when a traversal returns many claim nodes from the same anchor. The cache
    // stores promises so concurrent Promise.all lookups of the same anchor share
    // one read instead of racing.
    const hasClaimNode = nodes.some((node) => node.type === "claim");
    const claimInputs: ClaimResolutionInputs | undefined = hasClaimNode
      ? { mappings: await this.loadProjectMappings(), anchorNames, peopleIndex }
      : undefined;
    const resolvedClaimsByAnchor = new Map<string, Promise<AnchorClaim[] | undefined>>();
    const enrichedNodes = await Promise.all(
      nodes.map((node) => this.enrichGraphNeighborNode(node, metaByName, claimInputs, resolvedClaimsByAnchor)),
    );

    return { resolvedNode: resolution.resolved, nodes: enrichedNodes, edges };
  }

  /** Best-effort anchor-name resolution used by graph node resolution: normalizes and checks existence against the known anchor set, mirroring `GraphIndex`'s own `resolveAnchorName` context builder. */
  private resolveAnchorNameOrUndefined(value: string, anchorNames: ReadonlySet<string>): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (anchorNames.has(trimmed)) {
      return trimmed;
    }
    const withMd = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    return anchorNames.has(withMd) ? withMd : undefined;
  }

  /** Fill in `display` for node kinds resolvable without another traversal, and attach claim provenance to claim nodes. Never throws on an unresolvable/unreadable node — the bare node id/type is still a valid, inspectable result. */
  private async enrichGraphNeighborNode(
    node: GraphNeighborsResultNode,
    metaByName: Map<string, AnchorMeta>,
    claimInputs: ClaimResolutionInputs | undefined,
    resolvedClaimsByAnchor: Map<string, Promise<AnchorClaim[] | undefined>>,
  ): Promise<GraphNeighborsResultNode> {
    if (node.display) {
      return node;
    }
    if (node.type === "anchor" || node.type === "milestone") {
      const anchorName = node.id.slice(node.id.indexOf(":") + 1);
      const meta = metaByName.get(anchorName);
      return meta?.title ? { ...node, display: meta.title } : node;
    }
    if (node.type === "claim" && claimInputs) {
      return this.attachClaimProvenanceToNode(node, claimInputs, resolvedClaimsByAnchor);
    }
    return node;
  }

  private async attachClaimProvenanceToNode(
    node: GraphNeighborsResultNode,
    claimInputs: ClaimResolutionInputs,
    resolvedClaimsByAnchor: Map<string, Promise<AnchorClaim[] | undefined>>,
  ): Promise<GraphNeighborsResultNode> {
    const parsed = parseClaimNodeId(node.id);
    if (!parsed) {
      return node;
    }
    const claims = await this.resolveAnchorClaimsCached(parsed.anchorName, claimInputs, resolvedClaimsByAnchor);
    const claim = claims?.find((candidate) => candidate.id === parsed.claimId);
    if (!claim) {
      return node;
    }
    return { ...node, display: node.display ?? claim.text, claim };
  }

  /**
   * Read and resolve one anchor's claims at most once per request. Reuses the
   * caller's precomputed mappings/anchorNames/peopleIndex (no per-call reload of
   * the whole tree) and memoizes the in-flight promise so concurrent lookups of
   * the same anchor share a single read/parse.
   */
  private resolveAnchorClaimsCached(
    anchorName: string,
    claimInputs: ClaimResolutionInputs,
    cache: Map<string, Promise<AnchorClaim[] | undefined>>,
  ): Promise<AnchorClaim[] | undefined> {
    let resolved = cache.get(anchorName);
    if (!resolved) {
      resolved = (async () => {
        const content = await this.repo.readRaw(anchorName);
        if (content === undefined) {
          return undefined;
        }
        return extractClaims(content).map((claim) =>
          this.withResolvedSourceLinks(
            anchorName,
            claim,
            claimInputs.mappings,
            claimInputs.anchorNames,
            claimInputs.peopleIndex,
          ),
        );
      })();
      cache.set(anchorName, resolved);
    }
    return resolved;
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

      const content = await this.repo.readRaw(anchor.name);
      if (content === undefined) {
        continue;
      }
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

function projectPriorityMap(anchors: AnchorMeta[]): Map<string, number> {
  const candidatesByProject = new Map<string, AnchorMeta[]>();

  for (const anchor of anchors) {
    const classification = classifyAnchorPath(anchor.name);
    if (classification.kind !== "anchor" || classification.category !== "projects" || anchor.name.includes("/milestones/")) {
      continue;
    }
    const projectSlug = classification.projectSlug;
    if (!projectSlug) {
      continue;
    }
    const items = candidatesByProject.get(projectSlug) ?? [];
    items.push(anchor);
    candidatesByProject.set(projectSlug, items);
  }

  const priorities = new Map<string, number>();
  for (const [project, candidates] of candidatesByProject.entries()) {
    const preferred =
      candidates.find((meta) => meta.name === `projects/${project}/${project}.md`) ??
      candidates.find((meta) => !frontmatterTypeIncludes(meta.type, "project-roadmap") && !isProposedChangesType(meta.type)) ??
      candidates.find((meta) => frontmatterTypeIncludes(meta.type, "project-roadmap"));
    if (typeof preferred?.priority === "number" && Number.isFinite(preferred.priority)) {
      priorities.set(project, preferred.priority);
    }
  }

  return priorities;
}

function taskMatchesDueWindow(task: MilestoneTaskMeta, input: ListTasksDueInput): boolean {
  if (input.noDue) {
    return !task.due;
  }
  if (!input.dueBefore && !input.dueAfter) {
    return true;
  }
  if (!task.due) {
    return Boolean(input.dueBefore && !input.dueAfter);
  }
  if (input.dueBefore && task.due >= input.dueBefore) {
    return false;
  }
  if (input.dueAfter && task.due < input.dueAfter) {
    return false;
  }
  return true;
}

function taskMatchesCompletedWindow(task: MilestoneTaskMeta, input: ListTasksDueInput): boolean {
  if (!input.completedBefore && !input.completedAfter) {
    return true;
  }
  if (!task.completedOn) {
    return false;
  }
  if (input.completedBefore && task.completedOn >= input.completedBefore) {
    return false;
  }
  if (input.completedAfter && task.completedOn < input.completedAfter) {
    return false;
  }
  return true;
}

function questionSummary(questions: readonly { status: QuestionStatus }[]): ListQuestionsResult["summary"] {
  const summary: ListQuestionsResult["summary"] = {
    total: questions.length,
    open: 0,
    resolved: 0,
    deferred: 0,
    "wont-answer": 0,
  };
  for (const question of questions) {
    summary[question.status] += 1;
  }
  return summary;
}

function questionSearchText(question: ListQuestionsResult["questions"][number]): string {
  return [
    question.anchor,
    question.section,
    question.id,
    question.text,
    question.status,
    question.resolution,
    question.resolvedOn,
    question.owner,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
}

function questionTargetFromInput(input: {
  line?: number;
  id?: string;
  question?: string;
}): QuestionTarget | undefined {
  if (input.line !== undefined) {
    return { line: input.line };
  }
  if (input.id?.trim()) {
    return { id: input.id.trim() };
  }
  if (input.question?.trim()) {
    return { question: input.question.trim() };
  }
  return undefined;
}

function questionTextTargetFromInput(input: {
  line?: number;
  id?: string;
  question?: string;
}): QuestionTarget | undefined {
  if (input.id?.trim()) {
    return { id: input.id.trim() };
  }
  if (input.line !== undefined) {
    return { line: input.line };
  }
  if (input.question?.trim()) {
    return { question: input.question.trim() };
  }
  return undefined;
}

function questionLocationBlock(
  name: string,
  target: QuestionTarget,
  location: ReturnType<typeof locateQuestion> & { ok: false },
): WriteAnchorResult {
  const targetLabel = "line" in target ? `line ${target.line}` : "id" in target ? `id "${target.id}"` : `"${target.question}"`;
  return {
    warnings: [
      {
        severity: "BLOCK",
        code: location.code,
        message:
          location.code === "question_not_found"
            ? `No question in ${name} matches ${targetLabel}. Questions are top-level bullets in Open Questions, Questions, or Resolved Questions sections.`
            : `Question match ${targetLabel} is ambiguous in ${name}. Matches: ${location.candidates
                .map((candidate) => `"${candidate}"`)
                .join(", ")}. Use a line number, id, or longer unique fragment.`,
      },
    ],
  };
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

function validateTaskPriorityValue(value: number | null | undefined): ValidationViolation | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return undefined;
  }
  return {
    severity: "BLOCK",
    code: "task_priority_invalid",
    message: "Task priority must be a finite number or null to clear it.",
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

/**
 * Extract the anchor name from a `section:<anchor>#<heading>` canonical node id.
 * Anchor names never contain `#`, so the anchor is everything up to the FIRST
 * `#` after the `section:` prefix — splitting on the last `#` would break for a
 * heading that itself contains `#` (e.g. "C# Notes").
 */
function sectionNodeAnchorName(nodeId: string): string {
  const withoutPrefix = nodeId.slice("section:".length);
  const hashIndex = withoutPrefix.indexOf("#");
  return hashIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, hashIndex);
}

function parseClaimSourceInputs(
  sources: Array<{
    src?: string;
    observed?: string;
    conf?: string;
    id?: string;
    kind?: string;
    person?: string;
    derivedFrom?: string;
    contradicts?: string;
  }>,
): { ok: true; sources: ClaimAnnotation[] } | { ok: false; errors: string[] } {
  const parsedSources: ClaimAnnotation[] = [];
  const errors: string[] = [];

  sources.forEach((source, index) => {
    const body = [
      `src: ${source.src ?? ""}`,
      source.kind ? `kind: ${source.kind}` : undefined,
      source.person ? `person: ${source.person}` : undefined,
      `observed: ${source.observed ?? ""}`,
      `conf: ${source.conf ?? ""}`,
      source.id ? `id: ${source.id}` : undefined,
      source.derivedFrom ? `derived_from: ${source.derivedFrom}` : undefined,
      source.contradicts ? `contradicts: ${source.contradicts}` : undefined,
    ]
      .filter(Boolean)
      .join("; ");
    const parsed = parseAnnotationBody(body);
    if (parsed.ok) {
      parsedSources.push(parsed.annotation);
    } else {
      errors.push(...parsed.errors.map((error) => `sources[${index}]: ${error}`));
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, sources: parsedSources };
}

const RELEVANT_PROVENANCE_CLAIM_LIMIT = 12;

function selectRelevantProvenanceClaims(claims: AnchorClaim[], task?: string): AnchorClaim[] {
  const terms = provenanceTaskTerms(task);
  const selected: AnchorClaim[] = [];

  for (const claim of claims) {
    const isWeak = claim.status !== "annotated" || claim.strength !== "high";
    const matchesTask = terms.length > 0 && terms.some((term) => claimProvenanceSearchText(claim).includes(term));
    if (isWeak || matchesTask) {
      selected.push(claim);
    }
    if (selected.length >= RELEVANT_PROVENANCE_CLAIM_LIMIT) {
      break;
    }
  }

  return selected;
}

function provenanceTaskTerms(task?: string): string[] {
  return Array.from(
    new Set(
      String(task || "")
        .toLowerCase()
        .split(/[^a-z0-9_.#/-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  );
}

function claimProvenanceSearchText(claim: AnchorClaim): string {
  return [
    claim.text,
    claim.section,
    ...claim.sources.flatMap((source) => [source.src, source.kind, source.person, source.personName]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function provenanceMissingContextSignals(provenance?: ContextProvenanceSummary): string[] {
  if (!provenance || provenance.summary.totalClaims === 0) {
    return [];
  }
  const summary = provenance.summary;
  const parts: string[] = [];
  if (summary.malformedClaims > 0) {
    parts.push(`${summary.malformedClaims} malformed`);
  }
  if (summary.unannotatedClaims > 0) {
    parts.push(`${summary.unannotatedClaims} unannotated`);
  }
  if (summary.claimStrengths.low > 0) {
    parts.push(`${summary.claimStrengths.low} low-strength`);
  }
  if (summary.claimStrengths.medium > 0) {
    parts.push(`${summary.claimStrengths.medium} medium-strength`);
  }
  if (parts.length === 0) {
    return [];
  }
  const observed = summary.oldestObserved ? ` Oldest checked source: ${summary.oldestObserved}.` : "";
  return [`Claim provenance health for included anchors: ${parts.join(", ")} claim(s).${observed}`];
}

function claimSourceSearchText(source: ClaimSource): string {
  return [source.src, source.kind, source.person, source.personName]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function claimSourceTypesById(sourceTypes: ClaimSourceType[]): Map<string, ClaimSourceType> {
  const map = new Map<string, ClaimSourceType>();
  for (const type of sourceTypes) {
    map.set(type.id, type);
  }
  return map;
}

function claimSourceKindId(source: Pick<ClaimAnnotation, "kind" | "src">): string {
  const kind = source.kind?.trim().toLowerCase();
  if (kind === "source" || kind === "evidence") {
    return "url";
  }
  if (kind) {
    return kind;
  }
  return source.src.trim().toLowerCase() === TRUST_ME_BRO_SOURCE ? TRUST_ME_BRO_KIND : "url";
}

function truncateClaimText(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/**
 * BLOCK validations for claim ids (WP1): a duplicate id within this write's
 * own content, or one that collides with an id already present elsewhere in
 * the tree. Distinct from `claim_annotation_invalid` (malformed format),
 * which the parser/validator pipeline already blocks.
 */
function duplicateClaimIdViolations(content: string, treeIdsExcludingThisAnchor: ReadonlySet<string>): ValidationViolation[] {
  const claims = extractClaims(content).filter((claim) => claim.id);
  const seen = new Map<string, string[]>();
  for (const claim of claims) {
    const id = claim.id as string;
    const texts = seen.get(id) ?? [];
    texts.push(claim.text);
    seen.set(id, texts);
  }

  const violations: ValidationViolation[] = [];
  for (const [id, texts] of seen) {
    if (texts.length > 1) {
      violations.push({
        severity: "BLOCK",
        code: "claim_id_duplicate",
        message: `Claim id "${id}" is used by ${texts.length} claims in this write: ${texts.map((text) => `"${truncateClaimText(text)}"`).join("; ")}. Claim ids must be unique.`,
      });
      continue;
    }
    if (treeIdsExcludingThisAnchor.has(id)) {
      violations.push({
        severity: "BLOCK",
        code: "claim_id_duplicate",
        message: `Claim id "${id}" on claim "${truncateClaimText(texts[0])}" already exists elsewhere in the tree. Claim ids must be unique.`,
      });
    }
  }
  return violations;
}

/** `graphNeighbors` input's `direction` defaults to `"both"`; the traversal core (`src/graph/neighbors.ts`) uses `"forward"`/`"reverse"`/`"both"` naming to avoid the `to`/`from`-vs-`in`/`out` ambiguity edge objects already use. */
function normalizeGraphDirection(direction: GraphNeighborsInput["direction"]): GraphNeighborsDirection {
  return direction === "forward" || direction === "reverse" ? direction : "both";
}

/** Split a `claim:<anchor>#<id>` node id back into its parts. Undefined for any other node kind's id shape. */
function parseClaimNodeId(nodeId: string): { anchorName: string; claimId: string } | undefined {
  if (!nodeId.startsWith("claim:")) {
    return undefined;
  }
  const withoutPrefix = nodeId.slice("claim:".length);
  const hashIndex = withoutPrefix.lastIndexOf("#");
  if (hashIndex === -1) {
    return undefined;
  }
  return { anchorName: withoutPrefix.slice(0, hashIndex), claimId: withoutPrefix.slice(hashIndex + 1) };
}
