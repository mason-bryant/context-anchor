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
} from "./model.js";
import type { AnchorFrontmatter, PeopleRegistry, ProjectMappings } from "../types.js";
import { extractClaims } from "../claims.js";

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

function frontmatterProjectSlugs(frontmatter: AnchorFrontmatter): string[] {
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

    for (const target of values) {
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }
      const resolved = ctx.resolveAnchorName(target);
      if (!resolved) {
        continue;
      }
      edges.push({ from, to: anchorNodeId(resolved), type: "anchor_anchor", sourceOfTruth: "front-matter" });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Milestone: milestone node containment + tasks/owners
// ---------------------------------------------------------------------------

/**
 * `milestone -> anchor` containment edge (the milestone node's home anchor)
 * plus `task -> owner` edges resolved through the people index, for
 * `type: project-milestone` anchors.
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
    if (!task.owner) {
      continue;
    }
    const match = ctx.peopleIndex.resolveOwner(task.owner);
    if (!match) {
      continue;
    }
    const to = match.kind === "person" ? personNodeId(match.person.id) : teamNodeId(match.team.id);
    edges.push({
      from: taskNodeId(doc.anchorName, task.id),
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
 * `status === "annotated"` claim in the document. Section nodes are only
 * materialized when a claim actually cites one (never one node per H2
 * heading in every anchor).
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

  for (const claim of claims) {
    if (claim.status !== "annotated" || !claim.id) {
      continue;
    }
    const from = claimNodeId(doc.anchorName, claim.id);

    for (const source of claim.sources) {
      const result = parseClaimSource(source, sourceCtx);
      if (result.node) {
        if (result.node.type === "person") {
          edges.push({ from, to: result.node.nodeId, type: "claim_person", sourceOfTruth: "claim-annotation" });
        } else if (result.node.type === "section") {
          edges.push({ from, to: result.node.nodeId, type: "claim_section", sourceOfTruth: "claim-annotation" });
          const sectionAnchor = sectionNodeAnchorName(result.node.nodeId);
          if (sectionAnchor) {
            edges.push({
              from: result.node.nodeId,
              to: anchorNodeId(sectionAnchor),
              type: "section_anchor",
              sourceOfTruth: "containment",
            });
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
  }

  return edges;
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
