import { describe, expect, it } from "vitest";

import {
  appendToAnchorSection,
  deleteAnchorSection,
  mergeAnchorFrontmatter,
  replaceAnchorSection,
} from "../src/anchorPatch.js";
import { parseAnchor } from "../src/storage/markdown.js";

/**
 * Byte-preservation coverage for the front-matter writer (see the
 * "Byte-preserving front-matter writer" plan). Fixtures here deliberately
 * use the NON-canonical styles (double-quoted strings, block scalars) that
 * exposed the original bug: js-yaml/gray-matter's `matter.stringify`
 * re-serialized every key in its own canonical style, so minting a single
 * new key silently reformatted every sibling field.
 */

const NON_CANONICAL_MILESTONE = `---
type: milestone
tags: []
summary: "A summary that must not reformat."
read_this_if:
  - "Some condition worded exactly this way."
theme: "steel-thread-a"
steel_thread: "thread-1"
tasks:
  - title: "Do the thing"
    status: open
  - title: "Do another thing"
    status: open
last_validated: "2026-07-07"
---

# Milestone

## Current State

Some prose.
`;

describe("mergeAnchorFrontmatter: byte preservation", () => {
  it("minting anchor_id + schema_version on a double-quoted/block-scalar anchor leaves every other field byte-identical", () => {
    const out = mergeAnchorFrontmatter(NON_CANONICAL_MILESTONE, {
      anchor_id: "a-abc123",
      schema_version: 1,
    });

    const untouchedLines = [
      'summary: "A summary that must not reformat."',
      "read_this_if:",
      '  - "Some condition worded exactly this way."',
      'theme: "steel-thread-a"',
      'steel_thread: "thread-1"',
      "tasks:",
      '  - title: "Do the thing"',
      "    status: open",
      '  - title: "Do another thing"',
      "    status: open",
      'last_validated: "2026-07-07"',
    ];
    for (const line of untouchedLines) {
      expect(out).toContain(line);
    }
    expect(out).toContain("anchor_id: a-abc123");
    expect(out).toContain("schema_version: 1");

    // Only the two new lines were added: line count grew by exactly 2.
    const originalLines = NON_CANONICAL_MILESTONE.split("\n");
    const outLines = out.split("\n");
    expect(outLines.length).toBe(originalLines.length + 2);

    // Body is untouched.
    expect(out.endsWith("# Milestone\n\n## Current State\n\nSome prose.\n")).toBe(true);

    // Round-trips: a later parseAnchor sees the same data plus the new keys.
    const parsed = parseAnchor(out);
    expect(parsed.frontmatter.anchor_id).toBe("a-abc123");
    expect(parsed.frontmatter.schema_version).toBe(1);
    expect(parsed.frontmatter.summary).toBe("A summary that must not reformat.");
    expect(parsed.frontmatter.theme).toBe("steel-thread-a");
  });

  it("updating one existing scalar changes only that key's line", () => {
    const out = mergeAnchorFrontmatter(NON_CANONICAL_MILESTONE, { theme: "steel-thread-b" });
    expect(out).toContain('theme: "steel-thread-b"');
    expect(out).not.toContain('theme: "steel-thread-a"');
    // Everything else byte-identical.
    expect(out).toContain('summary: "A summary that must not reformat."');
    expect(out).toContain('steel_thread: "thread-1"');
    expect(out).toContain('  - title: "Do the thing"');
  });

  it("removing a key (null) removes only that key's line(s)", () => {
    const out = mergeAnchorFrontmatter(NON_CANONICAL_MILESTONE, { steel_thread: null });
    expect(out).not.toContain("steel_thread");
    expect(out).toContain('theme: "steel-thread-a"');
    expect(out).toContain('summary: "A summary that must not reformat."');
    const parsed = parseAnchor(out);
    expect(parsed.frontmatter.steel_thread).toBeUndefined();
    expect(parsed.frontmatter.theme).toBe("steel-thread-a");
  });

  it("null-remove of an absent key is a no-op", () => {
    const out = mergeAnchorFrontmatter(NON_CANONICAL_MILESTONE, { nonexistent_key: null });
    expect(out).toBe(NON_CANONICAL_MILESTONE);
  });

  it("preserves key order: new keys are appended, existing keys keep position", () => {
    const out = mergeAnchorFrontmatter(NON_CANONICAL_MILESTONE, { anchor_id: "a-abc123" });
    const keys = [...out.matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
    expect(keys.slice(0, -1)).toEqual([
      "type",
      "tags",
      "summary",
      "read_this_if",
      "theme",
      "steel_thread",
      "tasks",
      "last_validated",
    ]);
    expect(keys[keys.length - 1]).toBe("anchor_id");
  });

  it("a nested relations.<key> change touches only the affected entry, siblings byte-identical", () => {
    const content = `---
type: context-anchor
tags: []
summary: "Anchor with relations."
relations:
  blocks:
    - "legacy-target"
  depends_on:
    - "other-target"
last_validated: "2026-07-07"
---

Body.
`;
    const out = mergeAnchorFrontmatter(content, {
      relations: { blocks: ["anchor:a-abc123"] },
    });
    expect(out).toContain('    - "other-target"');
    expect(out).toContain("depends_on:");
    expect(out).toContain("anchor:a-abc123");
    expect(out).not.toContain('"legacy-target"');
    expect(out).toContain('summary: "Anchor with relations."');
  });

  it("handles an anchor with no front matter at all", () => {
    const content = "# Just a doc\n\nNo front matter here.\n";
    const out = mergeAnchorFrontmatter(content, { anchor_id: "a-abc123" });
    expect(out).toContain("anchor_id: a-abc123");
    expect(out.endsWith(content)).toBe(true);
    const parsed = parseAnchor(out);
    expect(parsed.frontmatter.anchor_id).toBe("a-abc123");
  });

  it("handles empty front matter (--- --- with no keys)", () => {
    const content = "---\n---\n\nBody text.\n";
    const out = mergeAnchorFrontmatter(content, { anchor_id: "a-abc123" });
    expect(out).toContain("anchor_id: a-abc123");
    const parsed = parseAnchor(out);
    expect(parsed.frontmatter.anchor_id).toBe("a-abc123");
    expect(parsed.body).toContain("Body text.");
  });

  it("preserves front-matter comments untouched", () => {
    const content = `---
type: context-anchor
# a maintainer note
summary: "S"
---

Body.
`;
    const out = mergeAnchorFrontmatter(content, { anchor_id: "a-abc123" });
    expect(out).toContain("# a maintainer note");
    expect(out).toContain('summary: "S"');
    expect(out).toContain("anchor_id: a-abc123");
  });

  it("preserves CRLF line endings byte-for-byte outside the touched key", () => {
    const lf = `---
type: context-anchor
summary: "S"
last_validated: "2026-07-07"
---

Body.
`;
    const crlf = lf.replace(/\n/g, "\r\n");
    const out = mergeAnchorFrontmatter(crlf, { anchor_id: "a-abc123" });
    // Every line ending in the result is CRLF.
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain('type: context-anchor\r\nsummary: "S"\r\n');
    expect(out).toContain("anchor_id: a-abc123\r\n");
  });

  it("synthesizing front matter on a CRLF doc with no front matter uses CRLF (no mixed endings)", () => {
    const body = "# Just a doc\r\n\r\nNo front matter here.\r\n";
    const out = mergeAnchorFrontmatter(body, { anchor_id: "a-abc123" });
    // The whole file is CRLF: stripping CRLF leaves no stray LF anywhere.
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("anchor_id: a-abc123\r\n");
    expect(out.endsWith(body)).toBe(true);
    const parsed = parseAnchor(out);
    expect(parsed.frontmatter.anchor_id).toBe("a-abc123");
  });

  it("a bare date-like value round-trips as a string, not a Date, after being written unquoted-source then updated", () => {
    const content = `---
type: context-anchor
last_validated: 2026-05-10
---

Body.
`;
    const out = mergeAnchorFrontmatter(content, { last_validated: "2026-05-14" });
    const parsed = parseAnchor(out);
    expect(parsed.frontmatter.last_validated).toBe("2026-05-14");
  });
});

describe("section-edit paths: front-matter block is reproduced verbatim", () => {
  const nonCanonicalFull = `---
type: design
tags: []
summary: "A summary that must not reformat."
read_this_if:
  - "Some condition."
theme: "steel-thread-a"
last_validated: "2026-05-10"
---

# Doc

## Current State

one

## Decisions

two

## PRs

None.
`;

  it("replaceAnchorSection leaves the entire front-matter block byte-identical", () => {
    const out = replaceAnchorSection(nonCanonicalFull, "## PRs", "- [PR Fix - #99](https://example.com/99)");
    const originalFrontmatter = nonCanonicalFull.slice(0, nonCanonicalFull.indexOf("\n---\n") + 5);
    expect(out.startsWith(originalFrontmatter)).toBe(true);
  });

  it("appendToAnchorSection leaves the entire front-matter block byte-identical", () => {
    const out = appendToAnchorSection(nonCanonicalFull, "Decisions", "\nmore");
    const originalFrontmatter = nonCanonicalFull.slice(0, nonCanonicalFull.indexOf("\n---\n") + 5);
    expect(out.startsWith(originalFrontmatter)).toBe(true);
  });

  it("deleteAnchorSection leaves the entire front-matter block byte-identical", () => {
    const out = deleteAnchorSection(nonCanonicalFull, "Decisions");
    const originalFrontmatter = nonCanonicalFull.slice(0, nonCanonicalFull.indexOf("\n---\n") + 5);
    expect(out.startsWith(originalFrontmatter)).toBe(true);
  });

  it("a section edit on a CRLF document stays uniformly CRLF (front matter verbatim, body converted to match)", () => {
    const crlf = nonCanonicalFull.replace(/\n/g, "\r\n");
    const out = replaceAnchorSection(crlf, "## PRs", "- [PR Fix - #99](https://example.com/99)");
    // No mixed endings: the verbatim CRLF front matter and the rebuilt body
    // (which the segment stringifier emits as LF) agree on CRLF.
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    const originalFrontmatter = crlf.slice(0, crlf.indexOf("\r\n---\r\n") + 7);
    expect(out.startsWith(originalFrontmatter)).toBe(true);
    expect(out).toContain("- [PR Fix - #99](https://example.com/99)");
  });
});
