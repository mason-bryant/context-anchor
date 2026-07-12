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

  it("uses shared title parsing for detail fallback labels", () => {
    const detail = toAnchorUiDetail(
      validRead({
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

# Demo Anchor ###

## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.
`,
      }),
    );

    expect(detail.ui.label).toBe("Demo Anchor");
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

  it("derives roadmap health from anchor detail without a preloaded meta row", () => {
    const detail = toAnchorUiDetail(
      validRead({
        name: "projects/demo/demo-roadmap.md",
        frontmatter: {
          project: ["demo"],
          type: "project-roadmap",
          tags: ["project-roadmap"],
          summary: "Demo roadmap summary.",
          read_this_if: ["You need demo roadmap context."],
          last_validated: "2026-05-20",
        },
        content: `---
project:
  - demo
type: project-roadmap
tags:
  - project-roadmap
summary: "Demo roadmap summary."
read_this_if:
  - "You need demo roadmap context."
last_validated: 2026-05-20
---

# Demo Roadmap

## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.

## Goals

### Goal G-001 -- Missing criteria

#### Requirements

- Ship a thing.
`,
      }),
    );

    expect(detail.ui.health.status).toBe("warn");
    expect(detail.ui.health.issues.map((issue) => issue.code)).toContain("roadmap_missing_acceptance_criteria");
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

  it("surfaces design-header warnings before migration", () => {
    const read = validRead();
    read.warnings = [
      {
        severity: "WARN",
        code: "design_header_section_missing",
        message: "Project context anchor is missing design header section: ## Introduction.",
      },
    ];
    const detail = toAnchorUiDetail(read);

    expect(detail.ui.health.status).toBe("warn");
    expect(detail.ui.designHeader.applies).toBe(true);
    expect(detail.ui.designHeader.sections.Introduction).toBe(false);
  });

  it("exposes Current State organization data for the anchor detail UI", () => {
    const read = validRead();
    read.content = read.content.replace(
      "## Current State\n\nExists.",
      "## Current State\n\n### Architecture\n\n- The service exists.\n\n### Capabilities\n\n- Agents can load context.",
    );
    const detail = toAnchorUiDetail(read);

    expect(detail.ui.currentStateOrganization).toEqual(expect.objectContaining({
      applies: true,
      status: "organized",
      claimCount: 2,
      ungroupedClaimCount: 0,
    }));
    expect(detail.ui.currentStateOrganization.topics.map((topic) => topic.path)).toEqual([
      "Current State > Architecture",
      "Current State > Capabilities",
    ]);
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
