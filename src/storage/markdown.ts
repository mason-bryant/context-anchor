import matter from "gray-matter";

import type { AnchorFrontmatter } from "../types.js";

export type ParsedAnchor = {
  frontmatter: AnchorFrontmatter;
  body: string;
  sections: Map<string, string>;
  title?: string;
};

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

export function extractH2Sections(markdownBody: string): Map<string, string> {
  const lines = markdownBody.split(/\r?\n/);
  const sections = new Map<string, string>();
  let current: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      sections.set(current, buffer.join("\n").trim());
    }
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      current = match[1]?.trim();
      buffer = [];
      continue;
    }

    if (current) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
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

