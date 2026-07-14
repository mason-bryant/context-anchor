import { describe, expect, it } from "vitest";

import { validateFrontMatter } from "../src/validators/frontMatter.js";
import type { ValidationContext } from "../src/validators/types.js";
import type { AnchorStore } from "../src/storage/store.js";

const BASE_FRONTMATTER = `type: reference
tags: [demo]
summary: A demo anchor for front matter validation tests.
read_this_if:
  - "Whenever you need a demo anchor."
last_validated: 2026-07-01`;

function anchorContent(extraFrontmatter = ""): string {
  return `---\n${BASE_FRONTMATTER}\n${extraFrontmatter}---\n\n## Current State\n\n- Demo content.\n`;
}

function makeContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    name: "shared/demo.md",
    path: "shared/demo.md",
    newContent: anchorContent(),
    repo: {} as AnchorStore,
    migrationWarnOnly: false,
    approved: true,
    ...overrides,
  };
}

describe("validateFrontMatter: anchor_id", () => {
  it("has no violations when anchor_id is absent (missing is a coverage finding, not a validator violation)", async () => {
    const violations = await validateFrontMatter(makeContext());
    expect(violations).toEqual([]);
  });

  it("accepts a valid 6-char anchor_id", async () => {
    const context = makeContext({ newContent: anchorContent("anchor_id: a-abc123\n") });
    const violations = await validateFrontMatter(context);
    expect(violations).toEqual([]);
  });

  it("accepts a valid 8-char anchor_id", async () => {
    const context = makeContext({ newContent: anchorContent("anchor_id: a-abcdef12\n") });
    const violations = await validateFrontMatter(context);
    expect(violations).toEqual([]);
  });

  it("rejects an anchor_id with the wrong prefix", async () => {
    const context = makeContext({ newContent: anchorContent("anchor_id: c-abc123\n") });
    const violations = await validateFrontMatter(context);
    expect(violations.some((v) => v.code === "front_matter_schema")).toBe(true);
  });

  it("rejects an anchor_id that is too short", async () => {
    const context = makeContext({ newContent: anchorContent("anchor_id: a-ab1\n") });
    const violations = await validateFrontMatter(context);
    expect(violations.some((v) => v.code === "front_matter_schema")).toBe(true);
  });

  it("rejects an anchor_id with uppercase characters", async () => {
    const context = makeContext({ newContent: anchorContent("anchor_id: a-ABC123\n") });
    const violations = await validateFrontMatter(context);
    expect(violations.some((v) => v.code === "front_matter_schema")).toBe(true);
  });
});

describe("validateFrontMatter: schema_version", () => {
  it("has no violations when schema_version is absent", async () => {
    const violations = await validateFrontMatter(makeContext());
    expect(violations).toEqual([]);
  });

  it("accepts a positive integer schema_version", async () => {
    const context = makeContext({ newContent: anchorContent("schema_version: 1\n") });
    const violations = await validateFrontMatter(context);
    expect(violations).toEqual([]);
  });

  it("accepts a numeric-string schema_version (mirrors the milestone overlay's union shape)", async () => {
    const context = makeContext({ newContent: anchorContent('schema_version: "2"\n') });
    const violations = await validateFrontMatter(context);
    expect(violations).toEqual([]);
  });

  it("rejects a zero schema_version", async () => {
    const context = makeContext({ newContent: anchorContent("schema_version: 0\n") });
    const violations = await validateFrontMatter(context);
    expect(violations.some((v) => v.code === "front_matter_schema")).toBe(true);
  });

  it("rejects a negative schema_version", async () => {
    const context = makeContext({ newContent: anchorContent("schema_version: -1\n") });
    const violations = await validateFrontMatter(context);
    expect(violations.some((v) => v.code === "front_matter_schema")).toBe(true);
  });

  it("rejects a non-numeric string schema_version", async () => {
    const context = makeContext({ newContent: anchorContent('schema_version: "abc"\n') });
    const violations = await validateFrontMatter(context);
    expect(violations.some((v) => v.code === "front_matter_schema")).toBe(true);
  });
});

describe("validateFrontMatter: existing fixtures still validate", () => {
  it("a plain anchor with none of the new fields still passes", async () => {
    const violations = await validateFrontMatter(makeContext());
    expect(violations).toEqual([]);
  });

  it("both new fields together still pass when valid", async () => {
    const context = makeContext({
      newContent: anchorContent("anchor_id: a-abc123\nschema_version: 1\n"),
    });
    const violations = await validateFrontMatter(context);
    expect(violations).toEqual([]);
  });
});
