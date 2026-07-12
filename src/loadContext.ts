import { isDiscoveryCategory } from "./taxonomy.js";
import type { DiscoveryCategory } from "./taxonomy.js";
import { tokenize } from "./contextPlanner.js";
import { isProjectContextAnchor } from "./anchorStructure.js";
import {
  extractHeadingSections,
  parseAnchor,
  parseBodyH2Segments,
  stringifyBodyH2Segments,
  type BodyH2Segment,
} from "./storage/markdown.js";
import type {
  AnchorContentMode,
  AnchorRead,
  ClaimProvenanceMode,
  ContextRootFormat,
  LoadContextAnchor,
  LoadContextSelectionReason,
} from "./types.js";

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
  task?: string;
  format?: ContextRootFormat;
  includeProvenance?: ClaimProvenanceMode;
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
  const task = typeof parsed.task === "string" && parsed.task.trim().length > 0 ? parsed.task : undefined;
  const includeProvenance = normalizeIncludeProvenance(parsed.includeProvenance);

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
    task,
    format,
    includeProvenance,
  };
}

/** Ensure a single-row payload fits under `maxBytes` by downgrading full→excerpt→none and shrinking excerpt length. */
export function shrinkLoadContextAnchorToFit(
  read: AnchorRead,
  includeContent: AnchorContentMode,
  excerptChars: number,
  maxBytes: number,
  task?: string,
): LoadContextAnchor {
  let mode: AnchorContentMode = includeContent === "full" ? "excerpt" : includeContent;
  let chars = excerptChars;

  while (true) {
    const row = buildLoadContextAnchor(read, mode, chars, task);
    if (jsonByteLength(row) <= maxBytes) {
      return row;
    }
    if (chars === 100) {
      break;
    }
    chars = Math.max(100, Math.floor(chars * 0.7));
  }

  let minimal = buildLoadContextAnchor(read, "none", excerptChars, task);
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
    ...(read.sectionDefinitions ? { sectionDefinitions: read.sectionDefinitions } : {}),
  };
}

export function buildLoadContextAnchor(
  read: AnchorRead,
  includeContent: AnchorContentMode,
  excerptChars: number,
  task?: string,
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
    ...(read.warnings?.length ? { warnings: read.warnings } : {}),
    ...(read.sectionDefinitions ? { sectionDefinitions: read.sectionDefinitions } : {}),
  };

  if (includeContent === "none") {
    return base;
  }

  if (includeContent === "full") {
    return { ...base, content: read.content };
  }

  const projectOverview = projectContextRetrievalOverview(read.name, read.content);
  if (projectOverview) {
    return {
      ...base,
      excerpt: projectOverview.excerpt,
      availableSections: projectOverview.availableSections,
      availableSectionPaths: projectOverview.availableSectionPaths,
    };
  }

  return { ...base, excerpt: excerptFromContent(read.content, excerptChars, task) };
}

export type ProjectContextRetrievalOverview = {
  excerpt: string;
  availableSections: string[];
  availableSectionPaths: string[];
};

/** Keep the authoritative project design header intact and expose the rest as an H2 outline. */
export function projectContextRetrievalOverview(
  name: string,
  content: string,
): ProjectContextRetrievalOverview | undefined {
  const parsed = parseAnchor(content);
  if (!isProjectContextAnchor(name, parsed.frontmatter)) {
    return undefined;
  }

  const sections = parseBodyH2Segments(parsed.body).filter(
    (segment): segment is Extract<BodyH2Segment, { kind: "section" }> => segment.kind === "section",
  );
  const introductionIndex = sections.findIndex((section) => section.title === "Introduction");
  const invariantsIndex = sections.findIndex((section) => section.title === "Invariants");
  if (introductionIndex < 0 || invariantsIndex !== introductionIndex + 1) {
    return undefined;
  }

  const designHeader = sections.slice(introductionIndex, invariantsIndex + 1);
  const designHeaderSet = new Set(designHeader.map((section) => section.title));
  const availableSections = sections.filter((section) => !designHeaderSet.has(section.title)).map((section) => section.title);
  return {
    excerpt: stringifyBodyH2Segments(designHeader).trim(),
    availableSections,
    availableSectionPaths: extractHeadingSections(parsed.body)
      .filter((section) => section.level > 2 && availableSections.includes(section.path[0] ?? ""))
      .map((section) => section.path.join(" > ")),
  };
}

/** Character count used by planning for the content shape loadContext will actually return. */
export function retrievalContentCharCount(name: string, content: string): number {
  const overview = projectContextRetrievalOverview(name, content);
  if (!overview) {
    return stripFrontMatterForExcerpt(content).length;
  }
  return overview.excerpt.length
    + overview.availableSections.join("\n").length
    + overview.availableSectionPaths.join("\n").length;
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function excerptFromContent(content: string, maxChars: number, task?: string): string {
  const body = stripFrontMatterForExcerpt(content);
  if (task && task.trim().length > 0) {
    const taskAware = taskAwareExcerpt(body, task, maxChars);
    if (taskAware) {
      return taskAware;
    }
  }
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars).trimEnd()}\n\n…`;
}

type MarkdownSection = {
  heading: string;
  level: number;
  content: string;
};

function splitMarkdownSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match?.[1] && match[2]) {
      if (current) {
        sections.push(current);
      }
      current = {
        heading: match[2].trim(),
        level: match[1].length,
        content: "",
      };
      continue;
    }

    if (current) {
      current.content = current.content ? `${current.content}\n${line}` : line;
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections;
}

function scoreMarkdownSection(section: MarkdownSection, taskTerms: string[]): number {
  const haystack = `${section.heading} ${section.content}`.toLowerCase();
  let score = 0;
  for (const term of taskTerms) {
    const occurrences = haystack.split(term).length - 1;
    if (occurrences > 0) {
      score += occurrences * (section.level <= 3 ? 4 : 2);
    }
    if (section.heading.toLowerCase().includes(term)) {
      score += 6;
    }
  }
  return score;
}

export function taskAwareExcerpt(body: string, task: string, maxChars: number): string | undefined {
  const taskTerms = tokenize(task);
  if (taskTerms.length === 0) {
    return undefined;
  }

  const sections = splitMarkdownSections(body);
  if (sections.length === 0) {
    return undefined;
  }

  const scored = sections
    .map((section) => ({ section, score: scoreMarkdownSection(section, taskTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.section.level - right.section.level);

  if (scored.length === 0) {
    return undefined;
  }

  const chunks: string[] = [];
  let used = 0;
  for (const { section } of scored) {
    const headingPrefix = `${"#".repeat(Math.min(section.level, 6))} ${section.heading}`;
    const block = section.content.trim().length > 0 ? `${headingPrefix}\n\n${section.content.trim()}` : headingPrefix;
    const separator = chunks.length > 0 ? "\n\n" : "";
    const nextLength = used + separator.length + block.length;
    if (nextLength > maxChars && chunks.length > 0) {
      break;
    }
    chunks.push(block);
    used = nextLength;
    if (used >= maxChars) {
      break;
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const excerpt = chunks.join("\n\n");
  if (excerpt.length <= maxChars) {
    return excerpt;
  }

  return `${excerpt.slice(0, maxChars).trimEnd()}\n\n…`;
}

export function stripFrontMatterForExcerpt(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return content;
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return content;
  return lines.slice(closeIdx + 1).join('\n').trimStart();
}

/** Body text for lexical search indexing: no front matter or markdown headings. */
export function anchorBodyForSearchIndex(content: string): string {
  const body = stripFrontMatterForExcerpt(content);
  return body.replace(/^#{1,6}\s+.*$/gm, "").trim();
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

function normalizeIncludeProvenance(value: unknown): ClaimProvenanceMode | undefined {
  if (value === "none" || value === "summary" || value === "relevant" || value === "full") {
    return value;
  }

  return undefined;
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
  task?: string;
  format?: ContextRootFormat;
  includeProvenance?: ClaimProvenanceMode;
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
    task: params.task,
    format: params.format,
    includeProvenance: params.includeProvenance,
  };
}

export type LoadContextCursorPayload = LoadContextCursorV1;
