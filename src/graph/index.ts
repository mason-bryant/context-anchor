/**
 * `GraphIndex` — the derived, in-memory, lazily built, HEAD-keyed knowledge
 * graph over the whole anchor tree (WP3 of the claim knowledge graph plan).
 *
 * Copies `GitMetadataCache`'s (`src/git/metadataCache.ts`) caching shape
 * exactly: HEAD resolved from the filesystem (no git subprocess), an
 * `ensureFresh`/`rebuild` loop with a `refreshing` promise dedup, and a
 * `generation` counter bumped on any out-of-band mutation so an in-flight
 * rebuild that raced a mutation discards its stale result instead of
 * clobbering newer state.
 *
 * Zero git subprocesses: every input comes from `AnchorStore` read methods
 * (`listAnchors`, `readAnchor`) plus the cached people/project registries —
 * never from a `SimpleGit` instance. This is a hard acceptance criterion
 * (design doc "Cost and scaling"; implementation plan WP3 acceptance).
 */

import { isBuiltInAnchorName } from "../builtin/serverPolicy.js";
import { resolveHeadFromFs } from "../git/metadataCache.js";
import type { PeopleIndex } from "../peopleRegistry.js";
import { buildPeopleIndex } from "../peopleRegistry.js";
import type { AnchorStore } from "../storage/store.js";
import { parseAnchor } from "../storage/markdown.js";
import { buildProjectAliasIndex } from "../projectAliases.js";
import { normalizeRelative } from "../utils/path.js";
import {
  anchorIdFromFrontmatter,
  buildIdentityCompatibilityMap,
  isValidAnchorId,
  type IdentityCompatibilityMap,
} from "./identity.js";
import { canonicalizeNodeId } from "./canonicalIds.js";
import { listRoadmapGoalsWithStatus } from "../roadmap/analyzeRoadmap.js";
import type { CoverageAnalysisContext } from "./coverage.js";
import type { AnchorMeta, PeopleRegistry, ProjectMappings } from "../types.js";
import {
  extractDocumentEdges,
  extractLiteralRelationsEdges,
  extractRegistryPersonProjectEdges,
  extractRegistryProjectRepoEdges,
  frontmatterProjectSlugs,
  type DocumentInput,
  type ExtractDocumentEdgesContext,
  type LiteralRelationEdge,
} from "./extract.js";
import type { GraphEdge, GraphEdgeType } from "./model.js";

export type GraphIndexDeps = {
  loadPeopleRegistry: () => Promise<PeopleRegistry>;
  loadProjectMappings: () => Promise<ProjectMappings>;
};

/** Per-document edge group, so a targeted write can drop and re-extract exactly one document's edges. */
type DocumentEdgeGroup = {
  edges: GraphEdge[];
  literalRelations: LiteralRelationEdge[];
};

type ReadAnchorResult = Awaited<ReturnType<AnchorStore["readAnchor"]>>;

// Bounded read concurrency for the whole-tree pass in rebuild(), matching
// AnchorService.buildBM25SearchIndex's worker-pool pattern for the same kind
// of I/O-bound whole-tree read.
const GRAPH_READ_CONCURRENCY = 8;

export class GraphIndex {
  private head: string | undefined;
  private built = false;
  private refreshing: Promise<void> | undefined;
  // Bumped on any state change outside a rebuild (invalidateDocument,
  // invalidate) so an in-flight rebuild that raced the change discards its
  // result — mirrors GitMetadataCache's generation-token protection.
  private generation = 0;

  private byDocument = new Map<string, DocumentEdgeGroup>();
  private registryEdges: GraphEdge[] = [];
  private forward = new Map<string, GraphEdge[]>();
  private reverse = new Map<string, GraphEdge[]>();
  private literalRelationsReverse = new Map<string, LiteralRelationEdge[]>();
  private anchorMetaByName = new Map<string, AnchorMeta>();
  // H2 section titles per anchor, populated fresh each rebuild pass so
  // getAnchorSectionTitles can resolve ANY anchor's sections (a claim can
  // cite a section of a different anchor than the one being extracted).
  private sectionTitlesByAnchor = new Map<string, ReadonlySet<string>>();
  // Goal 0 Phase 1 WP3 (typed relation vocabulary): reverse anchor_id -> name
  // lookup and tree-wide known goal ids, both populated only during a full
  // `rebuild` pass (which reads every anchor's content already) and reused
  // as-is by `invalidateDocument` rather than recomputed there, so the
  // incremental per-document path stays cheap. This means a brand-new
  // anchor_id or goal heading introduced purely via invalidateDocument calls
  // (no intervening rebuild) is not yet resolvable for typed-relation
  // targets until the next full rebuild — safe by construction, since an
  // unresolved typed target simply falls back to the pre-WP3 anchor_anchor
  // legacy edge (see `extractRelationsEdges` in extract.ts), never drops.
  private anchorIdByName = new Map<string, string | undefined>();
  /** Goal ids keyed by the canonical project slug whose roadmap defines them — PROJECT-SCOPED so `goal:<project>:<goal-id>` refs never cross-resolve against a same-numbered goal in another project. */
  private knownGoalIdsByProject = new Map<string, Set<string>>();

  constructor(
    private readonly repo: Pick<AnchorStore, "repoPath" | "listAnchors" | "readAnchor">,
    private readonly deps: GraphIndexDeps,
  ) {}

  /**
   * The repo HEAD this graph was last built from, and the in-process
   * generation counter (bumped on every out-of-band mutation) — exposed for
   * read-only callers (WP6's `graphCoverage`) that report "which graph
   * generation this response reflects" alongside their data, so a client can
   * tell whether two responses came from the same graph snapshot. Call
   * `ensureBuilt()` first if the caller needs this to reflect the CURRENT
   * HEAD rather than whatever was last built.
   */
  graphVersion(): { head: string | undefined; generation: number } {
    return { head: this.head, generation: this.generation };
  }

  /**
   * The v1<->v2 identity compatibility map for the current tree (Goal 0 Phase
   * 2 slice 4), built once per query from the same `anchorIdByName` /
   * goal-owner maps this index already holds — HEAD-keyed like everything
   * else via `ensureBuilt`. Callers (the graph-neighbors route/service) use it
   * to normalize an incoming path / v1 id / v2 id to its current canonical id
   * before traversal, so an old deep link still resolves after re-key. Goal
   * ids are scoped by their SINGLE owning project (ambiguous / unknown goals
   * are reported unmapped), matching how goal nodes are keyed v2 during
   * extraction.
   */
  async identityCompatibilityMap(): Promise<IdentityCompatibilityMap> {
    await this.ensureBuilt();
    const projectSlugByGoalId = new Map<string, string | undefined>();
    const owners = await this.goalIdOwnersSnapshot();
    for (const [goalId, projectSlugs] of owners) {
      // Exactly one owner -> scoped v2; zero/many -> unmapped (stays v1).
      projectSlugByGoalId.set(goalId, projectSlugs.length === 1 ? projectSlugs[0] : undefined);
    }
    return buildIdentityCompatibilityMap({
      anchorIdByName: this.anchorIdByName,
      projectSlugByGoalId,
    });
  }

  /**
   * Normalize an incoming node id (a path already resolved to a v1 node id, a
   * v1 id, or a v2 id) to its current canonical form via the compatibility map
   * plus structural re-keying of anchor-path-embedding node kinds
   * (milestone/task/section/claim). A v2 id, or a v1 id whose owner has no
   * `anchor_id` yet, passes through unchanged. Used by the graph-neighbors
   * service so an old v1/path deep link resolves to the (now v2) node.
   */
  async canonicalizeNodeId(nodeId: string): Promise<string> {
    const compat = await this.identityCompatibilityMap();
    return canonicalizeNodeId(nodeId, compat, this.anchorIdByName);
  }

  /** Ensure the graph reflects the current repo HEAD, rebuilding if stale. Never called from the constructor — first graph query triggers the initial build. */
  async ensureBuilt(): Promise<void> {
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
      // invalidateDocument/invalidate raced it, or HEAD may have moved again.
    }
  }

  /** All edges pointing FROM this node, optionally filtered by type. */
  async edgesFrom(nodeId: string, type?: GraphEdgeType): Promise<GraphEdge[]> {
    await this.ensureBuilt();
    const edges = this.forward.get(nodeId) ?? [];
    return type ? edges.filter((edge) => edge.type === type) : [...edges];
  }

  /** All edges pointing TO this node (reverse adjacency), optionally filtered by type. O(1) lookup — this is what makes reverse queries (e.g. `findReferencingAnchorMetas`) cheap. */
  async edgesTo(nodeId: string, type?: GraphEdgeType): Promise<GraphEdge[]> {
    await this.ensureBuilt();
    const edges = this.reverse.get(nodeId) ?? [];
    return type ? edges.filter((edge) => edge.type === type) : [...edges];
  }

  /** Every edge in the graph. Intended for tests/debugging and WP4's traversal needs, not hot paths. */
  async allEdges(): Promise<GraphEdge[]> {
    await this.ensureBuilt();
    const out: GraphEdge[] = [];
    for (const group of this.byDocument.values()) {
      out.push(...group.edges);
    }
    out.push(...this.registryEdges);
    return out;
  }

  /**
   * Build the resolver context `analyzeCoverage` (`src/graph/coverage.ts`,
   * WP5) needs, reusing this index's already-built anchor_id/goal/people
   * lookups rather than re-scanning the tree a second time (the caller —
   * `AnchorService.graphCoverage`, WP6 — still needs its own read of every
   * anchor's front matter/content for `CoverageDocumentInput`, since this
   * index does not retain raw content after a rebuild, only derived edges).
   */
  async buildCoverageContext(): Promise<CoverageAnalysisContext> {
    await this.ensureBuilt();
    const metas = await this.repo.listAnchors();
    const ctx = await this.buildExtractContext(metas);

    const anchorNamesByAnchorId = new Map<string, string[]>();
    for (const [name, anchorId] of this.anchorIdByName) {
      if (!anchorId) {
        continue;
      }
      const names = anchorNamesByAnchorId.get(anchorId) ?? [];
      names.push(name);
      anchorNamesByAnchorId.set(anchorId, names);
    }

    return {
      anchorNames: ctx.anchorNames,
      resolveAnchorName: ctx.resolveAnchorName,
      resolveProjectSlug: ctx.resolveProjectSlug,
      anchorNamesForAnchorId: (anchorId: string) => anchorNamesByAnchorId.get(anchorId) ?? [],
      goalExistsInProject: ctx.goalExistsInProject ?? (() => false),
      personExists: (id: string) => Boolean(ctx.peopleIndex.getPersonById(id)),
      teamExists: (id: string) => Boolean(ctx.peopleIndex.getTeamById(id)),
    };
  }

  /**
   * Every canonical project slug whose roadmap defines `goalId` (Goal 0 Phase
   * 2 migration: `scope_goal_reference` needs "is this goal id owned by
   * exactly one project?" to rewrite a legacy bare goal target to a scoped
   * `goal:<project-slug>:<goal-id>` ref). Reuses the same
   * `knownGoalIdsByProject` map `goalExistsInProject` above closes over — no
   * extra tree scan. Zero entries means unknown-everywhere; two or more means
   * ambiguous; both cases are the migration planner's job to skip, not this
   * method's (it only reports what exists).
   */
  async projectsForGoalId(goalId: string): Promise<string[]> {
    const snapshot = await this.goalIdOwnersSnapshot();
    return [...(snapshot.get(goalId) ?? [])];
  }

  /**
   * Bulk inversion of `knownGoalIdsByProject` (goal id -> every project slug
   * whose roadmap defines it), for callers that need a synchronous lookup
   * over several goal ids in one request (e.g. `AnchorService`'s migration
   * context, whose planner-facing resolver must be a plain sync function) —
   * one await instead of one `projectsForGoalId` call per relation target.
   */
  async goalIdOwnersSnapshot(): Promise<ReadonlyMap<string, readonly string[]>> {
    await this.ensureBuilt();
    const owners = new Map<string, string[]>();
    for (const [projectSlug, goalIds] of this.knownGoalIdsByProject) {
      for (const goalId of goalIds) {
        const list = owners.get(goalId) ?? [];
        list.push(projectSlug);
        owners.set(goalId, list);
      }
    }
    for (const list of owners.values()) {
      list.sort();
    }
    return owners;
  }

  /**
   * Literal (unresolved) `relations.<kind>` reverse lookup: anchors whose
   * literal target list contains `normalizedTarget` (already `.md`-suffixed),
   * optionally filtered by relation kind. Powers
   * `findReferencingAnchorMetas`'s reverse-edge reimplementation, which must
   * stay byte-parity with the old full-scan's literal (non-goal_ids-resolving)
   * semantics — see `extractLiteralRelationsEdges`'s docstring.
   */
  async anchorsReferencingLiteralTarget(normalizedTarget: string, kind?: string): Promise<AnchorMeta[]> {
    await this.ensureBuilt();
    const matches = this.literalRelationsReverse.get(normalizedTarget) ?? [];
    const fromNames = new Set(matches.filter((edge) => !kind || edge.kind === kind).map((edge) => edge.from));
    const out: AnchorMeta[] = [];
    for (const name of fromNames) {
      const meta = this.anchorMetaByName.get(name);
      if (meta) {
        out.push(meta);
      }
    }
    return out;
  }

  /**
   * Drop one document's edge group and re-extract just that document,
   * without a full rebuild — mirrors `GitMetadataCache.recordCommit`'s
   * "fold an in-process change into the cache without rebuilding" pattern.
   * Bumps the generation counter for the same race-protection reason.
   * No-op if the graph has never been built (nothing to fold into).
   */
  async invalidateDocument(anchorName: string): Promise<void> {
    if (!this.built) {
      return;
    }
    this.generation += 1;

    let read: ReadAnchorResult | undefined;
    try {
      read = await this.repo.readAnchor(anchorName);
    } catch {
      // Deleted or unreadable: leave it removed from the graph.
    }

    // Goal 0 Phase 2 slice 4 — incremental re-key parity: node ids are keyed
    // v2 off the owning anchor's `anchor_id`, which the incremental path reuses
    // from the last FULL rebuild (this.anchorIdByName is not recomputed here —
    // see the field docstring). If this write changed the anchor's id
    // (gained/lost/replaced it), re-keying only THIS document is not enough:
    // every OTHER document with an edge targeting this anchor must also re-key
    // to the new identity, and the reused anchorIdByName map is now stale for
    // resolving this anchor's own id. Rather than attempt a precise tree-wide
    // incremental re-key (intricate, and the incremental contract explicitly
    // permits full invalidation for id-affecting changes), fall back to a
    // conservative full invalidation: the next query does a clean rebuild,
    // guaranteeing incremental == clean-rebuild parity by construction.
    const freshAnchorId = read ? normalizeValidAnchorId(read.frontmatter) : undefined;
    const cachedAnchorId = this.anchorIdByName.get(anchorName);
    if (freshAnchorId !== cachedAnchorId) {
      this.invalidate();
      return;
    }

    this.removeDocumentContribution(anchorName);

    if (!read || isBuiltInAnchorName(anchorName)) {
      this.anchorMetaByName.delete(anchorName);
      this.sectionTitlesByAnchor.delete(anchorName);
      // The write that triggered this invalidation has already advanced HEAD;
      // adopt it so the next query treats the folded-in change as current
      // instead of discarding this work with a full rebuild.
      this.head = await this.resolveHead();
      return;
    }

    // listAnchors() here is a filesystem-only, meta-cache-backed call (no git
    // subprocess) — not a per-document shortcut, because re-extracting this
    // one document still needs full-tree context: resolveAnchorName must
    // resolve any anchor a claim/relation/link in THIS document might cite,
    // and resolveProjectSlug's alias index is derived from every anchor's
    // declared aliases. A truly O(1) per-document lookup would need to cache
    // the metas list itself; left as a possible follow-up if this call
    // proves hot in practice (AnchorRepository's own meta cache already
    // makes repeat listAnchors() calls cheap after the first).
    const metas = await this.repo.listAnchors();
    const meta = metas.find((candidate) => candidate.name === anchorName);
    if (meta) {
      this.anchorMetaByName.set(anchorName, meta);
    }

    const parsed = parseAnchor(read.content);
    this.sectionTitlesByAnchor.set(anchorName, new Set(parsed.sections.keys()));

    const ctx = await this.buildExtractContext(metas);

    const doc: DocumentInput = { anchorName, frontmatter: read.frontmatter, body: parsed.body, content: read.content };
    const group: DocumentEdgeGroup = {
      edges: extractDocumentEdges(doc, ctx),
      literalRelations: extractLiteralRelationsEdges(doc),
    };
    this.byDocument.set(anchorName, group);
    indexGroup(group, this.forward, this.reverse, this.literalRelationsReverse);

    // The write that triggered this invalidation has already advanced HEAD
    // (invalidateGraphDocument runs after commitAnchor). Adopt the new HEAD so
    // the next query sees the graph as current and keeps this incremental
    // update instead of discarding it with a full rebuild — which would negate
    // per-document invalidation entirely.
    this.head = await this.resolveHead();
  }

  /** Drop everything; the next access rebuilds from the current HEAD. */
  invalidate(): void {
    this.generation += 1;
    this.head = undefined;
    this.built = false;
    this.byDocument = new Map();
    this.registryEdges = [];
    this.forward = new Map();
    this.reverse = new Map();
    this.literalRelationsReverse = new Map();
    this.anchorMetaByName = new Map();
    this.sectionTitlesByAnchor = new Map();
    this.anchorIdByName = new Map();
    this.knownGoalIdsByProject = new Map();
  }

  private async resolveHead(): Promise<string | undefined> {
    const resolution = await resolveHeadFromFs(this.repo.repoPath);
    return resolution.ok ? resolution.head : undefined;
  }

  private async rebuild(head: string | undefined, generation: number): Promise<void> {
    const byDocument = new Map<string, DocumentEdgeGroup>();
    const anchorMetaByName = new Map<string, AnchorMeta>();
    const forward = new Map<string, GraphEdge[]>();
    const reverse = new Map<string, GraphEdge[]>();
    const literalRelationsReverse = new Map<string, LiteralRelationEdge[]>();
    const sectionTitlesByAnchor = new Map<string, ReadonlySet<string>>();
    // Goal 0 Phase 1 WP3: populated alongside section titles in pass 1 below
    // (both need the same per-anchor content read).
    const anchorIdByName = new Map<string, string | undefined>();
    const knownGoalIdsByProject = new Map<string, Set<string>>();

    const metas = await this.repo.listAnchors();

    // Pass 1: read every anchor's content once, materialize meta + section
    // titles up front, so pass 2's getAnchorSectionTitles can resolve a claim
    // section-reference pointing at ANY anchor, not just the one currently
    // being extracted. Reads run with bounded worker-pool concurrency
    // (mirrors AnchorService.buildBM25SearchIndex's pattern for the same
    // kind of whole-tree read) since this is I/O-bound, not CPU-bound.
    const contentByAnchor = new Map<string, { read: ReadAnchorResult; body: string }>();
    const readable = metas.filter((meta) => !isBuiltInAnchorName(meta.name));
    let nextIndex = 0;
    const workerCount = Math.min(GRAPH_READ_CONCURRENCY, readable.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        for (;;) {
          const meta = readable[nextIndex];
          nextIndex += 1;
          if (!meta) {
            return;
          }
          try {
            const read = await this.repo.readAnchor(meta.name);
            const parsed = parseAnchor(read.content);
            anchorMetaByName.set(meta.name, meta);
            contentByAnchor.set(meta.name, { read, body: parsed.body });
            sectionTitlesByAnchor.set(meta.name, new Set(parsed.sections.keys()));
            // Format-gate here (the single population site): a malformed
            // anchor_id must never participate in typed-relation resolution
            // or coverage's anchorNamesForAnchorId as if it were resolvable —
            // WP5 coverage reports the malformed value from the raw front
            // matter separately.
            const anchorId = anchorIdFromFrontmatter(read.frontmatter);
            anchorIdByName.set(meta.name, anchorId && isValidAnchorId(anchorId) ? anchorId : undefined);
            if (frontmatterTypeIncludesRoadmap(read.frontmatter.type)) {
              // Key each goal by every project the roadmap belongs to (its
              // path-derived slug plus declared front-matter slugs), so a
              // typed goal:<project>:<goal-id> ref only resolves within the
              // named project — never against a same-numbered goal elsewhere.
              const roadmapSlugs = new Set<string>([
                ...(meta.projectSlug ? [meta.projectSlug] : []),
                ...frontmatterProjectSlugs(read.frontmatter),
              ]);
              for (const row of listRoadmapGoalsWithStatus(read.content)) {
                if (!row.id) {
                  continue;
                }
                for (const slug of roadmapSlugs) {
                  const goals = knownGoalIdsByProject.get(slug) ?? new Set<string>();
                  goals.add(row.id);
                  knownGoalIdsByProject.set(slug, goals);
                }
              }
            }
          } catch {
            // Skip unreadable anchors during graph indexing.
          }
        }
      }),
    );

    const ctx = await this.buildExtractContext(metas, sectionTitlesByAnchor, anchorIdByName, knownGoalIdsByProject);

    // Pass 2: extract edges per document (pure, no I/O — uses the content and
    // parsed body already read in pass 1).
    for (const [anchorName, { read, body }] of contentByAnchor) {
      const doc: DocumentInput = { anchorName, frontmatter: read.frontmatter, body, content: read.content };
      const group: DocumentEdgeGroup = {
        edges: extractDocumentEdges(doc, ctx),
        literalRelations: extractLiteralRelationsEdges(doc),
      };
      byDocument.set(anchorName, group);
      indexGroup(group, forward, reverse, literalRelationsReverse);
    }

    const registryEdges = [
      ...extractRegistryPersonProjectEdges(ctx.peopleRegistry),
      ...extractRegistryProjectRepoEdges(ctx.mappings),
    ];
    indexEdges(registryEdges, forward, reverse);

    if (generation !== this.generation) {
      // State changed while the walk ran (invalidateDocument/invalidate raced
      // us); discard so the caller re-checks against current state.
      return;
    }

    this.head = head;
    this.built = true;
    this.byDocument = byDocument;
    this.anchorMetaByName = anchorMetaByName;
    this.registryEdges = registryEdges;
    this.forward = forward;
    this.reverse = reverse;
    this.literalRelationsReverse = literalRelationsReverse;
    this.sectionTitlesByAnchor = sectionTitlesByAnchor;
    this.anchorIdByName = anchorIdByName;
    this.knownGoalIdsByProject = knownGoalIdsByProject;
  }

  private async buildExtractContext(
    metas: AnchorMeta[],
    sectionTitlesByAnchor?: ReadonlyMap<string, ReadonlySet<string>>,
    anchorIdByName?: ReadonlyMap<string, string | undefined>,
    knownGoalIdsByProject?: ReadonlyMap<string, ReadonlySet<string>>,
  ): Promise<ExtractDocumentEdgesContext & { peopleRegistry: PeopleRegistry }> {
    const anchorNames = new Set(metas.map((meta) => meta.name));
    const peopleRegistry = await this.deps.loadPeopleRegistry();
    const mappings = await this.deps.loadProjectMappings();
    const peopleIndex: PeopleIndex = buildPeopleIndex(peopleRegistry);
    const titles = sectionTitlesByAnchor ?? this.sectionTitlesByAnchor;
    // Goal 0 Phase 1 WP3: reused from the last full rebuild when this call
    // comes from invalidateDocument (see the field docstrings above) rather
    // than recomputed, keeping the incremental path cheap.
    const anchorIds = anchorIdByName ?? this.anchorIdByName;
    const goalIdsByProject = knownGoalIdsByProject ?? this.knownGoalIdsByProject;
    // Same alias resolution resolveProjectFilter uses elsewhere (project
    // scoping in listAnchors/loadContext/etc), so a project slug in front
    // matter that is actually a declared alias resolves to the same
    // project:<canonical-slug> node an anchor using the canonical slug does.
    const aliasIndex = buildProjectAliasIndex(metas);

    const resolveAnchorName = (value: string): string | undefined => {
      const trimmed = normalizeRelative(value.trim());
      if (!trimmed) {
        return undefined;
      }
      if (anchorNames.has(trimmed)) {
        return trimmed;
      }
      const withMd = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      return anchorNames.has(withMd) ? withMd : undefined;
    };

    const resolveProjectSlug = (slug: string): string | undefined => {
      const trimmed = slug.trim();
      if (!trimmed) {
        return undefined;
      }
      const alias = aliasIndex.byAlias.get(trimmed.toLowerCase());
      if (alias) {
        return alias;
      }
      // Already a canonical slug (declared by some anchor's projectSlug, or a
      // project-mappings row), or an undeclared slug front matter is still
      // the source of truth for — either way, keep it as-is.
      return trimmed;
    };

    // Goal 0 Phase 1 WP3: reverse anchor_id -> name lookup for typed
    // `anchor:<anchor-id>` relation targets. Built once per context (not per
    // target) since a document's relations can cite several anchor_ids. An
    // anchor_id declared by MORE than one anchor is a tree-level defect (WP5
    // coverage reports it as malformed/ambiguous); a typed target citing it
    // must resolve to NO anchor — falling back to legacy handling — rather
    // than to whichever duplicate happened to be inserted last.
    const anchorNameByAnchorId = new Map<string, string>();
    const duplicatedAnchorIds = new Set<string>();
    for (const [name, anchorId] of anchorIds) {
      if (!anchorId) {
        continue;
      }
      if (anchorNameByAnchorId.has(anchorId)) {
        duplicatedAnchorIds.add(anchorId);
        continue;
      }
      anchorNameByAnchorId.set(anchorId, name);
    }
    const resolveAnchorId = (anchorId: string): string | undefined =>
      duplicatedAnchorIds.has(anchorId) ? undefined : anchorNameByAnchorId.get(anchorId);

    // Goal 0 Phase 2 slice 4: invert knownGoalIdsByProject to a single-owner
    // lookup for canonical goal v2 keying. A goal id owned by exactly one
    // project scopes to that project (v2 `goal:<slug>:<id>`); zero owners
    // (unknown) or two-plus owners (ambiguous — the exact collision scoped
    // goals prevent) leave it v1 (`goal:<id>`).
    const projectsByGoalId = new Map<string, Set<string>>();
    for (const [projectSlug, goalIds] of goalIdsByProject) {
      for (const goalId of goalIds) {
        const owners = projectsByGoalId.get(goalId) ?? new Set<string>();
        owners.add(projectSlug);
        projectsByGoalId.set(goalId, owners);
      }
    }
    const projectSlugForGoalId = (goalId: string): string | undefined => {
      const owners = projectsByGoalId.get(goalId);
      if (!owners || owners.size !== 1) {
        return undefined;
      }
      return [...owners][0];
    };

    return {
      anchorNames,
      resolveAnchorName,
      getAnchorSectionTitles: (anchorName: string) => titles.get(anchorName),
      resolveProjectSlug,
      peopleRegistry,
      peopleIndex,
      mappings,
      resolveAnchorId,
      goalExistsInProject: (projectSlug: string, goalId: string) =>
        goalIdsByProject.get(projectSlug)?.has(goalId) ?? false,
      canonicalIds: {
        anchorIdByName: anchorIds,
        projectSlugForGoalId,
      },
    };
  }

  private removeDocumentContribution(anchorName: string): void {
    const existing = this.byDocument.get(anchorName);
    if (!existing) {
      return;
    }
    this.byDocument.delete(anchorName);
    removeEdgesFromIndex(existing.edges, this.forward, this.reverse);
    removeLiteralRelationsFromIndex(anchorName, this.literalRelationsReverse);
  }
}

/** Read a front-matter `anchor_id`, format-gated exactly like the pass-1 population site (a malformed id is treated as no id). */
function normalizeValidAnchorId(frontmatter: Record<string, unknown> | undefined): string | undefined {
  const anchorId = anchorIdFromFrontmatter(frontmatter);
  return anchorId && isValidAnchorId(anchorId) ? anchorId : undefined;
}

/** Front-matter `type` includes `project-roadmap` (string or array form). */
function frontmatterTypeIncludesRoadmap(type: unknown): boolean {
  if (type === "project-roadmap") {
    return true;
  }
  return Array.isArray(type) && type.some((item) => item === "project-roadmap");
}

function indexGroup(
  group: DocumentEdgeGroup,
  forward: Map<string, GraphEdge[]>,
  reverse: Map<string, GraphEdge[]>,
  literalRelationsReverse: Map<string, LiteralRelationEdge[]>,
): void {
  indexEdges(group.edges, forward, reverse);
  for (const literal of group.literalRelations) {
    const bucket = literalRelationsReverse.get(literal.to);
    if (bucket) {
      bucket.push(literal);
    } else {
      literalRelationsReverse.set(literal.to, [literal]);
    }
  }
}

function indexEdges(edges: GraphEdge[], forward: Map<string, GraphEdge[]>, reverse: Map<string, GraphEdge[]>): void {
  for (const edge of edges) {
    const fwd = forward.get(edge.from);
    if (fwd) {
      fwd.push(edge);
    } else {
      forward.set(edge.from, [edge]);
    }
    const rev = reverse.get(edge.to);
    if (rev) {
      rev.push(edge);
    } else {
      reverse.set(edge.to, [edge]);
    }
  }
}

function removeEdgesFromIndex(
  edges: GraphEdge[],
  forward: Map<string, GraphEdge[]>,
  reverse: Map<string, GraphEdge[]>,
): void {
  for (const edge of edges) {
    removeOne(forward, edge.from, edge);
    removeOne(reverse, edge.to, edge);
  }
}

function removeOne(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const bucket = map.get(key);
  if (!bucket) {
    return;
  }
  const next = bucket.filter((candidate) => candidate !== edge);
  if (next.length > 0) {
    map.set(key, next);
  } else {
    map.delete(key);
  }
}

function removeLiteralRelationsFromIndex(
  anchorName: string,
  literalRelationsReverse: Map<string, LiteralRelationEdge[]>,
): void {
  for (const [target, edges] of literalRelationsReverse) {
    const next = edges.filter((edge) => edge.from !== anchorName);
    if (next.length > 0) {
      literalRelationsReverse.set(target, next);
    } else {
      literalRelationsReverse.delete(target);
    }
  }
}
