import type { AnchorStore } from "../storage/store.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { AnchorMeta, AnchorRead } from "../types.js";
import { GraphIndex } from "../graph/index.js";
import { parsePeopleRegistry } from "../peopleRegistry.js";
import { parseProjectMappings } from "../projectMappings.js";

function roadmapNameForProjectSlug(slug: string): string {
  return `projects/${slug}/${slug}-roadmap.md`;
}

export async function getRelatedAnchors(repo: AnchorStore, name: string, kind?: string): Promise<AnchorRead[]> {
  const resolvedName = repo.resolveAnchor(name).name;
  const read = await repo.readAnchor(resolvedName);
  const relRaw = read.frontmatter.relations;
  if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
    return [];
  }

  const rel = relRaw as Record<string, unknown>;
  const kinds = kind ? [kind] : Object.keys(rel);
  const out: AnchorRead[] = [];
  const seen = new Set<string>();

  const classification = classifyAnchorPath(resolvedName);
  const slug = classification.kind === "anchor" ? classification.projectSlug : undefined;

  for (const key of kinds) {
    const values = rel[key];
    if (!Array.isArray(values)) {
      continue;
    }

    if (key === "goal_ids" && isProjectMilestoneType(read.frontmatter.type)) {
      if (slug) {
        const roadmapName = roadmapNameForProjectSlug(slug);
        if (!seen.has(roadmapName)) {
          seen.add(roadmapName);
          try {
            out.push(await repo.readAnchor(roadmapName));
          } catch {
            // roadmap missing
          }
        }
      }
      continue;
    }

    for (const target of values) {
      if (typeof target !== "string" || target.length === 0) {
        continue;
      }
      const resolved = target.endsWith(".md") ? target : `${target}.md`;
      if (seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      try {
        out.push(await repo.readAnchor(resolved));
      } catch {
        // skip missing anchors
      }
    }
  }

  return out;
}

/**
 * Anchors whose front-matter `relations.<kind>` array literally names
 * `targetName` (WP3: reimplemented on `GraphIndex`'s reverse edges instead of
 * an O(N) full-tree scan). Exported signature and behavior are unchanged —
 * confirmed today's implementation has zero production call sites, but the
 * plan asks for the schema to stay byte-compatible for a future caller (and
 * for `getRelated`'s tool schema, which this does not currently feed).
 *
 * Layering note: this reimplementation builds a `GraphIndex` scoped to the
 * call rather than reusing a caller-cached one. Nothing calls this function
 * in production today, so there is no cache-reuse to preserve; a future
 * caller sitting on `AnchorService` (which does hold a long-lived
 * `GraphIndex`) can call the index's `anchorsReferencingLiteralTarget`
 * directly instead of going through this free function if it wants the
 * cached-index performance benefit.
 *
 * Deliberately preserves the OLD function's simpler semantics, distinct from
 * `getRelatedAnchors`: `relations.goal_ids` on a `project-milestone` anchor is
 * read as a LITERAL target list here (no resolution to the sibling roadmap
 * anchor) — only `getRelatedAnchors` has that special case. See
 * `extractLiteralRelationsEdges` in `src/graph/extract.ts` for the edge
 * extraction that preserves this.
 */
export async function findReferencingAnchorMetas(
  repo: AnchorStore,
  targetName: string,
  kind?: string,
): Promise<AnchorMeta[]> {
  const normalizedTarget = targetName.endsWith(".md") ? targetName : `${targetName}.md`;
  const graph = new GraphIndex(repo, {
    loadPeopleRegistry: async () => parsePeopleRegistry(await repo.readPeopleRegistryRaw()),
    loadProjectMappings: async () => parseProjectMappings(await repo.readProjectMappingsRaw()),
  });
  return graph.anchorsReferencingLiteralTarget(normalizedTarget, kind);
}
