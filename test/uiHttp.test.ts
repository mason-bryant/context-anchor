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

  it("routes paged anchor batch requests for progressive UI loading", async () => {
    const listPage = vi.fn(async () => ({
      anchors: [
        uiAnchorMeta("projects/demo/middle.md", "2026-05-02T00:00:00.000Z"),
        uiAnchorMeta("projects/demo/old.md", "2026-05-01T00:00:00.000Z"),
      ],
      total: 3,
      offset: 1,
      limit: 2,
    }));
    const restore = stubAnchorServiceMethod("listAnchorsDiscoveryPage", listPage);

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
      expect(listPage).toHaveBeenCalledWith(expect.objectContaining({}), {
        sort: "updated",
        offset: 1,
        limit: 2,
      });
    } finally {
      restore();
    }
  });

  it("applies anchor offsets even without a limit", async () => {
    const listPage = vi.fn(async () => ({
      anchors: [
        uiAnchorMeta("projects/demo/middle.md", "2026-05-02T00:00:00.000Z"),
        uiAnchorMeta("projects/demo/old.md", "2026-05-01T00:00:00.000Z"),
      ],
      total: 3,
      offset: 1,
    }));
    const restore = stubAnchorServiceMethod("listAnchorsDiscoveryPage", listPage);

    try {
      const response = await fetchJson<{
        anchors: Array<{ name: string }>;
        total: number;
        offset: number;
        limit?: number;
        nextOffset?: number;
      }>("/api/ui/anchors?sort=updated&offset=1");

      expect(response.anchors.map((anchor) => anchor.name)).toEqual([
        "projects/demo/middle.md",
        "projects/demo/old.md",
      ]);
      expect(response.total).toBe(3);
      expect(response.offset).toBe(1);
      expect(response.limit).toBeUndefined();
      expect(response.nextOffset).toBeUndefined();
      expect(listPage).toHaveBeenCalledWith(expect.objectContaining({}), {
        sort: "updated",
        offset: 1,
        limit: undefined,
      });
    } finally {
      restore();
    }
  });

  it("returns context planner output for the UI", async () => {
    const plan = await fetchJson<{
      included: Array<{ name: string; reason: string }>;
      excluded: Array<{ name: string; reason: string }>;
      loadContext: { names: string[]; includeContent: string; maxBytes: number; includeProvenance?: string };
      missingContext: string[];
      provenance?: { summary: { totalClaims: number; unannotatedClaims: number } };
    }>("/api/ui/context-plan?task=Update%20demo%20context&project=demo&budgetTokens=1200&maxAnchors=1&maxExcluded=5");

    expect(plan.included[0]?.name).toBe("projects/demo/demo.md");
    expect(plan.included[0]?.reason).toContain('project matches "demo"');
    expect(plan.loadContext.names).toContain("projects/demo/demo.md");
    const serverRuleNames = ["server-rules/acceptance-criteria.md", "server-rules/milestone-usage.md", "server-rules/project-updates.md"];
    expect(plan.loadContext.names.some((n: string) => serverRuleNames.includes(n))).toBe(false);
    expect(plan.loadContext.includeContent).toBe("excerpt");
    expect(plan.loadContext.maxBytes).toBe(4800);
    expect(plan.loadContext.includeProvenance).toBe("summary");
    expect(plan.provenance?.summary.totalClaims).toBeGreaterThan(0);
    expect(plan.missingContext.some((line) => line.includes("Claim provenance health"))).toBe(true);
  });

  it("forwards an unknown repo through the planner route and flags it", async () => {
    const plan = await fetchJson<{
      projectResolution?: { unknownRepo?: string; candidates: Array<{ project: string }> };
      missingContext: string[];
    }>(
      "/api/ui/context-plan?task=Trace%20a%20charge&repo=repo-unknown&filePaths=services%2Fpayments%2Fcharge.ts",
    );

    expect(plan.projectResolution?.unknownRepo).toBe("repo-unknown");
    expect(plan.projectResolution?.candidates).toEqual([]);
    expect(plan.missingContext.some((line) => line.includes("repo-unknown"))).toBe(true);
  });

  it("manages project mappings and resolves a repo to candidate projects through the routes", async () => {
    await service.writeAnchor({
      name: "projects/project-one/project-one.md",
      content: projectAnchorContent("project-one"),
      message: "test: add project-one anchor",
      approved: true,
    });
    await service.writeAnchor({
      name: "projects/project-two/project-two.md",
      content: projectAnchorContent("project-two"),
      message: "test: add project-two anchor",
      approved: true,
    });

    // CRUD: an empty registry, then a write through the POST route.
    const initial = await fetchJson<{ projects: unknown[]; claimSourceTypes: Array<{ id: string }>; fileCommit?: string }>("/api/ui/project-mappings");
    expect(initial.projects).toEqual([]);
    expect(initial.claimSourceTypes.map((type) => type.id)).toEqual(["url", "design-doc", "adr", "misc", "trust-me-bro"]);

    const writeResponse = await fetch(`${baseUrl}/api/ui/project-mappings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mappings: {
          claimSourceTypes: [
            { id: "source", label: "Source" },
            { id: "runbook", label: "Runbook" },
          ],
          projects: [
            {
              project: "project-one",
              repos: [
                { repo: "repo-alpha", paths: [], web: { url: "https://github.com/owner/repo-alpha", branch: "main" } },
              ],
            },
            { project: "project-two", repos: [{ repo: "repo-alpha", paths: [] }] },
          ],
        },
        expectedFileCommit: initial.fileCommit,
      }),
    });
    expect(writeResponse.ok).toBe(true);

    const stored = await fetchJson<{
      claimSourceTypes: Array<{ id: string; label: string }>;
      projects: Array<{ project: string; repos: Array<{ web?: { url: string; branch?: string } }> }>;
    }>("/api/ui/project-mappings");
    expect(stored.claimSourceTypes.map((type) => type.id)).toContain("runbook");
    expect(stored.claimSourceTypes.find((type) => type.id === "url")?.label).toBe("URL");
    expect(stored.claimSourceTypes.find((type) => type.id === "runbook")?.label).toBe("Runbook");
    expect(stored.projects.map((p) => p.project).sort()).toEqual(["project-one", "project-two"]);
    const projectOne = stored.projects.find((p) => p.project === "project-one");
    expect(projectOne?.repos[0]?.web).toEqual({ url: "https://github.com/owner/repo-alpha", branch: "main" });

    const plan = await fetchJson<{
      included: Array<{ name: string }>;
      projectResolution?: { candidates: Array<{ project: string }> };
    }>("/api/ui/context-plan?task=Investigate%20flow&repo=repo-alpha");

    const includedNames = plan.included.map((anchor) => anchor.name);
    expect(includedNames).toContain("projects/project-one/project-one.md");
    expect(includedNames).toContain("projects/project-two/project-two.md");
    expect(plan.projectResolution?.candidates.map((candidate) => candidate.project).sort()).toEqual([
      "project-one",
      "project-two",
    ]);
  });

  it("rejects a stale project-mappings write with a 409 conflict", async () => {
    const stale = await fetch(`${baseUrl}/api/ui/project-mappings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mappings: { projects: [{ project: "demo", repos: [{ repo: "repo-alpha", paths: [] }] }] },
        expectedFileCommit: "0000000000000000000000000000000000000000",
      }),
    });
    expect(stale.status).toBe(409);
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
    const restorePriority = stubAnchorServiceMethod("updateProjectPriority", vi.fn(async () => ({ version: "vp", warnings: [] })));
    const restoreSection = stubAnchorServiceMethod("updateAnchorSection", vi.fn(async () => ({ version: "v2", warnings: [] })));
    const restoreAppend = stubAnchorServiceMethod("appendToAnchorSection", vi.fn(async () => ({ version: "v3", warnings: [] })));
    const restoreDeleteSection = stubAnchorServiceMethod("deleteAnchorSection", vi.fn(async () => ({ version: "v4", warnings: [] })));

    try {
      await postJson("/api/ui/anchor-frontmatter", {
        name: "projects/demo/demo.md",
        updates: { summary: "Updated summary." },
        expectedFileCommit: "abc123",
      });
      await postJson("/api/ui/project-priority", {
        project: "demo",
        name: "projects/demo/demo.md",
        priority: 2.045,
        approved: true,
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
      expect((AnchorService.prototype as unknown as { updateProjectPriority: ReturnType<typeof vi.fn> }).updateProjectPriority)
        .toHaveBeenCalledWith({
          project: "demo",
          name: "projects/demo/demo.md",
          priority: 2.045,
          message: undefined,
          approved: true,
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
      restorePriority();
      restoreSection();
      restoreAppend();
      restoreDeleteSection();
    }
  });

  it("persists people and teams with project associations through the registry round-trip", async () => {
    await postJson("/api/ui/people-registry", {
      registry: {
        people: [
          {
            id: "jdoe",
            displayName: "Jane Doe",
            identities: { slack: "U123", emails: ["jane@co.com"], names: ["JD"] },
            teams: ["platform"],
            projects: [{ project: "demo", role: "responsible" }],
          },
        ],
        teams: [
          {
            id: "platform",
            displayName: "Platform Team",
            slackHandles: ["platform-eng"],
            projects: [{ project: "demo", role: "executive_sponsor" }],
          },
        ],
      },
      message: "test: seed registry",
    });

    const registry = await fetchJson<{
      people: Array<{ id: string; projects?: Array<{ project: string; role: string }> }>;
      teams: Array<{ id: string; projects?: Array<{ project: string; role: string }> }>;
    }>("/api/ui/people-registry");

    expect(registry.people[0]?.projects).toEqual([{ project: "demo", role: "responsible" }]);
    expect(registry.teams[0]?.projects).toEqual([{ project: "demo", role: "executive_sponsor" }]);
  });

  it("searches people by display name and name alias for task assignment", async () => {
    await postJson("/api/ui/people-registry", {
      registry: {
        people: [
          {
            id: "jdoe",
            displayName: "Jane Doe",
            identities: { names: ["JD", "Janie"] },
          },
          {
            id: "asmith",
            displayName: "Alice Smith",
            identities: { names: ["Ace"] },
          },
        ],
        teams: [],
      },
    });

    const alias = await fetchJson<{ people: Array<{ id: string; displayName: string; matched: string; value: string }> }>(
      "/api/ui/people-search?q=JD",
    );
    expect(alias.people[0]).toMatchObject({
      id: "jdoe",
      displayName: "Jane Doe",
      matched: "JD",
      value: "Jane Doe",
    });

    const name = await fetchJson<{ people: Array<{ id: string }> }>("/api/ui/people-search?q=alice");
    expect(name.people.map((person) => person.id)).toEqual(["asmith"]);
  });

  it("guards concurrent registry writes with an optimistic file-commit check", async () => {
    await postJson("/api/ui/people-registry", {
      registry: { people: [{ id: "jdoe", displayName: "Jane Doe" }], teams: [] },
      message: "test: seed registry",
    });

    const first = await fetchJson<{ fileCommit?: string }>("/api/ui/people-registry");
    expect(typeof first.fileCommit).toBe("string");

    // A second writer advances the registry past the commit the first reader holds.
    await postJson("/api/ui/people-registry", {
      registry: { people: [{ id: "asmith", displayName: "Alice Smith" }], teams: [] },
      message: "test: concurrent write",
      expectedFileCommit: first.fileCommit,
    });

    // The stale writer using the original commit must be rejected with 409.
    const stale = await fetch(`${baseUrl}/api/ui/people-registry`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        registry: { people: [{ id: "jdoe", displayName: "Jane Doe (stale)" }], teams: [] },
        expectedFileCommit: first.fileCommit,
      }),
    });
    const body = (await stale.json()) as { error: { message: string } };

    expect(stale.status).toBe(409);
    expect(body.error.message).toContain("commit mismatch");

    const latest = await fetchJson<{ people: Array<{ id: string }> }>("/api/ui/people-registry");
    expect(latest.people.map((p) => p.id)).toEqual(["asmith"]);
  });

  it("drops project associations with invalid roles when writing the registry", async () => {
    await postJson("/api/ui/people-registry", {
      registry: {
        people: [
          {
            id: "jdoe",
            displayName: "Jane Doe",
            projects: [
              { project: "demo", role: "responsible" },
              { project: "demo", role: "not-a-real-role" },
            ],
          },
        ],
        teams: [],
      },
    });

    const registry = await fetchJson<{
      people: Array<{ id: string; projects?: Array<{ project: string; role: string }> }>;
    }>("/api/ui/people-registry");

    expect(registry.people[0]?.projects).toEqual([{ project: "demo", role: "responsible" }]);
  });

  it("creates, lists, completes, reopens, and deletes a task through the UI routes", async () => {
    type TaskWrite = { taskId?: string; milestoneName?: string; version?: string; warnings: { severity: string }[] };
    type TasksDue = { tasks: Array<{ taskId: string; taskTitle: string; taskStatus: string; taskOwner?: string; taskPriority?: number; completedOn?: string }> };

    // Create on a project with no milestones — the backlog milestone is auto-created.
    const created = await postJson<TaskWrite>("/api/ui/task-create", {
      project: "demo",
      title: "Follow up on the thing",
      priority: 2.5,
      approved: true,
    });
    expect(created.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    expect(created.taskId).toBe("T-1");
    expect(created.milestoneName).toBe("projects/demo/milestones/backlog.md");

    const listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    const row = listed.tasks.find((t) => t.taskId === "T-1");
    expect(row?.taskTitle).toBe("Follow up on the thing");
    expect(row?.taskOwner).toBeUndefined();
    expect(row?.taskPriority).toBe(2.5);

    // Complete it, then confirm it only shows under a done-status query.
    const completed = await postJson<TaskWrite>("/api/ui/task-complete", {
      taskId: "T-1",
      project: "demo",
      approved: true,
    });
    expect(completed.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    const done = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo&status=done");
    expect(done.tasks.find((t) => t.taskId === "T-1")?.taskStatus).toBe("done");

    // Reopen it, then confirm completed_on is cleared and status is todo again.
    const reopened = await postJson<TaskWrite>("/api/ui/task-reopen", {
      taskId: "T-1",
      project: "demo",
      approved: true,
    });
    expect(reopened.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    const reopenedTasks = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo&status=todo,done");
    const reopenedRow = reopenedTasks.tasks.find((t) => t.taskId === "T-1");
    expect(reopenedRow?.taskStatus).toBe("todo");
    expect(reopenedRow?.completedOn).toBeUndefined();

    // Delete it.
    const deleted = await postJson<TaskWrite>("/api/ui/task-delete", {
      taskId: "T-1",
      project: "demo",
      approved: true,
    });
    expect(deleted.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    const after = await fetchJson<TasksDue>(
      "/api/ui/tasks-due?project=demo&status=todo,active,blocked,done,cancelled",
    );
    expect(after.tasks.map((t) => t.taskId)).not.toContain("T-1");
  });

  it("filters unassigned tasks through the tasks-due route", async () => {
    await postJson("/api/ui/task-create", { project: "demo", title: "owned", owner: "alice", approved: true });
    await postJson("/api/ui/task-create", { project: "demo", title: "free", approved: true });

    const unassigned = await fetchJson<{ tasks: Array<{ taskTitle: string }> }>(
      "/api/ui/tasks-due?project=demo&unassigned=true",
    );
    expect(unassigned.tasks.map((t) => t.taskTitle)).toEqual(["free"]);
  });

  it("filters task reports by completed/due windows and project priority through the tasks-due route", async () => {
    await postJson("/api/ui/project-priority", { project: "demo", priority: 1.1, approved: true });
    await service.writeAnchor({
      name: "projects/low/low.md",
      content: projectAnchorContent("low"),
      message: "test: add low priority anchor",
      approved: true,
    });
    await postJson("/api/ui/project-priority", { project: "low", priority: 4, approved: true });

    await postJson("/api/ui/task-create", {
      project: "demo",
      title: "due soon",
      due: "2026-06-20",
      dateConfidence: "estimated",
      approved: true,
    });
    const recent = await postJson<{ taskId?: string }>("/api/ui/task-create", {
      project: "demo",
      title: "recently done",
      approved: true,
    });
    const old = await postJson<{ taskId?: string }>("/api/ui/task-create", {
      project: "demo",
      title: "old done",
      approved: true,
    });
    await postJson("/api/ui/task-complete", {
      taskId: recent.taskId,
      project: "demo",
      completedOn: "2026-06-17",
      approved: true,
    });
    await postJson("/api/ui/task-complete", {
      taskId: old.taskId,
      project: "demo",
      completedOn: "2026-05-30",
      approved: true,
    });
    await postJson("/api/ui/task-create", {
      project: "low",
      title: "low priority due",
      due: "2026-06-20",
      dateConfidence: "estimated",
      approved: true,
    });

    const report = await fetchJson<{
      tasks: Array<{ taskTitle: string; taskStatus: string; completedOn?: string; projectPriority?: number }>;
    }>(
      "/api/ui/tasks-due?dueAfter=2026-06-18&dueBefore=2026-06-26&completedAfter=2026-06-11&completedBefore=2026-06-19&maxProjectPriority=2",
    );

    expect(report.tasks.map((task) => task.taskTitle)).toEqual(["due soon", "recently done"]);
    expect(report.tasks.find((task) => task.taskTitle === "recently done")?.completedOn).toBe("2026-06-17");
    expect(report.tasks.every((task) => task.projectPriority !== undefined && task.projectPriority <= 2)).toBe(true);
  });

  it("filters tasks by task priority and modified date through the tasks-due route", async () => {
    await postJson("/api/ui/task-create", {
      project: "demo",
      title: "high priority",
      priority: 1.5,
      approved: true,
    });
    await postJson("/api/ui/task-create", {
      project: "demo",
      title: "low priority",
      priority: 4,
      approved: true,
    });

    const filtered = await fetchJson<{
      tasks: Array<{ taskTitle: string; taskPriority?: number; milestoneUpdatedAt?: string }>;
    }>("/api/ui/tasks-due?project=demo&maxTaskPriority=2&modifiedAfter=2000-01-01");

    expect(filtered.tasks.map((task) => task.taskTitle)).toEqual(["high priority"]);
    expect(filtered.tasks[0]?.taskPriority).toBe(1.5);
    expect(filtered.tasks[0]?.milestoneUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const future = await fetchJson<{ tasks: unknown[] }>("/api/ui/tasks-due?project=demo&modifiedAfter=2999-01-01");
    expect(future.tasks).toEqual([]);
  });

  it("updates task assignment through the UI routes", async () => {
    type TaskWrite = { taskId?: string; milestoneName?: string; warnings: { severity: string }[] };
    type TasksDue = { tasks: Array<{ taskId: string; taskOwner?: string }> };

    const created = await postJson<TaskWrite>("/api/ui/task-create", {
      project: "demo",
      title: "assign through UI",
      approved: true,
    });

    const assigned = await postJson<TaskWrite>("/api/ui/task-owner", {
      name: created.milestoneName,
      taskId: created.taskId,
      owner: "alice",
      approved: true,
    });
    expect(assigned.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    let listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.taskOwner).toBe("alice");

    const cleared = await postJson<TaskWrite>("/api/ui/task-owner", {
      name: created.milestoneName,
      taskId: created.taskId,
      owner: null,
      approved: true,
    });
    expect(cleared.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.taskOwner).toBeUndefined();
  });

  it("lists and annotates claims through the UI routes", async () => {
    type ClaimsResult = {
      claims: Array<{
        anchor: string;
        text: string;
        status: string;
        annotation?: { src: string; conf: string; kind?: string; person?: string; personName?: string };
        sources?: Array<{ src: string; conf: string; kind?: string; person?: string; personName?: string }>;
        strength?: string;
      }>;
      summary: { total: number; annotated: number; unannotated: number; malformed: number };
    };
    type ClaimWrite = { version?: string; warnings: { severity: string; code: string; message: string }[] };

    const initial = await fetchJson<ClaimsResult>("/api/ui/claims?project=demo&status=unannotated");
    expect(initial.summary.total).toBeGreaterThan(0);
    const target = initial.claims[0];
    expect(target?.status).toBe("unannotated");

    const saved = await postJson<ClaimWrite>("/api/ui/claim-annotation", {
      name: target.anchor,
      claim: target.text,
      src: "PR #54",
      observed: "2026-07-07",
      conf: "medium",
      approved: true,
    });
    expect(saved.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(saved.version).toBeTruthy();

    const annotated = await fetchJson<ClaimsResult>(
      `/api/ui/claims?name=${encodeURIComponent(target.anchor)}&status=annotated`,
    );
    expect(annotated.claims.map((claim) => claim.text)).toContain(target.text);
    expect(annotated.claims.find((claim) => claim.text === target.text)?.annotation?.src).toBe("PR #54");

    const multi = await postJson<ClaimWrite>("/api/ui/claim-sources", {
      name: target.anchor,
      claim: target.text,
      sources: [
        { src: "PR #55", observed: "2026-07-08", conf: "high" },
        { src: "src/a.ts", observed: "2026-07-09", conf: "low" },
      ],
      approved: true,
    });
    expect(multi.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const multiListed = await fetchJson<ClaimsResult>(
      `/api/ui/claims?name=${encodeURIComponent(target.anchor)}&status=annotated`,
    );
    const multiClaim = multiListed.claims.find((claim) => claim.text === target.text);
    expect(multiClaim?.sources?.map((source) => source.src)).toEqual(["PR #55", "src/a.ts"]);
    expect(multiClaim?.strength).toBe("medium");

    const cleared = await postJson<ClaimWrite>("/api/ui/claim-annotation", {
      name: target.anchor,
      claim: target.text,
      clear: true,
      approved: true,
    });
    expect(cleared.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    await postJson("/api/ui/people-registry", {
      registry: { people: [{ id: "alice", displayName: "Alice Example" }], teams: [] },
      message: "test: add claim source person",
    });
    const trust = await postJson<ClaimWrite>("/api/ui/claim-sources", {
      name: target.anchor,
      claim: target.text,
      sources: [
        {
          src: "trust me bro",
          kind: "trust-me-bro",
          person: "Alice Example",
          observed: "2026-07-08",
          conf: "high",
        },
      ],
      approved: true,
    });
    expect(trust.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const trustListed = await fetchJson<ClaimsResult>(
      `/api/ui/claims?name=${encodeURIComponent(target.anchor)}&q=${encodeURIComponent("trust-me-bro")}`,
    );
    const trustClaim = trustListed.claims.find((claim) => claim.text === target.text);
    expect(trustClaim?.sources?.[0]).toMatchObject({
      src: "trust me bro",
      kind: "trust-me-bro",
      person: "alice",
      personName: "Alice Example",
      conf: "high",
    });

    const rejected = await postJson<ClaimWrite>("/api/ui/claim-annotation", {
      name: target.anchor,
      claim: target.text,
      src: "person:alice",
      observed: "2026-07-07",
      conf: "high",
      approved: true,
    });
    expect(rejected.warnings.some((warning) => warning.code === "claim_annotation_invalid")).toBe(true);
  });

  it("updates task priority through the UI routes", async () => {
    type TaskWrite = { taskId?: string; milestoneName?: string; warnings: { severity: string }[] };
    type TasksDue = { tasks: Array<{ taskId: string; taskPriority?: number }> };

    const created = await postJson<TaskWrite>("/api/ui/task-create", {
      project: "demo",
      title: "prioritize through UI",
      approved: true,
    });

    const assigned = await postJson<TaskWrite>("/api/ui/task-priority", {
      name: created.milestoneName,
      taskId: created.taskId,
      priority: 1.2,
      approved: true,
    });
    expect(assigned.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    let listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.taskPriority).toBe(1.2);

    const cleared = await postJson<TaskWrite>("/api/ui/task-priority", {
      name: created.milestoneName,
      taskId: created.taskId,
      priority: null,
      approved: true,
    });
    expect(cleared.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.taskPriority).toBeUndefined();
  });

  it("updates task notes through the UI routes", async () => {
    type TaskWrite = { taskId?: string; milestoneName?: string; warnings: { severity: string }[] };
    type TasksDue = { tasks: Array<{ taskId: string; notes?: string }> };

    const created = await postJson<TaskWrite>("/api/ui/task-create", {
      project: "demo",
      title: "annotate through UI",
      notes: "Initial note",
      approved: true,
    });

    let listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.notes).toBe("Initial note");

    const updated = await postJson<TaskWrite>("/api/ui/task-notes", {
      name: created.milestoneName,
      taskId: created.taskId,
      notes: "Updated note",
      approved: true,
    });
    expect(updated.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.notes).toBe("Updated note");

    const cleared = await postJson<TaskWrite>("/api/ui/task-notes", {
      name: created.milestoneName,
      taskId: created.taskId,
      notes: null,
      approved: true,
    });
    expect(cleared.warnings.filter((w) => w.severity === "BLOCK")).toEqual([]);
    listed = await fetchJson<TasksDue>("/api/ui/tasks-due?project=demo");
    expect(listed.tasks.find((task) => task.taskId === created.taskId)?.notes).toBeUndefined();
  });

  it("blocks task creation with a due date but no date confidence", async () => {
    const response = await postJson<{ taskId?: string; warnings: { code: string }[] }>("/api/ui/task-create", {
      project: "demo",
      title: "needs confidence",
      due: "2026-07-01",
      approved: true,
    });
    expect(response.taskId).toBeUndefined();
    expect(response.warnings.map((w) => w.code)).toContain("missing_date_confidence");
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

  it("returns 400 for invalid project priority bodies", async () => {
    const response = await fetch(`${baseUrl}/api/ui/project-priority`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        project: "demo",
        priority: "P1",
        approved: true,
      }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Invalid priority");
  });

  it("rejects invalid boolean strings in UI query parameters", async () => {
    const response = await fetch(`${baseUrl}/api/ui/anchors?includeArchive=yes`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Invalid includeArchive: expected a boolean");
  });

  it("accepts valid boolean query parameters", async () => {
    const response = await fetch(`${baseUrl}/api/ui/anchors?includeArchive=true`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(200);
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

function localDateKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function projectAnchorContent(project = "demo"): string {
  // Computed so the fixture never ages past the staleAfterDays window. Uses
  // the local date to match the lastValidatedBump validator's "today" (UTC
  // would disagree with it every evening west of Greenwich).
  const recentLastValidated = localDateKey();
  return `---
project:
  - ${project}
type: context-anchor
tags:
  - context-anchor
summary: "Demo anchor summary."
read_this_if:
  - "You need demo context."
last_validated: ${recentLastValidated}
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
