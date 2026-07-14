import { describe, expect, it } from "vitest";

import {
  appendCoverageRecords,
  coverageFiltersFromUrlParams,
  coverageKindLabel,
  coverageQueryParams,
  coverageRecordKey,
  coverageStateLabel,
  coverageUrlParamsFromFilters,
  deriveCoverageProjects,
  filterCoverageRecords,
  requiredSectionStatus,
  toAnchorUiDetail,
  toAnchorUiMeta,
} from "../src/ui/viewModel.js";
import type { AnchorMeta, AnchorRead } from "../src/types.js";
import type { CoverageRecordKind } from "../src/graph/coverage.js";

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

describe("Schema Coverage view model", () => {
  it("labels every coverage state with human text, not a bare code", () => {
    expect(coverageStateLabel("structured")).toBe("Structured");
    expect(coverageStateLabel("prose_only")).toBe("Prose only");
    expect(coverageStateLabel("dangling")).toBe("Dangling");
    expect(coverageStateLabel("malformed")).toBe("Malformed");
  });

  it("labels the anchor/claim record kind", () => {
    expect(coverageKindLabel("anchor")).toBe("Anchor");
    expect(coverageKindLabel("claim")).toBe("Claim");
  });

  it("derives the sorted, deduplicated set of projects from anchor records only", () => {
    const records: CoverageRecordKind[] = [
      anchorRecord({ anchorName: "projects/beta/beta.md", projectSlug: "beta" }),
      anchorRecord({ anchorName: "projects/alpha/alpha.md", projectSlug: "alpha" }),
      anchorRecord({ anchorName: "projects/alpha/other.md", projectSlug: "alpha" }),
      anchorRecord({ anchorName: "shared/notes.md", projectSlug: undefined }),
      claimRecord({ anchorName: "projects/beta/beta.md", line: 5 }),
    ];

    expect(deriveCoverageProjects(records)).toEqual(["alpha", "beta"]);
  });

  it("filters records by state", () => {
    const records: CoverageRecordKind[] = [
      anchorRecord({ anchorName: "a.md", state: "structured" }),
      anchorRecord({ anchorName: "b.md", state: "dangling" }),
      claimRecord({ anchorName: "a.md", line: 3, state: "partial" }),
    ];

    const filtered = filterCoverageRecords(records, { states: ["dangling", "partial"] });
    expect(filtered.map((record) => record.anchorName + ":" + record.state)).toEqual(["b.md:dangling", "a.md:partial"]);
  });

  it("does NOT filter by project client-side: project scoping is server-side, so claim rows (which carry no projectSlug) survive", () => {
    // Regression guard for review feedback on PR #90: a client-side project
    // comparison silently dropped every claim row because claims have no
    // projectSlug of their own. The server already scopes the fetched page
    // via the project= query param (coverageQueryParams), so client-side
    // filtering must pass ALL records through when a project is selected.
    const records: CoverageRecordKind[] = [
      anchorRecord({ anchorName: "projects/alpha/alpha.md", projectSlug: "alpha" }),
      claimRecord({ anchorName: "projects/alpha/alpha.md", line: 2 }),
    ];

    const filtered = filterCoverageRecords(records, { project: "alpha" });
    expect(filtered.map((record) => record.kind + ":" + record.anchorName)).toEqual([
      "anchor:projects/alpha/alpha.md",
      "claim:projects/alpha/alpha.md",
    ]);
  });

  it("filters records by a case-insensitive anchor-name substring", () => {
    const records: CoverageRecordKind[] = [
      anchorRecord({ anchorName: "projects/alpha/Roadmap.md" }),
      anchorRecord({ anchorName: "projects/alpha/design.md" }),
    ];

    const filtered = filterCoverageRecords(records, { anchorText: "roadmap" });
    expect(filtered.map((record) => record.anchorName)).toEqual(["projects/alpha/Roadmap.md"]);
  });

  it("combines state and text filters (AND semantics); project is ignored client-side", () => {
    const records: CoverageRecordKind[] = [
      anchorRecord({ anchorName: "projects/alpha/roadmap.md", projectSlug: "alpha", state: "dangling" }),
      anchorRecord({ anchorName: "projects/alpha/design.md", projectSlug: "alpha", state: "structured" }),
      anchorRecord({ anchorName: "projects/beta/notes.md", projectSlug: "beta", state: "dangling" }),
    ];

    const filtered = filterCoverageRecords(records, { states: ["dangling"], project: "alpha", anchorText: "road" });
    expect(filtered.map((record) => record.anchorName)).toEqual(["projects/alpha/roadmap.md"]);
  });

  it("builds server query params from project/state filters, omitting anchor text (server has no text param)", () => {
    expect(coverageQueryParams({ project: "alpha", states: ["dangling", "malformed"], anchorText: "road" })).toEqual({
      project: "alpha",
      states: "dangling,malformed",
    });
    expect(coverageQueryParams({})).toEqual({});
    expect(coverageQueryParams({}, "cursor-value", 50)).toEqual({ cursor: "cursor-value", limit: "50" });
  });

  it("round-trips filters through URL query params", () => {
    const filters = { project: "alpha", states: ["dangling", "malformed"] as const, anchorText: "roadmap" };
    const params = coverageUrlParamsFromFilters(filters);
    const restored = coverageFiltersFromUrlParams((key) => params[key] ?? null);
    expect(restored).toEqual(filters);
  });

  it("omits empty filter keys when serializing to URL params", () => {
    expect(coverageUrlParamsFromFilters({})).toEqual({});
  });

  it("drops unknown state tokens instead of throwing when parsing from the URL", () => {
    const restored = coverageFiltersFromUrlParams((key) =>
      key === "coverageStates" ? "dangling,not_a_real_state,malformed" : null,
    );
    expect(restored.states).toEqual(["dangling", "malformed"]);
  });

  it("deduplicates repeated state tokens from the URL in order (set semantics — a single toggle must clear a state)", () => {
    const restored = coverageFiltersFromUrlParams((key) =>
      key === "coverageStates" ? "dangling,dangling,malformed,dangling" : null,
    );
    expect(restored.states).toEqual(["dangling", "malformed"]);
  });

  it("computes a stable per-record key from kind/anchorName/line", () => {
    expect(coverageRecordKey(anchorRecord({ anchorName: "a.md" }))).toBe("anchor\na.md\n-1");
    expect(coverageRecordKey(claimRecord({ anchorName: "a.md", line: 7 }))).toBe("claim\na.md\n7");
  });

  it("appends a cursor page to existing records without duplicating rows", () => {
    const page1: CoverageRecordKind[] = [anchorRecord({ anchorName: "a.md" }), anchorRecord({ anchorName: "b.md" })];
    const page2: CoverageRecordKind[] = [anchorRecord({ anchorName: "b.md" }), anchorRecord({ anchorName: "c.md" })];

    const combined = appendCoverageRecords(page1, page2);
    expect(combined.map((record) => record.anchorName)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("appends an empty page as a no-op", () => {
    const page1: CoverageRecordKind[] = [anchorRecord({ anchorName: "a.md" })];
    expect(appendCoverageRecords(page1, [])).toEqual(page1);
  });
});

function anchorRecord(overrides: Partial<Extract<CoverageRecordKind, { kind: "anchor" }>> = {}): CoverageRecordKind {
  return {
    kind: "anchor",
    anchorName: "projects/demo/demo.md",
    anchorType: "context-anchor",
    state: "structured",
    reasons: [],
    suggestedOperations: [],
    ...overrides,
  };
}

function claimRecord(overrides: Partial<Extract<CoverageRecordKind, { kind: "claim" }>> = {}): CoverageRecordKind {
  return {
    kind: "claim",
    anchorName: "projects/demo/demo.md",
    line: 1,
    state: "structured",
    reasons: [],
    suggestedOperations: [],
    ...overrides,
  };
}

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
