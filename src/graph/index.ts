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
import { anchorIdFromFrontmatter } from "./identity.js";
import { listRoadmapGoalsWithStatus } from "../roadmap/analyzeRoadmap.js";
import type { AnchorMeta, PeopleRegistry, ProjectMappings } from "../types.js";
import {
  extractDocumentEdges,
  extractLiteralRelationsEdges,
  extractRegistryPersonProjectEdges,
  extractRegistryProjectRepoEdges,
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
  private knownGoalIds = new Set<string>();

  constructor(
    private readonly repo: Pick<AnchorStore, "repoPath" | "listAnchors" | "readAnchor">,
    private readonly deps: GraphIndexDeps,
  ) {}

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

    this.removeDocumentContribution(anchorName);

    let read: ReadAnchorResult | undefined;
    try {
      read = await this.repo.readAnchor(anchorName);
    } catch {
      // Deleted or unreadable: leave it removed from the graph.
    }

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
    this.knownGoalIds = new Set();
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
    const knownGoalIds = new Set<string>();

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
            anchorIdByName.set(meta.name, anchorIdFromFrontmatter(read.frontmatter));
            if (frontmatterTypeIncludesRoadmap(read.frontmatter.type)) {
              for (const row of listRoadmapGoalsWithStatus(read.content)) {
                if (row.id) {
                  knownGoalIds.add(row.id);
                }
              }
            }
          } catch {
            // Skip unreadable anchors during graph indexing.
          }
        }
      }),
    );

    const ctx = await this.buildExtractContext(metas, sectionTitlesByAnchor, anchorIdByName, knownGoalIds);

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
    this.knownGoalIds = knownGoalIds;
  }

  private async buildExtractContext(
    metas: AnchorMeta[],
    sectionTitlesByAnchor?: ReadonlyMap<string, ReadonlySet<string>>,
    anchorIdByName?: ReadonlyMap<string, string | undefined>,
    knownGoalIds?: ReadonlySet<string>,
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
    const goalIds = knownGoalIds ?? this.knownGoalIds;
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
    // target) since a document's relations can cite several anchor_ids.
    const anchorNameByAnchorId = new Map<string, string>();
    for (const [name, anchorId] of anchorIds) {
      if (anchorId) {
        anchorNameByAnchorId.set(anchorId, name);
      }
    }
    const resolveAnchorId = (anchorId: string): string | undefined => anchorNameByAnchorId.get(anchorId);

    return {
      anchorNames,
      resolveAnchorName,
      getAnchorSectionTitles: (anchorName: string) => titles.get(anchorName),
      resolveProjectSlug,
      peopleRegistry,
      peopleIndex,
      mappings,
      resolveAnchorId,
      knownGoalIds: goalIds,
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
