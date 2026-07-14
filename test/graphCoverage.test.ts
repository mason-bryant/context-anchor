import { describe, expect, it } from "vitest";

import {
  analyzeCoverage,
  clampCoverageLimit,
  pageCoverageRecords,
  GRAPH_COVERAGE_DEFAULT_LIMIT,
  GRAPH_COVERAGE_MAX_LIMIT,
  type CoverageAnalysisContext,
  type CoverageDocumentInput,
} from "../src/graph/coverage.js";
import { CONTEXT_ROOT_FILE } from "../src/taxonomy.js";

const BASE_FRONTMATTER = {
  type: "context-anchor",
  tags: [],
  summary: "Test anchor.",
  read_this_if: ["Testing coverage analysis."],
  last_validated: "2026-07-13",
};

function makeDoc(overrides: Partial<CoverageDocumentInput> & { anchorName: string }): CoverageDocumentInput {
  return {
    frontmatter: { ...BASE_FRONTMATTER },
    content: "## Current State\n\nNone.\n",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<CoverageAnalysisContext> = {}): CoverageAnalysisContext {
  const anchorNames = overrides.anchorNames ?? new Set<string>();
  return {
    anchorNames,
    resolveAnchorName: (value) => {
      const trimmed = value.trim();
      if (anchorNames.has(trimmed)) return trimmed;
      const withMd = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      return anchorNames.has(withMd) ? withMd : undefined;
    },
    resolveProjectSlug: (slug) => slug.trim() || undefined,
    anchorNamesForAnchorId: () => [],
    knownGoalIds: new Set(),
    personExists: () => false,
    teamExists: () => false,
    ...overrides,
  };
}

describe("analyzeCoverage: state fixtures", () => {
  it("structured: has anchor_id, schema_version, and every relation target typed + resolved", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({
      anchorNames,
      anchorNamesForAnchorId: (id) => (id === "a-target1" ? ["projects/demo/b.md"] : []),
    });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["anchor:a-target1"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0].state).toBe("structured");
    expect(result.anchors[0].reasons).toEqual([]);
  });

  it("partial: graphable but missing anchor_id (mint_anchor_id suggested)", () => {
    const ctx = makeCtx();
    const docs = [makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, schema_version: 1 } })];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("partial");
    expect(result.anchors[0].suggestedOperations).toContainEqual(
      expect.objectContaining({ code: "mint_anchor_id" }),
    );
  });

  it("partial: has anchor_id and schema_version but a legacy bare-string relation target", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({ anchorNames });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["projects/demo/b.md"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("partial");
    // The primary migration case: a REGISTERED key with a legacy bare-string
    // target must carry the actionable convert_relation suggestion.
    expect(result.anchors[0].suggestedOperations).toContainEqual(
      expect.objectContaining({ code: "convert_relation" }),
    );
  });

  it("malformed: a wrong-kind typed target (depends_on -> person:) is never counted as resolved/structured", () => {
    const anchorNames = new Set(["projects/demo/a.md"]);
    const ctx = makeCtx({
      anchorNames,
      // The person genuinely exists — kind-validity, not existence, is what
      // must fail here, exactly like extract.ts's relationTargetKindAllowed
      // gate that refuses the typed edge.
      personExists: (id) => id === "alice",
    });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["person:alice"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("malformed");
    expect(result.anchors[0].reasons).toContainEqual(
      expect.objectContaining({ code: "relation_target_wrong_kind" }),
    );
  });

  it("registered key with only canonical typed targets suggests no convert_relation", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({
      anchorNames,
      anchorNamesForAnchorId: (id) => (id === "a-target1" ? ["projects/demo/b.md"] : []),
    });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["anchor:a-target1"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].suggestedOperations).not.toContainEqual(
      expect.objectContaining({ code: "convert_relation" }),
    );
  });

  it("duplicateAnchorIds findings are sorted by anchorId regardless of document order", () => {
    const ctx = makeCtx();
    const dup = (name: string, anchorId: string) =>
      makeDoc({ anchorName: name, frontmatter: { ...BASE_FRONTMATTER, anchor_id: anchorId } });
    // The z-duplicate pair is encountered first in document order; the
    // findings list must still come back a-first.
    const docs = [
      dup("projects/demo/z1.md", "a-zzz111"),
      dup("projects/demo/z2.md", "a-zzz111"),
      dup("projects/demo/a1.md", "a-aaa111"),
      dup("projects/demo/a2.md", "a-aaa111"),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.duplicateAnchorIds.map((finding) => finding.anchorId)).toEqual(["a-aaa111", "a-zzz111"]);
  });

  it("prose_only: a generated document (e.g. CONTEXT-ROOT.md)", () => {
    const ctx = makeCtx();
    const docs = [makeDoc({ anchorName: CONTEXT_ROOT_FILE, frontmatter: {} })];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("prose_only");
  });

  it("prose_only: a valid anchor with no graph-participating structure beyond discovery fields", () => {
    const ctx = makeCtx();
    const docs = [makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER } })];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("prose_only");
  });

  it("ambiguous: a typed anchor:<anchor-id> target resolves to more than one candidate", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md", "projects/demo/c.md"]);
    const ctx = makeCtx({
      anchorNames,
      anchorNamesForAnchorId: (id) => (id === "a-dup" ? ["projects/demo/b.md", "projects/demo/c.md"] : []),
    });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["anchor:a-dup"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("ambiguous");
    expect(result.anchors[0].reasons).toContainEqual(expect.objectContaining({ code: "relation_target_ambiguous" }));
  });

  it("dangling: a typed relation target resolves to no known node", () => {
    const ctx = makeCtx({ anchorNamesForAnchorId: () => [] });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["anchor:a-ghost1"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("dangling");
    expect(result.anchors[0].reasons).toContainEqual(expect.objectContaining({ code: "relation_target_dangling" }));
  });

  it("dangling: a legacy bare-string relation target that does not resolve to a known anchor", () => {
    const ctx = makeCtx({ anchorNames: new Set(["projects/demo/a.md"]) });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: { depends_on: ["projects/demo/ghost.md"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("dangling");
  });

  it("malformed: front matter fails the universal schema", () => {
    const ctx = makeCtx();
    const docs = [makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { type: "context-anchor" } })]; // missing required fields
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("malformed");
    expect(result.anchors[0].reasons.some((r) => r.code === "front_matter_schema")).toBe(true);
  });

  it("malformed: anchor_id present but invalid format (caught by the universal front-matter schema itself, WP2)", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "not-valid" } }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("malformed");
    expect(result.anchors[0].reasons.some((r) => r.code === "front_matter_schema")).toBe(true);
  });

  it("malformed: schema_version present but invalid (fails schema)", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, schema_version: -1 } }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("malformed");
  });

  it("malformed: a typed relation target present but syntactically unparseable", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: { ...BASE_FRONTMATTER, relations: { implements: ["goal:demo:"] } },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("malformed");
    expect(result.anchors[0].reasons.some((r) => r.code === "relation_target_malformed")).toBe(true);
  });

  it("malformed: duplicate anchor_id across the tree (both owning anchors are malformed)", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-dup123" } }),
      makeDoc({ anchorName: "projects/demo/b.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-dup123" } }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors.map((a) => a.state)).toEqual(["malformed", "malformed"]);
    expect(result.duplicateAnchorIds).toEqual([{ anchorId: "a-dup123", anchorNames: ["projects/demo/a.md", "projects/demo/b.md"] }]);
  });
});

describe("analyzeCoverage: precedence", () => {
  it("malformed wins over dangling when both apply", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "not-valid", // malformed
          relations: { depends_on: ["anchor:a-ghost1"] }, // would also be dangling
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("malformed");
  });

  it("dangling wins over ambiguous when both apply", () => {
    const anchorNames = new Set(["projects/demo/a.md"]);
    const ctx = makeCtx({
      anchorNames,
      anchorNamesForAnchorId: (id) => (id === "a-dup" ? ["projects/demo/b.md", "projects/demo/c.md"] : []),
    });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          schema_version: 1,
          relations: {
            depends_on: ["anchor:a-dup", "anchor:a-ghost1"], // one ambiguous, one dangling
          },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("dangling");
  });

  it("ambiguous wins over partial when both apply", () => {
    const ctx = makeCtx({
      anchorNamesForAnchorId: (id) => (id === "a-dup" ? ["projects/demo/b.md", "projects/demo/c.md"] : []),
    });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        // Missing schema_version (partial-worthy) AND an ambiguous target.
        frontmatter: {
          ...BASE_FRONTMATTER,
          anchor_id: "a-abc123",
          relations: { depends_on: ["anchor:a-dup"] },
        },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.anchors[0].state).toBe("ambiguous");
  });
});

describe("analyzeCoverage: claims", () => {
  it("structured: an annotated claim with an id", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        content: "## Current State\n\n- A claim.\n  {src: PR #1; observed: 2026-07-13; conf: high; id: c-abc123}\n",
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].state).toBe("structured");
    expect(result.claims[0].claimId).toBe("c-abc123");
  });

  it("partial: an id-only claim (WP4) has an id but no provenance", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        content: "## Current State\n\n- A claim.\n  {id: c-abc123}\n",
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.claims[0].state).toBe("partial");
    expect(result.claims[0].claimId).toBe("c-abc123");
  });

  it("partial: a plain unannotated claim with no id at all (mint_claim_id suggested)", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", content: "## Current State\n\n- A plain claim.\n" }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.claims[0].state).toBe("partial");
    expect(result.claims[0].claimId).toBeUndefined();
    expect(result.claims[0].suggestedOperations).toContainEqual(expect.objectContaining({ code: "mint_claim_id" }));
  });

  it("malformed: a claim with conflicting ids across its source rows", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        content:
          "## Current State\n\n- Conflicting claim.\n  {src: a; observed: 2026-07-13; conf: high; id: c-aaaaaa}\n  {src: b; observed: 2026-07-13; conf: high; id: c-bbbbbb}\n",
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.claims[0].state).toBe("malformed");
  });
});

describe("analyzeCoverage: summary-count consistency", () => {
  it("byState counts agree with per-record states", () => {
    const anchorNames = new Set(["projects/demo/a.md", "projects/demo/b.md"]);
    const ctx = makeCtx({ anchorNames });
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-abc123", schema_version: 1 },
      }),
      makeDoc({ anchorName: "projects/demo/b.md", frontmatter: { ...BASE_FRONTMATTER } }),
      makeDoc({ anchorName: CONTEXT_ROOT_FILE, frontmatter: {} }),
    ];
    const result = analyzeCoverage(docs, ctx);
    const countedByState: Record<string, number> = {};
    for (const anchor of result.anchors) {
      countedByState[anchor.state] = (countedByState[anchor.state] ?? 0) + 1;
    }
    for (const state of Object.keys(result.summary.byState) as (keyof typeof result.summary.byState)[]) {
      expect(result.summary.byState[state]).toBe(countedByState[state] ?? 0);
    }
    expect(result.summary.totalAnchors).toBe(result.anchors.length);
    expect(result.summary.totalClaims).toBe(result.claims.length);
  });

  it("byProject counts agree with per-record project slugs and states", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-abc123", schema_version: 1 } }),
      makeDoc({ anchorName: "projects/demo/b.md", frontmatter: { ...BASE_FRONTMATTER } }),
      makeDoc({ anchorName: "projects/other/c.md", frontmatter: { ...BASE_FRONTMATTER } }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.summary.byProject.demo?.structured).toBe(1);
    expect(result.summary.byProject.demo?.prose_only).toBe(1);
    expect(result.summary.byProject.other?.prose_only).toBe(1);
  });

  it("byAnchorType counts agree with front-matter type", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, type: "context-anchor" } }),
      makeDoc({
        anchorName: "projects/demo/milestones/m1.md",
        frontmatter: { ...BASE_FRONTMATTER, type: "project-milestone" },
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.summary.byAnchorType["context-anchor"]?.prose_only).toBe(1);
    expect(result.summary.byAnchorType["project-milestone"]?.prose_only).toBe(1);
  });

  it("duplicateAnchorIdCount agrees with duplicateAnchorIds length", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-dup123" } }),
      makeDoc({ anchorName: "projects/demo/b.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-dup123" } }),
      makeDoc({ anchorName: "projects/demo/c.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-unique1" } }),
    ];
    const result = analyzeCoverage(docs, ctx);
    expect(result.summary.duplicateAnchorIdCount).toBe(result.duplicateAnchorIds.length);
    expect(result.summary.duplicateAnchorIdCount).toBe(1);
  });
});

describe("clampCoverageLimit (Goal 0 Phase 1 WP6)", () => {
  it("defaults when omitted", () => {
    expect(clampCoverageLimit(undefined)).toBe(GRAPH_COVERAGE_DEFAULT_LIMIT);
  });

  it("clamps to the max", () => {
    expect(clampCoverageLimit(10000)).toBe(GRAPH_COVERAGE_MAX_LIMIT);
  });

  it("clamps to a minimum of 1", () => {
    expect(clampCoverageLimit(0)).toBe(1);
    expect(clampCoverageLimit(-5)).toBe(1);
  });

  it("floors a fractional value", () => {
    expect(clampCoverageLimit(4.9)).toBe(4);
  });
});

describe("pageCoverageRecords (Goal 0 Phase 1 WP6)", () => {
  function buildManyAnchorsResult(count: number) {
    const ctx = makeCtx();
    const docs = Array.from({ length: count }, (_, index) =>
      makeDoc({
        anchorName: `projects/demo/anchor-${String(index).padStart(3, "0")}.md`,
        frontmatter: { ...BASE_FRONTMATTER },
      }),
    );
    return analyzeCoverage(docs, ctx);
  }

  it("never returns more than the clamped limit", () => {
    const result = buildManyAnchorsResult(10);
    const page = pageCoverageRecords(result, { limit: 3 });
    expect(page.records.length).toBe(3);
    expect(page.limit).toBe(3);
    expect(page.totalMatching).toBe(10);
    expect(page.nextCursor).toBeDefined();
  });

  it("defaults to GRAPH_COVERAGE_DEFAULT_LIMIT when no limit is given, never the unbounded set", () => {
    const result = buildManyAnchorsResult(GRAPH_COVERAGE_DEFAULT_LIMIT + 50);
    const page = pageCoverageRecords(result, {});
    expect(page.records.length).toBe(GRAPH_COVERAGE_DEFAULT_LIMIT);
    expect(page.totalMatching).toBe(GRAPH_COVERAGE_DEFAULT_LIMIT + 50);
  });

  it("pages through the full set via nextCursor with no gaps or duplicates", () => {
    const result = buildManyAnchorsResult(25);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let iterations = 0;
    for (;;) {
      const page = pageCoverageRecords(result, { limit: 7, cursor });
      for (const record of page.records) {
        const key = `${record.kind}:${record.anchorName}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
      iterations += 1;
      expect(iterations).toBeLessThan(20); // guard against an infinite loop bug
    }
    expect(seen.size).toBe(25);
  });

  it("filters by state before paginating, and totalMatching reflects the filtered count", () => {
    const anchorNames = new Set(["projects/demo/a.md"]);
    const ctx = makeCtx({ anchorNames });
    const docs = [
      makeDoc({ anchorName: "projects/demo/a.md", frontmatter: { ...BASE_FRONTMATTER, anchor_id: "a-abc123", schema_version: 1 } }),
      makeDoc({ anchorName: "projects/demo/b.md", frontmatter: { ...BASE_FRONTMATTER } }),
    ];
    const result = analyzeCoverage(docs, ctx);
    const page = pageCoverageRecords(result, { states: ["structured"] });
    expect(page.records.every((record) => record.state === "structured")).toBe(true);
    expect(page.totalMatching).toBe(1);
  });

  it("includes both anchor and claim records, distinguishable by kind", () => {
    const ctx = makeCtx();
    const docs = [
      makeDoc({
        anchorName: "projects/demo/a.md",
        content: "## Current State\n\n- A claim.\n  {id: c-abc123}\n",
      }),
    ];
    const result = analyzeCoverage(docs, ctx);
    const page = pageCoverageRecords(result, {});
    const kinds = new Set(page.records.map((record) => record.kind));
    expect(kinds.has("anchor")).toBe(true);
    expect(kinds.has("claim")).toBe(true);
  });

  it("has no nextCursor when the page reaches the end", () => {
    const result = buildManyAnchorsResult(3);
    const page = pageCoverageRecords(result, { limit: 100 });
    expect(page.records.length).toBe(3);
    expect(page.nextCursor).toBeUndefined();
  });
});
