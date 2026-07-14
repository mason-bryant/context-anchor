import { describe, expect, it } from "vitest";

import {
  planAnchorMigration,
  MIGRATION_OPERATION_CODES,
  type AnchorMigrationContext,
} from "../src/migration/anchorMigration.js";
import { extractClaims } from "../src/claims.js";
import { isValidAnchorId } from "../src/graph/identity.js";

function makeCtx(overrides: Partial<AnchorMigrationContext> = {}): AnchorMigrationContext {
  return {
    treeAnchorIds: new Set(),
    treeClaimIds: new Set(),
    resolveAnchorName: () => undefined,
    anchorIdForAnchorName: () => undefined,
    projectsForGoalId: () => [],
    ...overrides,
  };
}

const BASE_FRONTMATTER = `type: context-anchor
tags: []
summary: "Test anchor."
read_this_if:
  - "Testing migration."
last_validated: "2026-07-14"`;

function doc(frontmatterExtra: string, body: string): string {
  return `---
${BASE_FRONTMATTER}${frontmatterExtra ? `\n${frontmatterExtra}` : ""}
---

${body}`;
}

describe("planAnchorMigration: mint_anchor_id", () => {
  it("mints a new anchor_id when absent", () => {
    const content = doc("", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["mint_anchor_id"]);
    const outcome = result.outcomes.find((o) => o.code === "mint_anchor_id")!;
    expect(outcome.status).toBe("applied");
    const parsed = /anchor_id:\s*(\S+)/.exec(result.newContent);
    expect(parsed?.[1]).toBeDefined();
    expect(isValidAnchorId(parsed![1])).toBe(true);
  });

  it("never replaces an existing valid anchor_id (not_applicable, already_present)", () => {
    const content = doc("anchor_id: a-abc123", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["mint_anchor_id"]);
    const outcome = result.outcomes.find((o) => o.code === "mint_anchor_id")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.reason).toBe("already_present");
    expect(result.newContent).toContain("anchor_id: a-abc123");
  });

  it("mints against the tree-wide existing id set so it never collides", () => {
    const content = doc("", "## Current State\n\nNone.\n");
    const existing = new Set(["a-abc123"]);
    const result = planAnchorMigration(content, makeCtx({ treeAnchorIds: existing }), ["mint_anchor_id"]);
    const parsed = /anchor_id:\s*(\S+)/.exec(result.newContent);
    expect(parsed?.[1]).not.toBe("a-abc123");
  });
});

describe("planAnchorMigration: add_schema_version", () => {
  it("sets schema_version to 1 when absent", () => {
    const content = doc("", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["add_schema_version"]);
    const outcome = result.outcomes.find((o) => o.code === "add_schema_version")!;
    expect(outcome.status).toBe("applied");
    expect(result.newContent).toMatch(/schema_version:\s*1/);
  });

  it("is not_applicable when schema_version already present", () => {
    const content = doc("schema_version: 2", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["add_schema_version"]);
    const outcome = result.outcomes.find((o) => o.code === "add_schema_version")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.reason).toBe("already_present");
    expect(result.newContent).toMatch(/schema_version:\s*2/);
  });
});

describe("planAnchorMigration: convert_relation", () => {
  it("converts a legacy bare-string target on a registered key to anchor:<id> when the target has a valid anchor_id", () => {
    const content = doc(
      "relations:\n  depends_on:\n    - projects/demo/other.md",
      "## Current State\n\nNone.\n",
    );
    const ctx = makeCtx({
      resolveAnchorName: (value) => (value === "projects/demo/other.md" ? "projects/demo/other.md" : undefined),
      anchorIdForAnchorName: (name) => (name === "projects/demo/other.md" ? "a-target1" : undefined),
    });
    const result = planAnchorMigration(content, ctx, ["convert_relation"]);
    const outcome = result.outcomes.find((o) => o.code === "convert_relation")!;
    expect(outcome.status).toBe("applied");
    expect(result.newContent).toContain("anchor:a-target1");
    expect(result.newContent).not.toContain("projects/demo/other.md");
  });

  it("skips with target_missing_anchor_id when the resolvable target anchor has no anchor_id yet", () => {
    const content = doc(
      "relations:\n  depends_on:\n    - projects/demo/other.md",
      "## Current State\n\nNone.\n",
    );
    const ctx = makeCtx({
      resolveAnchorName: (value) => (value === "projects/demo/other.md" ? "projects/demo/other.md" : undefined),
      anchorIdForAnchorName: () => undefined,
    });
    const result = planAnchorMigration(content, ctx, ["convert_relation"]);
    const outcome = result.outcomes.find((o) => o.code === "convert_relation")!;
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("target_missing_anchor_id");
    expect(result.newContent).toContain("projects/demo/other.md");
  });

  it("skips with target_unparseable when the legacy target does not resolve to any known anchor", () => {
    const content = doc(
      "relations:\n  depends_on:\n    - projects/demo/missing.md",
      "## Current State\n\nNone.\n",
    );
    const result = planAnchorMigration(content, makeCtx(), ["convert_relation"]);
    const outcome = result.outcomes.find((o) => o.code === "convert_relation")!;
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("target_unparseable");
  });

  it("never auto-converts an unregistered relation key (key_not_registered)", () => {
    const content = doc(
      "relations:\n  custom_key:\n    - projects/demo/other.md",
      "## Current State\n\nNone.\n",
    );
    const ctx = makeCtx({
      resolveAnchorName: () => "projects/demo/other.md",
      anchorIdForAnchorName: () => "a-target1",
    });
    const result = planAnchorMigration(content, ctx, ["convert_relation"]);
    const outcome = result.outcomes.find((o) => o.code === "convert_relation")!;
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("key_not_registered");
    expect(result.newContent).toContain("projects/demo/other.md");
  });

  it("is not_applicable (target_not_legacy) when the target is already a canonical typed ref", () => {
    const content = doc(
      "relations:\n  depends_on:\n    - anchor:a-already",
      "## Current State\n\nNone.\n",
    );
    const result = planAnchorMigration(content, makeCtx(), ["convert_relation"]);
    const outcome = result.outcomes.find((o) => o.code === "convert_relation")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.reason).toBe("target_not_legacy");
  });

  it("does not touch a goal-targeted key (implements) — that is scope_goal_reference's job", () => {
    const content = doc(
      "relations:\n  implements:\n    - G-030",
      "## Current State\n\nNone.\n",
    );
    const result = planAnchorMigration(content, makeCtx(), ["convert_relation"]);
    expect(result.outcomes.filter((o) => o.code === "convert_relation")).toHaveLength(0);
    expect(result.newContent).toContain("G-030");
  });
});

describe("planAnchorMigration: scope_goal_reference", () => {
  it("scopes a legacy bare goal id to goal:<project-slug>:<goal-id> when exactly one project defines it", () => {
    const content = doc("relations:\n  implements:\n    - G-030", "## Current State\n\nNone.\n");
    const ctx = makeCtx({ projectsForGoalId: (id) => (id === "G-030" ? ["demo"] : []) });
    const result = planAnchorMigration(content, ctx, ["scope_goal_reference"]);
    const outcome = result.outcomes.find((o) => o.code === "scope_goal_reference")!;
    expect(outcome.status).toBe("applied");
    expect(result.newContent).toContain("goal:demo:G-030");
  });

  it("skips with goal_unknown when no project defines the goal id", () => {
    const content = doc("relations:\n  implements:\n    - G-999", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["scope_goal_reference"]);
    const outcome = result.outcomes.find((o) => o.code === "scope_goal_reference")!;
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("goal_unknown");
  });

  it("skips with goal_ambiguous when more than one project defines the goal id", () => {
    const content = doc("relations:\n  implements:\n    - G-030", "## Current State\n\nNone.\n");
    const ctx = makeCtx({ projectsForGoalId: (id) => (id === "G-030" ? ["demo", "other"] : []) });
    const result = planAnchorMigration(content, ctx, ["scope_goal_reference"]);
    const outcome = result.outcomes.find((o) => o.code === "scope_goal_reference")!;
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toBe("goal_ambiguous");
    expect(result.newContent).toContain("G-030");
    expect(result.newContent).not.toContain("goal:demo:G-030");
  });

  it("is not_applicable (target_not_legacy) when the goal target is already scoped", () => {
    const content = doc("relations:\n  implements:\n    - goal:demo:G-030", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["scope_goal_reference"]);
    const outcome = result.outcomes.find((o) => o.code === "scope_goal_reference")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.reason).toBe("target_not_legacy");
  });
});

describe("planAnchorMigration: mint_claim_ids", () => {
  it("appends an id-only annotation line to each top-level claim lacking an id", () => {
    const content = doc(
      "",
      `## Current State

- First unannotated claim.
- Second unannotated claim.
`,
    );
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const outcome = result.outcomes.find((o) => o.code === "mint_claim_ids")!;
    expect(outcome.status).toBe("applied");

    const claims = extractClaims(result.newContent);
    expect(claims).toHaveLength(2);
    expect(claims[0].id).toBeDefined();
    expect(claims[1].id).toBeDefined();
    expect(claims[0].idProvenanceless).toBe(true);
    expect(claims[0].status).toBe("unannotated");
    expect(claims[1].status).toBe("unannotated");
    // Different minted ids.
    expect(claims[0].id).not.toBe(claims[1].id);
  });

  it("mints ids using the exact grammar that round-trips through extractClaims (2-space indent, standalone line)", () => {
    const content = doc("", "## Current State\n\n- A claim.\n");
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const lines = result.newContent.split("\n");
    const bulletIndex = lines.findIndex((line) => line === "- A claim.");
    expect(bulletIndex).toBeGreaterThan(-1);
    expect(lines[bulletIndex + 1]).toMatch(/^  \{id: c-[0-9a-z]{6,8}\}$/);
  });

  it("does not touch an already-annotated claim's id, and leaves fully id-less-but-annotated claims to the existing mintMissingClaimIds path (unaffected here)", () => {
    const content = doc(
      "",
      `## Current State

- Annotated claim with id.
  {src: PR #1; observed: 2026-07-14; conf: high; id: c-abc123}
- Unannotated claim without id.
`,
    );
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const claims = extractClaims(result.newContent);
    expect(claims[0].id).toBe("c-abc123");
    expect(claims[0].status).toBe("annotated");
    expect(claims[1].id).toBeDefined();
    expect(claims[1].status).toBe("unannotated");
  });

  it("is not_applicable (no_unannotated_claims) when every claim already has an id", () => {
    const content = doc(
      "",
      `## Current State

- Claim with id-only annotation.
  {id: c-abc123}
`,
    );
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const outcome = result.outcomes.find((o) => o.code === "mint_claim_ids")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.reason).toBe("no_unannotated_claims");
    expect(result.newContent).toBe(content);
  });

  it("mints against the tree-wide claim id set so it never collides", () => {
    const content = doc("", "## Current State\n\n- A claim.\n");
    // Force collision retries to prove treeClaimIds is actually consulted:
    // can't easily force a *specific* collision without controlling
    // randomness, so instead assert the minted id is never IN the supplied
    // "existing" set for a large synthetic set covering common short ids is
    // impractical; instead verify the id is well-formed and distinct from a
    // pre-seeded id placed in treeClaimIds.
    const seeded = new Set(["c-abc123"]);
    const result = planAnchorMigration(content, makeCtx({ treeClaimIds: seeded }), ["mint_claim_ids"]);
    const claims = extractClaims(result.newContent);
    expect(claims[0].id).not.toBe("c-abc123");
  });
});

describe("planAnchorMigration: byte preservation", () => {
  it("touching only mint_anchor_id leaves the body byte-identical", () => {
    const body = `## Current State

- Some prose that must not change.

## Decisions

- Another line.
`;
    const content = doc("", body);
    const result = planAnchorMigration(content, makeCtx(), ["mint_anchor_id"]);
    expect(result.newContent.endsWith(body)).toBe(true);
  });

  it("mint_claim_ids changes only the inserted annotation lines — every other line is byte-identical and in the same relative order", () => {
    const content = doc(
      "",
      `## Current State

- First claim.
- Second claim.

## Decisions

- A decision.
`,
    );
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const oldLines = content.split("\n");
    const newLines = result.newContent.split("\n");
    const insertedPattern = /^ {2}\{id: c-[0-9a-z]{6,8}\}$/;
    const filteredNewLines = newLines.filter((line) => !insertedPattern.test(line));
    expect(filteredNewLines).toEqual(oldLines);
  });

  it("running every operation with nothing applicable leaves content completely unchanged", () => {
    const content = doc(
      "anchor_id: a-abc123\nschema_version: 1",
      `## Current State

- Claim with id-only annotation.
  {id: c-abc123}
`,
    );
    const result = planAnchorMigration(content, makeCtx(), MIGRATION_OPERATION_CODES);
    expect(result.outcomes.every((o) => o.status === "not_applicable")).toBe(true);
    expect(result.newContent).toBe(content);
  });
});

describe("planAnchorMigration: idempotence", () => {
  it("planning the planned output again yields zero applied operations", () => {
    const content = doc(
      "relations:\n  depends_on:\n    - projects/demo/other.md\n  implements:\n    - G-030",
      `## Current State

- First unannotated claim.
- Second unannotated claim.
`,
    );
    const ctx = makeCtx({
      resolveAnchorName: (value) => (value === "projects/demo/other.md" ? "projects/demo/other.md" : undefined),
      anchorIdForAnchorName: (name) => (name === "projects/demo/other.md" ? "a-target1" : undefined),
      projectsForGoalId: (id) => (id === "G-030" ? ["demo"] : []),
    });

    const first = planAnchorMigration(content, ctx, MIGRATION_OPERATION_CODES);
    expect(first.outcomes.some((o) => o.status === "applied")).toBe(true);

    // Second pass: the minted anchor_id and claim ids must be folded into the
    // tree-wide id sets, exactly as a real service call would after the
    // first apply committed (a fresh planner call re-reads the tree).
    const mintedAnchorId = /anchor_id:\s*(\S+)/.exec(first.newContent)?.[1];
    const claims = extractClaims(first.newContent);
    const ctx2 = makeCtx({
      ...ctx,
      treeAnchorIds: new Set(mintedAnchorId ? [mintedAnchorId] : []),
      treeClaimIds: new Set(claims.map((c) => c.id).filter((id): id is string => Boolean(id))),
    });

    const second = planAnchorMigration(first.newContent, ctx2, MIGRATION_OPERATION_CODES);
    expect(second.outcomes.every((o) => o.status !== "applied")).toBe(true);
    expect(second.newContent).toBe(first.newContent);
  });
});
