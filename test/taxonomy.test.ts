import { describe, expect, it } from "vitest";

import { buildContextRoot } from "../src/contextRoot.js";
import { classifyAnchorPath } from "../src/taxonomy.js";
import type { AnchorMeta } from "../src/types.js";

describe("taxonomy", () => {
  it("classifies valid anchor paths", () => {
    expect(classifyAnchorPath("projects/demo/current.md")).toEqual({
      kind: "anchor",
      category: "projects",
      projectSlug: "demo",
    });
    expect(classifyAnchorPath("agent-rules/codex.md")).toEqual({ kind: "anchor", category: "agent-rules" });
    expect(classifyAnchorPath("invariants/auth.md")).toEqual({ kind: "anchor", category: "invariants" });
    expect(classifyAnchorPath("conflicts/token-model.md")).toEqual({ kind: "anchor", category: "conflicts" });
    expect(classifyAnchorPath("shared/glossary.md")).toEqual({ kind: "anchor", category: "shared" });
    expect(classifyAnchorPath("archive/2026/old.md")).toEqual({ kind: "anchor", category: "archive" });
  });

  it("rejects root-level and unknown-directory anchors", () => {
    expect(classifyAnchorPath("demo.md")).toMatchObject({ kind: "invalid" });
    expect(classifyAnchorPath("unknown/demo.md")).toMatchObject({ kind: "invalid" });
    expect(classifyAnchorPath("projects/demo/milestones/m1.md")).toEqual({
      kind: "anchor",
      category: "projects",
      projectSlug: "demo",
    });
    expect(classifyAnchorPath("projects/demo/nested/extra.md")).toMatchObject({ kind: "invalid" });
    expect(classifyAnchorPath("CONTEXT-ROOT.md")).toEqual({ kind: "generated" });
  });

  it("renders context root entries in taxonomy order", () => {
    const result = buildContextRoot(
      [
        meta("shared/glossary.md", "shared"),
        meta("projects/demo/current.md", "projects", "demo"),
        meta("agent-rules/codex.md", "agent-rules"),
      ],
      { generatedAt: "2026-05-10T00:00:00.000Z", format: "markdown" },
    );

    expect(result.entries.map((entry) => entry.category)).toEqual(["agent-rules", "projects", "shared"]);
    expect(result.markdown).toContain("Do not edit manually");
    expect(result.markdown?.indexOf("## Agent Rules")).toBeLessThan(result.markdown?.indexOf("## Projects") ?? -1);
  });
});

function meta(name: string, category: AnchorMeta["category"], projectSlug?: string): AnchorMeta {
  return {
    name,
    path: name,
    category,
    projectSlug,
    title: name,
    summary: `${name} summary.`,
    read_this_if: [`You need ${name}.`],
    type: "design",
    tags: ["context"],
    last_validated: "2026-05-10",
  };
}

