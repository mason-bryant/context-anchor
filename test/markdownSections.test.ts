import { describe, expect, it } from "vitest";

import {
  appendToAnchorSection,
  deleteAnchorSection,
  replaceAnchorSection,
} from "../src/anchorPatch.js";
import {
  extractH2Sections,
  extractHeadingSections,
  findHeadingSection,
  parseBodyH2Segments,
  stringifyBodyH2Segments,
  uniqueHeadingPaths,
} from "../src/storage/markdown.js";

describe("fence-aware H2 sections", () => {
  it("does not treat ## inside a fenced block as a section heading", () => {
    const body =
      "# Title\n\n## Current State\n\nBefore fence.\n\n" +
      "```md\n## Not a section\n\nMore\n```\n\n## Decisions\n\nReal decisions.\n";
    const sections = extractH2Sections(body);
    expect(sections.has("Not a section")).toBe(false);
    expect(sections.get("Current State")).toContain("Before fence.");
    expect(sections.get("Decisions")).toContain("Real decisions.");
  });

  it("round-trips parseBodyH2Segments and stringifyBodyH2Segments", () => {
    const body = `# Title

## Current State

A

## Decisions

B
`;
    expect(stringifyBodyH2Segments(parseBodyH2Segments(body))).toBe(body);
  });

  it("indexes and resolves nested heading paths without crossing sibling boundaries", () => {
    const body = `# Demo

## Current State

### Architecture

- Service and storage exist.

#### Storage

- Git is authoritative.

### Capabilities

- Context can be loaded.

\`\`\`md
### Not a real topic
\`\`\`

## Decisions

- Keep Markdown readable.
`;
    const paths = extractHeadingSections(body).map((section) => section.path.join(" > "));
    expect(paths).toEqual([
      "Current State",
      "Current State > Architecture",
      "Current State > Architecture > Storage",
      "Current State > Capabilities",
      "Decisions",
    ]);

    const architecture = findHeadingSection(body, ["Current State", "Architecture"]);
    expect(architecture?.bodyLines.join("\n")).toContain("#### Storage");
    expect(architecture?.bodyLines.join("\n")).not.toContain("Context can be loaded");
    expect(findHeadingSection(body, ["Current State", "Not a real topic"])).toBeUndefined();
  });

  it("uses the last matching heading path, consistent with established H2 parsing", () => {
    const body = `## Current State

### Capabilities

- Old.

### Capabilities

- New.
`;
    expect(findHeadingSection(body, ["Current State", "Capabilities"])?.bodyLines.join("\n")).toContain("New.");
    expect(uniqueHeadingPaths(extractHeadingSections(body).filter((section) => section.level > 2))).toEqual([
      "Current State > Capabilities",
    ]);
  });
});

describe("anchorPatch section helpers", () => {
  const full = `---
type: design
tags: []
summary: "S"
read_this_if:
  - "R"
last_validated: 2026-05-10
---

# Doc

## Current State

one

## Decisions

two

## Constraints

three

## PRs

None.
`;

  it("replaceAnchorSection updates one section body", () => {
    const next = replaceAnchorSection(full, "## PRs", "- [PR Fix - #99](https://github.com/example/repo/pull/99)");
    expect(next).toContain("- [PR Fix - #99](https://github.com/example/repo/pull/99)");
    expect(next).toContain("## Current State");
    expect(next).toContain("one");
    expect(next).not.toMatch(/## PRs\n\nNone\./);
  });

  it("appendToAnchorSection appends to a section", () => {
    const next = appendToAnchorSection(full, "PRs", "\n- [PR Extra - #100](https://github.com/example/repo/pull/100)");
    expect(next).toContain("- [PR Extra - #100](https://github.com/example/repo/pull/100)");
  });

  it("deleteAnchorSection removes a heading and body", () => {
    const next = deleteAnchorSection(full, "Constraints");
    expect(next).not.toContain("## Constraints");
    expect(next).not.toContain("three");
    expect(next).toContain("## PRs");
  });

  it("replaceAnchorSection accepts heading without ## prefix", () => {
    const next = replaceAnchorSection(full, "Current State", "patched");
    expect(next).toContain("patched");
    expect(next).not.toContain("## Current State\n\none");
  });
});
