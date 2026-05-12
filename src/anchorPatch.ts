import matter from "gray-matter";

import {
  parseBodyH2Segments,
  stringifyBodyH2Segments,
  type BodyH2Segment,
} from "./storage/markdown.js";

/** Normalize a user-supplied heading (`## PRs` or `PRs`) to the section title key. */
export function normalizeSectionTitle(heading: string): string {
  const t = heading.trim();
  const m = t.match(/^##\s+(.+?)\s*#*\s*$/);
  if (m?.[1]) {
    return m[1].trim();
  }
  return t;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeFrontmatterRecords(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      delete out[key];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeFrontmatterRecords(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Merge YAML front matter keys; `null` in updates removes a key. */
export function mergeAnchorFrontmatter(fullContent: string, updates: Record<string, unknown>): string {
  const file = matter(fullContent);
  file.data = mergeFrontmatterRecords(file.data as Record<string, unknown>, updates);
  return matter.stringify(file, {});
}

function findSectionIndex(segments: BodyH2Segment[], title: string): number {
  const want = normalizeSectionTitle(title);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "section" && seg.title === want) {
      return i;
    }
  }
  return -1;
}

function bodyFromFull(fullContent: string): { body: string; file: ReturnType<typeof matter> } {
  const file = matter(fullContent);
  return { body: file.content, file };
}

function assembleFull(file: ReturnType<typeof matter>, newBody: string): string {
  file.content = newBody;
  return matter.stringify(file, {});
}

/** Replace an H2 section body (lines below the heading until the next H2). `content` must not include the `##` line. */
export function replaceAnchorSection(fullContent: string, heading: string, content: string): string {
  const { body, file } = bodyFromFull(fullContent);
  const segments = parseBodyH2Segments(body);
  const idx = findSectionIndex(segments, heading);
  if (idx < 0) {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const seg = segments[idx];
  if (seg.kind !== "section") {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const newLines = content.split(/\r?\n/);
  const next: BodyH2Segment = { ...seg, bodyLines: newLines };
  const out = [...segments.slice(0, idx), next, ...segments.slice(idx + 1)];
  return assembleFull(file, stringifyBodyH2Segments(out));
}

/** Append markdown to the end of a section body (after trimming trailing whitespace, one blank line is inserted when needed). */
export function appendToAnchorSection(fullContent: string, heading: string, appendMarkdown: string): string {
  const { body, file } = bodyFromFull(fullContent);
  const segments = parseBodyH2Segments(body);
  const idx = findSectionIndex(segments, heading);
  if (idx < 0) {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const seg = segments[idx];
  if (seg.kind !== "section") {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const appendLines = appendMarkdown.split(/\r?\n/);
  let bodyLines = [...seg.bodyLines];
  if (bodyLines.length > 0) {
    const last = bodyLines[bodyLines.length - 1];
    if (last !== "" && appendLines.length > 0 && appendLines[0] !== "") {
      bodyLines.push("");
    }
  }
  bodyLines = bodyLines.concat(appendLines);
  const next: BodyH2Segment = { ...seg, bodyLines };
  const out = [...segments.slice(0, idx), next, ...segments.slice(idx + 1)];
  return assembleFull(file, stringifyBodyH2Segments(out));
}

/** Remove an entire H2 section including its heading line. */
export function deleteAnchorSection(fullContent: string, heading: string): string {
  const { body, file } = bodyFromFull(fullContent);
  const segments = parseBodyH2Segments(body);
  const idx = findSectionIndex(segments, heading);
  if (idx < 0) {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const out = segments.filter((_, i) => i !== idx);
  return assembleFull(file, stringifyBodyH2Segments(out));
}
