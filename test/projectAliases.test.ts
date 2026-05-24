import { describe, expect, it } from "vitest";

import {
  anchorMatchesProject,
  buildProjectAliasIndex,
  isProjectContextAnchorPath,
  isValidProjectAliasSlug,
  parseProjectAliases,
  resolveProjectFilter,
} from "../src/projectAliases.js";
import type { AnchorMeta } from "../src/types.js";

function meta(partial: Partial<AnchorMeta> & Pick<AnchorMeta, "name">): AnchorMeta {
  return {
    path: partial.name,
    category: "projects",
    summary: "summary",
    read_this_if: ["read"],
    ...partial,
  };
}

describe("projectAliases", () => {
  it("parses alias arrays from front matter", () => {
    expect(parseProjectAliases(["context-conductor", "  ", 3, "demo"])).toEqual([
      "context-conductor",
      "demo",
    ]);
    expect(parseProjectAliases(undefined)).toEqual([]);
  });

  it("validates alias slug shape", () => {
    expect(isValidProjectAliasSlug("context-conductor")).toBe(true);
    expect(isValidProjectAliasSlug("Context-Conductor")).toBe(false);
    expect(isValidProjectAliasSlug("-bad")).toBe(false);
  });

  it("detects project context anchor paths", () => {
    expect(isProjectContextAnchorPath("projects/demo/demo-project-context.md", "context-anchor")).toBe(true);
    expect(isProjectContextAnchorPath("projects/demo/demo.md", "context-anchor")).toBe(true);
    expect(isProjectContextAnchorPath("projects/demo/demo-roadmap.md", "project-roadmap")).toBe(false);
  });

  it("matches canonical project slug and front matter project", () => {
    const anchor = meta({
      name: "projects/demo/demo-project-context.md",
      projectSlug: "demo",
      project: ["demo"],
    });
    expect(anchorMatchesProject(anchor, "demo")).toBe(true);
    expect(anchorMatchesProject(anchor, "other")).toBe(false);
  });

  it("resolves canonical, alias, and unresolved project filters", () => {
    const anchors = [
      meta({
        name: "projects/anchor-mcp/anchor-mcp-project-context.md",
        projectSlug: "anchor-mcp",
        project: ["anchor-mcp"],
        aliases: ["context-conductor"],
      }),
    ];
    const index = buildProjectAliasIndex(anchors);

    expect(resolveProjectFilter("anchor-mcp", anchors, index)).toEqual({
      requested: "anchor-mcp",
      resolved: "anchor-mcp",
      via: "canonical",
    });
    expect(resolveProjectFilter("context-conductor", anchors, index)).toEqual({
      requested: "context-conductor",
      resolved: "anchor-mcp",
      via: "alias",
      matchedAlias: "context-conductor",
    });
    expect(resolveProjectFilter("missing-slug", anchors, index)).toEqual({
      requested: "missing-slug",
      resolved: "missing-slug",
      via: "unresolved",
    });
  });
});
