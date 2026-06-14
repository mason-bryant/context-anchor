import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { startHttpServer } from "../src/http/server.js";

let tmpDir: string;
let server: Server | undefined;
let baseUrl: string;
let service: AnchorService;

const TOKEN = "test-token";

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-ui-"));
  const repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

  const result = await service.writeAnchor({
    name: "projects/demo/demo.md",
    content: projectAnchorContent(),
    message: "test: add demo anchor",
    approved: true,
  });
  expect(result.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

  server = await startHttpServer(
    {
      repoPath: tmpDir,
      anchorRoot: ".",
      autoSync: false,
      pushOnWrite: false,
      syncIntervalMs: 0,
      migrationWarnOnly: false,
      staleAfterDays: 45,
    },
    {
      host: "127.0.0.1",
      port: 0,
      authToken: TOKEN,
      stateless: true,
    },
  );

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("UI HTTP routes", () => {
  it("serves the read-only UI shell without API auth", async () => {
    const response = await fetch(`${baseUrl}/ui`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Context explorer and guarded editor");
    expect(html).toContain("/ui/app.js");
  });

  it("redirects anchor markdown paths back into the UI", async () => {
    const response = await fetch(`${baseUrl}/server-rules/acceptance-criteria.md`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui?anchor=server-rules%2Facceptance-criteria.md");
  });

  it("protects UI API routes with the HTTP auth token", async () => {
    const unauthorized = await fetch(`${baseUrl}/api/ui/anchors`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetchJson<{ anchors: unknown[] }>("/api/ui/anchors");
    expect(authorized.anchors.length).toBeGreaterThan(0);
  });

  it("returns decorated anchor list and generated context root preview", async () => {
    const anchors = await fetchJson<{
      anchors: Array<{ name: string; ui: { health: { status: string } } }>;
    }>("/api/ui/anchors?project=demo");
    const root = await fetchJson<{ markdown: string; entries: Array<{ name: string }> }>(
      "/api/ui/context-root?project=demo",
    );

    expect(anchors.anchors.map((anchor) => anchor.name)).toContain("projects/demo/demo.md");
    expect(anchors.anchors.find((anchor) => anchor.name === "projects/demo/demo.md")?.ui.health.status).toBe("ok");
    expect(root.markdown).toContain("# CONTEXT-ROOT");
    expect(root.markdown).toContain("Demo Anchor");
    expect(root.entries.map((entry) => entry.name)).toContain("projects/demo/demo.md");
  });

  it("returns sorted and paged anchor batches for progressive UI loading", async () => {
    const restore = stubAnchorServiceMethod("listAnchorsDiscovery", vi.fn(async () => ({
      anchors: [
        uiAnchorMeta("projects/demo/old.md", "2026-05-01T00:00:00.000Z"),
        uiAnchorMeta("projects/demo/new.md", "2026-05-03T00:00:00.000Z"),
        uiAnchorMeta("projects/demo/middle.md", "2026-05-02T00:00:00.000Z"),
      ],
    })));

    try {
      const response = await fetchJson<{
        anchors: Array<{ name: string }>;
        total: number;
        offset: number;
        limit: number;
        nextOffset?: number;
        sort: string;
      }>("/api/ui/anchors?sort=updated&limit=2&offset=1");

      expect(response.anchors.map((anchor) => anchor.name)).toEqual([
        "projects/demo/middle.md",
        "projects/demo/old.md",
      ]);
      expect(response.total).toBe(3);
      expect(response.offset).toBe(1);
      expect(response.limit).toBe(2);
      expect(response.nextOffset).toBeUndefined();
      expect(response.sort).toBe("updated");
    } finally {
      restore();
    }
  });

  it("returns context planner output for the UI", async () => {
    const plan = await fetchJson<{
      included: Array<{ name: string; reason: string }>;
      excluded: Array<{ name: string; reason: string }>;
      loadContext: { names: string[]; includeContent: string; maxBytes: number };
      missingContext: string[];
    }>("/api/ui/context-plan?task=Update%20demo%20context&project=demo&budgetTokens=1200&maxAnchors=1&maxExcluded=5");

    expect(plan.included[0]?.name).toBe("projects/demo/demo.md");
    expect(plan.included[0]?.reason).toContain('project matches "demo"');
    expect(plan.loadContext.names).toContain("projects/demo/demo.md");
    const serverRuleNames = ["server-rules/acceptance-criteria.md", "server-rules/milestone-usage.md", "server-rules/project-updates.md"];
    expect(plan.loadContext.names.some((n: string) => serverRuleNames.includes(n))).toBe(false);
    expect(plan.loadContext.includeContent).toBe("excerpt");
    expect(plan.loadContext.maxBytes).toBe(4800);
    expect(plan.missingContext).toEqual([]);
  });

  it("returns anchor detail with required section status and front matter", async () => {
    const detail = await fetchJson<{
      anchor: {
        name: string;
        frontmatter: { project: string[] };
        ui: {
          sections: { "Current State": boolean; Decisions: boolean; Constraints: boolean; PRs: boolean };
          health: { status: string };
        };
      };
    }>("/api/ui/anchor?name=projects%2Fdemo%2Fdemo.md");

    expect(detail.anchor.name).toBe("projects/demo/demo.md");
    expect(detail.anchor.frontmatter.project).toEqual(["demo"]);
    expect(detail.anchor.ui.sections).toEqual({
      "Current State": true,
      Decisions: true,
      Constraints: true,
      PRs: true,
    });
    expect(detail.anchor.ui.health.status).toBe("ok");
  });

  it("does not rescan the anchor index for detail requests", async () => {
    const listAnchors = vi.spyOn(AnchorService.prototype, "listAnchors");

    const detail = await fetchJson<{ anchor: { name: string } }>("/api/ui/anchor?name=projects%2Fdemo%2Fdemo.md");

    expect(detail.anchor.name).toBe("projects/demo/demo.md");
    expect(listAnchors).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid UI API filters", async () => {
    const response = await fetch(`${baseUrl}/api/ui/anchors?category=bad`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Invalid category");

    const badSort = await fetch(`${baseUrl}/api/ui/anchors?sort=bad`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(badSort.status).toBe(400);
  });

  it("returns 400 for invalid planner query parameters", async () => {
    const missingTask = await fetch(`${baseUrl}/api/ui/context-plan?project=demo`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const invalidBudget = await fetch(`${baseUrl}/api/ui/context-plan?task=demo&budgetTokens=0`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(missingTask.status).toBe(400);
    expect(((await missingTask.json()) as { error: { message: string } }).error.message).toContain(
      "Missing required query parameter: task",
    );
    expect(invalidBudget.status).toBe(400);
    expect(((await invalidBudget.json()) as { error: { message: string } }).error.message).toContain(
      "Invalid budgetTokens",
    );
  });

  it("routes proposed-change list requests with optional filters", async () => {
    const restore = stubAnchorServiceMethod("listProposedChanges", vi.fn(async () => ({ proposals: [{ id: "pc-1" }] })));

    try {
      const response = await fetchJson<{ proposals: Array<{ id: string }> }>(
        "/api/ui/proposed-changes?project=demo&scope=agent-rules&status=pending",
      );
      expect(response.proposals).toEqual([{ id: "pc-1" }]);
      expect((AnchorService.prototype as unknown as { listProposedChanges: ReturnType<typeof vi.fn> }).listProposedChanges)
        .toHaveBeenCalledWith({ project: "demo", scope: "agent-rules", status: "pending" });
    } finally {
      restore();
    }
  });

  it("routes proposed-change detail and preview requests by id", async () => {
    const restoreRead = stubAnchorServiceMethod("readProposedChange", vi.fn(async () => ({ id: "pc-1" })));
    const restorePreview = stubAnchorServiceMethod("previewProposedChange", vi.fn(async () => ({ id: "pc-1" })));

    try {
      const detail = await fetchJson<{ id: string }>("/api/ui/proposed-change?id=pc-1");
      const preview = await fetchJson<{ id: string }>("/api/ui/proposed-change-preview?id=pc-1");

      expect(detail.id).toBe("pc-1");
      expect(preview.id).toBe("pc-1");
      expect(
        (AnchorService.prototype as unknown as { readProposedChange: ReturnType<typeof vi.fn> }).readProposedChange,
      ).toHaveBeenCalledWith("pc-1");
      expect(
        (AnchorService.prototype as unknown as { previewProposedChange: ReturnType<typeof vi.fn> }).previewProposedChange,
      ).toHaveBeenCalledWith("pc-1");
    } finally {
      restoreRead();
      restorePreview();
    }
  });

  it("routes proposed-change mutation requests", async () => {
    const restorePropose = stubAnchorServiceMethod("proposeChange", vi.fn(async () => ({ proposal: { id: "pc-1" }, warnings: [] })));
    const restoreReview = stubAnchorServiceMethod("reviewProposedChange", vi.fn(async () => ({ proposal: { id: "pc-1" }, warnings: [] })));
    const restoreApply = stubAnchorServiceMethod("applyProposedChange", vi.fn(async () => ({ proposal: { id: "pc-1" }, warnings: [] })));

    try {
      await postJson("/api/ui/propose-change", {
        scope: { kind: "project", project: "demo" },
        target: "projects/demo/demo.md",
        summary: "Update demo state",
        operations: [{ type: "section.append", heading: "Current State", content: "- New fact." }],
        rationale: "Keep context fresh.",
      });
      await postJson("/api/ui/proposed-change-review", {
        id: "pc-1",
        status: "changes_requested",
        note: "Tighten wording.",
        expectedLedgerFileCommit: "abc123",
      });
      await postJson("/api/ui/proposed-change-apply", {
        id: "pc-1",
        approved: true,
        message: "test: apply proposal",
        expectedLedgerFileCommit: "abc123",
      });

      expect((AnchorService.prototype as unknown as { proposeChange: ReturnType<typeof vi.fn> }).proposeChange)
        .toHaveBeenCalledWith({
          scope: { kind: "project", project: "demo" },
          target: "projects/demo/demo.md",
          summary: "Update demo state",
          operations: [{ type: "section.append", heading: "Current State", content: "- New fact." }],
          rationale: "Keep context fresh.",
          createdBy: undefined,
          message: undefined,
        });
      expect((AnchorService.prototype as unknown as { reviewProposedChange: ReturnType<typeof vi.fn> }).reviewProposedChange)
        .toHaveBeenCalledWith({
          id: "pc-1",
          status: "changes_requested",
          note: "Tighten wording.",
          reviewedBy: undefined,
          message: undefined,
          expectedLedgerFileCommit: "abc123",
        });
      expect((AnchorService.prototype as unknown as { applyProposedChange: ReturnType<typeof vi.fn> }).applyProposedChange)
        .toHaveBeenCalledWith({
          id: "pc-1",
          approved: true,
          appliedBy: undefined,
          message: "test: apply proposal",
          coAuthor: undefined,
          expectedLedgerFileCommit: "abc123",
        });
    } finally {
      restorePropose();
      restoreReview();
      restoreApply();
    }
  });

  it("routes direct anchor edit requests", async () => {
    const restoreFrontmatter = stubAnchorServiceMethod("updateAnchorFrontmatter", vi.fn(async () => ({ version: "v1", warnings: [] })));
    const restoreSection = stubAnchorServiceMethod("updateAnchorSection", vi.fn(async () => ({ version: "v2", warnings: [] })));
    const restoreAppend = stubAnchorServiceMethod("appendToAnchorSection", vi.fn(async () => ({ version: "v3", warnings: [] })));
    const restoreDeleteSection = stubAnchorServiceMethod("deleteAnchorSection", vi.fn(async () => ({ version: "v4", warnings: [] })));

    try {
      await postJson("/api/ui/anchor-frontmatter", {
        name: "projects/demo/demo.md",
        updates: { summary: "Updated summary." },
        expectedFileCommit: "abc123",
      });
      await postJson("/api/ui/anchor-section", {
        name: "projects/demo/demo.md",
        heading: "Current State",
        content: "- Updated.",
        lastValidated: "2026-06-06",
        approved: true,
      });
      await postJson("/api/ui/anchor-append", {
        name: "projects/demo/demo.md",
        heading: "PRs",
        content: "- [PR Demo - #1](https://github.com/example/repo/pull/1)",
      });
      await postJson("/api/ui/anchor-section-delete", {
        name: "projects/demo/demo.md",
        heading: "Old Section",
        approved: true,
      });

      expect((AnchorService.prototype as unknown as { updateAnchorFrontmatter: ReturnType<typeof vi.fn> }).updateAnchorFrontmatter)
        .toHaveBeenCalledWith({
          name: "projects/demo/demo.md",
          updates: { summary: "Updated summary." },
          message: undefined,
          approved: undefined,
          coAuthor: undefined,
          expectedFileCommit: "abc123",
        });
      expect((AnchorService.prototype as unknown as { updateAnchorSection: ReturnType<typeof vi.fn> }).updateAnchorSection)
        .toHaveBeenCalledWith({
          name: "projects/demo/demo.md",
          heading: "Current State",
          content: "- Updated.",
          lastValidated: "2026-06-06",
          message: undefined,
          approved: true,
          coAuthor: undefined,
          expectedFileCommit: undefined,
        });
      expect((AnchorService.prototype as unknown as { appendToAnchorSection: ReturnType<typeof vi.fn> }).appendToAnchorSection)
        .toHaveBeenCalledWith({
          name: "projects/demo/demo.md",
          heading: "PRs",
          content: "- [PR Demo - #1](https://github.com/example/repo/pull/1)",
          lastValidated: undefined,
          message: undefined,
          approved: undefined,
          coAuthor: undefined,
          expectedFileCommit: undefined,
        });
      expect((AnchorService.prototype as unknown as { deleteAnchorSection: ReturnType<typeof vi.fn> }).deleteAnchorSection)
        .toHaveBeenCalledWith({
          name: "projects/demo/demo.md",
          heading: "Old Section",
          lastValidated: undefined,
          message: undefined,
          approved: true,
          coAuthor: undefined,
          expectedFileCommit: undefined,
        });
    } finally {
      restoreFrontmatter();
      restoreSection();
      restoreAppend();
      restoreDeleteSection();
    }
  });

  it("rejects invalid boolean strings in UI mutation bodies", async () => {
    const response = await fetch(`${baseUrl}/api/ui/anchor-delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "projects/demo/demo.md",
        approved: "yes",
      }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Invalid approved: expected a boolean");
  });

  it("routes anchor history and destructive action requests", async () => {
    const restoreVersions = stubAnchorServiceMethod("listVersions", vi.fn(async () => [{ version: "a", author: "A", date: "2026-06-06", message: "one" }]));
    const restoreDiff = stubAnchorServiceMethod("diffAnchor", vi.fn(async () => "diff --git a b"));
    const restoreRevert = stubAnchorServiceMethod("revertAnchor", vi.fn(async () => ({ newVersion: "b" })));
    const restoreRename = stubAnchorServiceMethod("renameAnchor", vi.fn(async () => ({ version: "c", warnings: [] })));
    const restoreDelete = stubAnchorServiceMethod("deleteAnchor", vi.fn(async () => ({ version: "d", warnings: [] })));

    try {
      const versions = await fetchJson<{ versions: Array<{ version: string }> }>(
        "/api/ui/anchor-versions?name=projects%2Fdemo%2Fdemo.md&limit=5",
      );
      const diff = await fetchJson<{ patch: string }>(
        "/api/ui/anchor-diff?name=projects%2Fdemo%2Fdemo.md&fromVersion=a&toVersion=b",
      );
      await postJson("/api/ui/anchor-revert", {
        name: "projects/demo/demo.md",
        toVersion: "a",
        message: "test: revert",
      });
      await postJson("/api/ui/anchor-rename", {
        from: "projects/demo/demo.md",
        to: "projects/demo/demo-renamed.md",
        approved: true,
        expectedFileCommit: "abc123",
      });
      await postJson("/api/ui/anchor-delete", {
        name: "projects/demo/demo.md",
        approved: true,
        expectedFileCommit: "abc123",
      });

      expect(versions.versions[0]?.version).toBe("a");
      expect(diff.patch).toContain("diff --git");
      expect((AnchorService.prototype as unknown as { listVersions: ReturnType<typeof vi.fn> }).listVersions)
        .toHaveBeenCalledWith("projects/demo/demo.md", 5);
      expect((AnchorService.prototype as unknown as { diffAnchor: ReturnType<typeof vi.fn> }).diffAnchor)
        .toHaveBeenCalledWith("projects/demo/demo.md", "a", "b");
      expect((AnchorService.prototype as unknown as { revertAnchor: ReturnType<typeof vi.fn> }).revertAnchor)
        .toHaveBeenCalledWith("projects/demo/demo.md", "a", "test: revert");
      expect((AnchorService.prototype as unknown as { renameAnchor: ReturnType<typeof vi.fn> }).renameAnchor)
        .toHaveBeenCalledWith({
          from: "projects/demo/demo.md",
          to: "projects/demo/demo-renamed.md",
          message: undefined,
          approved: true,
          coAuthor: undefined,
          expectedFileCommit: "abc123",
        });
      expect((AnchorService.prototype as unknown as { deleteAnchor: ReturnType<typeof vi.fn> }).deleteAnchor)
        .toHaveBeenCalledWith({
          name: "projects/demo/demo.md",
          message: undefined,
          approved: true,
          coAuthor: undefined,
          expectedFileCommit: "abc123",
        });
    } finally {
      restoreVersions();
      restoreDiff();
      restoreRevert();
      restoreRename();
      restoreDelete();
    }
  });

  it("returns 400 for invalid proposed-change list scope", async () => {
    const response = await fetch(`${baseUrl}/api/ui/proposed-changes?scope=projects`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Invalid scope");
  });
});

async function fetchJson<T>(pathSuffix: string): Promise<T> {
  const response = await fetch(`${baseUrl}${pathSuffix}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function postJson<T = unknown>(pathSuffix: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${pathSuffix}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function projectAnchorContent(): string {
  return `---
project:
  - demo
type: context-anchor
tags:
  - context-anchor
summary: "Demo anchor summary."
read_this_if:
  - "You need demo context."
last_validated: 2026-05-20
---

# Demo Anchor

## Current State

- The demo project exists.

## Decisions

- Keep the UI read-only for M1.

## Constraints

- Writes remain outside the first UI milestone.

## PRs

None.
`;
}

function uiAnchorMeta(name: string, updatedAt: string) {
  return {
    name,
    path: name,
    category: "projects",
    project: ["demo"],
    projectSlug: "demo",
    type: "context-anchor",
    tags: ["context-anchor"],
    summary: "Demo anchor summary.",
    read_this_if: ["You need demo context."],
    last_validated: "2026-05-20",
    updatedAt,
    createdAt: updatedAt,
    origin: "repo",
  };
}

function stubAnchorServiceMethod(name: string, implementation: (...args: any[]) => unknown): () => void {
  const prototype = AnchorService.prototype as Record<string, unknown>;
  const original = Object.getOwnPropertyDescriptor(prototype, name);
  Object.defineProperty(prototype, name, {
    value: implementation,
    configurable: true,
    writable: true,
  });

  return () => {
    if (original) {
      Object.defineProperty(prototype, name, original);
      return;
    }
    delete prototype[name];
  };
}
