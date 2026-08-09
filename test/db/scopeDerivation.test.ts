import { describe, expect, it } from "vitest";

import { deriveScopeForPath, DEFAULT_WORKSPACE_SCOPE_SLUG } from "../../src/db/scopeDerivation.js";

describe("deriveScopeForPath", () => {
  it("maps a project slug to a domain — projects are enduring, not time-bounded", () => {
    expect(deriveScopeForPath("projects/anchor-mcp/anchor-mcp-project-context.md")).toEqual({
      scopeKind: "domain",
      scopeSlug: "anchor-mcp",
      title: "anchor-mcp",
      derivedFromSignal: "path:projects/<slug>",
    });
  });

  it("maps a milestone anchor to an initiative — the time-bounded thing with dates", () => {
    expect(deriveScopeForPath("projects/anchor-mcp/milestones/db-backed-vertical-slice.md")).toMatchObject({
      scopeKind: "initiative",
      scopeSlug: "anchor-mcp-db-backed-vertical-slice",
      derivedFromSignal: "path:projects/<slug>/milestones/<name>",
    });
  });

  it("maps the backlog milestone to an initiative like any other", () => {
    expect(deriveScopeForPath("projects/anchor-mcp/milestones/backlog.md")).toMatchObject({
      scopeKind: "initiative",
      scopeSlug: "anchor-mcp-backlog",
    });
  });

  it("maps rule directories to practices", () => {
    expect(deriveScopeForPath("agent-rules/pr-review-comment-workflow.md")).toMatchObject({
      scopeKind: "practice",
      scopeSlug: "agent-rules",
    });
    expect(deriveScopeForPath("server-rules/whatever.md")).toMatchObject({
      scopeKind: "practice",
      scopeSlug: "server-rules",
    });
  });

  it("falls back to the single default workspace scope for everything else", () => {
    for (const path of ["shared/adding-an-rql-audit.md", "CONTEXT-ROOT.md", "conflicts/x.md"]) {
      expect(deriveScopeForPath(path), path).toMatchObject({
        scopeKind: "workspace",
        scopeSlug: DEFAULT_WORKSPACE_SCOPE_SLUG,
      });
    }
  });

  it("does not treat a roadmap as its own scope — goals live as sections of a document", () => {
    // Roadmap goals mint no scopes; the roadmap is an ordinary document owned by its domain.
    expect(deriveScopeForPath("projects/anchor-mcp/anchor-mcp-roadmap.md")).toMatchObject({
      scopeKind: "domain",
      scopeSlug: "anchor-mcp",
    });
  });

  it("keeps milestone slugs distinct across projects", () => {
    const a = deriveScopeForPath("projects/anchor-mcp/milestones/backlog.md");
    const b = deriveScopeForPath("projects/other-project/milestones/backlog.md");
    expect(a.scopeSlug).not.toBe(b.scopeSlug);
  });

  it("normalizes leading slashes and Windows separators", () => {
    expect(deriveScopeForPath("/projects/anchor-mcp/x.md")).toMatchObject({ scopeSlug: "anchor-mcp" });
    expect(deriveScopeForPath("projects\\anchor-mcp\\x.md")).toMatchObject({ scopeSlug: "anchor-mcp" });
  });

  it("rejects a path that escapes the anchor root rather than deriving a scope from it", () => {
    expect(() => deriveScopeForPath("../outside/x.md")).toThrow(/path/i);
  });
});
