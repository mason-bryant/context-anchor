import { isDiscoveryCategory } from "./taxonomy.js";
import type { DiscoveryCategory } from "./taxonomy.js";
import type { AnchorContentMode, AnchorRead, ContextRootFormat, LoadContextAnchor, LoadContextSelectionReason } from "./types.js";

/** Defaults aligned with the orchestration tool contract. */
export const LOAD_CONTEXT_DEFAULT_LIMIT = 12;
export const LOAD_CONTEXT_DEFAULT_MAX_BYTES = 250_000;
export const LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS = 1200;

export type LoadContextCursorV1 = {
  v: 1;
  selectionReason: LoadContextSelectionReason;
  filter: {
    project?: string;
    category?: DiscoveryCategory;
    tag?: string;
    runtime?: string;
    includeArchive?: boolean;
  };
  explicitNames?: string[];
  offset: number;
  limit: number;
  maxBytes: number;
  includeContent: AnchorContentMode;
  excerptChars: number;
  format?: ContextRootFormat;
};

export function encodeLoadContextCursor(payload: LoadContextCursorV1): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLoadContextCursor(cursor: string): LoadContextCursorV1 {
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid loadContext cursor: could not decode");
  }

  if (!isRecord(parsed) || parsed.v !== 1) {
    throw new Error("Invalid loadContext cursor: unsupported version");
  }

  const selectionReason = parsed.selectionReason;
  if (selectionReason !== "explicit_names" && selectionReason !== "filter") {
    throw new Error("Invalid loadContext cursor: bad selectionReason");
  }

  const offset = typeof parsed.offset === "number" && Number.isFinite(parsed.offset) ? Math.max(0, Math.floor(parsed.offset)) : 0;
  const limit = typeof parsed.limit === "number" && Number.isFinite(parsed.limit) ? Math.max(1, Math.floor(parsed.limit)) : LOAD_CONTEXT_DEFAULT_LIMIT;
  const maxBytes =
    typeof parsed.maxBytes === "number" && Number.isFinite(parsed.maxBytes)
      ? Math.max(1024, Math.floor(parsed.maxBytes))
      : LOAD_CONTEXT_DEFAULT_MAX_BYTES;
  const includeContent = normalizeIncludeContent(parsed.includeContent);
  const excerptChars =
    typeof parsed.excerptChars === "number" && Number.isFinite(parsed.excerptChars)
      ? Math.max(100, Math.floor(parsed.excerptChars))
      : LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS;

  const filter = isRecord(parsed.filter) ? parsed.filter : {};
  const explicitNames = Array.isArray(parsed.explicitNames)
    ? parsed.explicitNames.filter((item): item is string => typeof item === "string")
    : undefined;

  const format =
    parsed.format === "json" || parsed.format === "markdown" || parsed.format === "both" ? parsed.format : undefined;

  return {
    v: 1,
    selectionReason,
    filter: {
      project: typeof filter.project === "string" ? filter.project : undefined,
      category: typeof filter.category === "string" && isDiscoveryCategory(filter.category) ? filter.category : undefined,
      tag: typeof filter.tag === "string" ? filter.tag : undefined,
      runtime: typeof filter.runtime === "string" ? filter.runtime : undefined,
      includeArchive: typeof filter.includeArchive === "boolean" ? filter.includeArchive : undefined,
    },
    explicitNames,
    offset,
    limit,
    maxBytes,
    includeContent,
    excerptChars,
    format,
  };
}

/** Ensure a single-row payload fits under `maxBytes` by downgrading full→excerpt→none and shrinking excerpt length. */
export function shrinkLoadContextAnchorToFit(
  read: AnchorRead,
  includeContent: AnchorContentMode,
  excerptChars: number,
  maxBytes: number,
): LoadContextAnchor {
  let mode: AnchorContentMode = includeContent === "full" ? "excerpt" : includeContent;
  let chars = excerptChars;

  while (chars >= 100) {
    const row = buildLoadContextAnchor(read, mode, chars);
    if (jsonByteLength(row) <= maxBytes) {
      return row;
    }
    chars = Math.max(100, Math.floor(chars * 0.7));
  }

  let minimal = buildLoadContextAnchor(read, "none", excerptChars);
  if (jsonByteLength(minimal) <= maxBytes) {
    return minimal;
  }

  minimal = { ...minimal, frontmatter: undefined };
  if (jsonByteLength(minimal) <= maxBytes) {
    return minimal;
  }

  return {
    name: read.name,
    path: read.path,
    summary: stringFromFrontmatter(read.frontmatter.summary),
    read_this_if: stringArrayFromFrontmatter(read.frontmatter.read_this_if),
    version: read.version,
  };
}

export function buildLoadContextAnchor(
  read: AnchorRead,
  includeContent: AnchorContentMode,
  excerptChars: number,
): LoadContextAnchor {
  const summary = stringFromFrontmatter(read.frontmatter.summary);
  const readThisIf = stringArrayFromFrontmatter(read.frontmatter.read_this_if);
  const title = typeof read.frontmatter.title === "string" ? read.frontmatter.title : extractTitleFromBody(read.content);

  const base: LoadContextAnchor = {
    name: read.name,
    path: read.path,
    title,
    summary,
    read_this_if: readThisIf,
    version: read.version,
    frontmatter: read.frontmatter,
  };

  if (includeContent === "none") {
    return base;
  }

  if (includeContent === "full") {
    return { ...base, content: read.content };
  }

  return { ...base, excerpt: excerptFromContent(read.content, excerptChars) };
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function excerptFromContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars).trimEnd()}\n\n…`;
}

function extractTitleFromBody(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function stringFromFrontmatter(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayFromFrontmatter(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeIncludeContent(value: unknown): AnchorContentMode {
  if (value === "full" || value === "excerpt" || value === "none") {
    return value;
  }

  return "excerpt";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Build cursor payload for the next page (same shape as decoded cursor). */
export function toNextCursorPayload(params: {
  selectionReason: LoadContextSelectionReason;
  filter: LoadContextCursorV1["filter"];
  explicitNames?: string[];
  offset: number;
  limit: number;
  maxBytes: number;
  includeContent: AnchorContentMode;
  excerptChars: number;
  format?: ContextRootFormat;
}): LoadContextCursorV1 {
  return {
    v: 1,
    selectionReason: params.selectionReason,
    filter: params.filter,
    explicitNames: params.explicitNames,
    offset: params.offset,
    limit: params.limit,
    maxBytes: params.maxBytes,
    includeContent: params.includeContent,
    excerptChars: params.excerptChars,
    format: params.format,
  };
}

export type LoadContextCursorPayload = LoadContextCursorV1;
