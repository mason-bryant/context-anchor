/**
 * Pure per-document graph edge extractors (WP3 of the claim knowledge graph
 * plan). Every function here takes already-parsed data — front matter, body
 * text, registries, resolvers — and returns `GraphEdge[]`. No I/O, no git, no
 * filesystem access: `GraphIndex` (`src/graph/index.ts`) is the only caller
 * that touches storage, and it does so before calling into this module.
 *
 * One extractor per edge source, callable independently, plus
 * `extractDocumentEdges` which concatenates all of them for one document.
 * Keeping edges grouped per source document is what makes per-document
 * invalidation possible: `GraphIndex.invalidateDocument` drops one document's
 * edge group and re-extracts just that document.
 */

import { normalizeSectionTitle } from "../anchorPatch.js";
import { normalizePathForStorage } from "../projectMappings.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { normalizedTasksFromFm } from "../milestoneFrontmatter.js";
import { listRoadmapGoalsWithStatus } from "../roadmap/analyzeRoadmap.js";
import { extractMarkdownLinks } from "../storage/markdown.js";
import type { PeopleIndex } from "../peopleRegistry.js";
import { parseClaimSource, type ParseClaimSourceContext } from "./sourceId.js";
import {
  anchorNodeId,
  claimNodeId,
  goalNodeId,
  milestoneNodeId,
  pathNodeId,
  personNodeId,
  projectNodeId,
  repoNodeId,
  sectionNodeId,
  taskNodeId,
  teamNodeId,
  type GraphEdge,
  type GraphEdgeType,
} from "./model.js";
import type { AnchorFrontmatter, PeopleRegistry, ProjectMappings } from "../types.js";
import { EDGE_TARGET_PATTERN, extractClaims } from "../claims.js";
import {
  parseRelationTarget,
  relationTargetKindAllowed,
  relationVocabularyEntry,
  type ParsedRelationTarget,
} from "../relations/vocabulary.js";

/** Minimal per-document input every extractor needs. */
export type DocumentInput = {
  anchorName: string;
  frontmatter: AnchorFrontmatter;
  body: string;
  content: string;
};

export type ExtractDocumentEdgesContext = {
  /** All known anchor names in the tree (for relation-target / body-link / claim-source resolution). */
  anchorNames: ReadonlySet<string>;
  /** Resolve a possibly-unnormalized anchor reference to its canonical stored name, or undefined if it does not exist. */
  resolveAnchorName: (value: string) => string | undefined;
  /** H2 section titles for an already-resolved anchor name (for claim section-reference edges). */
  getAnchorSectionTitles: (anchorName: string) => ReadonlySet<string> | undefined;
  /** Resolve a front-matter `project` slug/alias to its canonical slug (via `buildProjectAliasIndex`, the same alias resolution `resolveProjectFilter` uses), or the trimmed input unchanged when no anchor declares it as either a canonical slug or an alias. */
  resolveProjectSlug: (slug: string) => string | undefined;
  peopleRegistry: PeopleRegistry;
  peopleIndex: PeopleIndex;
  mappings: ProjectMappings;
  /**
   * Resolve a canonical typed-relation `anchor:<anchor-id>` target
   * (`src/relations/vocabulary.ts`) to its v1 anchor name, or undefined when
   * no anchor in the tree declares that `anchor_id` (Goal 0 Phase 1 WP3).
   */
  resolveAnchorId?: (anchorId: string) => string | undefined;
  /**
   * True when `goalId` is defined by a `project-roadmap` anchor belonging to
   * the given (already canonical) project slug — PROJECT-SCOPED, so a typed
   * `goal:<project-slug>:<goal-id>` target only resolves against the named
   * project's own roadmap, never against a same-numbered goal in some other
   * project (the exact collision Goal 0's scoped-goal contract exists to
   * prevent). Absent/undefined treats no goal as known (conservative: typed
   * goal refs fall back to legacy handling rather than being asserted
   * resolved).
   */
  goalExistsInProject?: (projectSlug: string, goalId: string) => boolean;
};

// ---------------------------------------------------------------------------
// Front matter: project slug(s)
// ---------------------------------------------------------------------------

/** `anchor -> project` edges from front-matter `project` (alias-resolved via `ctx.resolveProjectSlug`, which `GraphIndex` builds from `buildProjectAliasIndex` — the same alias resolution `resolveProjectFilter` uses for project-scoped queries elsewhere in the codebase). */
export function extractProjectEdges(doc: DocumentInput, ctx: ExtractDocumentEdgesContext): GraphEdge[] {
  const projectSlugs = frontmatterProjectSlugs(doc.frontmatter);
  if (projectSlugs.length === 0) {
    return [];
  }
  const from = anchorNodeId(doc.anchorName);
  const edges: GraphEdge[] = [];
  for (const slug of projectSlugs) {
    const resolvedSlug = ctx.resolveProjectSlug(slug);
    if (!resolvedSlug) {
      continue;
    }
    edges.push({ from, to: projectNodeId(resolvedSlug), type: "anchor_project", sourceOfTruth: "front-matter" });
  }
  return edges;
}

export function frontmatterProjectSlugs(frontmatter: AnchorFrontmatter): string[] {
  const raw = frontmatter.project;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return [raw.trim()];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Front matter: relations.*
// ---------------------------------------------------------------------------

/**
 * `anchor -> anchor` edges from front-matter `relations.<kind>` arrays,
 * mirroring `getRelatedAnchors`' target-normalization rules (`.md` appended
 * if missing), PLUS the true semantic `milestone -> goal` edge (design doc's
 * edge table) from `relations.goal_ids` on a `project-milestone` anchor: one
 * `milestone_goal` edge per goal id, from the milestone's `milestone:` node
 * straight to each `goal:<id>` node — not an `anchor_anchor` edge to the
 * sibling roadmap anchor (that would conflate "this milestone targets goal
 * G-001" with "this milestone's anchor links to the roadmap anchor", two
 * different facts). See `extractRelationsLiteralEdges` below for the literal
 * (unresolved) reading `findReferencingAnchorMetas` needs to stay
 * byte-parity with its pre-WP3 full-scan behavior — that one does NOT
 * resolve `goal_ids` specially, unlike this semantic extractor.
 *
 * WP3 addition (typed relation vocabulary, `src/relations/vocabulary.ts`):
 * for a registered relation key (`depends_on`, `implements`, `supersedes`,
 * `related_to`, `owned_by` — NOT `goal_ids`, handled above, and NOT
 * `derived_from`/`contradicts`, claim-annotation grammar) whose target parses
 * as a canonical typed ref (`anchor:a-xxxxxx`, `goal:<project-slug>:G-123`,
 * `person:<id>`, `team:<id>`) AND resolves to a real, kind-valid node, emit
 * the typed edge INSTEAD of the legacy `anchor_anchor` edge for that one
 * target (`related_to` emits both directions, since it is symmetric). Every
 * other case — unregistered key, legacy bare string, unparseable/malformed
 * typed ref, wrong-kind target, or a typed ref that fails to resolve — falls
 * through to the exact pre-WP3 `anchor_anchor` behavior for that key
 * (`emitLegacyAnchorAnchor` below), so no relation target the graph tracked
 * before this phase can disappear.
 */
export function extractRelationsEdges(doc: DocumentInput, ctx: ExtractDocumentEdgesContext): GraphEdge[] {
  const relRaw = doc.frontmatter.relations;
  if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
    return [];
  }
  const rel = relRaw as Record<string, unknown>;
  const from = anchorNodeId(doc.anchorName);
  const edges: GraphEdge[] = [];

  for (const key of Object.keys(rel)) {
    const values = rel[key];
    if (!Array.isArray(values)) {
      continue;
    }

    if (key === "goal_ids" && isProjectMilestoneType(doc.frontmatter.type)) {
      const milestoneFrom = milestoneNodeId(doc.anchorName);
      for (const goalId of values) {
        if (typeof goalId !== "string" || goalId.trim().length === 0) {
          continue;
        }
        edges.push({
          from: milestoneFrom,
          to: goalNodeId(goalId.trim()),
          type: "milestone_goal",
          sourceOfTruth: "front-matter",
        });
      }
      continue;
    }

    const vocabEntry = relationVocabularyEntry(key);

    for (const target of values) {
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }

      if (vocabEntry) {
        const typedEdges = tryEmitTypedRelationEdges(vocabEntry.key, from, target, ctx);
        if (typedEdges) {
          edges.push(...typedEdges);
          continue;
        }
      }

      emitLegacyAnchorAnchor(edges, from, target, ctx);
    }
  }

  return edges;
}

/**
 * Attempt to resolve one relation target as a registered vocabulary key's
 * typed edge. Returns undefined (never an empty array) when the target
 * should fall back to legacy `anchor_anchor` handling instead — a legacy bare
 * string, a malformed typed ref, a wrong-kind target, or a typed ref that
 * fails to resolve against the tree are all "not typed-resolvable" cases the
 * caller treats identically.
 */
function tryEmitTypedRelationEdges(
  relationKey: string,
  from: string,
  target: string,
  ctx: ExtractDocumentEdgesContext,
): GraphEdge[] | undefined {
  const entry = relationVocabularyEntry(relationKey);
  if (!entry) {
    return undefined;
  }
  const parseResult = parseRelationTarget(target);
  if (parseResult.legacy || !parseResult.parsed) {
    // Legacy bare string, or a recognized-but-malformed typed ref (WP5
    // reports the malformed reason; extraction just falls back).
    return undefined;
  }
  if (!relationTargetKindAllowed(entry, parseResult.parsed)) {
    return undefined;
  }
  const to = resolveTypedRelationTarget(parseResult.parsed, ctx);
  if (!to) {
    return undefined;
  }
  const edgeType = relationKey as GraphEdgeType;
  const edges: GraphEdge[] = [{ from, to, type: edgeType, sourceOfTruth: "front-matter" }];
  if (entry.symmetric) {
    edges.push({ from: to, to: from, type: edgeType, sourceOfTruth: "front-matter" });
  }
  return edges;
}

/** Resolve a parsed canonical typed-relation target to a v1 node id, or undefined if it does not resolve against the tree. */
function resolveTypedRelationTarget(
  parsed: ParsedRelationTarget,
  ctx: ExtractDocumentEdgesContext,
): string | undefined {
  switch (parsed.kind) {
    case "anchor": {
      const resolvedName = ctx.resolveAnchorId?.(parsed.id);
      return resolvedName ? anchorNodeId(resolvedName) : undefined;
    }
    case "goal": {
      const resolvedSlug = ctx.resolveProjectSlug(parsed.projectSlug);
      if (!resolvedSlug) {
        return undefined;
      }
      if (!ctx.goalExistsInProject?.(resolvedSlug, parsed.goalId)) {
        return undefined;
      }
      // Goal nodes stay unscoped (v1) in this phase (plan decision 2): the
      // typed ref's project scope gates resolution (the goal must be defined
      // by the NAMED project's own roadmap — never a same-numbered goal in
      // another project), but the emitted edge still targets the existing
      // unscoped `goal:<id>` node — no v2 re-key happens here.
      return goalNodeId(parsed.goalId);
    }
    case "person": {
      const person = ctx.peopleIndex.getPersonById(parsed.id);
      return person ? personNodeId(person.id) : undefined;
    }
    case "team": {
      const team = ctx.peopleIndex.getTeamById(parsed.id);
      return team ? teamNodeId(team.id) : undefined;
    }
    default:
      return undefined;
  }
}

/** The exact pre-WP3 legacy `anchor_anchor` edge emission for one relation target. */
function emitLegacyAnchorAnchor(
  edges: GraphEdge[],
  from: string,
  target: string,
  ctx: ExtractDocumentEdgesContext,
): void {
  const resolved = ctx.resolveAnchorName(target);
  if (!resolved) {
    return;
  }
  edges.push({ from, to: anchorNodeId(resolved), type: "anchor_anchor", sourceOfTruth: "front-matter" });
}

// ---------------------------------------------------------------------------
// Milestone: milestone node containment + tasks/owners
// ---------------------------------------------------------------------------

/**
 * `milestone -> anchor` containment edge (the milestone node's home anchor),
 * `milestone -> task` containment edges (one per front-matter `tasks[]`
 * entry, regardless of whether it has an owner — WP4 addition, see
 * `milestone_task`'s docstring in `src/graph/model.ts`), plus `task ->
 * owner` edges resolved through the people index, for `type:
 * project-milestone` anchors.
 */
export function extractMilestoneEdges(doc: DocumentInput, ctx: ExtractDocumentEdgesContext): GraphEdge[] {
  if (!isProjectMilestoneType(doc.frontmatter.type)) {
    return [];
  }
  const edges: GraphEdge[] = [];
  const milestoneId = milestoneNodeId(doc.anchorName);

  edges.push({
    from: milestoneId,
    to: anchorNodeId(doc.anchorName),
    type: "milestone_anchor",
    sourceOfTruth: "containment",
  });

  const tasks = normalizedTasksFromFm(doc.frontmatter as Record<string, unknown>) ?? [];
  for (const task of tasks) {
    const taskId = taskNodeId(doc.anchorName, task.id);
    edges.push({
      from: milestoneId,
      to: taskId,
      type: "milestone_task",
      sourceOfTruth: "front-matter",
    });

    if (!task.owner) {
      continue;
    }
    const match = ctx.peopleIndex.resolveOwner(task.owner);
    if (!match) {
      continue;
    }
    const to = match.kind === "person" ? personNodeId(match.person.id) : teamNodeId(match.team.id);
    edges.push({
      from: taskId,
      to,
      type: "task_owner",
      sourceOfTruth: "front-matter",
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Roadmap goal headings
// ---------------------------------------------------------------------------

/**
 * Materializes goal nodes via an `anchor -> goal` containment edge
 * (`roadmap_goal`, NOT `milestone_goal` — the `from` side here is the
 * roadmap anchor itself, never a milestone) from the roadmap anchor to each
 * goal heading it defines, for `type: project-roadmap` anchors, sourced from
 * `listRoadmapGoalsWithStatus`. The primary semantic goal EDGE in the design
 * doc's table, "milestone -> goal" via `relations.goal_ids`, is a distinct
 * edge type (`milestone_goal`) emitted by `extractRelationsEdges`'s
 * `goal_ids` special case, from the milestone's own `milestone:` node. This
 * extractor's job is narrower: ensure goal nodes exist / are reachable from
 * the roadmap anchor that defines them, independent of which milestones
 * reference them.
 */
export function extractRoadmapGoalEdges(doc: DocumentInput): GraphEdge[] {
  if (!frontmatterTypeIncludes(doc.frontmatter.type, "project-roadmap")) {
    return [];
  }
  const rows = listRoadmapGoalsWithStatus(doc.content);
  const edges: GraphEdge[] = [];
  const from = anchorNodeId(doc.anchorName);
  for (const row of rows) {
    if (!row.id) {
      continue;
    }
    edges.push({ from, to: goalNodeId(row.id), type: "roadmap_goal", sourceOfTruth: "containment" });
  }
  return edges;
}

function frontmatterTypeIncludes(type: unknown, value: string): boolean {
  if (type === value) {
    return true;
  }
  return Array.isArray(type) && type.some((item) => item === value);
}

// ---------------------------------------------------------------------------
// Registries: people RACI + project-mappings repos/paths
// ---------------------------------------------------------------------------

/** `person/team -> project` edges from people-registry RACI associations. Tree-wide (not per-document); call once per build, not per anchor. */
export function extractRegistryPersonProjectEdges(peopleRegistry: PeopleRegistry): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const person of peopleRegistry.people) {
    for (const association of person.projects ?? []) {
      edges.push({
        from: personNodeId(person.id),
        to: projectNodeId(association.project),
        type: "person_project",
        sourceOfTruth: "registry",
      });
    }
  }
  for (const team of peopleRegistry.teams) {
    for (const association of team.projects ?? []) {
      edges.push({
        from: teamNodeId(team.id),
        to: projectNodeId(association.project),
        type: "team_project",
        sourceOfTruth: "registry",
      });
    }
  }
  return dedupeEdges(edges);
}

/** `project -> repo` and `repo -> path` edges from project-mappings. Tree-wide; call once per build, not per anchor. */
export function extractRegistryProjectRepoEdges(mappings: ProjectMappings): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const project of mappings.projects) {
    for (const repo of project.repos) {
      edges.push({
        from: projectNodeId(project.project),
        to: repoNodeId(repo.repo),
        type: "project_repo",
        sourceOfTruth: "registry",
      });
      for (const rawPath of repo.paths) {
        const dirPath = normalizePathForStorage(rawPath);
        if (!dirPath) {
          continue;
        }
        edges.push({
          from: repoNodeId(repo.repo),
          to: pathNodeId(repo.repo, dirPath),
          type: "repo_path",
          sourceOfTruth: "registry",
        });
      }
    }
  }
  return dedupeEdges(edges);
}

// ---------------------------------------------------------------------------
// Body markdown links
// ---------------------------------------------------------------------------

/**
 * `anchor -> anchor` edges from markdown links in the body that resolve to a
 * real anchor name. Reuses `extractMarkdownLinks` (`src/storage/markdown.ts`,
 * already the single place `[text](href)` links are parsed — shared with
 * `src/validators/prFormat.ts`) rather than a second, independently-drifting
 * link regex.
 */
export function extractBodyLinkEdges(doc: DocumentInput, ctx: ExtractDocumentEdgesContext): GraphEdge[] {
  const from = anchorNodeId(doc.anchorName);
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const link of extractMarkdownLinks(doc.body)) {
    const target = stripLinkFragmentAndQuery(link.href);
    if (!target || isExternalLinkTarget(target)) {
      continue;
    }
    const resolved = ctx.resolveAnchorName(target);
    if (!resolved || resolved === doc.anchorName || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    edges.push({ from, to: anchorNodeId(resolved), type: "anchor_anchor", sourceOfTruth: "body-link" });
  }

  return edges;
}

function isExternalLinkTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#");
}

function stripLinkFragmentAndQuery(target: string): string {
  return target.split(/[?#]/)[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Claim annotations
// ---------------------------------------------------------------------------

/**
 * `claim -> source` (pr/file/anchor/person/url), `claim -> person`,
 * `claim -> section` + `section -> anchor` containment edges for every
 * `status === "annotated"` claim in the document, plus `derived_from` /
 * `contradicts` claim -> claim edges (WP5) parsed off the same rows. Section
 * nodes are only materialized when a claim actually cites one (never one
 * node per H2 heading in every anchor).
 *
 * Goal 0 Phase 1 WP4 addition: a claim with an `id` but no provenance
 * (`status === "unannotated"`, id-only annotation — `src/claims.ts`'s
 * `parseIdOnlyAnnotationBody`) still gets its `claim:` node, so it appears in
 * the graph as unverified rather than disappearing (design doc acceptance
 * criterion: "an unannotated claim can have a stable identity and appears as
 * unverified rather than disappearing from the graph"). Since it has no
 * `sources` to derive a cited section from, its containment into the graph
 * is anchored via the claim's OWN H2 section (`claim.section`, e.g. "Current
 * State") rather than a section a source row cites — the same
 * `claim_section` + `section_anchor` edge types, just a different section
 * (the claim's home section instead of a cited one). An annotated claim's
 * edges are completely unchanged by this addition: it never gains an
 * own-section edge, only the pre-existing cited-section edges from its
 * sources.
 *
 * Edge targets whose anchor side doesn't resolve to a real anchor are silently
 * skipped here; the extractor does NOT check whether the target claim id
 * exists (that tree-wide check belongs to the write-time validator). Dangling
 * targets are a write-time WARN
 * (`claim_edge_target_missing`, `src/validators/claimEdgeTargets.ts`), not an
 * extractor concern: a graph edge to a node that does not exist would be
 * useless (and the malformed-shape case is already unreachable here, since a
 * malformed target blocks the write and never reaches an extracted document).
 */
export function extractClaimEdges(doc: DocumentInput, ctx: ExtractDocumentEdgesContext): GraphEdge[] {
  const claims = extractClaims(doc.content);
  const edges: GraphEdge[] = [];

  const sourceCtx: ParseClaimSourceContext = {
    anchorName: doc.anchorName,
    anchorNames: ctx.anchorNames,
    resolveAnchorName: ctx.resolveAnchorName,
    getAnchorSectionTitles: ctx.getAnchorSectionTitles,
    mappings: ctx.mappings,
    resolvePersonId: (rawPerson: string) => {
      const person = ctx.peopleIndex.getPersonById(rawPerson) ?? ctx.peopleIndex.getPerson(rawPerson);
      return person?.id;
    },
  };

  // Containment `section_anchor` edges are structural facts about the
  // section, not about any one claim: several claims in (or citing) the same
  // section must produce ONE section -> anchor edge, not one per claim or per
  // source row — GraphIndex does not dedupe edges, so emitting duplicates
  // here would inflate the adjacency lists and every downstream traversal.
  const seenSectionAnchorEdges = new Set<string>();
  const pushSectionAnchorEdge = (fromSection: string, toAnchor: string): void => {
    const key = `${fromSection}\n${toAnchor}`;
    if (seenSectionAnchorEdges.has(key)) {
      return;
    }
    seenSectionAnchorEdges.add(key);
    edges.push({ from: fromSection, to: toAnchor, type: "section_anchor", sourceOfTruth: "containment" });
  };

  for (const claim of claims) {
    if (!claim.id) {
      continue;
    }
    const from = claimNodeId(doc.anchorName, claim.id);

    if (claim.status !== "annotated") {
      // Id-only claim (WP4): no sources to derive a cited-section edge from,
      // so anchor it into the graph via its own containing section instead —
      // see the function docstring above. `derived_from`/`contradicts` below
      // still run (id-only claims can, in principle, carry them via a
      // reworded document, though the annotation grammar only sets those on
      // real source rows today), harmlessly no-op-ing over an empty array.
      const ownSection = sectionNodeId(doc.anchorName, normalizeSectionTitle(claim.section));
      edges.push({ from, to: ownSection, type: "claim_section", sourceOfTruth: "containment" });
      pushSectionAnchorEdge(ownSection, anchorNodeId(doc.anchorName));
    }

    for (const source of claim.sources) {
      const result = parseClaimSource(source, sourceCtx);
      if (result.node) {
        if (result.node.type === "person") {
          edges.push({ from, to: result.node.nodeId, type: "claim_person", sourceOfTruth: "claim-annotation" });
        } else if (result.node.type === "section") {
          edges.push({ from, to: result.node.nodeId, type: "claim_section", sourceOfTruth: "claim-annotation" });
          const sectionAnchor = sectionNodeAnchorName(result.node.nodeId);
          if (sectionAnchor) {
            pushSectionAnchorEdge(result.node.nodeId, anchorNodeId(sectionAnchor));
          }
        } else {
          edges.push({ from, to: result.node.nodeId, type: "claim_source", sourceOfTruth: "claim-annotation" });
        }
      }
      // personNode is independent of node (a row can carry both an artifact
      // src AND a structured person key per parseClaimSource's shape) — emit
      // a separate claim -> person edge unless it's the same node already
      // pushed above (trust-me-bro rows where node === personNode).
      if (result.personNode && result.personNode.nodeId !== result.node?.nodeId) {
        edges.push({
          from,
          to: result.personNode.nodeId,
          type: "claim_person",
          sourceOfTruth: "claim-annotation",
        });
      }
    }

    for (const target of claim.derivedFrom) {
      const to = resolveClaimEdgeTarget(target, doc.anchorName, ctx);
      if (to) {
        edges.push({ from, to, type: "derived_from", sourceOfTruth: "claim-annotation" });
      }
    }
    for (const target of claim.contradicts) {
      const to = resolveClaimEdgeTarget(target, doc.anchorName, ctx);
      if (to) {
        edges.push({ from, to, type: "contradicts", sourceOfTruth: "claim-annotation" });
      }
    }
  }

  return edges;
}

/**
 * Resolve a `derived_from`/`contradicts` target string (`<anchor>#<claim-id>`
 * or same-anchor `#<claim-id>`) to a `claim:<anchor>#<id>` node id, or
 * undefined when the anchor side doesn't resolve to a real anchor. Does NOT
 * verify the claim id actually exists on the target anchor — that check needs
 * to read the target anchor's content, which `extractClaimEdges` (pure,
 * per-document) does not have for a different document; the write-path
 * validator does that tree-wide check and reports dangling ids as a WARN.
 * Pointing at a bare anchor id shape here would still be a stable,
 * inspectable node id even before the target claim exists, so callers that
 * only need the shape (not existence) are unaffected.
 */
function resolveClaimEdgeTarget(
  target: string,
  ownerAnchorName: string,
  ctx: ExtractDocumentEdgesContext,
): string | undefined {
  const match = EDGE_TARGET_PATTERN.exec(target);
  if (!match) {
    return undefined;
  }
  const [, anchorPart, claimId] = match;
  const resolvedAnchor =
    anchorPart.trim() === "" ? ctx.resolveAnchorName(ownerAnchorName) : ctx.resolveAnchorName(anchorPart.trim());
  if (!resolvedAnchor || !ctx.anchorNames.has(resolvedAnchor)) {
    return undefined;
  }
  return claimNodeId(resolvedAnchor, claimId);
}

function sectionNodeAnchorName(sectionNodeId: string): string | undefined {
  // `section:<anchor>#<heading>` — split on the FIRST `#` after the `section:` prefix.
  const withoutPrefix = sectionNodeId.slice("section:".length);
  const hashIndex = withoutPrefix.indexOf("#");
  return hashIndex === -1 ? undefined : withoutPrefix.slice(0, hashIndex);
}

// ---------------------------------------------------------------------------
// Top-level per-document aggregator
// ---------------------------------------------------------------------------

/**
 * Every per-document (front matter, milestone, roadmap, body-link, claim)
 * extractor's edges, concatenated and deduplicated once here (rather than
 * once per extractor) — this is both the single place duplicates across
 * extractors would be caught and the only dedup pass most extractors need.
 * Registry edges (tree-wide, not per-document) are NOT included here — call
 * the registry extractors separately once per build.
 */
export function extractDocumentEdges(doc: DocumentInput, ctx: ExtractDocumentEdgesContext): GraphEdge[] {
  return dedupeEdges([
    ...extractProjectEdges(doc, ctx),
    ...extractRelationsEdges(doc, ctx),
    ...extractMilestoneEdges(doc, ctx),
    ...extractRoadmapGoalEdges(doc),
    ...extractBodyLinkEdges(doc, ctx),
    ...extractClaimEdges(doc, ctx),
  ]);
}

// ---------------------------------------------------------------------------
// Literal (unresolved) relations edges — for findReferencingAnchorMetas parity
// ---------------------------------------------------------------------------

export type LiteralRelationEdge = {
  from: string;
  /** Normalized (`.md`-suffixed) literal target, exactly as the old full-scan `findReferencingAnchorMetas` compared it — no goal_ids/project-milestone resolution. */
  to: string;
  kind: string;
};

/**
 * Literal, unresolved `relations.<kind>` target edges — deliberately NOT the
 * same as `extractRelationsEdges` above. The pre-WP3 `findReferencingAnchorMetas`
 * (`src/relations/index.ts`) reads `relations.<kind>` arrays as literal
 * anchor-name-ish targets for EVERY key including `goal_ids`, with no
 * `project-milestone` -> sibling-roadmap special case (only `getRelatedAnchors`,
 * a different function, has that special case). This extractor preserves that
 * exact literal semantics so the reverse-edge reimplementation stays byte-parity
 * with the old O(N) full-scan.
 */
export function extractLiteralRelationsEdges(doc: DocumentInput): LiteralRelationEdge[] {
  const relRaw = doc.frontmatter.relations;
  if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
    return [];
  }
  const rel = relRaw as Record<string, unknown>;
  const from = doc.anchorName;
  const edges: LiteralRelationEdge[] = [];

  for (const kind of Object.keys(rel)) {
    const values = rel[kind];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const target of values) {
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }
      const to = target.endsWith(".md") ? target : `${target}.md`;
      edges.push({ from, to, kind });
    }
  }

  return edges;
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}\u001f${edge.to}\u001f${edge.type}\u001f${edge.sourceOfTruth}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(edge);
  }
  return out;
}
