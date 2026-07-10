/**
 * Shared low-level parsing for claim `src` strings: PR references, repo-prefixed
 * paths, file paths (optionally with `#L<line>`), and http(s) URL detection.
 *
 * This is the single place these forms are parsed. `src/anchorService.ts`'s
 * `resolveClaimSourceHref` (UI/API link resolution) and `src/graph/sourceId.ts`'s
 * `parseClaimSource` (canonical graph node ids) both funnel through these
 * functions so links and node ids can never diverge.
 */

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Split an optional `<repo>:<path>` prefix off a source value. `person:<id>`
 * is never treated as repo-prefixed (the `person:` scheme is reserved).
 */
export function parseRepoPrefixedSource(value: string): { repo?: string; path: string } {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("person:")) {
    return { path: trimmed };
  }
  const match = /^([A-Za-z0-9_.-]+):(.+)$/.exec(trimmed);
  if (!match) {
    return { path: trimmed };
  }
  return { repo: match[1], path: match[2].trim() };
}

export function parsePullRequestSource(value: string): number | undefined {
  // Accepts "PR #39", "PR#39", and "PR 39" so every common spelling
  // canonicalizes to the same `pr:<repo>#<n>` node id (design doc part 3).
  const match = /^PR\s*#?(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

export function parseFileSource(value: string): { path: string; line?: number } | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("://") || trimmed.startsWith("person:")) {
    return undefined;
  }
  const lineMatch = /^(.*)#L(\d+)$/i.exec(trimmed);
  const path = (lineMatch ? lineMatch[1] : trimmed).trim();
  if (!path || /\s/.test(path) || path.startsWith("#")) {
    return undefined;
  }
  const line = lineMatch ? Number(lineMatch[2]) : undefined;
  return { path, ...(line !== undefined ? { line } : {}) };
}

/**
 * Normalize a URL for canonicalization purposes: lowercase scheme/host, drop a
 * default port, and drop a bare-origin trailing slash the input did not have.
 * Deliberately conservative — path/query/hash content is preserved verbatim
 * (case can be meaningful there); only parts that are safely case-insensitive
 * per the URL spec are normalized.
 */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    let normalized = parsed.toString();
    if (parsed.pathname === "/" && !trimmed.endsWith("/")) {
      normalized = normalized.replace(/\/(?=([?#]|$))/, "");
    }
    return normalized;
  } catch {
    return trimmed;
  }
}
