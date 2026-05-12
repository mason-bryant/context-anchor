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
  return input.replace(/\s+/g, " ").trim().toLowerCase();
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
