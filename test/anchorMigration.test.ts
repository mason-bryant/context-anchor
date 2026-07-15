import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  planAnchorMigration,
  MIGRATION_OPERATION_CODES,
  type AnchorMigrationContext,
} from "../src/migration/anchorMigration.js";
import { extractClaims } from "../src/claims.js";
import { isValidAnchorId } from "../src/graph/identity.js";
import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";

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

  it("treats an INVALID schema_version as absent and replaces it with 1 (matching writeAnchor's create-path policy)", () => {
    const content = doc("schema_version: 0", "## Current State\n\nNone.\n");
    const result = planAnchorMigration(content, makeCtx(), ["add_schema_version"]);
    const outcome = result.outcomes.find((o) => o.code === "add_schema_version")!;
    expect(outcome.status).toBe("applied");
    expect(result.newContent).toMatch(/schema_version:\s*1\b/);
    expect(result.newContent).not.toMatch(/schema_version:\s*0/);

    const nonNumeric = doc("schema_version: abc", "## Current State\n\nNone.\n");
    const nonNumericResult = planAnchorMigration(nonNumeric, makeCtx(), ["add_schema_version"]);
    expect(nonNumericResult.outcomes.find((o) => o.code === "add_schema_version")!.status).toBe("applied");
    expect(nonNumericResult.newContent).toMatch(/schema_version:\s*1\b/);
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
    // At-least-one contract: a requested per-target operation with no
    // matching relation arrays reports a single no_relation_targets
    // not_applicable outcome, never silence.
    const outcomes = result.outcomes.filter((o) => o.code === "convert_relation");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("not_applicable");
    expect(outcomes[0].reason).toBe("no_relation_targets");
    expect(result.newContent).toContain("G-030");
  });

  it("leaves a legacy owned_by (person/team) target untouched — no operation in this slice converts person/team-targeted keys", () => {
    const content = doc(
      "relations:\n  owned_by:\n    - alice",
      "## Current State\n\nNone.\n",
    );
    const ctx = makeCtx({ resolveAnchorName: () => undefined, anchorIdForAnchorName: () => undefined });
    const result = planAnchorMigration(content, ctx, ["convert_relation", "scope_goal_reference"]);
    const perTarget = result.outcomes.filter(
      (o) => o.code === "convert_relation" || o.code === "scope_goal_reference",
    );
    // owned_by is neither anchor- nor goal-targeted, so both requested
    // operations report the at-least-one no_relation_targets filler.
    expect(perTarget).toHaveLength(2);
    expect(perTarget.every((o) => o.status === "not_applicable" && o.reason === "no_relation_targets")).toBe(true);
    expect(result.newContent).toContain("owned_by:\n    - alice");
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

  it("preserves CRLF line endings byte-for-byte (inserted annotation lines adopt CRLF too)", () => {
    const lfContent = doc("", "## Current State\n\n- A claim needing an id.\n");
    const crlfContent = lfContent.replace(/\n/g, "\r\n");
    const result = planAnchorMigration(crlfContent, makeCtx(), ["mint_claim_ids"]);
    const outcome = result.outcomes.find((o) => o.code === "mint_claim_ids")!;
    expect(outcome.status).toBe("applied");

    // No LF-only line endings anywhere: every "\n" is preceded by "\r".
    expect(result.newContent.replace(/\r\n/g, "")).not.toContain("\n");
    // The inserted annotation line is CRLF-terminated like the rest.
    expect(result.newContent).toMatch(/\r\n {2}\{id: c-[0-9a-z]{6,8}\}\r\n/);
    // Removing the inserted line restores the original bytes exactly.
    const withoutInserted = result.newContent.replace(/ {2}\{id: c-[0-9a-z]{6,8}\}\r\n/, "");
    expect(withoutInserted).toBe(crlfContent);
  });

  it("never adds an id-only row to an ANNOTATED claim lacking an id (that is mintMissingClaimIds' job on write)", () => {
    const content = doc(
      "",
      `## Current State

- Annotated claim WITHOUT an id.
  {src: PR #2; observed: 2026-07-14; conf: high}
`,
    );
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const outcome = result.outcomes.find((o) => o.code === "mint_claim_ids")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.reason).toBe("no_unannotated_claims");
    // Byte-identical: the annotated claim's id comes from the ordinary
    // write path minting onto its source row, never from an id-only row
    // that would mark a provenance-bearing claim as provenanceless.
    expect(result.newContent).toBe(content);
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

  it("inserts the id-only annotation correctly when a claim bullet is immediately followed by the next H2 heading (no blank line)", () => {
    const content = doc(
      "",
      `## Current State

- Claim directly before the next heading.
## Decisions

- A decision.
`,
    );
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const lines = result.newContent.split("\n");
    const bulletIndex = lines.findIndex((line) => line === "- Claim directly before the next heading.");
    expect(lines[bulletIndex + 1]).toMatch(/^ {2}\{id: c-[0-9a-z]{6,8}\}$/);
    expect(lines[bulletIndex + 2]).toBe("## Decisions");

    // Round-trips cleanly: extractClaims still finds exactly two claims and
    // does not fold the heading into the first claim's annotation block.
    const claims = extractClaims(result.newContent);
    expect(claims).toHaveLength(2);
    expect(claims[0].id).toBeDefined();
    expect(claims[0].section).toBe("Current State");
    expect(claims[1].section).toBe("Decisions");
  });

  it("inserts the id-only annotation correctly when the claim bullet is the very last line of the file", () => {
    const content = doc("", "## Current State\n\n- Last line claim.");
    const result = planAnchorMigration(content, makeCtx(), ["mint_claim_ids"]);
    const claims = extractClaims(result.newContent);
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBeDefined();
    expect(result.newContent.endsWith("}")).toBe(true);
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
    // Both convert_relation (anchor-targeted depends_on) and
    // scope_goal_reference (goal-targeted implements) touch the same
    // `relations` front-matter object in one merge call — assert both land
    // simultaneously without either clobbering the other.
    expect(first.newContent).toContain("anchor:a-target1");
    expect(first.newContent).toContain("goal:demo:G-030");
    expect(first.newContent).not.toContain("projects/demo/other.md");
    expect(first.newContent).not.toMatch(/implements:\s*\n\s*- G-030/);

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

// ---------------------------------------------------------------------------
// Service-level integration tests (Goal 0 Phase 2 slice 2): previewAnchorMigration
// / applyAnchorMigration wired through AnchorService against a real repo,
// exercising writeAnchor's write lock, validators, stale_base, and approval
// gate exactly as the plan's "apply funnels through writeAnchor" decision
// requires.
// ---------------------------------------------------------------------------

const TARGET_ANCHOR = `---
project:
  - demo
type: context-anchor
tags: []
summary: Migration target anchor already carrying an anchor_id.
read_this_if:
  - Testing anchor migration.
last_validated: 2026-07-07
anchor_id: a-target1
schema_version: 1
---

# Target Anchor

## Current State

None.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

const LEGACY_ANCHOR = `---
project:
  - demo
type: context-anchor
tags: []
summary: Legacy anchor with no anchor_id, schema_version, or typed relations.
read_this_if:
  - Testing anchor migration.
last_validated: 2026-07-07
relations:
  depends_on:
    - projects/demo/target.md
  implements:
    - G-001
---

# Legacy Anchor

## Current State

- An unannotated legacy claim.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

const ROADMAP = `---
project:
  - demo
type: project-roadmap
tags: []
summary: Demo roadmap.
read_this_if:
  - Testing anchor migration.
last_validated: 2026-07-07
---

# Demo Roadmap

## Goals

### Goal G-001 -- Ship the thing

Some description.
`;

// Deliberately narrower than LEGACY_ANCHOR: only a legacy depends_on target
// (no goal-targeted relation) so its pre-migration graphCoverage state is
// cleanly "partial" rather than "dangling" — coverage.ts's Phase 1 relation
// analysis resolves ANY legacy relation target via resolveAnchorName
// (anchor-name resolution only), so a bare goal id under `implements` is
// "dangling" pre-migration regardless of this slice's work; that is existing
// Phase 1 behavior, not something this fixture should exercise here.
const PARTIAL_ANCHOR = `---
project:
  - demo
type: context-anchor
tags: []
summary: Anchor with a legacy depends_on target only, no goal relation.
read_this_if:
  - Testing anchor migration.
last_validated: 2026-07-07
relations:
  depends_on:
    - projects/demo/target.md
---

# Partial Anchor

## Current State

None.

## Decisions

None.

## Constraints

None.

## PRs

None.
`;

let tmpDir: string;
let repo: AnchorRepository;
let service: AnchorService;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-migration-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function seedMigrationRepo(): Promise<void> {
  await repo.commitAnchor({ name: "projects/demo/target.md", content: TARGET_ANCHOR });
  await repo.commitAnchor({ name: "projects/demo/legacy.md", content: LEGACY_ANCHOR });
  await repo.commitAnchor({ name: "projects/demo/demo-roadmap.md", content: ROADMAP });
}

describe("AnchorService.previewAnchorMigration / applyAnchorMigration (Goal 0 Phase 2 slice 2)", () => {
  it("previews every applicable operation without mutating the anchor", async () => {
    await seedMigrationRepo();
    const before = await service.readAnchor("projects/demo/legacy.md");

    const preview = await service.previewAnchorMigration({ name: "projects/demo/legacy.md" });

    expect(preview.changed).toBe(true);
    expect(preview.outcomes.map((o) => o.code).sort()).toEqual(
      [...MIGRATION_OPERATION_CODES].sort(),
    );
    expect(preview.outcomes.every((o) => o.status !== "skipped" || o.reason)).toBe(true);
    expect(preview.newContent).toContain("anchor_id: a-");
    expect(preview.newContent).toContain("schema_version: 1");
    expect(preview.newContent).toContain("anchor:a-target1");
    expect(preview.newContent).toContain("goal:demo:G-001");
    expect(preview.diff).toContain("@@");

    // Preview never mutates.
    const after = await service.readAnchor("projects/demo/legacy.md");
    expect(after.content).toBe(before.content);
    expect(after.fileCommit).toBe(before.fileCommit);
  });

  it("deterministic-only operations match preview bytes WITHOUT the cache (add_schema_version re-plans identically)", async () => {
    await seedMigrationRepo();
    const preview = await service.previewAnchorMigration({
      name: "projects/demo/legacy.md",
      operations: ["add_schema_version"],
    });
    expect(preview.changed).toBe(true);

    const applied = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: preview.fileCommit,
      operations: ["add_schema_version"],
    });
    expect(applied.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);

    // Deterministic operations reproduce the preview's bytes by re-planning
    // alone — the preview cache deliberately skips them (it exists only for
    // random-mint reproducibility).
    const committed = await service.readAnchor("projects/demo/legacy.md");
    expect(committed.content).toBe(preview.newContent);
  });

  it("apply hits the preview cache even when operations are reordered and duplicated (operation SET semantics)", async () => {
    await seedMigrationRepo();
    const preview = await service.previewAnchorMigration({
      name: "projects/demo/legacy.md",
      operations: ["mint_anchor_id", "mint_claim_ids"],
    });

    const applied = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: preview.fileCommit,
      // Same SET, different order, with a duplicate — must still commit the
      // preview's exact bytes rather than re-planning with fresh mints.
      operations: ["mint_claim_ids", "mint_anchor_id", "mint_claim_ids"],
    });
    expect(applied.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);

    const committed = await service.readAnchor("projects/demo/legacy.md");
    expect(committed.content).toBe(preview.newContent);
  });

  it("apply commits content byte-identical to the most recent preview for the same fileCommit", async () => {
    await seedMigrationRepo();
    const preview = await service.previewAnchorMigration({ name: "projects/demo/legacy.md" });

    const applied = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: preview.fileCommit,
    });

    expect(applied.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(applied.version).toBeTruthy();
    expect(applied.noChangesNeeded).toBe(false);

    const committed = await service.readAnchor("projects/demo/legacy.md");
    expect(committed.content).toBe(preview.newContent);
  });

  it("rejects apply with stale_base when expectedFileCommit does not match the current commit", async () => {
    await seedMigrationRepo();
    const preview = await service.previewAnchorMigration({ name: "projects/demo/legacy.md" });

    // Advance the anchor out from under the preview.
    const current = await service.readAnchor("projects/demo/legacy.md");
    await service.writeAnchor({
      name: "projects/demo/legacy.md",
      content: current.content.replace("last_validated: 2026-07-07", "last_validated: 2026-07-08"),
      approved: true,
      expectedFileCommit: current.fileCommit,
    });

    const applied = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: preview.fileCommit,
    });

    expect(applied.warnings.some((w) => w.code === "stale_base" && w.severity === "BLOCK")).toBe(true);
    expect(applied.version).toBeUndefined();
  });

  it("requires approved: true — an unapproved apply is BLOCKed at the migration boundary itself", async () => {
    await seedMigrationRepo();
    const preview = await service.previewAnchorMigration({ name: "projects/demo/legacy.md" });
    const applied = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: false,
      expectedFileCommit: preview.fileCommit,
    });
    expect(applied.requiresApproval).toBe(true);
    expect(applied.version).toBeUndefined();
    expect(applied.warnings.some((w) => w.severity === "BLOCK" && w.code === "requires_approval")).toBe(true);

    const after = await service.readAnchor("projects/demo/legacy.md");
    expect(after.fileCommit).toBe(preview.fileCommit);
  });

  it("requires expectedFileCommit — apply without a named base revision is BLOCKed", async () => {
    await seedMigrationRepo();
    const applied = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
    });
    expect(applied.version).toBeUndefined();
    expect(applied.warnings.some((w) => w.severity === "BLOCK" && w.code === "expected_file_commit_required")).toBe(
      true,
    );
  });

  it("apply with no applicable operations is a no-op success, not an error (idempotence)", async () => {
    await seedMigrationRepo();
    const base = await service.readAnchor("projects/demo/legacy.md");
    const first = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: base.fileCommit,
    });
    expect(first.noChangesNeeded).toBe(false);
    expect(first.version).toBeTruthy();

    const committedAfterFirst = await service.readAnchor("projects/demo/legacy.md");

    const second = await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: committedAfterFirst.fileCommit,
    });
    expect(second.noChangesNeeded).toBe(true);
    expect(second.version).toBeUndefined();
    expect(second.warnings).toEqual([]);
    expect(second.outcomes.every((o) => o.status !== "applied")).toBe(true);

    // No second commit was made: the anchor's fileCommit is unchanged.
    const committedAfterSecond = await service.readAnchor("projects/demo/legacy.md");
    expect(committedAfterSecond.fileCommit).toBe(committedAfterFirst.fileCommit);
  });

  it("second preview after apply reports nothing applicable", async () => {
    await seedMigrationRepo();
    const base = await service.readAnchor("projects/demo/legacy.md");
    await service.applyAnchorMigration({
      name: "projects/demo/legacy.md",
      approved: true,
      expectedFileCommit: base.fileCommit,
    });

    const secondPreview = await service.previewAnchorMigration({ name: "projects/demo/legacy.md" });
    expect(secondPreview.changed).toBe(false);
    expect(secondPreview.outcomes.every((o) => o.status !== "applied")).toBe(true);
    expect(secondPreview.diff).toBe("");
  });

  it("a migrated fixture's coverage state improves from partial to structured through the real graphCoverage path (closes the loop)", async () => {
    await repo.commitAnchor({ name: "projects/demo/target.md", content: TARGET_ANCHOR });
    await repo.commitAnchor({ name: "projects/demo/partial.md", content: PARTIAL_ANCHOR });

    const beforeCoverage = await service.graphCoverage({ project: "demo" });
    const beforeRecord = beforeCoverage.records.find(
      (r) => r.kind === "anchor" && r.anchorName === "projects/demo/partial.md",
    );
    expect(beforeRecord?.state).toBe("partial");

    const base = await service.readAnchor("projects/demo/partial.md");
    await service.applyAnchorMigration({
      name: "projects/demo/partial.md",
      approved: true,
      expectedFileCommit: base.fileCommit,
    });

    const afterCoverage = await service.graphCoverage({ project: "demo" });
    const afterRecord = afterCoverage.records.find(
      (r) => r.kind === "anchor" && r.anchorName === "projects/demo/partial.md",
    );
    expect(afterRecord?.state).toBe("structured");
  });

  it("supports requesting a subset of operations", async () => {
    await seedMigrationRepo();
    const preview = await service.previewAnchorMigration({
      name: "projects/demo/legacy.md",
      operations: ["mint_anchor_id"],
    });
    expect(preview.outcomes).toHaveLength(1);
    expect(preview.outcomes[0].code).toBe("mint_anchor_id");
    expect(preview.newContent).not.toContain("schema_version: 1");
    expect(preview.newContent).toContain("depends_on:\n    - projects/demo/target.md");
  });
});
