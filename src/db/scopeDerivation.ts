export type ScopeKind = "initiative" | "component" | "domain" | "practice" | "workspace";

export type DerivedScope = {
  scopeKind: ScopeKind;
  scopeSlug: string;
  title: string;
  /** Which rule produced this, so a derived scope is never mistaken for a curated one. */
  derivedFromSignal: string;
};

export const DEFAULT_WORKSPACE_SCOPE_SLUG = "workspace";

const RULE_DIRECTORIES = new Set(["agent-rules", "server-rules"]);

/**
 * The fixed mapping from T2, chosen so each scope kind means what the reference model says:
 *
 *   projects/<slug>/…                      -> domain      (enduring subjects)
 *   projects/<slug>/milestones/<name>.md   -> initiative  (time-bounded, has outcomes/dates)
 *   agent-rules/…, server-rules/…          -> practice    (cross-cutting guidance)
 *   everything else                        -> the single default workspace scope
 *
 * Path-mapped code areas become `component` scopes, but those come from
 * `project-mappings.json` rather than from a document path, so they are derived separately.
 *
 * Roadmaps mint no scope of their own: a roadmap is an ordinary document owned by its
 * project's domain, and its goals live as sections that carry their own associations.
 */
export function deriveScopeForPath(rawPath: string): DerivedScope {
  const segments = normalizeSegments(rawPath);

  if (segments.length === 0) {
    throw new Error(`Cannot derive a scope from an empty path: ${JSON.stringify(rawPath)}`);
  }

  const [head, ...rest] = segments;

  if (head === "projects" && rest.length >= 1) {
    const projectSlug = rest[0]!;

    if (rest[1] === "milestones" && rest.length >= 3) {
      const milestoneName = stripMarkdownExtension(rest[rest.length - 1]!);
      return {
        scopeKind: "initiative",
        // Prefixed with the project: two projects legitimately both have a "backlog".
        scopeSlug: `${projectSlug}-${milestoneName}`,
        title: `${projectSlug} ${milestoneName}`,
        derivedFromSignal: "path:projects/<slug>/milestones/<name>",
      };
    }

    return {
      scopeKind: "domain",
      scopeSlug: projectSlug,
      title: projectSlug,
      derivedFromSignal: "path:projects/<slug>",
    };
  }

  if (RULE_DIRECTORIES.has(head!)) {
    return {
      scopeKind: "practice",
      scopeSlug: head!,
      title: head!,
      derivedFromSignal: `path:${head}/`,
    };
  }

  return {
    scopeKind: "workspace",
    scopeSlug: DEFAULT_WORKSPACE_SCOPE_SLUG,
    title: "Workspace",
    derivedFromSignal: "path:default",
  };
}

function normalizeSegments(rawPath: string): string[] {
  const unified = rawPath.replace(/\\/g, "/");
  const segments = unified.split("/").filter((segment) => segment.length > 0 && segment !== ".");

  // A traversal segment means the caller handed us something outside the anchor root.
  // Deriving a scope from it would silently attribute foreign content to a real subject.
  if (segments.includes("..")) {
    throw new Error(`Refusing to derive a scope from a path that escapes the root: ${JSON.stringify(rawPath)}`);
  }

  return segments;
}

function stripMarkdownExtension(segment: string): string {
  return segment.replace(/\.md$/i, "");
}
