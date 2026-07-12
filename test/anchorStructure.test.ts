import { describe, expect, it } from "vitest";

import {
  ALWAYS_REQUIRED_SECTIONS,
  ANCHOR_SECTION_DEFINITIONS,
  APPROVAL_REQUIRED_SECTIONS,
  CLAIM_BEARING_SECTIONS,
  CURRENT_STATE_TOPICS,
  currentStateOrganizationWarnings,
  designHeaderStatus,
  designHeaderWarnings,
  insertAnchorSectionBullet,
  migrateDesignHeaderContent,
} from "../src/anchorStructure.js";

describe("project context anchor design header", () => {
  it("derives validation, claim, approval, and tooltip data from one schema", () => {
    expect(ALWAYS_REQUIRED_SECTIONS).toEqual(["Current State", "Decisions", "Constraints", "PRs"]);
    expect(CLAIM_BEARING_SECTIONS).toEqual([
      "Introduction",
      "Invariants",
      "Current State",
      "Decisions",
      "Constraints",
    ]);
    expect(APPROVAL_REQUIRED_SECTIONS).toEqual(["Invariants", "Decisions", "Constraints"]);
    expect(Object.keys(ANCHOR_SECTION_DEFINITIONS)).toEqual([
      "Introduction",
      "Purpose",
      "Goals",
      "Users",
      "Non-goals",
      "Invariants",
      "Current State",
      "Architecture",
      "Capabilities",
      "Interfaces",
      "Data and Persistence",
      "Operations and Security",
      "Quality and Performance",
      "Known Limitations",
      "Decisions",
      "Constraints",
      "PRs",
    ]);
    expect(CURRENT_STATE_TOPICS).toEqual([
      "Architecture",
      "Capabilities",
      "Interfaces",
      "Data and Persistence",
      "Operations and Security",
      "Quality and Performance",
      "Known Limitations",
    ]);
  });

  it("warns for missing design sections and creates persisted blank sections", () => {
    const content = projectContextBody(`## Current State

Exists.

## Decisions

None.

## Constraints

None.

## PRs

None.`);

    expect(designHeaderWarnings("projects/demo/demo.md", content).map((warning) => warning.code)).toEqual([
      "design_header_section_missing",
      "design_header_section_missing",
    ]);

    const migrated = migrateDesignHeaderContent("projects/demo/demo.md", content);
    expect(migrated.indexOf("## Introduction")).toBeLessThan(migrated.indexOf("## Invariants"));
    expect(migrated.indexOf("## Invariants")).toBeLessThan(migrated.indexOf("## Current State"));
    expect(migrated).toContain("### Purpose");
    expect(migrated).toContain("### Non-goals");
    expect(migrated).not.toContain("Not documented");
    expect(migrated).toContain("last_validated: 2026-07-11\n");
    expect(migrated).not.toContain("last_validated: 2026-07-11T00:00:00.000Z");
    expect(designHeaderWarnings("projects/demo/demo.md", migrated)).toEqual([]);
    expect(migrateDesignHeaderContent("projects/demo/demo.md", migrated)).toBe(migrated);
  });

  it("requires the four Introduction fields and top placement", () => {
    const content = projectContextBody(`## Current State

Exists.

## Introduction

### Purpose

Explain the purpose.

## Invariants

- Stable ids never change.`);
    const status = designHeaderStatus("projects/demo/demo.md", content);

    expect(status.sections).toEqual({ Introduction: true, Invariants: true });
    expect(status.introduction).toEqual({ Purpose: true, Goals: false, Users: false, "Non-goals": false });
    expect(status.isAtTop).toBe(false);
    expect(designHeaderWarnings("projects/demo/demo.md", content).map((warning) => warning.code)).toEqual([
      "design_header_field_missing",
      "design_header_field_missing",
      "design_header_field_missing",
      "design_header_not_at_top",
    ]);
  });

  it("does not apply the design header to shared anchors, roadmaps, or milestones", () => {
    const context = projectContextBody("## Current State\n\nExists.");
    const roadmap = context.replace("type: context-anchor", "type: project-roadmap");
    const milestone = context.replace("type: context-anchor", "type: project-milestone");

    expect(designHeaderWarnings("shared/demo.md", context)).toEqual([]);
    expect(designHeaderWarnings("projects/demo/demo-roadmap.md", roadmap)).toEqual([]);
    expect(designHeaderWarnings("projects/demo/milestones/one.md", milestone)).toEqual([]);
  });

  it("ignores Introduction-like headings inside fenced code", () => {
    const content = projectContextBody(`## Introduction

\`\`\`md
### Purpose
### Goals
### Users
### Non-goals
\`\`\`

## Invariants

- Stable ids never change.`);
    expect(designHeaderStatus("projects/demo/demo.md", content).introduction).toEqual({
      Purpose: false,
      Goals: false,
      Users: false,
      "Non-goals": false,
    });
  });

  it("inserts bullets beneath exact H2 and H3 structured headings while preserving front matter", () => {
    const content = projectContextBody(`## Introduction

### Purpose

### Goals

## Invariants

## Current State

- Existing fact.

## Decisions

## Constraints

## PRs`);

    const purpose = insertAnchorSectionBullet(content, "Purpose", "Explain the project clearly.");
    const currentState = insertAnchorSectionBullet(purpose, "Current State", "New fact.");

    expect(purpose).toContain("### Purpose\n\n- Explain the project clearly.\n\n### Goals");
    expect(currentState).toContain("## Current State\n\n- New fact.\n\n- Existing fact.");
    expect(currentState.slice(0, currentState.indexOf("# Demo"))).toBe(content.slice(0, content.indexOf("# Demo")));
  });

  it("does not insert beneath matching headings inside fenced code", () => {
    const content = projectContextBody(`\`\`\`md
### Purpose
\`\`\`

## Introduction

### Purpose

## Invariants`);

    const updated = insertAnchorSectionBullet(content, "Purpose", "Real purpose.");
    expect(updated.indexOf("- Real purpose.")).toBeGreaterThan(updated.lastIndexOf("### Purpose"));
  });

  it("warns when a substantial Current State is unstructured or changelog-heavy", () => {
    const claims = Array.from({ length: 8 }, (_, index) =>
      `- Capability ${index + 1} shipped in PR #${index + 1}.`,
    ).join("\n");
    const content = projectContextBody(`## Current State

${claims}

## Decisions

None.

## Constraints

None.

## PRs

None.`);

    expect(currentStateOrganizationWarnings("projects/demo/demo.md", content).map((warning) => warning.code)).toEqual([
      "current_state_unstructured",
      "current_state_changelog_heavy",
    ]);
  });

  it("accepts a concise, topic-oriented Current State", () => {
    const content = projectContextBody(`## Current State

### Architecture

- The service has an MCP boundary.

### Capabilities

- Agents can retrieve context by task.

## Decisions

None.

## Constraints

None.

## PRs

None.`);

    expect(currentStateOrganizationWarnings("projects/demo/demo.md", content)).toEqual([]);
  });
});

function projectContextBody(body: string): string {
  return `---
project:
  - demo
type: context-anchor
tags:
  - context-anchor
summary: Demo context.
read_this_if:
  - You are working on demo.
last_validated: 2026-07-11
---

# Demo

${body}
`;
}
