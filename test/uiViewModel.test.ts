import { describe, expect, it } from "vitest";

import { requiredSectionStatus, toAnchorUiDetail, toAnchorUiMeta } from "../src/ui/viewModel.js";
import type { AnchorMeta, AnchorRead } from "../src/types.js";

describe("UI view model", () => {
  it("detects required H2 sections", () => {
    const sections = requiredSectionStatus(`# Demo

## Current State

Exists.

## Decisions

None.

## Constraints

None.
`);

    expect(sections["Current State"]).toBe(true);
    expect(sections.Decisions).toBe(true);
    expect(sections.Constraints).toBe(true);
    expect(sections.PRs).toBe(false);
  });

  it("uses the same H2 parsing semantics as section validation", () => {
    const sections = requiredSectionStatus(`# Demo

## current state

Lowercase heading should not satisfy the exact required title.

## Decisions ##

Trailing closing hashes are accepted by the shared parser.

\`\`\`md
## Constraints
## PRs
\`\`\`

## Constraints

Real section outside the fence.
`);

    expect(sections["Current State"]).toBe(false);
    expect(sections.Decisions).toBe(true);
    expect(sections.Constraints).toBe(true);
    expect(sections.PRs).toBe(false);
  });

  it("marks healthy anchor metadata as ok", () => {
    const meta = toAnchorUiMeta(validMeta());

    expect(meta.ui.label).toBe("Demo Anchor");
    expect(meta.ui.health.status).toBe("ok");
    expect(meta.ui.health.issues).toEqual([]);
  });

  it("surfaces roadmap acceptance warnings", () => {
    const meta = toAnchorUiMeta({
      ...validMeta({
        name: "projects/demo/demo-roadmap.md",
        type: "project-roadmap",
        tags: ["project-roadmap"],
      }),
      acceptanceCriteria: {
        activeGoals: 2,
        goalsWithCriteria: 1,
        goalsMissingCriteria: ["Goal G-002 -- Later"],
        hasProposedCriteria: true,
      },
    });

    expect(meta.ui.health.status).toBe("warn");
    expect(meta.ui.health.issues.map((issue) => issue.code)).toEqual([
      "roadmap_missing_acceptance_criteria",
      "roadmap_proposed_acceptance_criteria",
    ]);
  });

  it("surfaces missing section and project mismatch blocks on detail", () => {
    const detail = toAnchorUiDetail(
      validRead({
        name: "projects/demo/demo.md",
        frontmatter: {
          project: ["other"],
          type: "context-anchor",
          tags: ["context-anchor"],
          summary: "Demo anchor summary.",
          read_this_if: ["You need demo context."],
          last_validated: "2026-05-20",
        },
        content: `---
project:
  - other
type: context-anchor
tags:
  - context-anchor
summary: "Demo anchor summary."
read_this_if:
  - "You need demo context."
last_validated: 2026-05-20
---

# Demo

## Current State

Exists.

## Decisions

None.
`,
      }),
    );

    expect(detail.ui.health.status).toBe("block");
    expect(detail.ui.sections.PRs).toBe(false);
    expect(detail.ui.health.issues.map((issue) => issue.code)).toContain("project_slug_mismatch");
    expect(detail.ui.health.issues.map((issue) => issue.code)).toContain("required_section");
  });
});

function validMeta(overrides: Partial<AnchorMeta> = {}): AnchorMeta {
  return {
    name: "projects/demo/demo.md",
    path: "projects/demo/demo.md",
    category: "projects",
    project: ["demo"],
    projectSlug: "demo",
    title: "Demo Anchor",
    type: "context-anchor",
    tags: ["context-anchor"],
    summary: "Demo anchor summary.",
    read_this_if: ["You need demo context."],
    last_validated: "2026-05-20",
    origin: "repo",
    ...overrides,
  };
}

function validRead(overrides: Partial<AnchorRead> = {}): AnchorRead {
  return {
    name: "projects/demo/demo.md",
    path: "projects/demo/demo.md",
    content: `---
project:
  - demo
type: context-anchor
tags:
  - context-anchor
summary: "Demo anchor summary."
read_this_if:
  - "You need demo context."
last_validated: 2026-05-20
---

# Demo

## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.
`,
    frontmatter: {
      project: ["demo"],
      type: "context-anchor",
      tags: ["context-anchor"],
      summary: "Demo anchor summary.",
      read_this_if: ["You need demo context."],
      last_validated: "2026-05-20",
    },
    version: "latest",
    fileCommit: "abc123",
    ...overrides,
  };
}
