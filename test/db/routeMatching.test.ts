import { describe, expect, it } from "vitest";

import {
  contentFingerprint,
  lexicalMatch,
  pathMatch,
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
