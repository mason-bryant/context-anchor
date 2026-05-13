import type { AnchorRepository } from "../git/repo.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { AnchorMeta, AnchorRead } from "../types.js";

function roadmapNameForProjectSlug(slug: string): string {
  return `projects/${slug}/${slug}-roadmap.md`;
}

export async function getRelatedAnchors(repo: AnchorRepository, name: string, kind?: string): Promise<AnchorRead[]> {
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

export async function findReferencingAnchorMetas(
  repo: AnchorRepository,
  targetName: string,
  kind?: string,
): Promise<AnchorMeta[]> {
  const normalizedTarget = targetName.endsWith(".md") ? targetName : `${targetName}.md`;
  const metas = await repo.listAnchors();
  const out: AnchorMeta[] = [];

  for (const meta of metas) {
    const read = await repo.readAnchor(meta.name);
    const relRaw = read.frontmatter.relations;
    if (!relRaw || typeof relRaw !== "object" || Array.isArray(relRaw)) {
      continue;
    }
    const rel = relRaw as Record<string, unknown>;
    const keys = kind ? [kind] : Object.keys(rel);
    let hit = false;
    outer: for (const k of keys) {
      const values = rel[k];
      if (!Array.isArray(values)) {
        continue;
      }
      for (const v of values) {
        if (typeof v !== "string") {
          continue;
        }
        const resolved = v.endsWith(".md") ? v : `${v}.md`;
        if (resolved === normalizedTarget) {
          hit = true;
          break outer;
        }
      }
    }
    if (hit) {
      out.push(meta);
    }
  }

  return out;
}
