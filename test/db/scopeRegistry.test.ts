import { describe, expect, it } from "vitest";

import { CliUsageError } from "../../src/cli/errors.js";
import { parseScopeDeclarations } from "../../src/db/scopeRegistry.js";

function registry(scopes: unknown): Record<string, unknown> {
  // Always alongside `projects`, because the Git-backed server keeps reading that key and
  // the two shapes coexist until it is retired (T-36).
  return { projects: [{ project: "legacy", repos: [{ repo: "r", paths: [] }] }], scopes };
}

describe("scope declarations", () => {
  it("is absent when the file has no scopes key, so callers fall back to the project shape", () => {
    expect(parseScopeDeclarations({ projects: [] })).toBeUndefined();
    expect(parseScopeDeclarations(undefined)).toBeUndefined();
    expect(parseScopeDeclarations(null)).toBeUndefined();
  });

  // The whole point of A1: one repository under two names is one scope, not two.
  it("collects many locators onto one scope", () => {
    const [declaration] = parseScopeDeclarations(
      registry([
        {
          scope: "anchor-mcp",
          title: "Anchor MCP",
          kind: "domain",
          locators: [{ repo: "context-anchor" }, { repo: "context-conductor" }, { repo: "other", path: "/app/" }],
        },
      ]),
    )!;

    expect(declaration.locators).toEqual([
      { repository: "context-anchor", pathPrefix: "" },
      { repository: "context-conductor", pathPrefix: "" },
      { repository: "other", pathPrefix: "app" },
    ]);
  });

  it("keeps title, kind, partOf, and aliases", () => {
    const declarations = parseScopeDeclarations(
      registry([
        { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", aliases: ["context-conductor", 7] },
        { scope: "routing", title: "Routing", kind: "practice", partOf: "anchor-mcp" },
      ]),
    )!;

    expect(declarations[0]).toMatchObject({ title: "Anchor MCP", kind: "domain", aliases: ["context-conductor"] });
    expect(declarations[1]).toMatchObject({ kind: "practice", partOf: "anchor-mcp" });
  });

  it("allows a scope with no locators when it is not a component", () => {
    const [declaration] = parseScopeDeclarations(
      registry([{ scope: "security", title: "Security", kind: "practice" }]),
    )!;

    expect(declaration.locators).toEqual([]);
  });

  // A2: `component` is the top specificity tier, so it has to mean "a concrete location",
  // not a label anyone can apply to outrank their neighbours.
  it("refuses a component with no locators", () => {
    expect(() =>
      parseScopeDeclarations(registry([{ scope: "thing", title: "Thing", kind: "component" }])),
    ).toThrow(/component .*no locators|no locators/i);
  });

  // The collision that today fuses two subjects silently whenever their kinds match.
  it("refuses two declarations sharing a name, naming both", () => {
    expect(() =>
      parseScopeDeclarations(
        registry([
          { scope: "object-graph", title: "Object Graph (UDF)", kind: "domain" },
          { scope: "object-graph", title: "Object Graph (zviews)", kind: "domain" },
        ]),
      ),
    ).toThrow(/Object Graph \(UDF\)[\s\S]*Object Graph \(zviews\)|twice/);
  });

  it("refuses one locator claimed by two scopes", () => {
    expect(() =>
      parseScopeDeclarations(
        registry([
          { scope: "a", title: "A", kind: "component", locators: [{ repo: "r", path: "app" }] },
          { scope: "b", title: "B", kind: "component", locators: [{ repo: "r", path: "app" }] },
        ]),
      ),
    ).toThrow(/claimed by both/);
  });

  it("allows one scope to list the same locator twice", () => {
    expect(() =>
      parseScopeDeclarations(
        registry([
          { scope: "a", title: "A", kind: "component", locators: [{ repo: "r", path: "app" }, { repo: "r", path: "app" }] },
        ]),
      ),
    ).not.toThrow();
  });

  // Parent is declared, not inferred from slug shape — flat names cannot carry a prefix,
  // and a typo would otherwise become a silently missing relation.
  it("refuses a partOf that names nothing", () => {
    expect(() =>
      parseScopeDeclarations(registry([{ scope: "a", title: "A", kind: "practice", partOf: "nope" }])),
    ).toThrow(/nope/);
  });

  it("refuses a partOf cycle of one", () => {
    expect(() =>
      parseScopeDeclarations(registry([{ scope: "a", title: "A", kind: "practice", partOf: "a" }])),
    ).toThrow(/itself/);
  });

  it.each([
    [{ scope: "Object Graph", title: "T", kind: "domain" }, /valid slug/],
    [{ scope: "a", title: "T", kind: "team" }, /not one of/],
    [{ scope: "a", kind: "domain" }, /title/],
    [{ title: "T", kind: "domain" }, /scope/],
    [{ scope: "a", title: "T", kind: "domain", locators: [{ path: "app" }] }, /repo is required/],
  ])("rejects malformed declaration %j", (entry, pattern) => {
    expect(() => parseScopeDeclarations(registry([entry]))).toThrow(CliUsageError);
    expect(() => parseScopeDeclarations(registry([entry]))).toThrow(pattern);
  });

  it("refuses a scopes key that is present but empty rather than silently falling back", () => {
    expect(() => parseScopeDeclarations(registry([]))).toThrow(/empty/);
  });

  it("refuses a scopes key that is not an array", () => {
    expect(() => parseScopeDeclarations({ scopes: { a: 1 } })).toThrow(/must be an array/);
  });
});
