import { describe, expect, it } from "vitest";

import {
  DEFAULT_CERTAINTY_CONFIG,
  ageDays,
  decay,
  effectiveCertainty,
  halfLifeForCategory,
  liveness,
  weakestAncestorCertainty,
  type CertaintyConfig,
  type LivenessInput,
} from "../src/certainty.js";
import type { ClaimAnnotation, ClaimSource } from "../src/claims.js";

const NOW = new Date("2026-07-10T00:00:00Z");

function source(overrides: Partial<ClaimAnnotation> = {}): ClaimSource {
  return {
    src: "PR #1",
    observed: "2026-07-10",
    conf: "high",
    ...overrides,
  };
}

const ALWAYS_LIVE: (source: ClaimSource) => LivenessInput = () => ({});

describe("ageDays", () => {
  it("is zero for a same-day observation", () => {
    expect(ageDays("2026-07-10", NOW)).toBe(0);
  });

  it("counts whole days between observed and now", () => {
    expect(ageDays("2026-06-10", NOW)).toBe(30);
  });

  it("never goes negative for a future-dated observation", () => {
    expect(ageDays("2026-08-10", NOW)).toBe(0);
  });

  it("returns 0 for an unparseable date rather than throwing", () => {
    expect(ageDays("not-a-date", NOW)).toBe(0);
  });
});

describe("decay", () => {
  it("is 1.0 at age zero", () => {
    expect(decay(0, 60)).toBe(1);
  });

  it("is 0.5 at exactly one half-life", () => {
    expect(decay(60, 60)).toBeCloseTo(0.5, 10);
  });

  it("is 0.25 at two half-lives", () => {
    expect(decay(120, 60)).toBeCloseTo(0.25, 10);
  });

  it("treats a non-positive half-life as an immediate cliff", () => {
    expect(decay(0, 0)).toBe(1);
    expect(decay(1, 0)).toBe(0);
    expect(decay(1, -5)).toBe(0);
  });
});

describe("halfLifeForCategory", () => {
  it("resolves each configured category", () => {
    expect(halfLifeForCategory("agent-rules", DEFAULT_CERTAINTY_CONFIG)).toBe(180);
    expect(halfLifeForCategory("projects", DEFAULT_CERTAINTY_CONFIG)).toBe(60);
    expect(halfLifeForCategory("milestones", DEFAULT_CERTAINTY_CONFIG)).toBe(45);
  });

  it("falls back to defaultHalfLifeDays for an unclassified category", () => {
    expect(halfLifeForCategory(undefined, DEFAULT_CERTAINTY_CONFIG)).toBe(DEFAULT_CERTAINTY_CONFIG.defaultHalfLifeDays);
  });
});

describe("liveness", () => {
  it("is live (1.0) for a pr node regardless of dangling flag (no network check)", () => {
    expect(liveness({ node: { nodeId: "pr:demo#1", type: "pr" } }, {})).toBe(1);
  });

  it("is live (1.0) for a url node (no network check)", () => {
    expect(liveness({ node: { nodeId: "url:https://example.com/", type: "url" } }, {})).toBe(1);
  });

  it("is live (1.0) for a person node", () => {
    expect(liveness({ node: { nodeId: "person:alice", type: "person" } }, {})).toBe(1);
  });

  it("is live for a row with no classifiable node (e.g. bare trust-me-bro)", () => {
    expect(liveness({}, {})).toBe(1);
  });

  it("is live for an anchor node when parseClaimSource did not flag it dangling", () => {
    expect(liveness({ node: { nodeId: "anchor:demo.md", type: "anchor" } }, {})).toBe(1);
  });

  it("is dead (0) for an anchor node flagged dangling", () => {
    expect(liveness({ node: { nodeId: "anchor:demo.md", type: "anchor" }, dangling: true }, {})).toBe(0);
  });

  it("is live for a section node when not flagged dangling", () => {
    expect(liveness({ node: { nodeId: "section:demo.md#Decisions", type: "section" } }, {})).toBe(1);
  });

  it("is dead (0) for a section node flagged dangling", () => {
    expect(liveness({ node: { nodeId: "section:demo.md#Ghost", type: "section" }, dangling: true }, {})).toBe(0);
  });

  it("defaults a file node to live when the caller cannot check a local checkout", () => {
    expect(liveness({ node: { nodeId: "file:demo:src/x.ts", type: "file" } }, {})).toBe(1);
  });

  it("defaults a file node to live when fileExistsLocally returns undefined (cannot determine)", () => {
    expect(
      liveness(
        { node: { nodeId: "file:demo:src/x.ts", type: "file" } },
        { fileExistsLocally: () => undefined },
      ),
    ).toBe(1);
  });

  it("is live for a file node the caller confirms exists locally", () => {
    expect(
      liveness({ node: { nodeId: "file:demo:src/x.ts", type: "file" } }, { fileExistsLocally: () => true }),
    ).toBe(1);
  });

  it("is dead (0) for a file node the caller confirms does NOT exist locally", () => {
    expect(
      liveness({ node: { nodeId: "file:demo:src/x.ts", type: "file" } }, { fileExistsLocally: () => false }),
    ).toBe(0);
  });
});

describe("effectiveCertainty — per-row factor math", () => {
  it("reproduces a single high-confidence, same-day, live row by hand", () => {
    const claim = { sources: [source({ conf: "high", observed: "2026-07-10" })] };
    const result = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 60, ALWAYS_LIVE, {});
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.base).toBe(0.9);
    expect(row.ageDays).toBe(0);
    expect(row.decay).toBe(1);
    expect(row.liveness).toBe(1);
    expect(row.value).toBeCloseTo(0.9, 10);
    expect(result.certainty).toBeCloseTo(0.9, 10);
    // Reproducible by hand: base x decay x liveness.
    expect(row.value).toBeCloseTo(row.base * row.decay * row.liveness, 10);
  });

  it("reproduces a medium-confidence row decayed by exactly one half-life", () => {
    const claim = { sources: [source({ conf: "medium", observed: "2026-05-11" })] }; // 60 days before NOW
    const result = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 60, ALWAYS_LIVE, {});
    const row = result.rows[0];
    expect(row.ageDays).toBe(60);
    expect(row.base).toBe(0.6);
    expect(row.decay).toBeCloseTo(0.5, 10);
    expect(row.value).toBeCloseTo(0.3, 10);
  });

  it("zeroes a row's value when liveness is 0 (dangling source)", () => {
    const claim = { sources: [source({ conf: "high", observed: "2026-07-10" })] };
    const dangling: (s: ClaimSource) => LivenessInput = () => ({
      node: { nodeId: "anchor:ghost.md", type: "anchor" },
      dangling: true,
    });
    const result = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 60, dangling, {});
    expect(result.rows[0].liveness).toBe(0);
    expect(result.rows[0].value).toBe(0);
    expect(result.certainty).toBe(0);
  });

  it("returns certainty 0 with no rows for a claim with no sources", () => {
    const result = effectiveCertainty({ sources: [] }, NOW, DEFAULT_CERTAINTY_CONFIG, 60, ALWAYS_LIVE, {});
    expect(result.certainty).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it("carries the source row's line number into the factor set when present", () => {
    const claim = { sources: [{ ...source(), line: 12 }] };
    const result = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 60, ALWAYS_LIVE, {});
    expect(result.rows[0].line).toBe(12);
  });
});

describe("effectiveCertainty — average aggregation (decision gate D2)", () => {
  it("averages two same-strength live rows to their common value", () => {
    const claim = {
      sources: [
        source({ conf: "high", observed: "2026-07-10" }),
        source({ conf: "high", observed: "2026-07-10", src: "PR #2" }),
      ],
    };
    const result = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 60, ALWAYS_LIVE, {});
    expect(result.aggregation).toBe("average");
    expect(result.certainty).toBeCloseTo(0.9, 10);
  });

  it("a weak corroborating source LOWERS the average (not max — this is the D2 contract)", () => {
    const strongOnly = effectiveCertainty(
      { sources: [source({ conf: "high", observed: "2026-07-10" })] },
      NOW,
      DEFAULT_CERTAINTY_CONFIG,
      60,
      ALWAYS_LIVE,
      {},
    );
    const strongPlusWeak = effectiveCertainty(
      {
        sources: [
          source({ conf: "high", observed: "2026-07-10" }),
          source({ conf: "low", observed: "2026-07-10", src: "PR #2" }),
        ],
      },
      NOW,
      DEFAULT_CERTAINTY_CONFIG,
      60,
      ALWAYS_LIVE,
      {},
    );
    expect(strongPlusWeak.certainty).toBeLessThan(strongOnly.certainty);
    // Explicit average, not max: (0.9 + 0.3) / 2 = 0.6, not 0.9.
    expect(strongPlusWeak.certainty).toBeCloseTo(0.6, 10);
  });

  it("aggregate is reproducible by hand as the mean of row values", () => {
    const claim = {
      sources: [
        source({ conf: "high", observed: "2026-07-10" }),
        source({ conf: "medium", observed: "2026-05-11", src: "PR #2" }), // 60d decay
        source({ conf: "low", observed: "2026-06-10", src: "PR #3" }),
      ],
    };
    const result = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 60, ALWAYS_LIVE, {});
    const manualMean = result.rows.reduce((sum, row) => sum + row.value, 0) / result.rows.length;
    expect(result.certainty).toBeCloseTo(manualMean, 10);
  });
});

describe("effectiveCertainty — half-life config override", () => {
  it("a shorter half-life decays faster for the same age", () => {
    const claim = { sources: [source({ conf: "high", observed: "2026-05-11" })] }; // 60 days old
    const longHalfLife = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 180, ALWAYS_LIVE, {});
    const shortHalfLife = effectiveCertainty(claim, NOW, DEFAULT_CERTAINTY_CONFIG, 45, ALWAYS_LIVE, {});
    expect(shortHalfLife.certainty).toBeLessThan(longHalfLife.certainty);
  });

  it("a custom config's base/threshold values flow through", () => {
    const customConfig: CertaintyConfig = {
      base: { high: 1, medium: 0.5, low: 0.1 },
      halfLifeDays: { "agent-rules": 10, projects: 10, milestones: 10 },
      defaultHalfLifeDays: 10,
      missingContextThreshold: 0.9,
    };
    const claim = { sources: [source({ conf: "high", observed: "2026-07-10" })] };
    const result = effectiveCertainty(claim, NOW, customConfig, 10, ALWAYS_LIVE, {});
    expect(result.rows[0].base).toBe(1);
    expect(result.certainty).toBeCloseTo(1, 10);
  });
});

describe("weakestAncestorCertainty", () => {
  it("degrades to the origin claim itself when there are no derived_from edges (pre-WP5 state)", async () => {
    const result = await weakestAncestorCertainty("claim:demo.md#c-aaa111", 0.7, () => []);
    expect(result).toEqual({ claim: "claim:demo.md#c-aaa111", certainty: 0.7, path: ["claim:demo.md#c-aaa111"] });
  });

  it("finds a single weaker ancestor one hop away", async () => {
    const lookup = (claimLabel: string) => {
      if (claimLabel === "claim:a.md#c-1") {
        return [{ claim: "claim:b.md#c-2", certainty: 0.3 }];
      }
      return [];
    };
    const result = await weakestAncestorCertainty("claim:a.md#c-1", 0.9, lookup);
    expect(result.claim).toBe("claim:b.md#c-2");
    expect(result.certainty).toBe(0.3);
    expect(result.path).toEqual(["claim:a.md#c-1", "claim:b.md#c-2"]);
  });

  it("never blends: the weakest ancestor is a separate flag, and the origin's own certainty is untouched by the traversal", async () => {
    const lookup = (claimLabel: string) => {
      if (claimLabel === "claim:a.md#c-1") {
        return [{ claim: "claim:b.md#c-2", certainty: 0.1 }];
      }
      return [];
    };
    const originCertainty = 0.9;
    const result = await weakestAncestorCertainty("claim:a.md#c-1", originCertainty, lookup);
    // The origin's own score (as passed in) never changes — weakestAncestor
    // is reported beside it, never folded into a blended number.
    expect(originCertainty).toBe(0.9);
    expect(result.certainty).toBe(0.1);
  });

  it("walks a multi-hop chain to the globally weakest ancestor", async () => {
    const edges: Record<string, { claim: string; certainty: number }[]> = {
      "claim:a.md#c-1": [{ claim: "claim:b.md#c-2", certainty: 0.5 }],
      "claim:b.md#c-2": [{ claim: "claim:c.md#c-3", certainty: 0.1 }],
      "claim:c.md#c-3": [],
    };
    const result = await weakestAncestorCertainty("claim:a.md#c-1", 0.9, (claim) => edges[claim] ?? []);
    expect(result.claim).toBe("claim:c.md#c-3");
    expect(result.certainty).toBe(0.1);
    expect(result.path).toEqual(["claim:a.md#c-1", "claim:b.md#c-2", "claim:c.md#c-3"]);
  });

  it("guards against cycles instead of looping forever", async () => {
    const edges: Record<string, { claim: string; certainty: number }[]> = {
      "claim:a.md#c-1": [{ claim: "claim:b.md#c-2", certainty: 0.5 }],
      "claim:b.md#c-2": [{ claim: "claim:a.md#c-1", certainty: 0.9 }], // cycle back to origin
    };
    const result = await weakestAncestorCertainty("claim:a.md#c-1", 0.9, (claim) => edges[claim] ?? []);
    // Terminates and finds the one real ancestor without infinite-looping.
    expect(result.claim).toBe("claim:b.md#c-2");
    expect(result.certainty).toBe(0.5);
  });

  it("guards against a longer cycle that revisits an interior node", async () => {
    const edges: Record<string, { claim: string; certainty: number }[]> = {
      "claim:a.md#c-1": [{ claim: "claim:b.md#c-2", certainty: 0.6 }],
      "claim:b.md#c-2": [{ claim: "claim:c.md#c-3", certainty: 0.2 }],
      "claim:c.md#c-3": [{ claim: "claim:b.md#c-2", certainty: 0.6 }], // cycles back to b
    };
    const result = await weakestAncestorCertainty("claim:a.md#c-1", 0.9, (claim) => edges[claim] ?? []);
    expect(result.claim).toBe("claim:c.md#c-3");
    expect(result.certainty).toBe(0.2);
  });

  it("finds the shortest path to the weakest ancestor when multiple paths reach it", async () => {
    // a -> b (0.5), a -> c (0.5) -> d (0.1), b -> d (0.1): d reachable via both
    // a->c->d (2 hops) and a->b->d (2 hops) — BFS visits first-seen, path length 3 either way.
    const edges: Record<string, { claim: string; certainty: number }[]> = {
      "claim:a.md#c-1": [
        { claim: "claim:b.md#c-2", certainty: 0.5 },
        { claim: "claim:c.md#c-3", certainty: 0.5 },
      ],
      "claim:b.md#c-2": [{ claim: "claim:d.md#c-4", certainty: 0.1 }],
      "claim:c.md#c-3": [],
    };
    const result = await weakestAncestorCertainty("claim:a.md#c-1", 0.9, (claim) => edges[claim] ?? []);
    expect(result.claim).toBe("claim:d.md#c-4");
    expect(result.certainty).toBe(0.1);
    expect(result.path).toEqual(["claim:a.md#c-1", "claim:b.md#c-2", "claim:d.md#c-4"]);
  });

  it("supports a synchronous lookup callback (not just async)", async () => {
    const result = await weakestAncestorCertainty("claim:a.md#c-1", 0.9, () => [
      { claim: "claim:b.md#c-2", certainty: 0.2 },
    ]);
    expect(result.certainty).toBe(0.2);
  });
});
