import { describe, expect, it } from "vitest";

import { parseClaimSource, type ParseClaimSourceContext } from "../src/graph/sourceId.js";
import type { ProjectMappings } from "../src/types.js";

const NO_MAPPINGS: ProjectMappings = { projects: [], claimSourceTypes: [] };

function mappingsWithRepo(project: string, repo: string, paths: string[] = []): ProjectMappings {
  return {
    projects: [{ project, repos: [{ repo, paths, web: { url: `https://github.com/owner/${repo}` } }] }],
    claimSourceTypes: [],
  };
}

function makeContext(overrides: Partial<ParseClaimSourceContext> = {}): ParseClaimSourceContext {
  const anchorNames = overrides.anchorNames ?? new Set<string>();
  return {
    anchorName: "projects/demo/demo-project-context.md",
    anchorNames,
    resolveAnchorName: (value: string) => {
      const clean = value.trim().replace(/^\.?\/+/, "");
      const resolved = clean.endsWith(".md") ? clean : `${clean}.md`;
      return anchorNames.has(resolved) ? resolved : undefined;
    },
    getAnchorSectionTitles: () => undefined,
    mappings: NO_MAPPINGS,
    resolvePersonId: () => undefined,
    ...overrides,
  };
}

describe("parseClaimSource — canonicalization table", () => {
  const mappings = mappingsWithRepo("demo", "repo-alpha");
  const ctx = makeContext({ mappings });

  it.each([
    ["PR #39", "pr:repo-alpha#39"],
    ["PR#39", "pr:repo-alpha#39"],
    ["PR  #39", "pr:repo-alpha#39"],
    ["repo-alpha:PR #39", "pr:repo-alpha#39"],
  ])("normalizes %s to the same PR node id", (src, expected) => {
    const result = parseClaimSource({ src }, ctx);
    expect(result.node?.nodeId).toBe(expected);
    expect(result.node?.type).toBe("pr");
  });

  it.each([
    ["src/a.ts", "file:repo-alpha:src/a.ts"],
    ["repo-alpha:src/a.ts", "file:repo-alpha:src/a.ts"],
    ["src/a.ts#L12", "file:repo-alpha:src/a.ts"],
    ["repo-alpha:src/a.ts#L99", "file:repo-alpha:src/a.ts"],
  ])("normalizes %s to the same file node id (line number does not affect node identity)", (src, expected) => {
    const result = parseClaimSource({ src }, ctx);
    expect(result.node?.nodeId).toBe(expected);
    expect(result.node?.type).toBe("file");
  });

  it.each([
    ["https://example.com/doc", "url:https://example.com/doc"],
    ["HTTPS://EXAMPLE.com/doc", "url:https://example.com/doc"],
    ["https://example.com:443/doc", "url:https://example.com/doc"],
  ])("normalizes %s to the same url node id", (src, expected) => {
    const result = parseClaimSource({ src }, ctx);
    expect(result.node?.nodeId).toBe(expected);
    expect(result.node?.type).toBe("url");
  });

  it("gives an unmapped repo file path a file:?:<path> node id", () => {
    const bareCtx = makeContext();
    const result = parseClaimSource({ src: "src/unmapped.ts" }, bareCtx);
    expect(result.node?.nodeId).toBe("file:?:src/unmapped.ts");
    expect(result.node?.type).toBe("file");
  });

  it("resolves a bare anchor-name src to an anchor node", () => {
    const anchorNames = new Set(["projects/other/other-project-context.md"]);
    const withAnchor = makeContext({ anchorNames });
    const result = parseClaimSource({ src: "projects/other/other-project-context" }, withAnchor);
    expect(result.node).toEqual({ nodeId: "anchor:projects/other/other-project-context.md", type: "anchor" });
  });
});

describe("parseClaimSource — person and trust-me-bro rows", () => {
  it("resolves a structured person key to a person node", () => {
    const ctx = makeContext({ resolvePersonId: (raw) => (raw === "alice" ? "alice" : undefined) });
    const result = parseClaimSource({ src: "PR #1", person: "alice" }, ctx);
    expect(result.personNode).toEqual({ nodeId: "person:alice", type: "person" });
    // src is still classified independently of the person row.
    expect(result.node?.type).toBe("pr");
  });

  it("keeps the raw token when a person id is unresolved", () => {
    const ctx = makeContext();
    const result = parseClaimSource({ src: "PR #1", person: "unknown-person" }, ctx);
    expect(result.personNode).toEqual({ nodeId: "person:unknown-person", type: "person", display: "unknown-person" });
  });

  it("produces ONLY the person node for a trust-me-bro row with no artifact src", () => {
    const ctx = makeContext({ resolvePersonId: (raw) => (raw === "bob" ? "bob" : undefined) });
    const result = parseClaimSource({ src: "trust me bro", kind: "trust-me-bro", person: "bob" }, ctx);
    expect(result.node).toEqual({ nodeId: "person:bob", type: "person" });
    expect(result.personNode).toEqual({ nodeId: "person:bob", type: "person" });
    expect(result.warning).toBeUndefined();
  });

  it("resolves the legacy person:<id> src value the same way as the structured key", () => {
    const ctx = makeContext({ resolvePersonId: (raw) => (raw === "carol" ? "carol" : undefined) });
    const result = parseClaimSource({ src: "person:carol" }, ctx);
    expect(result.node).toEqual({ nodeId: "person:carol", type: "person" });
  });

  it("kind hint does not override src-derived classification", () => {
    // kind is a hint to confirm, not re-derive: an (unusual) src that parses as
    // a PR reference stays a pr node even if kind claims otherwise.
    const ctx = makeContext({ mappings: mappingsWithRepo("demo", "repo-alpha") });
    const result = parseClaimSource({ src: "PR #7", kind: "design-doc" }, ctx);
    expect(result.node?.type).toBe("pr");
    expect(result.node?.nodeId).toBe("pr:repo-alpha#7");
  });
});

describe("parseClaimSource — section references", () => {
  const anchorNames = new Set([
    "projects/demo/demo-project-context.md",
    "projects/other/other-project-context.md",
  ]);

  it("resolves a valid cross-anchor section reference with no warning", () => {
    const ctx = makeContext({
      anchorNames,
      getAnchorSectionTitles: (name) =>
        name === "projects/other/other-project-context.md" ? new Set(["Decisions"]) : undefined,
    });
    const result = parseClaimSource({ src: "projects/other/other-project-context#Decisions" }, ctx);
    expect(result.node).toEqual({
      nodeId: "section:projects/other/other-project-context.md#Decisions",
      type: "section",
    });
    expect(result.warning).toBeUndefined();
  });

  it("resolves same-anchor shorthand against the containing anchor", () => {
    const ctx = makeContext({
      anchorNames,
      getAnchorSectionTitles: (name) =>
        name === "projects/demo/demo-project-context.md" ? new Set(["Current State"]) : undefined,
    });
    const result = parseClaimSource({ src: "#Current State" }, ctx);
    expect(result.node).toEqual({
      nodeId: "section:projects/demo/demo-project-context.md#Current State",
      type: "section",
    });
    expect(result.warning).toBeUndefined();
  });

  it("warns (never blocks) on a dangling heading", () => {
    const ctx = makeContext({
      anchorNames,
      getAnchorSectionTitles: (name) =>
        name === "projects/other/other-project-context.md" ? new Set(["Decisions"]) : undefined,
    });
    const result = parseClaimSource({ src: "projects/other/other-project-context#Nonexistent" }, ctx);
    expect(result.node?.type).toBe("section");
    expect(result.warning).toEqual({
      code: "claim_source_section_missing",
      message: expect.stringContaining("does not exist"),
    });
  });

  it("warns (never blocks) on a dangling anchor", () => {
    const ctx = makeContext({ anchorNames });
    const result = parseClaimSource({ src: "projects/ghost/ghost-project-context#Decisions" }, ctx);
    expect(result.node?.type).toBe("section");
    expect(result.warning?.code).toBe("claim_source_section_missing");
  });

  it("normalizes a heading given with a ## prefix the same as a bare heading", () => {
    const withHash = makeContext({
      anchorNames,
      getAnchorSectionTitles: (name) =>
        name === "projects/other/other-project-context.md" ? new Set(["Decisions"]) : undefined,
    });
    const result = parseClaimSource({ src: "projects/other/other-project-context### Decisions" }, withHash);
    expect(result.node?.nodeId).toBe("section:projects/other/other-project-context.md#Decisions");
    expect(result.warning).toBeUndefined();
  });

  it("does not misread a PR reference as a section reference", () => {
    const ctx = makeContext({ mappings: mappingsWithRepo("demo", "repo-alpha") });
    const result = parseClaimSource({ src: "PR #39" }, ctx);
    expect(result.node?.type).toBe("pr");
  });

  it("does not misread a file#L<line> reference as a section reference", () => {
    const ctx = makeContext({ mappings: mappingsWithRepo("demo", "repo-alpha") });
    const result = parseClaimSource({ src: "src/a.ts#L12" }, ctx);
    expect(result.node?.type).toBe("file");
  });
});
