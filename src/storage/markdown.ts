import matter from "gray-matter";

import type { AnchorFrontmatter } from "../types.js";

export type ParsedAnchor = {
  frontmatter: AnchorFrontmatter;
  body: string;
  sections: Map<string, string>;
  title?: string;
};

/** One block before the first H2, or one H2 section (heading line stored verbatim). */
export type BodyH2Segment =
  | { kind: "preamble"; lines: string[] }
  | { kind: "section"; headingLine: string; title: string; bodyLines: string[] };

/** One fence-aware Markdown heading and the content nested beneath it. */
export type MarkdownHeadingSection = {
  headingLine: string;
  title: string;
  level: number;
  /** One-based source line containing the heading. */
  startLine: number;
  /** Heading titles from the containing H2 through this heading. */
  path: string[];
  /** Content through (but not including) the next heading at this level or higher. */
  bodyLines: string[];
};

type OpenFence = { char: "`" | "~"; len: number };

export function parseAnchor(content: string): ParsedAnchor {
  const parsed = matter(content);
  const body = parsed.content;
  return {
    frontmatter: parsed.data,
    body,
    sections: extractH2Sections(body),
    title: extractTitle(body),
  };
}

export function extractTitle(markdownBody: string): string | undefined {
  for (const line of markdownBody.split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (match) {
      return match[1]?.trim();
    }
  }

  return undefined;
}

/**
 * H2 sections keyed by trimmed heading text (without `##`).
 * Ignores `##` lines inside fenced code blocks (``` and ~~~).
 */
export function extractH2Sections(markdownBody: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const segment of parseBodyH2Segments(markdownBody)) {
    if (segment.kind === "section") {
      map.set(segment.title, segment.bodyLines.join("\n").trim());
    }
  }
  return map;
}

/**
 * Enumerate H2-H6 sections with stable, human-readable heading paths.
 * Headings inside fenced code blocks are ignored. Parent sections include
 * their nested headings in bodyLines so reading an H2 remains backward compatible.
 */
export function extractHeadingSections(markdownBody: string): MarkdownHeadingSection[] {
  const lines = markdownBody.split(/\r?\n/);
  const headings: Array<Omit<MarkdownHeadingSection, "bodyLines" | "startLine"> & { lineIndex: number }> = [];
  const ancestors: Array<string | undefined> = [];
  let openFence: OpenFence | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (openFence) {
      if (tryCloseFence(line, openFence)) openFence = undefined;
      continue;
    }
    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      continue;
    }
    const match = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (!match?.[1] || !match[2]) continue;

    const level = match[1].length;
    const title = match[2].trim();
    const depth = level - 2;
    ancestors.length = depth;
    ancestors[depth] = title;
    headings.push({
      headingLine: line,
      title,
      level,
      path: ancestors.filter((entry): entry is string => entry !== undefined),
      lineIndex,
    });
  }

  return headings.map((heading, index) => {
    let endLine = lines.length;
    for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex += 1) {
      const next = headings[nextIndex];
      if (next && next.level <= heading.level) {
        endLine = next.lineIndex;
        break;
      }
    }
    return {
      headingLine: heading.headingLine,
      title: heading.title,
      level: heading.level,
      startLine: heading.lineIndex + 1,
      path: heading.path,
      bodyLines: lines.slice(heading.lineIndex + 1, endLine),
    };
  });
}

/** Resolve `Current State > Capabilities`-style paths without loading the whole anchor. */
export function findHeadingSection(
  markdownBody: string,
  headingPath: readonly string[],
): MarkdownHeadingSection | undefined {
  const normalized = headingPath.map((part) => part.trim()).filter(Boolean);
  if (normalized.length === 0) return undefined;
  let match: MarkdownHeadingSection | undefined;
  for (const section of extractHeadingSections(markdownBody)) {
    if (
      section.path.length === normalized.length
      && section.path.every((part, index) => part === normalized[index])
    ) {
      // Match extractH2Sections' established duplicate-heading behavior: the
      // last occurrence wins. This is deterministic for nested paths too.
      match = section;
    }
  }
  return match;
}

/**
 * Split markdown body into preamble (before first H2) and fence-aware H2 sections.
 */
export function parseBodyH2Segments(markdownBody: string): BodyH2Segment[] {
  const lines = markdownBody.split(/\r?\n/);
  const segments: BodyH2Segment[] = [];
  let preamble: string[] = [];
  let openFence: OpenFence | undefined;
  let currentSection: Extract<BodyH2Segment, { kind: "section" }> | undefined;

  const flushPreamble = () => {
    segments.push({ kind: "preamble", lines: preamble });
    preamble = [];
  };

  const startSection = (headingLine: string, title: string) => {
    if (currentSection) {
      segments.push(currentSection);
    } else {
      flushPreamble();
    }
    currentSection = { kind: "section", headingLine, title, bodyLines: [] };
  };

  for (const line of lines) {
    if (openFence) {
      const closed = tryCloseFence(line, openFence);
      if (currentSection) {
        currentSection.bodyLines.push(line);
      } else {
        preamble.push(line);
      }
      if (closed) {
        openFence = undefined;
      }
      continue;
    }

    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      if (currentSection) {
        currentSection.bodyLines.push(line);
      } else {
        preamble.push(line);
      }
      continue;
    }

    const h2 = matchH2Heading(line);
    if (h2) {
      startSection(h2.headingLine, h2.title);
      continue;
    }

    if (currentSection) {
      currentSection.bodyLines.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (currentSection) {
    segments.push(currentSection);
  } else {
    segments.push({ kind: "preamble", lines: preamble });
  }

  return segments;
}

function tryOpenFence(line: string): OpenFence | undefined {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m?.[1]) {
    return undefined;
  }
  const tick = m[1];
  const char: "`" | "~" = tick.startsWith("~") ? "~" : "`";
  return { char, len: tick.length };
}

function tryCloseFence(line: string, open: OpenFence): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  if (!m?.[1]) {
    return false;
  }
  const tick = m[1];
  const char: "`" | "~" = tick.startsWith("~") ? "~" : "`";
  return char === open.char && tick.length >= open.len;
}

/** Rebuild body markdown from segments (preserves line boundaries within each segment). */
export function stringifyBodyH2Segments(segments: BodyH2Segment[]): string {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "preamble") {
      out.push(...seg.lines);
    } else {
      out.push(seg.headingLine);
      out.push(...seg.bodyLines);
    }
  }
  return out.join("\n");
}

function matchH2Heading(line: string): { headingLine: string; title: string } | undefined {
  const match = line.match(/^##\s+(.+?)\s*#*\s*$/);
  if (!match?.[1]) {
    return undefined;
  }
  return { headingLine: line, title: match[1].trim() };
}

export function extractMarkdownLinks(markdown: string): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(linkRegex)) {
    links.push({ text: match[1] ?? "", href: match[2] ?? "" });
  }

  return links;
}

export function extractBullets(markdown: string): Set<string> {
  const bullets = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (match?.[1]) {
      bullets.add(normalizeBullet(match[1]));
    }
  }

  return bullets;
}

export function normalizeBullet(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\[(?: |x|~|-|open|resolved|deferred|wont-answer|won't-answer|wont answer)\]\s+/i, "")
    .replace(/^(?:open|resolved|deferred|wont-answer|won't-answer|wont answer):\s+/i, "")
    .trim()
    .toLowerCase();
}

export function countCompletedRows(markdown: string): number {
  const sections = extractH2Sections(markdown);
  const completed = sections.get("Completed");
  if (!completed) {
    return 0;
  }

  return completed
    .split(/\r?\n/)
    .filter((line) => /^\s*\|/.test(line))
    .filter((line) => !/^\s*\|\s*[-:]+\s*\|/.test(line))
    .length;
}
