import { describe, expect, it } from "vitest";

import {
  excerptFromContent,
  projectContextRetrievalOverview,
  shrinkLoadContextAnchorToFit,
  taskAwareExcerpt,
} from "../src/loadContext.js";

describe("taskAwareExcerpt", () => {
  it("returns matching sections even when they appear after a long prefix", () => {
    const padding = "x".repeat(1500);
    const body = `# Roadmap

## Current State

- ${padding}

### Goal G-004 -- Session start

Ship startTask and retrieval quality improvements.

## Decisions

- Keep planner deterministic.
`;

    const excerpt = excerptFromContent(`---\ntype: project-roadmap\n---\n${body}`, 1200, "session start G-004");
    expect(excerpt).toContain("Goal G-004");
    expect(excerpt).toContain("startTask");
    expect(excerpt?.includes(padding.slice(0, 200))).toBe(false);
  });

  it("falls back to prefix excerpt when no section matches the task", () => {
    const body = `# Doc

## Current State

- Only generic content here.
`;
    const direct = taskAwareExcerpt(body, "unrelated quantum physics", 500);
    expect(direct).toBeUndefined();
    const fallback = excerptFromContent(`---\n---\n${body}`, 500, "unrelated quantum physics");
    expect(fallback).toContain("Current State");
  });
});

describe("projectContextRetrievalOverview", () => {
  it("returns the complete design header and outlines the remaining H2 sections", () => {
    const content = `---
project:
  - demo
type: context-anchor
tags: []
summary: Demo context.
read_this_if:
  - Working on demo.
last_validated: 2026-07-12
---

# Demo

## Introduction

### Purpose

- Explain why demo exists.

### Goals

- Ship demo.

### Users

- Demo users.

### Non-goals

- Everything else.

## Invariants

- Stable ids remain stable.

## Current State

- ${"large history ".repeat(500)}

## Decisions

- Keep it simple.

## Constraints

- Stay bounded.

## PRs

None.
`;

    const overview = projectContextRetrievalOverview("projects/demo/demo-project-context.md", content);

    expect(overview?.excerpt).toContain("## Introduction");
    expect(overview?.excerpt).toContain("### Users");
    expect(overview?.excerpt).toContain("## Invariants");
    expect(overview?.excerpt).not.toContain("large history");
    expect(overview?.availableSections).toEqual(["Current State", "Decisions", "Constraints", "PRs"]);
  });

  it("falls back when the complete design header cannot fit the byte budget", () => {
    const content = `---
project:
  - demo
type: context-anchor
tags: []
summary: Demo context.
read_this_if:
  - Working on demo.
last_validated: 2026-07-12
---

## Introduction

${"oversized design context ".repeat(500)}

## Invariants

- Stable ids remain stable.

## Current State

- Demo exists.
`;
    const row = shrinkLoadContextAnchorToFit(
      {
        name: "projects/demo/demo-project-context.md",
        path: "projects/demo/demo-project-context.md",
        content,
        frontmatter: {
          project: ["demo"],
          type: "context-anchor",
          tags: [],
          summary: "Demo context.",
          read_this_if: ["Working on demo."],
          last_validated: "2026-07-12",
        },
      },
      "excerpt",
      1200,
      500,
    );

    expect(row.excerpt).toBeUndefined();
    expect(row.content).toBeUndefined();
    expect(row.name).toBe("projects/demo/demo-project-context.md");
  });
});
