import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";

let tmpDir: string;
let repo: AnchorRepository;
let service: AnchorService;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AnchorService", () => {
  it("writes a valid anchor as a git commit", async () => {
    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });

    expect(result.version).toMatch(/[a-f0-9]{40}/);
    expect(result.warnings).toEqual([]);

    const read = await service.readAnchor("projects/demo/demo");
    expect(read.frontmatter.project).toEqual(["demo"]);
    expect(read.frontmatter.summary).toBe("Demo anchor summary.");
    expect(read.content).toContain("## Current State");

    const versions = await service.listVersions("projects/demo/demo");
    expect(versions).toHaveLength(1);
    expect(versions[0]?.message).toBe("test: add demo anchor");
  });

  it("blocks anchors missing required sections", async () => {
    const result = await service.writeAnchor({
      name: "shared/bad",
      content: `---
type: design
tags: []
summary: "Bad anchor summary."
read_this_if:
  - "You are checking section validation."
last_validated: 2026-05-10
---

# Bad Anchor

## Current State

- Exists.
`,
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.filter((warning) => warning.severity === "BLOCK").map((warning) => warning.code)).toContain(
      "required_section",
    );
  });

  it("blocks anchors outside the enforced taxonomy", async () => {
    const result = await service.writeAnchor({
      name: "demo",
      content: sharedAnchorContent(),
      message: "test: invalid path",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("directory_taxonomy");
  });

  it("blocks missing summary and read_this_if front matter", async () => {
    const result = await service.writeAnchor({
      name: "shared/missing-metadata",
      content: `---
type: design
tags: []
last_validated: 2026-05-10
---

# Missing Metadata

## Current State

- Exists.

## Decisions

- Keep it.

## Constraints

- Preserve shape.

## PRs

- [PR Add metadata checks - #123](https://github.com/example/repo/pull/123)
`,
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("front_matter_schema");
  });

  it("blocks local/private path leakage in anchor content", async () => {
    const result = await service.writeAnchor({
      name: "shared/path-leak",
      content: `---
type: design
tags: []
summary: "Path leak example."
read_this_if:
  - "You are validating path hygiene."
last_validated: 2026-05-10
---

# Path Leak

## Current State

- See [Draft](cursor-output/markdowns/context-conductor/draft.md) for details.

## Decisions

- Keep private references out of shared anchors.

## Constraints

- Local-only files should not appear in persisted anchors.

## PRs

None.
`,
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("tracked_link_leak");
  });

  it("blocks project anchors whose front matter does not include the project slug", async () => {
    const result = await service.writeAnchor({
      name: "projects/demo/wrong-project",
      content: projectAnchorContent({ project: "other" }),
      message: "test: mismatched project slug",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("project_slug_mismatch");
  });

  it("blocks direct writes to generated CONTEXT-ROOT.md", async () => {
    const result = await service.writeAnchor({
      name: "CONTEXT-ROOT",
      content: "# Manual Root\n",
      message: "test: write generated root",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["generated_file_reserved"]);
  });

  it("requires last_validated to change when substantive sections change", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });

    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ currentState: "- Updated but same validation date." }),
      message: "test: update current state",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("last_validated_bump");
  });

  it("requires explicit approval for decisions changes", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });

    const blocked = await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({
        lastValidated: "2026-05-11",
        decisions: "- New decision.",
      }),
      message: "test: update decision",
    });

    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.version).toBeUndefined();

    const approved = await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({
        lastValidated: "2026-05-11",
        decisions: "- New decision.",
      }),
      message: "test: update decision",
      approved: true,
    });

    expect(approved.version).toMatch(/[a-f0-9]{40}/);
  });

  it("builds a grouped dynamic context root and excludes archive by default", async () => {
    await service.writeAnchor({
      name: "agent-rules/codex",
      content: sharedAnchorContent({ title: "Codex Rules", summary: "Rules for Codex agents." }),
      message: "test: add rules",
    });
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add project",
    });
    await service.writeAnchor({
      name: "shared/common",
      content: sharedAnchorContent({ title: "Common Context", summary: "Shared context for all agents." }),
      message: "test: add shared",
    });
    await service.writeAnchor({
      name: "archive/retired",
      content: sharedAnchorContent({ title: "Retired Context", summary: "Old context kept for history." }),
      message: "test: add archive",
    });

    const root = await service.contextRoot({ format: "markdown" });
    expect(root.entries.map((entry) => entry.category)).toEqual(["agent-rules", "projects", "shared"]);
    expect(root.markdown).toContain("Generated by anchor-mcp");
    expect(root.markdown).toContain("## Agent Rules");
    expect(root.markdown).toContain("## Projects");
    expect(root.markdown).not.toContain("## Archive");

    const archived = await service.contextRoot({ includeArchive: true });
    expect(archived.entries.map((entry) => entry.category)).toContain("archive");
  });

  it("writes generated CONTEXT-ROOT.md as a commit", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add project",
    });

    const result = await service.writeContextRoot();
    expect(result.version).toMatch(/[a-f0-9]{40}/);

    const generated = await repo.readRaw("CONTEXT-ROOT");
    expect(generated).toContain("Do not edit manually");
    expect(generated).toContain("[Demo Anchor](projects/demo/demo.md)");
  });

  it("loadContext returns entries plus excerpt anchors in one call", async () => {
    await service.writeAnchor({
      name: "agent-rules/codex",
      content: sharedAnchorContent({ title: "Codex Rules", summary: "Rules for Codex agents." }),
      message: "test: add rules",
    });
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add project",
    });

    const loaded = await service.loadContext({
      project: "demo",
      format: "json",
    });

    expect(loaded.selectionReason).toBe("filter");
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]?.name).toBe("projects/demo/demo.md");
    expect(loaded.totalMatching).toBe(1);
    expect(loaded.returnedCount).toBe(1);
    expect(loaded.truncated).toBe(false);
    expect(loaded.anchors).toHaveLength(1);
    expect(loaded.anchors[0]?.excerpt).toBeDefined();
    expect(loaded.anchors[0]?.content).toBeUndefined();
  });

  it("loadContext paginates with limit and nextCursor", async () => {
    await service.writeAnchor({
      name: "agent-rules/codex",
      content: sharedAnchorContent({ title: "Codex Rules", summary: "Rules for Codex agents." }),
      message: "test: add rules",
    });
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add project",
    });
    await service.writeAnchor({
      name: "shared/common",
      content: sharedAnchorContent({ title: "Common Context", summary: "Shared context for all agents." }),
      message: "test: add shared",
    });

    const first = await service.loadContext({ limit: 1, format: "json" });
    expect(first.returnedCount).toBe(1);
    expect(first.totalMatching).toBe(3);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeDefined();

    const second = await service.loadContext({ cursor: first.nextCursor });
    expect(second.returnedCount).toBe(1);
    expect(second.truncated).toBe(true);

    const third = await service.loadContext({ cursor: second.nextCursor });
    expect(third.returnedCount).toBe(1);
    expect(third.truncated).toBe(false);
    expect(third.nextCursor).toBeUndefined();
  });

  it("loadContext explicit names supports includeContent none", async () => {
    await service.writeAnchor({
      name: "shared/common",
      content: sharedAnchorContent({ title: "Common Context", summary: "Shared context for all agents." }),
      message: "test: add shared",
    });
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add project",
    });

    const loaded = await service.loadContext({
      names: ["shared/common", "projects/demo/demo"],
      includeContent: "none",
      format: "json",
    });

    expect(loaded.selectionReason).toBe("explicit_names");
    expect(loaded.anchors).toHaveLength(2);
    expect(loaded.anchors.every((anchor) => anchor.content === undefined && anchor.excerpt === undefined)).toBe(true);
  });
});

function projectAnchorContent(
  overrides: {
    currentState?: string;
    decisions?: string;
    constraints?: string;
    lastValidated?: string;
    project?: string;
  } = {},
): string {
  return `---
project:
  - ${overrides.project ?? "demo"}
type: design
tags:
  - context
summary: "Demo anchor summary."
read_this_if:
  - "You are working on the demo project."
last_validated: ${overrides.lastValidated ?? "2026-05-10"}
---

# Demo Anchor

## Current State

${overrides.currentState ?? "- The demo anchor exists."}

## Decisions

${overrides.decisions ?? "- Keep storage git-backed."}

## Constraints

${overrides.constraints ?? "- Preserve existing claims."}

## PRs

- [PR Add anchor MCP - #123](https://github.com/example/repo/pull/123)
`;
}

function sharedAnchorContent(
  overrides: {
    title?: string;
    summary?: string;
    currentState?: string;
    decisions?: string;
    constraints?: string;
  } = {},
): string {
  return `---
type: design
tags:
  - context
summary: "${overrides.summary ?? "Shared anchor summary."}"
read_this_if:
  - "You need shared context."
last_validated: 2026-05-10
---

# ${overrides.title ?? "Shared Anchor"}

## Current State

${overrides.currentState ?? "- The shared anchor exists."}

## Decisions

${overrides.decisions ?? "- Keep shared context compact."}

## Constraints

${overrides.constraints ?? "- Preserve existing claims."}

## PRs

- [PR Add shared anchor - #124](https://github.com/example/repo/pull/124)
`;
}
