import type { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false });

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
    expect(html).toContain("Read-only context explorer");
    expect(html).toContain("/ui/app.js");
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

  it("returns 400 for invalid UI API filters", async () => {
    const response = await fetch(`${baseUrl}/api/ui/anchors?category=bad`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Invalid category");
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
