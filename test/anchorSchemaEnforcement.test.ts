import { describe, expect, it } from "vitest";

import { validateAnchorSchemaEnforcement } from "../src/validators/anchorSchemaEnforcement.js";
import type { ValidationContext } from "../src/validators/types.js";
import type { AnchorStore } from "../src/storage/store.js";

/**
 * Goal 0 Phase 2 slice 3b: write-time schema enforcement
 * (`goal0_phase2_enforcement_mode_plan.md`).
 */

function anchorDoc(frontmatterExtra = ""): string {
  return `---
type: context-anchor
project:
  - demo
tags: []
summary: A demo anchor for schema-enforcement tests.
read_this_if:
  - "Whenever you test schema enforcement."
last_validated: 2026-07-15
${frontmatterExtra}---

## Current State

None.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;
}

const STRUCTURED = anchorDoc("anchor_id: a-abc123\nschema_version: 1\n");
const MISSING_ANCHOR_ID = anchorDoc("schema_version: 1\n");
const MISSING_SCHEMA_VERSION = anchorDoc("anchor_id: a-abc123\n");
const LEGACY_RELATION = anchorDoc(
  "anchor_id: a-abc123\nschema_version: 1\nrelations:\n  depends_on:\n    - projects/demo/other.md\n",
);
const PROSE_ONLY = anchorDoc();

function makeContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    name: "projects/demo/thing.md",
    path: "projects/demo/thing.md",
    newContent: STRUCTURED,
    repo: {} as AnchorStore,
    migrationWarnOnly: false,
    anchorSchemaMode: "enforce",
    approved: true,
    ...overrides,
  };
}

describe("validateAnchorSchemaEnforcement: mode gating", () => {
  it("does nothing in legacy mode (the default) — no enforcement of any gap", async () => {
    expect(await validateAnchorSchemaEnforcement(makeContext({ anchorSchemaMode: "legacy", newContent: MISSING_ANCHOR_ID }))).toEqual([]);
    // Absent mode is treated as legacy too.
    expect(await validateAnchorSchemaEnforcement(makeContext({ anchorSchemaMode: undefined, newContent: MISSING_ANCHOR_ID }))).toEqual([]);
  });

  it("warn mode emits WARN, enforce mode emits BLOCK, for the same missing anchor_id gap", async () => {
    const warned = await validateAnchorSchemaEnforcement(makeContext({ anchorSchemaMode: "warn", newContent: MISSING_ANCHOR_ID }));
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe("WARN");
    expect(warned[0].code).toBe("anchor_schema_mint_anchor_id");

    const blocked = await validateAnchorSchemaEnforcement(makeContext({ anchorSchemaMode: "enforce", newContent: MISSING_ANCHOR_ID }));
    expect(blocked).toHaveLength(1);
    expect(blocked[0].severity).toBe("BLOCK");
    expect(blocked[0].code).toBe("anchor_schema_mint_anchor_id");
  });
});

describe("validateAnchorSchemaEnforcement: per-gap detection (enforce)", () => {
  it("passes a fully structured anchor with no violations", async () => {
    expect(await validateAnchorSchemaEnforcement(makeContext({ newContent: STRUCTURED }))).toEqual([]);
  });

  it("blocks a missing schema_version", async () => {
    const v = await validateAnchorSchemaEnforcement(makeContext({ newContent: MISSING_SCHEMA_VERSION }));
    expect(v.map((x) => x.code)).toEqual(["anchor_schema_add_schema_version"]);
    expect(v[0].severity).toBe("BLOCK");
  });

  it("blocks a legacy bare-string relation target on a registered key", async () => {
    const v = await validateAnchorSchemaEnforcement(makeContext({ newContent: LEGACY_RELATION }));
    expect(v.map((x) => x.code)).toEqual(["anchor_schema_convert_relation"]);
    expect(v[0].severity).toBe("BLOCK");
  });

  it("does NOT block a plain prose anchor with no graph structure (nothing graph-participating to enforce)", async () => {
    expect(await validateAnchorSchemaEnforcement(makeContext({ newContent: PROSE_ONLY }))).toEqual([]);
  });

  it("leaves built-in and non-anchor paths alone", async () => {
    expect(
      await validateAnchorSchemaEnforcement(
        makeContext({ name: "server-rules/policy.md", path: "server-rules/policy.md", newContent: MISSING_ANCHOR_ID }),
      ),
    ).toEqual([]);
  });
});

describe("validateAnchorSchemaEnforcement: update-scoping (never retroactively block)", () => {
  it("does not block an unrelated edit to an already-legacy anchor (the gap pre-existed)", async () => {
    const editedButStillMissingId = anchorDoc("schema_version: 1\n").replace("None.\n\n## Decisions", "Edited.\n\n## Decisions");
    const v = await validateAnchorSchemaEnforcement(
      makeContext({ oldContent: MISSING_ANCHOR_ID, newContent: editedButStillMissingId }),
    );
    expect(v).toEqual([]);
  });

  it("blocks a gap the write NEWLY introduces (adding a legacy relation target to a previously clean anchor)", async () => {
    const v = await validateAnchorSchemaEnforcement(makeContext({ oldContent: STRUCTURED, newContent: LEGACY_RELATION }));
    expect(v.map((x) => x.code)).toEqual(["anchor_schema_convert_relation"]);
  });

  it("does not block when an update FIXES the last gap (becomes fully structured)", async () => {
    const v = await validateAnchorSchemaEnforcement(makeContext({ oldContent: MISSING_ANCHOR_ID, newContent: STRUCTURED }));
    expect(v).toEqual([]);
  });

  it("blocks a legacy target newly added under a DIFFERENT relation key (per-key gap identity, not just code)", async () => {
    // Old: one legacy target under depends_on. New: adds a second legacy
    // target under supersedes. Both are convert_relation gaps, but the
    // supersedes one is newly introduced — comparing by code alone would
    // wrongly treat it as pre-existing and skip enforcement.
    const oldWithDependsOn = anchorDoc(
      "anchor_id: a-abc123\nschema_version: 1\nrelations:\n  depends_on:\n    - projects/demo/other.md\n",
    );
    const newAddsSupersedes = anchorDoc(
      "anchor_id: a-abc123\nschema_version: 1\nrelations:\n  depends_on:\n    - projects/demo/other.md\n  supersedes:\n    - projects/demo/another.md\n",
    );
    const v = await validateAnchorSchemaEnforcement(
      makeContext({ oldContent: oldWithDependsOn, newContent: newAddsSupersedes }),
    );
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("anchor_schema_convert_relation");
    expect(v[0].message).toContain("supersedes");
  });
});
