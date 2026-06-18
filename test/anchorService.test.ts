import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";

let tmpDir: string;
let repo: AnchorRepository;
let service: AnchorService;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-"));
  repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
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

  it("builds planner search input without reading per-anchor file commits", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({
        currentState: "- Demo architecture uses a storage boundary and a read index.",
      }),
      message: "test: add demo anchor",
    });

    const logSpy = vi.spyOn(repo.git, "log");

    await service.planContextBundle({
      task: "storage boundary read index",
      project: "demo",
    });

    expect(logSpy).not.toHaveBeenCalled();
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
    const staleDate = "1900-01-01";
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ lastValidated: staleDate }),
      message: "test: add demo anchor",
    });

    const result = await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ currentState: "- Updated but same validation date.", lastValidated: staleDate }),
      message: "test: update current state",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("last_validated_bump");
  });

  it("allows same-day substantive edits when last_validated already matches today", async () => {
    const today = todayDateKey();
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ lastValidated: today }),
      message: "test: add demo anchor",
    });

    const result = await service.appendToAnchorSection({
      name: "projects/demo/demo",
      heading: "Current State",
      content: "- Updated again on the same day.",
      message: "test: update current state again",
    });

    expect(result.version).toMatch(/[a-f0-9]{40}/);
    expect(result.warnings).toEqual([]);
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

  it("section tools with lastValidated bump the date atomically in the same commit", async () => {
    const staleDate = "1900-01-01";
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ lastValidated: staleDate }),
      message: "test: add demo anchor",
    });

    // Without lastValidated: appending to a substantive section blocks on last_validated_bump.
    const withoutBump = await service.appendToAnchorSection({
      name: "projects/demo/demo",
      heading: "Current State",
      content: "- Extra observation.",
    });
    expect(withoutBump.version).toBeUndefined();
    expect(withoutBump.warnings.map((w) => w.code)).toContain("last_validated_bump");

    // With lastValidated: section append + date bump succeed in one call.
    const withBump = await service.appendToAnchorSection({
      name: "projects/demo/demo",
      heading: "Current State",
      content: "- Extra observation.",
      lastValidated: "2026-05-14",
    });
    expect(withBump.version).toMatch(/[a-f0-9]{40}/);
    expect(withBump.warnings).toEqual([]);

    const read = await service.readAnchor("projects/demo/demo");
    expect(read.frontmatter.last_validated).toBe("2026-05-14");
    expect(read.content).toContain("- Extra observation.");
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
    expect(loaded.entries).toHaveLength(4);
    expect(loaded.entries.map((entry) => entry.name)).toEqual([
      "server-rules/acceptance-criteria.md",
      "server-rules/milestone-usage.md",
      "server-rules/project-updates.md",
      "projects/demo/demo.md",
    ]);
    expect(loaded.totalMatching).toBe(4);
    expect(loaded.returnedCount).toBe(4);
    expect(loaded.truncated).toBe(false);
    expect(loaded.anchors).toHaveLength(4);
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
    expect(first.totalMatching).toBe(6);
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
    expect(fifth.truncated).toBe(true);
    expect(fifth.nextCursor).toBeDefined();

    const sixth = await service.loadContext({ cursor: fifth.nextCursor });
    expect(sixth.returnedCount).toBe(1);
    expect(sixth.truncated).toBe(false);
    expect(sixth.nextCursor).toBeUndefined();
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
      content: projectAnchorContent({
        project: "other",
        summary: "Other billing context.",
        currentState: "- Other project billing context exists.",
        decisions: "- Keep billing records accurate.",
      }),
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
    const serverRuleNames = ["server-rules/acceptance-criteria.md", "server-rules/milestone-usage.md", "server-rules/project-updates.md"];
    expect(planned.loadContext.names).toContain("projects/demo/demo.md");
    expect(planned.loadContext.names.some((n) => serverRuleNames.includes(n))).toBe(false);
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
    expect(planned.missingContext).toEqual([]);
  });

  it("planContextBundle resolves project aliases to canonical slugs", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo-project-context",
      content: projectContextAnchorContent({ aliases: ["context-conductor"] }),
      message: "test: add demo project context with alias",
    });

    const planned = await service.planContextBundle({
      task: "Update demo storage decisions",
      project: "context-conductor",
      budgetTokens: 1200,
    });

    expect(planned.projectFilter).toEqual({
      requested: "context-conductor",
      resolved: "demo",
      via: "alias",
      matchedAlias: "context-conductor",
    });
    expect(planned.included[0]?.name).toBe("projects/demo/demo-project-context.md");
    expect(planned.loadContext.project).toBe("demo");
    expect(planned.missingContext.some((signal) => signal.includes('declares project "context-conductor"'))).toBe(false);
  });

  it("listAnchorsDiscovery returns projectFilter for alias resolution", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo-project-context",
      content: projectContextAnchorContent({ aliases: ["context-conductor"] }),
      message: "test: add demo project context with alias",
    });

    const discovery = await service.listAnchorsDiscovery({ project: "context-conductor" });

    expect(discovery.projectFilter?.via).toBe("alias");
    expect(discovery.anchors.map((anchor) => anchor.name)).toContain("projects/demo/demo-project-context.md");
  });

  it("planContextBundle can plan over built-in server rules only", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ summary: "Demo milestone context." }),
      message: "test: add demo project",
    });

    const planned = await service.planContextBundle({
      task: "Review milestone usage policy",
      category: "server-rules",
    });

    expect(planned.totalCandidates).toBe(3);
    expect(planned.included.map((anchor) => anchor.name)).toContain("server-rules/milestone-usage.md");
    expect(planned.included.map((anchor) => anchor.name)).not.toContain("projects/demo/demo.md");
    expect(new Set(planned.loadContext.names)).toEqual(
      new Set([
        "server-rules/acceptance-criteria.md",
        "server-rules/milestone-usage.md",
        "server-rules/project-updates.md",
      ]),
    );
  });

  it("planContextBundle does not force server-rules into unrelated tasks", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ summary: "Demo storage decisions." }),
    });

    const planned = await service.planContextBundle({
      task: "review demo storage architecture",
      project: "demo",
      budgetTokens: 4000,
    });

    const serverRuleNames = ["server-rules/acceptance-criteria.md", "server-rules/milestone-usage.md", "server-rules/project-updates.md"];
    expect(planned.loadContext.names.some((n) => serverRuleNames.includes(n))).toBe(false);
  });

  it("excerptFromContent strips front matter", async () => {
    const { excerptFromContent } = await import("../src/loadContext.js");
    const content = "---\ntype: test\nsummary: foo\n---\n\n## Current State\n\nBody text here.";
    const result = excerptFromContent(content, 500);
    expect(result.startsWith("---")).toBe(false);
    expect(result).toContain("## Current State");
  });

  it("planContextBundle boosts anchors whose body contains the query term", async () => {
    await service.writeAnchor({
      name: "projects/demo/cbpr-diagnostic",
      content: projectAnchorContent({
        summary: "Generic benefits reporting diagnostics.",
        currentState:
          "- The company_benefit_plans_report (CBPR) model needs restructuring to support new plan types.",
      }),
      message: "test: add CBPR diagnostic anchor",
    });

    const planned = await service.planContextBundle({
      task: "fix CBPR models",
      project: "demo",
      budgetTokens: 4000,
    });

    expect(planned.included.map((anchor) => anchor.name)).toContain("projects/demo/cbpr-diagnostic.md");
    const cbprAnchor = planned.included.find((anchor) => anchor.name === "projects/demo/cbpr-diagnostic.md");
    expect(cbprAnchor?.reason).toContain("bm25 body match");
  });

  it("planContextBundle bounds concurrent BM25 anchor reads", async () => {
    for (let i = 0; i < 9; i += 1) {
      await service.writeAnchor({
        name: `shared/bm25-concurrency-${i}`,
        content: sharedAnchorContent({
          title: `BM25 Concurrency ${i}`,
          summary: `BM25 concurrency fixture ${i}.`,
          currentState: `- Fixture ${i} contains bounded indexing body text.`,
        }),
        message: `test: add bm25 concurrency fixture ${i}`,
      });
    }

    const originalReadAnchor = service.readAnchor.bind(service);
    let inFlight = 0;
    let maxInFlight = 0;
    service.readAnchor = async (name: string, version?: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        return await originalReadAnchor(name, version);
      } finally {
        inFlight -= 1;
      }
    };

    await service.planContextBundle({
      task: "find bounded indexing body text",
      budgetTokens: 4000,
    });

    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it("planContextBundle excludes large-body anchors under a tight token budget", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ summary: "Demo storage decisions and constraints." }),
      message: "test: add demo project",
    });
    await service.writeAnchor({
      name: "shared/storage",
      content: sharedAnchorContent({
        title: "Storage Workflow",
        summary: "Shared storage workflow for demo decisions.",
        currentState: `- ${"x".repeat(12000)}`,
      }),
      message: "test: add large storage guide",
    });

    const planned = await service.planContextBundle({
      task: "Update demo storage decisions",
      project: "demo",
      budgetTokens: 1200,
    });

    expect(planned.included.map((anchor) => anchor.name)).toContain("projects/demo/demo.md");
    expect(planned.excluded.some((anchor) => anchor.name === "shared/storage.md" && anchor.reason.includes("outside token budget"))).toBe(
      true,
    );
  });

  it("loadContext uses task-aware excerpts when task is provided", async () => {
    const padding = "x".repeat(1500);
    await service.writeAnchor({
      name: "projects/demo/roadmap",
      content: `---
project:
  - demo
type: project-roadmap
tags:
  - roadmap
summary: "Demo roadmap for storage and milestone goals."
read_this_if:
  - "You are planning demo work."
last_validated: 2026-05-10
---

# Demo Roadmap

## Current State

- ${padding}

### Goal G-004 -- Session start

Ship startTask and retrieval quality improvements.

## Decisions

- Keep planner deterministic.

## Constraints

- None.

## PRs

None.
`,
      message: "test: add roadmap with late goal section",
    });

    const loaded = await service.loadContext({
      names: ["projects/demo/roadmap.md"],
      includeContent: "excerpt",
      excerptChars: 1200,
      task: "session start G-004",
    });

    expect(loaded.anchors[0]?.excerpt).toContain("Goal G-004");
    expect(loaded.anchors[0]?.excerpt).toContain("startTask");
  });

  it("planContextBundle flags stale included anchors", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({
        summary: "Demo storage decisions and constraints.",
        lastValidated: "2025-01-01",
      }),
      message: "test: add stale demo project",
    });

    const planned = await service.planContextBundle({
      task: "Update demo storage decisions",
      project: "demo",
      budgetTokens: 4000,
    });

    expect(planned.included[0]?.stale).toBe(true);
    expect(planned.missingContext.some((signal) => signal.includes("may be stale"))).toBe(true);
  });

  it("startTask plans and loads anchor excerpts in one call", async () => {
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

    const started = await service.startTask({
      task: "Update demo storage decisions",
      project: "demo",
      budgetTokens: 1200,
    });

    expect(started.plan.included.map((anchor) => anchor.name)).toContain("projects/demo/demo.md");
    expect(started.anchors.length).toBeGreaterThan(0);
    expect(started.anchors[0]?.excerpt ?? started.anchors[0]?.content).toBeDefined();
    expect(started.suggestedFollowUp.readAnchor).toContain("projects/demo/demo.md");
    expect(started.staleness.staleAfterDays).toBe(45);
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

  it("requires approval for project priority changes and stores numeric priorities", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });

    const blocked = await service.updateAnchorFrontmatter({
      name: "projects/demo/demo",
      updates: { priority: 1.1 },
      message: "test: set priority",
    });
    expect(blocked.version).toBeUndefined();
    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.warnings.map((warning) => warning.code)).toContain("requires_approval");

    const approved = await service.updateProjectPriority({
      project: "demo",
      priority: 1.1,
      approved: true,
      message: "test: set approved priority",
    });
    expect(approved.version).toMatch(/[a-f0-9]{40}/);

    const read = await service.readAnchor("projects/demo/demo");
    expect(read.frontmatter.priority).toBe(1.1);
    const listed = await service.listAnchors({ project: "demo" });
    expect(listed.find((anchor) => anchor.name === "projects/demo/demo.md")?.priority).toBe(1.1);
  });

  it("sorts anchor pages by priority with unprioritized anchors last", async () => {
    await service.writeAnchor({
      name: "projects/demo/lower",
      content: projectAnchorContent({ summary: "Lower priority demo anchor." }),
      message: "test: add lower",
    });
    await service.writeAnchor({
      name: "projects/demo/higher",
      content: projectAnchorContent({ summary: "Higher priority demo anchor." }),
      message: "test: add higher",
    });
    await service.writeAnchor({
      name: "projects/demo/unprioritized",
      content: projectAnchorContent({ summary: "Unprioritized demo anchor." }),
      message: "test: add unprioritized",
    });

    await service.updateProjectPriority({ name: "projects/demo/lower", priority: 2.045, approved: true });
    await service.updateProjectPriority({ name: "projects/demo/higher", priority: 1.1, approved: true });

    const page = await service.listAnchorsDiscoveryPage({ project: "demo" }, { sort: "priority", offset: 0, limit: 3 });

    expect(page.anchors.map((anchor) => anchor.name)).toEqual([
      "projects/demo/higher.md",
      "projects/demo/lower.md",
      "projects/demo/unprioritized.md",
    ]);
  });

  it("rejects non-numeric priority front matter", async () => {
    const result = await service.writeAnchor({
      name: "projects/demo/bad-priority",
      content: `---
project:
  - demo
type: context-anchor
tags:
  - context-anchor
summary: "Demo anchor summary."
read_this_if:
  - "You need demo context."
last_validated: 2026-05-20
priority: P1
---

# Demo

## Current State

- Exists.

## Decisions

- None.

## Constraints

- None.

## PRs

None.
`,
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("front_matter_schema");
    expect(result.warnings.map((warning) => warning.code)).not.toContain("requires_approval");
    expect(result.requiresApproval).toBe(false);
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

    const readUpdates = await service.readAnchor("server-rules/project-updates");
    expect(readUpdates.content).toContain("put a task on a project backlog");
    expect(readUpdates.content).toContain("ask the user for both the date");
    expect(readUpdates.content).toContain("`committed`, an `internal_goal`, or `estimated`");
    const resU = await service.writeAnchor({ name: readUpdates.name, content: readUpdates.content });
    expect(resU.version).toBeUndefined();
    expect(resU.warnings.some((w) => w.code === "reserved_builtin")).toBe(true);
  });

  it("lists only built-ins when discovery category is server-rules", async () => {
    await service.writeAnchor({
      name: "shared/plan-list",
      content: sharedAnchorContent({ title: "Plan list", summary: "For list filter test." }),
      message: "test: add shared for list",
    });
    const only = await service.listAnchors({ category: "server-rules" });
    expect(only).toHaveLength(3);
    expect(only.every((a) => a.origin === "built-in")).toBe(true);
    const merged = await service.listAnchors({});
    expect(merged.some((a) => a.name === "server-rules/acceptance-criteria.md")).toBe(true);
    expect(merged.some((a) => a.name === "server-rules/milestone-usage.md")).toBe(true);
    expect(merged.some((a) => a.name === "server-rules/project-updates.md")).toBe(true);
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

  it("creates, previews, applies, and marks a project proposed change", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });

    const proposed = await service.proposeChange({
      scope: { kind: "project", project: "demo" },
      target: "projects/demo/demo.md",
      summary: "Record proposed change support",
      operations: [
        {
          type: "section.append",
          heading: "Current State",
          content: "- Proposed-change ledgers can stage reviewable edits.",
          lastValidated: todayDateKey(),
        },
      ],
    });

    expect(proposed.version).toMatch(/[a-f0-9]{40}/);
    expect(proposed.warnings).toEqual([]);
    expect(proposed.proposal.id).toMatch(/^PC-\d{8}-/);
    expect(proposed.proposal.ledgerName).toBe("projects/demo/demo-proposed-changes.md");

    const listed = await service.listProposedChanges({ project: "demo", status: "pending" });
    expect(listed.proposals.map((proposal) => proposal.id)).toContain(proposed.proposal.id);

    const root = await service.contextRoot({ project: "demo", format: "json" });
    expect(root.entries.map((entry) => entry.name)).not.toContain("projects/demo/demo-proposed-changes.md");

    const preview = await service.previewProposedChange(proposed.proposal.id);
    expect(preview.stale).toBe(false);
    expect(preview.diff).toContain("+- Proposed-change ledgers can stage reviewable edits.");
    expect(preview.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const blocked = await service.applyProposedChange({ id: proposed.proposal.id });
    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.warnings.map((warning) => warning.code)).toContain("requires_approval");

    const applied = await service.applyProposedChange({
      id: proposed.proposal.id,
      approved: true,
      appliedBy: "human-reviewer",
    });
    expect(applied.targetVersion).toMatch(/[a-f0-9]{40}/);
    expect(applied.ledgerVersion).toMatch(/[a-f0-9]{40}/);
    expect(applied.proposal.status).toBe("applied");
    expect(applied.proposal.appliedBy).toBe("human-reviewer");

    const readTarget = await service.readAnchor("projects/demo/demo.md");
    expect(readTarget.content).toContain("- Proposed-change ledgers can stage reviewable edits.");
  });

  it("supports proposed changes to agent rules and blocks cross-scope project targets", async () => {
    await service.writeAnchor({
      name: "agent-rules/codex",
      content: sharedAnchorContent({ title: "Codex Rules", summary: "Agent rule summary." }),
      message: "test: add agent rule",
    });

    const proposed = await service.proposeChange({
      scope: { kind: "agent-rules" },
      target: "agent-rules/codex.md",
      summary: "Clarify agent rule",
      operations: [
        {
          type: "section.append",
          heading: "Current State",
          content: "- Agent-rule proposals use their own ledger.",
          lastValidated: todayDateKey(),
        },
      ],
    });

    expect(proposed.warnings).toEqual([]);
    expect(proposed.proposal.ledgerName).toBe("agent-rules/agent-rules-proposed-changes.md");
    const agentRuleProposals = await service.listProposedChanges({ scope: "agent-rules" });
    expect(agentRuleProposals.proposals.map((proposal) => proposal.id)).toContain(proposed.proposal.id);

    const blocked = await service.proposeChange({
      scope: { kind: "project", project: "demo" },
      target: "agent-rules/codex.md",
      summary: "Wrong scope",
      operations: [{ type: "section.append", heading: "Current State", content: "- Wrong." }],
    });
    expect(blocked.version).toBeUndefined();
    expect(blocked.warnings.map((warning) => warning.code)).toContain("proposed_change_target_scope");
  });

  it("flags stale proposed changes before apply", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent({ lastValidated: todayDateKey() }),
      message: "test: add demo anchor",
    });

    const proposed = await service.proposeChange({
      scope: { kind: "project", project: "demo" },
      target: "projects/demo/demo.md",
      summary: "Append stale note",
      operations: [
        {
          type: "section.append",
          heading: "Current State",
          content: "- This should not apply after a concurrent write.",
        },
      ],
    });
    expect(proposed.version).toMatch(/[a-f0-9]{40}/);

    await service.appendToAnchorSection({
      name: "projects/demo/demo.md",
      heading: "Current State",
      content: "- Concurrent update.",
    });

    const preview = await service.previewProposedChange(proposed.proposal.id);
    expect(preview.stale).toBe(true);
    expect(preview.warnings.map((warning) => warning.code)).toContain("stale_base");

    const applied = await service.applyProposedChange({ id: proposed.proposal.id, approved: true });
    expect(applied.targetVersion).toBeUndefined();
    expect(applied.warnings.map((warning) => warning.code)).toContain("stale_base");
  });

  it("reports malformed proposal records without throwing during validation", async () => {
    const result = await service.writeAnchor({
      name: "projects/demo/demo-proposed-changes.md",
      content: proposalLedgerContent({
        proposedChanges: `### PC-20260525-missing-scope

\`\`\`json anchor-mcp-proposed-change
{
  "id": "PC-20260525-missing-scope",
  "status": "pending",
  "summary": "Missing scope",
  "target": "projects/demo/demo.md",
  "createdAt": "2026-05-25T00:00:00.000Z",
  "updatedAt": "2026-05-25T00:00:00.000Z",
  "operations": [
    {
      "type": "section.append",
      "heading": "Current State",
      "content": "- Missing scope should be reported."
    }
  ]
}
\`\`\``,
      }),
      message: "test: malformed proposal record",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("proposed_changes_shape");
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Proposal fence does not contain a valid proposed-change record.",
    );
  });

  it("returns a blocking warning when appending to a malformed proposal ledger", async () => {
    await service.writeAnchor({
      name: "projects/demo/demo",
      content: projectAnchorContent(),
      message: "test: add demo anchor",
    });
    await repo.commitAnchor({
      name: "projects/demo/demo-proposed-changes.md",
      content: proposalLedgerContent({ includeProposedChanges: false }),
      message: "test: seed malformed proposal ledger",
    });

    const proposed = await service.proposeChange({
      scope: { kind: "project", project: "demo" },
      target: "projects/demo/demo.md",
      summary: "Append via malformed ledger",
      operations: [{ type: "section.append", heading: "Current State", content: "- Should not throw." }],
    });

    expect(proposed.version).toBeUndefined();
    expect(proposed.warnings.map((warning) => warning.code)).toContain("proposed_change_ledger_malformed");
    expect(proposed.warnings.map((warning) => warning.message)).toContain("No section matching heading: Proposed Changes");
  });

  it("rejects proposal type arrays with mismatched or conflicting scopes", async () => {
    const mismatched = await service.writeAnchor({
      name: "projects/demo/demo-proposed-changes.md",
      content: proposalLedgerContent({
        type: "[project-proposed-changes]",
        proposalScope: "  kind: agent-rules",
      }),
      message: "test: mismatched proposal type array",
    });
    expect(mismatched.version).toBeUndefined();
    expect(mismatched.warnings.map((warning) => warning.code)).toContain("front_matter_typed_schema");
    expect(mismatched.warnings.map((warning) => warning.message)).toContain(
      "Typed front matter proposal_scope.kind must be project for type: project-proposed-changes",
    );

    const conflicting = await service.writeAnchor({
      name: "projects/demo/demo-proposed-changes.md",
      content: proposalLedgerContent({
        type: "[project-proposed-changes, agent-rule-proposed-changes]",
      }),
      message: "test: conflicting proposal type array",
    });
    expect(conflicting.version).toBeUndefined();
    expect(conflicting.warnings.map((warning) => warning.message)).toContain(
      "Typed front matter type must not include both proposed-change ledger types",
    );
  });
});

describe("AnchorService task write APIs", () => {
  const noBlocks = (result: { warnings: { severity: string }[] }) =>
    result.warnings.filter((w) => w.severity === "BLOCK");

  it("createTask auto-creates a backlog milestone and assigns a T- id", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });

    const result = await service.createTask({ project: "demo", title: "Write the thing" });

    expect(noBlocks(result)).toEqual([]);
    expect(result.taskId).toBe("T-1");
    expect(result.milestoneName).toBe("projects/demo/milestones/backlog.md");

    const { tasks } = await service.listTasksDue({ project: "demo" });
    const created = tasks.find((t) => t.taskId === "T-1");
    expect(created?.taskTitle).toBe("Write the thing");
    expect(created?.taskStatus).toBe("todo");
    expect(created?.taskOwner).toBeUndefined();
  });

  it("createTask requires dateConfidence when due is set", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });

    const result = await service.createTask({ project: "demo", title: "x", due: "2026-07-01" });

    expect(result.taskId).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toContain("missing_date_confidence");
  });

  it("createTask increments task ids across calls", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });

    const first = await service.createTask({ project: "demo", title: "first" });
    const second = await service.createTask({ project: "demo", title: "second" });

    expect(first.taskId).toBe("T-1");
    expect(second.taskId).toBe("T-2");
  });

  it("listTasksDue can filter to unassigned tasks only", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });
    await service.createTask({ project: "demo", title: "owned", owner: "alice" });
    await service.createTask({ project: "demo", title: "free" });

    const { tasks } = await service.listTasksDue({ project: "demo", unassigned: true });
    expect(tasks.map((t) => t.taskTitle)).toEqual(["free"]);
  });

  it("listTasksDue includes project priority for task display", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });
    await service.updateProjectPriority({ project: "demo", priority: 1.1, approved: true });
    await service.createTask({ project: "demo", title: "prioritized" });

    const { tasks } = await service.listTasksDue({ project: "demo" });

    expect(tasks.find((task) => task.taskTitle === "prioritized")?.projectPriority).toBe(1.1);
  });

  it("updateTaskOwner assigns and clears a task owner", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });
    const created = await service.createTask({ project: "demo", title: "assign me" });

    const assigned = await service.updateTaskOwner({
      name: created.milestoneName!,
      taskId: created.taskId!,
      owner: "alice",
    });
    expect(noBlocks(assigned)).toEqual([]);
    let listed = await service.listTasksDue({ project: "demo" });
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.taskOwner).toBe("alice");

    const cleared = await service.updateTaskOwner({
      name: created.milestoneName!,
      taskId: created.taskId!,
      owner: null,
    });
    expect(noBlocks(cleared)).toEqual([]);
    listed = await service.listTasksDue({ project: "demo" });
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.taskOwner).toBeUndefined();
  });

  it("completeTask marks a task done with a completion date", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });
    const created = await service.createTask({ project: "demo", title: "finish me" });

    const done = await service.completeTask({ taskId: created.taskId!, project: "demo" });
    expect(noBlocks(done)).toEqual([]);

    const { tasks } = await service.listTasksDue({ project: "demo", status: ["done"] });
    expect(tasks.find((t) => t.taskId === created.taskId)?.taskStatus).toBe("done");
  });

  it("deleteTask removes a task from its milestone", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });
    const created = await service.createTask({ project: "demo", title: "temporary" });

    const deleted = await service.deleteTask({ taskId: created.taskId!, project: "demo" });
    expect(noBlocks(deleted)).toEqual([]);

    const { tasks } = await service.listTasksDue({
      project: "demo",
      status: ["todo", "active", "blocked", "done", "cancelled"],
    });
    expect(tasks.map((t) => t.taskId)).not.toContain(created.taskId);
  });

  it("createTask rejects an explicit milestone that is not a project milestone path", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });

    const result = await service.createTask({
      project: "demo",
      title: "stray",
      milestone: "projects/demo/demo.md",
    });

    expect(result.taskId).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toContain("invalid_milestone");
  });

  it("completeTask and deleteTask reject a non-milestone anchor name", async () => {
    await service.writeAnchor({ name: "projects/demo/demo", content: projectAnchorContent() });

    const completed = await service.completeTask({ taskId: "T-1", name: "projects/demo/demo.md" });
    expect(completed.warnings.map((w) => w.code)).toContain("invalid_milestone");

    const deleted = await service.deleteTask({ taskId: "T-1", name: "projects/demo/demo.md" });
    expect(deleted.warnings.map((w) => w.code)).toContain("invalid_milestone");
  });
});

describe("AnchorService people registry caching", () => {
  it("refreshes the cached registry when the file changes out of band", async () => {
    await service.writePeopleRegistry({
      registry: { people: [{ id: "alice", displayName: "Alice" }], teams: [] },
    });
    expect((await service.listPeople()).people.map((p) => p.id)).toEqual(["alice"]);

    // Simulate a background AutoSync rebase / external edit: write a new commit
    // straight through the repo, bypassing the service's own cache invalidation.
    await repo.writePeopleRegistryRaw(
      { people: [{ id: "bob", displayName: "Bob" }], teams: [] },
      { message: "test: out-of-band registry change" },
    );

    expect((await service.listPeople()).people.map((p) => p.id)).toEqual(["bob"]);
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

function projectContextAnchorContent(
  overrides: {
    summary?: string;
    aliases?: string[];
    project?: string;
  } = {},
): string {
  const project = overrides.project ?? "demo";
  const aliasBlock =
    overrides.aliases && overrides.aliases.length > 0
      ? `aliases:\n${overrides.aliases.map((alias) => `  - ${alias}`).join("\n")}\n`
      : "";
  return `---
project:
  - ${project}
${aliasBlock}type: context-anchor
tags:
  - context
summary: "${overrides.summary ?? "Demo project context summary."}"
read_this_if:
  - "You are working on the demo project."
last_validated: 2026-05-10
---

# Demo Project Context

## Current State

- The demo project context exists.

## Decisions

- Keep storage git-backed.

## Constraints

- Preserve existing claims.

## PRs

- [PR Add anchor MCP - #123](https://github.com/example/repo/pull/123)
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

function proposalLedgerContent(
  options: {
    includeProposedChanges?: boolean;
    proposedChanges?: string;
    proposalScope?: string;
    type?: string;
  } = {},
): string {
  const proposalSection =
    options.includeProposedChanges === false
      ? ""
      : `## Proposed Changes

${options.proposedChanges ?? "None."}

`;
  return `---
project:
  - demo
type: ${options.type ?? "project-proposed-changes"}
tags:
  - proposed-changes
summary: "Reviewable proposed changes for project demo."
read_this_if:
  - "You are reviewing pending proposed changes for project demo."
last_validated: 2026-05-25
schema_version: 1
proposal_scope:
${options.proposalScope ?? "  kind: project\n  project: demo"}
---

# Proposed Changes -- demo

## Current State

- This ledger stores proposed changes for project \`demo\`.

## Decisions

- Review proposed changes before mutating target anchors.

## Constraints

- Pending proposals must not be treated as current project truth.

${proposalSection}## PRs

None.
`;
}

function todayDateKey(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
