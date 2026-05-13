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

  it("deleteAnchor requires approval before removing a file", async () => {
    await service.writeAnchor({
      name: "shared/to-delete",
      content: sharedAnchorContent({ title: "Delete Me", summary: "Will be removed." }),
      message: "test: add deletable anchor",
    });

    const blocked = await service.deleteAnchor({ name: "shared/to-delete" });
    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.version).toBeUndefined();

    const done = await service.deleteAnchor({ name: "shared/to-delete", approved: true });
    expect(done.version).toMatch(/[a-f0-9]{40}/);
    expect(await repo.readRaw("shared/to-delete")).toBeUndefined();
  });

  it("renameAnchor requires approval before moving a file", async () => {
    await service.writeAnchor({
      name: "shared/old-name",
      content: sharedAnchorContent({ title: "Renamed", summary: "Moves path." }),
      message: "test: add rename source",
    });

    const blocked = await service.renameAnchor({ from: "shared/old-name", to: "shared/new-name" });
    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.version).toBeUndefined();

    const done = await service.renameAnchor({ from: "shared/old-name", to: "shared/new-name", approved: true });
    expect(done.version).toMatch(/[a-f0-9]{40}/);
    expect(await repo.readRaw("shared/old-name")).toBeUndefined();
    const moved = await repo.readRaw("shared/new-name");
    expect(moved).toContain("Renamed");
  });

  it("blocks deleteAnchor on CONTEXT-ROOT.md", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add project",
    });
    await service.writeContextRoot();

    const result = await service.deleteAnchor({ name: "CONTEXT-ROOT", approved: true });
    expect(result.version).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toContain("generated_file_reserved");
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
    expect(root.entries.map((entry) => entry.category)).toEqual([
      "server-rules",
      "server-rules",
      "agent-rules",
      "projects",
      "shared",
    ]);
    expect(root.markdown).toContain("Generated by anchor-mcp");
    expect(root.markdown).toContain("Built-in server policy");
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
    expect(loaded.entries).toHaveLength(3);
    expect(loaded.entries.map((entry) => entry.name)).toEqual([
      "server-rules/acceptance-criteria.md",
      "server-rules/milestone-usage.md",
      "projects/demo/demo.md",
    ]);
    expect(loaded.totalMatching).toBe(3);
    expect(loaded.returnedCount).toBe(3);
    expect(loaded.truncated).toBe(false);
    expect(loaded.anchors).toHaveLength(3);
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
    expect(first.totalMatching).toBe(5);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeDefined();

    const second = await service.loadContext({ cursor: first.nextCursor });
    expect(second.returnedCount).toBe(1);
    expect(second.truncated).toBe(true);

    const third = await service.loadContext({ cursor: second.nextCursor });
    expect(third.returnedCount).toBe(1);
    expect(third.truncated).toBe(true);
    expect(third.nextCursor).toBeDefined();

    const fourth = await service.loadContext({ cursor: third.nextCursor });
    expect(fourth.returnedCount).toBe(1);
    expect(fourth.truncated).toBe(true);
    expect(fourth.nextCursor).toBeDefined();

    const fifth = await service.loadContext({ cursor: fourth.nextCursor });
    expect(fifth.returnedCount).toBe(1);
    expect(fifth.truncated).toBe(false);
    expect(fifth.nextCursor).toBeUndefined();
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

  it("planContextBundle ranks anchors by task and project", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ summary: "Demo storage decisions and constraints." }),
      message: "test: add demo project",
    });
    await service.writeAnchor({
      name: "projects/other/other",
      content: projectAnchorContent({ project: "other", summary: "Other billing context." }),
      message: "test: add other project",
    });
    await service.writeAnchor({
      name: "shared/storage",
      content: sharedAnchorContent({ title: "Storage Workflow", summary: "Shared storage workflow for anchor planning." }),
      message: "test: add storage guide",
    });

    const planned = await service.planContextBundle({
      task: "Update demo storage decisions",
      project: "demo",
      budgetTokens: 1200,
    });

    expect(planned.included[0]?.name).toBe("projects/demo/demo.md");
    expect(planned.included.map((anchor) => anchor.name)).toContain("shared/storage.md");
    expect(planned.excluded.map((anchor) => anchor.name)).toContain("projects/other/other.md");
    expect(planned.loadContext.names[0]).toBe("server-rules/acceptance-criteria.md");
    expect(planned.loadContext.names).toEqual([
      "server-rules/acceptance-criteria.md",
      "server-rules/milestone-usage.md",
      ...planned.included.map((anchor) => anchor.name),
    ]);
    expect(planned.loadContext.includeContent).toBe("excerpt");
    expect(planned.loadContext.maxBytes).toBe(4800);
    expect(planned.estimatedTokens).toBeLessThanOrEqual(planned.budgetTokens);
  });

  it("planContextBundle explains relevant anchors left out by limits", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ summary: "Demo storage decisions and constraints." }),
      message: "test: add demo project",
    });
    await service.writeAnchor({
      name: "shared/storage",
      content: sharedAnchorContent({ title: "Storage Workflow", summary: "Shared storage workflow for demo decisions." }),
      message: "test: add storage guide",
    });

    const planned = await service.planContextBundle({
      task: "Update demo storage decisions",
      project: "demo",
      budgetTokens: 1200,
      maxAnchors: 1,
    });

    expect(planned.included).toHaveLength(1);
    expect(planned.excluded.some((anchor) => anchor.reason.includes("max anchor count reached"))).toBe(true);
    expect(planned.loadContext.names[0]).toBe("server-rules/acceptance-criteria.md");
    expect(planned.missingContext).toEqual([]);
  });

  it("readAnchor returns fileCommit for latest reads", async () => {
    await service.writeAnchor({
      name: "shared/commit-meta",
      content: sharedAnchorContent({ title: "Commit meta", summary: "For fileCommit field." }),
      message: "test: add anchor for fileCommit",
    });
    const read = await service.readAnchor("shared/commit-meta");
    expect(read.fileCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(read.version).toMatch(/^[a-f0-9]{40}$/);
  });

  it("rejects writeAnchor when expectedFileCommit does not match", async () => {
    await service.writeAnchor({
      name: "shared/stale",
      content: sharedAnchorContent({ title: "Stale", summary: "Stale base test." }),
      message: "test: add stale anchor",
    });
    const result = await service.writeAnchor({
      name: "shared/stale",
      content: sharedAnchorContent({ title: "Stale", summary: "Updated summary only." }),
      message: "test: stale write",
      expectedFileCommit: "0".repeat(40),
    });
    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "stale_base")).toBe(true);
  });

  it("updateAnchorFrontmatter merges YAML without changing body sections", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });
    const result = await service.updateAnchorFrontmatter({
      name: "projects/demo/demo",
      updates: { summary: "Updated demo summary via front matter tool." },
      message: "test: fm merge",
    });
    expect(result.version).toMatch(/[a-f0-9]{40}/);
    const read = await service.readAnchor("projects/demo/demo");
    expect(read.frontmatter.summary).toBe("Updated demo summary via front matter tool.");
    expect(read.content).toContain("## Current State");
    expect(read.content).toContain("- The demo anchor exists.");
  });

  it("appendToAnchorSection appends a valid PR line", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });
    const result = await service.appendToAnchorSection({
      name: "projects/demo/demo",
      heading: "## PRs",
      content: "\n- [PR Chunked append - #999](https://github.com/example/repo/pull/999)",
      message: "test: append pr",
    });
    expect(result.version).toMatch(/[a-f0-9]{40}/);
    const read = await service.readAnchor("projects/demo/demo");
    expect(read.content).toContain("pull/999");
  });

  it("deleteAnchorSection returns section_not_found for unknown heading", async () => {
    await service.writeAnchor({
      name: "shared/del-sec",
      content: sharedAnchorContent({ title: "Del", summary: "Section delete test." }),
      message: "test: add del-sec",
    });
    const result = await service.deleteAnchorSection({
      name: "shared/del-sec",
      heading: "## Missing Section",
      message: "test: bad delete",
    });
    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "section_not_found")).toBe(true);
  });

  it("updateAnchorFrontmatter returns missing_anchor when file does not exist", async () => {
    const result = await service.updateAnchorFrontmatter({
      name: "shared/no-such-anchor",
      updates: { summary: "x" },
      message: "test: missing",
    });
    expect(result.version).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "missing_anchor")).toBe(true);
  });

  it("deleteAnchorSection on a required section is blocked by validators", async () => {
    await service.writeAnchor({
      name: "shared/del-req",
      content: sharedAnchorContent({ title: "Del req", summary: "Required section delete." }),
      message: "test: add del-req",
    });
    const result = await service.deleteAnchorSection({
      name: "shared/del-req",
      heading: "PRs",
      message: "test: delete PRs",
    });
    expect(result.version).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toContain("required_section");
  });

  it("readAnchor returns parsed YAML front matter for built-in policy anchors", async () => {
    const read = await service.readAnchor("server-rules/milestone-usage");
    expect(read.frontmatter.type).toBe("agent-roles");
    expect(typeof read.frontmatter.summary).toBe("string");
    expect((read.frontmatter.summary as string).length).toBeGreaterThan(0);
    expect(Array.isArray(read.frontmatter.read_this_if)).toBe(true);
    expect((read.frontmatter.read_this_if as string[]).length).toBeGreaterThan(0);
    const last = read.frontmatter.last_validated;
    expect(last === "2026-05-13" || (last instanceof Date && last.toISOString().startsWith("2026-05-13"))).toBe(true);
  });

  it("blocks writes to built-in policy anchors", async () => {
    const read = await service.readAnchor("server-rules/acceptance-criteria");
    const res = await service.writeAnchor({ name: read.name, content: read.content });
    expect(res.version).toBeUndefined();
    expect(res.warnings.some((w) => w.code === "reserved_builtin")).toBe(true);

    const readMilestone = await service.readAnchor("server-rules/milestone-usage");
    const resM = await service.writeAnchor({ name: readMilestone.name, content: readMilestone.content });
    expect(resM.version).toBeUndefined();
    expect(resM.warnings.some((w) => w.code === "reserved_builtin")).toBe(true);
  });

  it("lists only built-ins when discovery category is server-rules", async () => {
    await service.writeAnchor({
      name: "shared/plan-list",
      content: sharedAnchorContent({ title: "Plan list", summary: "For list filter test." }),
      message: "test: add shared for list",
    });
    const only = await service.listAnchors({ category: "server-rules" });
    expect(only).toHaveLength(2);
    expect(only.every((a) => a.origin === "built-in")).toBe(true);
    const merged = await service.listAnchors({});
    expect(merged.some((a) => a.name === "server-rules/acceptance-criteria.md")).toBe(true);
    expect(merged.some((a) => a.name === "server-rules/milestone-usage.md")).toBe(true);
    expect(merged.some((a) => a.name === "shared/plan-list.md")).toBe(true);
  });

  it("requires approval when acceptance criteria change on a project roadmap", async () => {
    const base = roadmapAnchorContent();
    await service.writeAnchor({
      name: "projects/demo/demo-roadmap",
      content: base,
      message: "test: add roadmap",
    });
    const changed = base.replace("AC-001: User can log in", "AC-001: User can log in with MFA");
    const bad = await service.writeAnchor({
      name: "projects/demo/demo-roadmap",
      content: changed,
      message: "test: tweak ac",
    });
    expect(bad.requiresApproval).toBe(true);
    const ok = await service.writeAnchor({
      name: "projects/demo/demo-roadmap",
      content: changed,
      message: "test: tweak ac approved",
      approved: true,
    });
    expect(ok.version).toMatch(/[a-f0-9]{40}/);
  });

  it("warns when anchor_mcp_policy.weaken is set on a roadmap", async () => {
    const base = roadmapAnchorContent({
      extraFm: `anchor_mcp_policy:\n  weaken:\n    - require_evidence`,
    });
    const res = await service.writeAnchor({
      name: "projects/demo/demo-roadmap",
      content: base,
      message: "test: roadmap weaken",
      approved: true,
    });
    expect(res.version).toMatch(/[a-f0-9]{40}/);
    expect(res.warnings.some((w) => w.code === "policy_weaken_active")).toBe(true);
  });
});

function roadmapAnchorContent(options: { extraFm?: string } = {}): string {
  const extraLine = options.extraFm ? `${options.extraFm}\n` : "";
  return `---
project:
  - demo
type: project-roadmap
tags: []
summary: "Demo roadmap."
read_this_if:
  - "Planning demo."
last_validated: 2026-05-10
${extraLine}---

# Demo Roadmap

## Goals

### Ship login

#### Acceptance Criteria

#### Approved

- [ ] AC-001: User can log in. Evidence: integration test.

#### Proposed

### Ship audit

#### Acceptance Criteria

#### Approved

- [ ] AC-002: Audit log written. Evidence: manual check.

## Current State

- Planning.

## Decisions

- Use roadmap format.

## Constraints

- Tests required.

## PRs

- [PR Demo roadmap - #1](https://github.com/example/repo/pull/1)
`;
}

function projectAnchorContent(
  overrides: {
    currentState?: string;
    decisions?: string;
    constraints?: string;
    lastValidated?: string;
    project?: string;
    summary?: string;
  } = {},
): string {
  return `---
project:
  - ${overrides.project ?? "demo"}
type: design
tags:
  - context
summary: "${overrides.summary ?? "Demo anchor summary."}"
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
