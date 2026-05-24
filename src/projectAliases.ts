import type { AnchorMeta, ProjectFilterResolution } from "./types.js";

const PROJECT_ALIAS_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export type ProjectAliasIndex = {
  byAlias: Map<string, string>;
  byCanonical: Map<string, string[]>;
  canonicalSlugs: Set<string>;
};

export function parseProjectAliases(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const aliases: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      aliases.push(trimmed);
    }
  }
  return aliases;
}

export function isValidProjectAliasSlug(slug: string): boolean {
  return PROJECT_ALIAS_SLUG.test(slug);
}

/** True for project context anchors that may declare `aliases`. */
export function isProjectContextAnchorPath(name: string, type: unknown): boolean {
  if (type === "context-anchor") {
    return /^projects\/[^/]+\/.+\.md$/.test(name);
  }
  return /\/[^/]+-project-context\.md$/i.test(name);
}

export function anchorMatchesProject(anchor: AnchorMeta, project: string): boolean {
  const needle = project.toLowerCase();
  if (anchor.projectSlug?.toLowerCase() === needle) {
    return true;
  }
  return frontmatterProjectIncludes(anchor.project, project);
}

export function buildProjectAliasIndex(metas: AnchorMeta[]): ProjectAliasIndex {
  const byAlias = new Map<string, string>();
  const byCanonical = new Map<string, string[]>();
  const canonicalSlugs = new Set<string>();

  for (const meta of metas) {
    if (meta.projectSlug) {
      canonicalSlugs.add(meta.projectSlug);
    }
    if (!meta.projectSlug || !meta.aliases?.length) {
      continue;
    }
    byCanonical.set(meta.projectSlug, meta.aliases);
    for (const alias of meta.aliases) {
      byAlias.set(alias.toLowerCase(), meta.projectSlug);
    }
  }

  return { byAlias, byCanonical, canonicalSlugs };
}

export function resolveProjectFilter(
  requested: string | undefined,
  anchors: AnchorMeta[],
  index: ProjectAliasIndex,
): ProjectFilterResolution | undefined {
  if (!requested?.trim()) {
    return undefined;
  }

  const trimmed = requested.trim();
  if (anchors.some((anchor) => anchorMatchesProject(anchor, trimmed))) {
    return { requested: trimmed, resolved: trimmed, via: "canonical" };
  }

  const canonical = index.byAlias.get(trimmed.toLowerCase());
  if (canonical) {
    return { requested: trimmed, resolved: canonical, via: "alias", matchedAlias: trimmed };
  }

  return { requested: trimmed, resolved: trimmed, via: "unresolved" };
}

function frontmatterProjectIncludes(project: unknown, slug: string): boolean {
  const needle = slug.toLowerCase();
  if (Array.isArray(project)) {
    return project.some((item) => typeof item === "string" && item.toLowerCase() === needle);
  }
  return typeof project === "string" && project.toLowerCase() === needle;
}
