import { describe, expect, it, vi } from "vitest";

import {
  assertRankerContract,
  defaultRanker,
  rankWithFallback,
  RankerContractError,
  type MatchSignal,
  type RankedRoute,
  type Ranker,
  type RouteCandidate,
} from "../../src/db/routing/ranker.js";

function candidate(
  slug: string,
  signals: MatchSignal["kind"][],
  overrides: Partial<RouteCandidate> = {},
): RouteCandidate {
  return {
    routeKey: `scope:${overrides.scopeKind ?? "domain"}:${slug}`,
    scopeGuid: `guid-${slug}`,
    scopeSlug: slug,
    scopeKind: "domain",
    title: slug,
    signals: signals.map((kind) => ({ kind, reason: `${kind} matched` })),
    recordCount: 1,
    ...overrides,
  };
}

const rank = async (candidates: RouteCandidate[]): Promise<string[]> =>
  (await defaultRanker.rank(candidates)).map((route) => route.scopeSlug);

describe("default ranker ordering", () => {
  it("ranks more distinct signals first", async () => {
    expect(
      await rank([candidate("one", ["lexical"]), candidate("two", ["lexical", "relation-hop"])]),
    ).toEqual(["two", "one"]);
  });

  // Two lexical hits are one kind of evidence, not two — otherwise a scope with a long
  // title outranks one the caller is demonstrably working in.
  it("counts distinct signal kinds, not signal instances", async () => {
    const many = candidate("many", []);
    many.signals = [
      { kind: "lexical", reason: "title" },
      { kind: "lexical", reason: "alias" },
      { kind: "lexical", reason: "slug" },
    ];

    expect(await rank([many, candidate("path", ["path-mapping"])])).toEqual(["path", "many"]);
  });

  // The discriminating case for the design's open question, and the only one where the two
  // tiers disagree: two weak signals versus one strong one. Without this, swapping tier 1
  // and tier 2 leaves the whole suite green — which it did until this test existed.
  //
  // Documented behaviour is count-first, so the lexical + relation-hop scope outranks the
  // one the caller is demonstrably working in. That is deliberately unsettled, and T8 is
  // meant to settle it; this test pins today's answer so a change to it is a decision
  // rather than a regression.
  it("puts two weak signals above one strong one, per the documented ordering", async () => {
    expect(
      await rank([
        candidate("path-only", ["path-mapping"]),
        candidate("lex-and-hop", ["lexical", "relation-hop"]),
      ]),
    ).toEqual(["lex-and-hop", "path-only"]);
  });

  it("breaks a count tie on the strongest signal", async () => {
    expect(
      await rank([candidate("lex", ["lexical"]), candidate("path", ["path-mapping"])]),
    ).toEqual(["path", "lex"]);
  });

  it("breaks a strength tie on scope specificity", async () => {
    expect(
      await rank([
        candidate("dom", ["lexical"], { scopeKind: "domain" }),
        candidate("comp", ["lexical"], { scopeKind: "component" }),
        candidate("prac", ["lexical"], { scopeKind: "practice" }),
      ]),
    ).toEqual(["comp", "prac", "dom"]);
  });

  it("breaks every remaining tie on slug, so the order is stable", async () => {
    expect(
      await rank([candidate("zebra", ["lexical"]), candidate("alpha", ["lexical"])]),
    ).toEqual(["alpha", "zebra"]);
  });

  // A build that does not recognize a kind must not let it outrank the kinds it does.
  it("sorts an unrecognized scope kind last rather than first", async () => {
    expect(
      await rank([
        candidate("weird", ["lexical"], { scopeKind: "not-a-kind" }),
        candidate("dom", ["lexical"], { scopeKind: "domain" }),
      ]),
    ).toEqual(["dom", "weird"]);
  });

  it("assigns offeredPosition by final order", async () => {
    const ranked = await defaultRanker.rank([
      candidate("b", ["lexical"]),
      candidate("a", ["lexical", "path-mapping"]),
    ]);

    expect(ranked.map((route) => [route.scopeSlug, route.offeredPosition])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("does not mutate its input", async () => {
    const input = [candidate("b", ["lexical"]), candidate("a", ["lexical"])];
    const before = input.map((c) => c.scopeSlug);

    await defaultRanker.rank(input);

    expect(input.map((c) => c.scopeSlug)).toEqual(before);
  });

  it("is deterministic and declares itself so", async () => {
    const input = [candidate("b", ["lexical"]), candidate("a", ["lexical"]), candidate("c", ["path-mapping"])];

    expect(await rank(input)).toEqual(await rank(input));
    expect(defaultRanker.deterministic).toBe(true);
  });
});

describe("ranker contract", () => {
  // The property that makes an untrusted or model-backed ranker safe to run: it may
  // misjudge an order, but it cannot change what is in the answer.
  it("rejects a route that was not among the candidates", () => {
    const input = [candidate("a", ["lexical"])];
    const invented: RankedRoute = { ...candidate("ghost", ["lexical"]), offeredPosition: 0 };

    expect(() => assertRankerContract(input, [invented])).toThrow(RankerContractError);
    expect(() => assertRankerContract(input, [invented])).toThrow(/not among the candidates/);
  });

  it("rejects a duplicated route", () => {
    const only = candidate("a", ["lexical"]);
    const dup: RankedRoute[] = [
      { ...only, offeredPosition: 0 },
      { ...only, offeredPosition: 1 },
    ];

    expect(() => assertRankerContract([only], dup)).toThrow(/more than once/);
  });

  it("rejects a route whose content was altered rather than reordered", () => {
    const only = candidate("a", ["lexical"]);

    expect(() =>
      assertRankerContract([only], [{ ...only, recordCount: 99, offeredPosition: 0 }]),
    ).toThrow(/altered, not just reordered/);
  });

  it("rejects positions that disagree with the order", () => {
    const only = candidate("a", ["lexical"]);

    expect(() => assertRankerContract([only], [{ ...only, offeredPosition: 7 }])).toThrow(
      /does not match its index/,
    );
  });

  // Dropping is explicitly allowed — a ranker may decide a route is not worth offering.
  it("allows a subset", () => {
    const input = [candidate("a", ["lexical"]), candidate("b", ["lexical"])];

    expect(() =>
      assertRankerContract(input, [{ ...input[0]!, offeredPosition: 0 }]),
    ).not.toThrow();
  });
});

describe("fallback", () => {
  const input = [candidate("b", ["lexical"]), candidate("a", ["lexical", "path-mapping"])];

  const brokenRanker = (rankImpl: Ranker["rank"]): Ranker => ({
    id: "broken",
    version: "0.0.1",
    deterministic: false,
    rank: rankImpl,
  });

  // A ranking failure must never fail the query: the caller asked for routes, and a worse
  // order is a better answer than an error.
  it("falls back to the default when a ranker throws", async () => {
    const outcome = await rankWithFallback(
      input,
      brokenRanker(() => Promise.reject(new Error("model unavailable"))),
    );

    expect(outcome.fellBack).toBe(true);
    expect(outcome.fallbackReason).toMatch(/model unavailable/);
    expect(outcome.ranker.id).toBe("precedence");
    expect(outcome.routes.map((route) => route.scopeSlug)).toEqual(["a", "b"]);
  });

  it("falls back when a ranker breaks the contract", async () => {
    const outcome = await rankWithFallback(
      input,
      brokenRanker(() => Promise.resolve([{ ...candidate("ghost", ["lexical"]), offeredPosition: 0 }])),
    );

    expect(outcome.fellBack).toBe(true);
    expect(outcome.fallbackReason).toMatch(/not among the candidates/);
    expect(outcome.routes).toHaveLength(2);
  });

  it("falls back when a ranker exceeds its time budget", async () => {
    vi.useFakeTimers();
    try {
      const pending = rankWithFallback(
        input,
        brokenRanker(() => new Promise<RankedRoute[]>(() => {})),
        { timeoutMs: 50 },
      );
      await vi.advanceTimersByTimeAsync(60);
      const outcome = await pending;

      expect(outcome.fellBack).toBe(true);
      expect(outcome.fallbackReason).toMatch(/exceeded 50ms/);
    } finally {
      vi.useRealTimers();
    }
  });

  // Handing the live array to an untrusted ranker let it mutate a candidate and return it:
  // the contract then compared the mutated objects to themselves and passed. Reproduced
  // before fixing — the answer came back carrying routeKey "scope:domain:INJECTED" and
  // recordCount 999 with fellBack false.
  it("cannot be defeated by a ranker that mutates its input", async () => {
    const mutating = brokenRanker((candidates) => {
      candidates[0]!.routeKey = "scope:domain:INJECTED";
      candidates[0]!.recordCount = 999;
      return Promise.resolve(candidates.map((c, index) => ({ ...c, offeredPosition: index })));
    });

    const outcome = await rankWithFallback(input, mutating);

    expect(outcome.fellBack).toBe(true);
    expect(outcome.routes.map((route) => route.routeKey)).not.toContain("scope:domain:INJECTED");
    expect(outcome.routes.every((route) => route.recordCount !== 999)).toBe(true);
  });

  it("leaves the caller's candidates untouched", async () => {
    const mutating = brokenRanker((candidates) => {
      candidates.forEach((candidate) => {
        candidate.recordCount = 999;
      });
      return Promise.resolve(candidates.map((c, index) => ({ ...c, offeredPosition: index })));
    });

    await rankWithFallback(input, mutating);

    expect(input.every((candidate) => candidate.recordCount !== 999)).toBe(true);
  });

  // Even a well-behaved ranker's returned objects are not trusted verbatim: the answer is
  // rebuilt from the baseline, so its influence is limited to order and membership.
  it("rebuilds routes from the baseline rather than from what the ranker returned", async () => {
    const tamperer: Ranker = {
      id: "tamperer",
      version: "1.0.0",
      deterministic: true,
      rank: (candidates) =>
        Promise.resolve(
          candidates.map((c, index) => ({ ...c, title: "REWRITTEN", offeredPosition: index })),
        ),
    };

    const outcome = await rankWithFallback(input, tamperer);

    expect(outcome.fellBack).toBe(false);
    expect(outcome.routes.every((route) => route.title !== "REWRITTEN")).toBe(true);
  });

  it("reports the ranker that actually produced the order", async () => {
    const good: Ranker = {
      id: "reverse",
      version: "2.0.0",
      deterministic: true,
      rank: (candidates) =>
        Promise.resolve(
          [...candidates].reverse().map((c, index) => ({ ...c, offeredPosition: index })),
        ),
    };

    const outcome = await rankWithFallback(input, good);

    expect(outcome.fellBack).toBe(false);
    expect(outcome.ranker).toEqual({ id: "reverse", version: "2.0.0", deterministic: true });
    expect(outcome.routes.map((route) => route.scopeSlug)).toEqual(["a", "b"]);
  });
});
