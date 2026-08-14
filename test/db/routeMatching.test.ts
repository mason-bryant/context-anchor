import { describe, expect, it } from "vitest";

import {
  contentFingerprint,
  lexicalMatch,
  pathMatch,
  RECORD_LEXICAL_EXAMPLES,
  recordLexicalReason,
  routeKeyFor,
  taskTerms,
  type RouteRecord,
  type ScopeRow,
} from "../../src/db/routing/selectRoutes.js";

const scope = (overrides: Partial<ScopeRow> = {}): ScopeRow => ({
  scope_guid: "g1",
  scope_slug: "http-transport",
  scope_kind: "component",
  title: "HTTP Transport",
  aliases: [],
  ...overrides,
});

const section = (stableKey: string, content: string): RouteRecord => ({
  ref: { type: "section", guid: `sec-${stableKey}`, documentGuid: "doc", revisionGuid: "rev", stableKey },
  content,
});

describe("task terms", () => {
  it("lowercases and dedupes alphanumeric runs", () => {
    expect(taskTerms("Add Rate limiting to the HTTP transport, rate!")).toEqual([
      "add", "rate", "limiting", "to", "the", "http", "transport",
    ]);
  });

  // Single characters match nearly every scope and carry no routing signal.
  it("drops one-character tokens and punctuation", () => {
    expect(taskTerms("a b/c 12 x-y")).toEqual(["12"]);
  });
});

describe("lexical matching", () => {
  it("matches a slug word", () => {
    expect(lexicalMatch(scope(), new Set(["transport"]))?.reason).toMatch(/scope slug/);
  });

  it("matches a title word", () => {
    expect(lexicalMatch(scope({ scope_slug: "zzz" }), new Set(["http"]))?.reason).toMatch(/scope title/);
  });

  it("matches an alias", () => {
    expect(
      lexicalMatch(scope({ scope_slug: "zzz", title: "Zzz", aliases: ["context-conductor"] }), new Set(["conductor"]))
        ?.reason,
    ).toMatch(/scope alias/);
  });

  // Substring containment would make short slugs match almost everything: "graph" appearing
  // inside "telegraph" is not evidence the caller is working on the graph.
  it("requires a whole word, not a substring", () => {
    expect(lexicalMatch(scope({ scope_slug: "graph", title: "Graph" }), new Set(["telegraph"]))).toBeUndefined();
  });

  it("does not match when nothing overlaps", () => {
    expect(lexicalMatch(scope(), new Set(["postgres"]))).toBeUndefined();
  });

  it("names the matched term, so the reason is checkable", () => {
    expect(lexicalMatch(scope(), new Set(["http"]))?.reason).toContain('"http"');
  });
});

describe("path matching", () => {
  const mappings = [
    { scope_guid: "whole", repository: "r", path_prefix: "" },
    { scope_guid: "app", repository: "r", path_prefix: "app" },
    { scope_guid: "deep", repository: "r", path_prefix: "app/http" },
  ];

  it("prefers the longest matching prefix", () => {
    const matched = pathMatch(["app/http/server.ts"], mappings);

    expect([...matched.keys()]).toEqual(["deep"]);
  });

  it("falls back to a shorter prefix when the longer does not apply", () => {
    expect([...pathMatch(["app/other/x.ts"], mappings).keys()]).toEqual(["app"]);
  });

  it("treats an empty prefix as the whole repository", () => {
    expect([...pathMatch(["README.md"], mappings).keys()]).toEqual(["whole"]);
  });

  // "app" must not claim "application/": a prefix matches on a segment boundary or not at all.
  it("does not match a partial path segment", () => {
    expect([...pathMatch(["application/x.ts"], mappings).keys()]).toEqual(["whole"]);
  });

  it("normalizes leading slashes and backslashes", () => {
    expect([...pathMatch(["\\app\\http\\server.ts"], mappings).keys()]).toEqual(["deep"]);
    expect([...pathMatch(["/app/http/server.ts"], mappings).keys()]).toEqual(["deep"]);
  });

  it("matches several paths onto several scopes", () => {
    expect(new Set(pathMatch(["app/http/a.ts", "app/other/b.ts"], mappings).keys())).toEqual(
      new Set(["deep", "app"]),
    );
  });

  it("names the prefix in the reason", () => {
    expect(pathMatch(["app/http/server.ts"], mappings).get("deep")?.reason).toContain("app/http");
  });
});

describe("route keys", () => {
  it("is scope:kind:slug", () => {
    expect(routeKeyFor("component", "http-transport")).toBe("scope:component:http-transport");
  });
});

describe("content fingerprint", () => {
  it("is stable across record order", () => {
    const a = section("doc#one", "alpha");
    const b = section("doc#two", "beta");

    expect(contentFingerprint([a, b])).toBe(contentFingerprint([b, a]));
  });

  it("changes when content changes", () => {
    expect(contentFingerprint([section("doc#one", "alpha")])).not.toBe(
      contentFingerprint([section("doc#one", "alpha!")]),
    );
  });

  it("changes when a record is added or removed", () => {
    const base = [section("doc#one", "alpha")];

    expect(contentFingerprint(base)).not.toBe(contentFingerprint([...base, section("doc#two", "beta")]));
  });

  // The reason it keys on stableKey: a section GUID is revision-scoped, so keying on it
  // would report every route containing a reimported document as changed even when its
  // text is byte-identical.
  it("is unchanged when only revision-scoped identity moves", () => {
    const before = section("doc#one", "alpha");
    const after: RouteRecord = {
      ...before,
      ref: { ...before.ref, guid: "different-section-guid", revisionGuid: "different-revision" } as typeof before.ref,
    };

    expect(contentFingerprint([before])).toBe(contentFingerprint([after]));
  });

  it("distinguishes two records whose contents are swapped", () => {
    expect(contentFingerprint([section("doc#one", "alpha"), section("doc#two", "beta")])).not.toBe(
      contentFingerprint([section("doc#one", "beta"), section("doc#two", "alpha")]),
    );
  });
});

/**
 * These sentences are the whole evidence for a listed route — most offered routes carry no
 * records — so a person judging whether recordLexical adds signal or noise is judging these.
 */
describe("recordLexicalReason", () => {
  // Every term is treated as matching every title unless the caller says otherwise, which keeps
  // the simple cases readable; `termed` below builds the per-term mapping explicitly.
  const reason = (titles: string[], source = "section", hits: string[] = ["decisions"]) =>
    recordLexicalReason({
      termTitles: new Map(hits.map((hit) => [hit, new Set(titles)])),
      source,
      titles,
    });

  const termed = (termTitles: Record<string, string[]>, source = "section") =>
    recordLexicalReason({
      termTitles: new Map(Object.entries(termTitles).map(([term, titles]) => [term, new Set(titles)])),
      source,
      titles: [...new Set(Object.values(termTitles).flat())],
    });

  it("names the single title when only one matched, without a count to read past", () => {
    expect(reason(["Decisions on logging"])).toBe(
      'task term "decisions" matched section title "Decisions on logging" in this scope',
    );
  });

  it("leads with how many matched, because the count is the judgement", () => {
    // One heading is a plausible route; thirty means the term is a common word and the scope is
    // noise. A reader given only examples cannot tell those apart.
    const text = reason(["A decisions", "B decisions", "C decisions", "D decisions", "E decisions"]);

    expect(text).toContain("matched 5 distinct section titles");
    expect(text).toContain("(+2 more)");
  });

  it("quotes no more than the example cap, so one scope cannot flood the pane", () => {
    const titles = Array.from({ length: 30 }, (_, index) => `decisions ${String(index)}`);
    const text = reason(titles);

    expect(text.match(/"decisions \d+"/g) ?? []).toHaveLength(RECORD_LEXICAL_EXAMPLES);
    expect(text).toContain("(+27 more)");
  });

  it("omits the remainder note when every match is shown", () => {
    expect(reason(["a decisions", "b decisions"])).not.toContain("more)");
  });

  it("is stable regardless of the order rows arrived in", () => {
    // The reason is stored in telemetry and compared across runs; ordering that followed the
    // query would make two identical retrievals look like a change.
    expect(reason(["b decisions", "a decisions"])).toBe(reason(["a decisions", "b decisions"]));
  });

  it("says assertion when the match came from an assertion", () => {
    expect(reason(["Decisions on logging"], "assertion")).toContain("matched assertion title");
  });

  it("counts distinct titles, so a boilerplate heading cannot look like broad evidence", () => {
    // Every anchor document carries the same structural headings, so a domain scope returns the
    // same title once per document. Counting rows made that read as strong evidence when it is
    // the strongest evidence of the opposite -- the term is structural, not topical.
    const text = reason(["Decisions", "Decisions", "Decisions", "Decisions", "Decisions"]);

    expect(text).toContain("matched the same section title");
    expect(text).toContain("in 5 sections of this scope");
    expect(text).not.toContain("5 distinct");
  });

  it("says how many sections carried the titles when they repeat", () => {
    const text = reason(["Decisions", "Decisions", "Logging", "Logging"]);

    expect(text).toContain("2 distinct section titles");
    expect(text).toContain("across 4 sections");
  });

  it("names every task term that matched, not whichever appeared first", () => {
    // Keying on one term split a scope's evidence by word order inside the heading, so a scope
    // matching everything on a two-word task read as two unremarkable partial matches.
    const text = reason(["Decisions about logging", "Logging decisions"], "section", ["decisions", "logging"]);

    expect(text).toContain('task terms "decisions" (2), "logging" (2)');
  });

  it("orders the terms so the sentence is stable across runs", () => {
    expect(reason(["a", "b"], "section", ["logging", "decisions"])).toBe(
      reason(["a", "b"], "section", ["decisions", "logging"]),
    );
  });

  it("counts each term separately, so stopwords cannot pose as topical evidence", () => {
    // taskTerms applies no stopword list, and the ordinary phrasings this signal exists to
    // rescue are full of "the" and "to". A bare union let one relevant heading plus four
    // stopword headings read as five-term evidence.
    const text = termed({
      the: ["How the importer works", "Notes on the migration", "Rate limiting and the transport"],
      rate: ["Rate limiting and the transport"],
    });

    expect(text).toContain('"rate" (1)');
    expect(text).toContain('"the" (3)');
  });

  it("quotes the titles found by the rarest term first, so the examples can check the count", () => {
    // Alphabetical order filled the examples with stopword matches — the three titles offered to
    // justify the count were the three least likely to.
    const text = termed({
      the: ["A the one", "B the two", "C the three", "Z rate limiting and the transport"],
      rate: ["Z rate limiting and the transport"],
    });

    expect(text.indexOf('"Z rate limiting and the transport"')).toBeLessThan(text.indexOf('"A the one"'));
  });
});

