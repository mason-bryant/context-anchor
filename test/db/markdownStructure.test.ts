import { describe, expect, it } from "vitest";

import { parseMarkdownStructure, sectionStableKey } from "../../src/db/markdownStructure.js";

const DOC = `---
project: anchor-mcp
---

# Roadmap

Intro paragraph.

## Goals

### Goal G-041 -- Structured substrate

Some goal text.

\`\`\`sql
SELECT 1;
\`\`\`

### Goal G-042 -- Database-backed redesign

| a | b |
|---|---|
| 1 | 2 |

## Completed

Nothing yet.
`;

describe("parseMarkdownStructure", () => {
  it("builds a section tree from headings with correct levels and nesting", () => {
    const { sections } = parseMarkdownStructure(DOC);

    expect(sections.map((s) => [s.headingLevel, s.title])).toEqual([
      [1, "Roadmap"],
      [2, "Goals"],
      [3, "Goal G-041 -- Structured substrate"],
      [3, "Goal G-042 -- Database-backed redesign"],
      [2, "Completed"],
    ]);

    const goals = sections.find((s) => s.title === "Goals")!;
    const g041 = sections.find((s) => s.title.startsWith("Goal G-041"))!;
    expect(g041.parentOrdinal).toBe(goals.ordinal);
    expect(sections[0]!.parentOrdinal).toBeUndefined();
  });

  it("gives each section a stable key of document plus normalized heading path", () => {
    const { sections } = parseMarkdownStructure(DOC, { documentName: "projects/anchor-mcp/roadmap.md" });
    const g041 = sections.find((s) => s.title.startsWith("Goal G-041"))!;

    expect(g041.stableKey).toBe("projects/anchor-mcp/roadmap.md#roadmap/goals/goal-g-041-structured-substrate");
  });

  it("offsets slice the original content back out byte-for-byte", () => {
    const { sections } = parseMarkdownStructure(DOC);
    for (const section of sections) {
      const sliced = DOC.slice(section.startOffset, section.endOffset);
      expect(sliced.length, section.title).toBeGreaterThan(0);
      expect(sliced).toContain(section.title);
    }
  });

  it("captures paragraphs, code fences, and tables as typed blocks", () => {
    const { blocks } = parseMarkdownStructure(DOC);
    const types = new Set(blocks.map((b) => b.blockType));

    expect(types.has("paragraph")).toBe(true);
    expect(types.has("code")).toBe(true);
    expect(types.has("table")).toBe(true);

    const code = blocks.find((b) => b.blockType === "code")!;
    expect(code.rawContent).toContain("SELECT 1;");

    const table = blocks.find((b) => b.blockType === "table")!;
    expect(table.rawContent).toContain("| 1 | 2 |");
  });

  it("does not treat a heading inside a fenced code block as a section", () => {
    // A '#' line inside a fence is code, not structure; splitting on it would invent
    // sections that do not exist and shift every subsequent offset.
    const fenced = ["# Real", "", "```sh", "# not a heading", "```", "", "## Also Real", ""].join("\n");
    const { sections } = parseMarkdownStructure(fenced);
    expect(sections.map((s) => s.title)).toEqual(["Real", "Also Real"]);
  });

  it("attaches each block to the section containing it", () => {
    const { sections, blocks } = parseMarkdownStructure(DOC);
    const g041 = sections.find((s) => s.title.startsWith("Goal G-041"))!;
    const code = blocks.find((b) => b.blockType === "code")!;
    expect(code.sectionOrdinal).toBe(g041.ordinal);
  });

  it("handles a document with no headings at all", () => {
    const { sections, blocks } = parseMarkdownStructure("Just a paragraph.\n");
    expect(sections).toEqual([]);
    expect(blocks.map((b) => b.blockType)).toEqual(["paragraph"]);
  });

  it("parses a document whose closing front-matter fence is the final line with no trailing newline", () => {
    // The closing `---` at EOF made bodyStart land past content.length, which skipped the
    // entire body silently — a document that imports as zero sections and zero blocks.
    const noBody = "---\ntitle: x\n---";
    expect(parseMarkdownStructure(noBody)).toEqual({ sections: [], blocks: [] });

    const withBody = "---\ntitle: x\n---\n# Heading\n\nBody text.";
    const parsed = parseMarkdownStructure(withBody);
    expect(parsed.sections.map((s) => s.title)).toEqual(["Heading"]);
    expect(parsed.blocks.map((b) => b.rawContent)).toEqual(["Body text."]);
  });

  it("excludes front matter from block content", () => {
    const { blocks } = parseMarkdownStructure(DOC);
    expect(blocks.every((b) => !b.rawContent.includes("project: anchor-mcp"))).toBe(true);
  });
});

describe("sectionStableKey", () => {
  it("normalizes a heading path into a slug trail under the document name", () => {
    expect(sectionStableKey("docs/a.md", ["Current State", "Data and Persistence"])).toBe(
      "docs/a.md#current-state/data-and-persistence",
    );
  });

  it("strips punctuation and collapses whitespace so cosmetic edits do not orphan it", () => {
    expect(sectionStableKey("d.md", ["Goal G-041 -- Structured  substrate!"])).toBe(
      "d.md#goal-g-041-structured-substrate",
    );
  });

  it("distinguishes two sections whose titles differ only by depth", () => {
    expect(sectionStableKey("d.md", ["A", "B"])).not.toBe(sectionStableKey("d.md", ["A", "B", "B"]));
  });
});
