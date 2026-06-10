import { describe, expect, it } from "vitest";

import { excerptFromContent, taskAwareExcerpt } from "../src/loadContext.js";

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
