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
      name: "project/demo",
      content: anchorContent(),
      message: "test: add demo anchor",
    });

    expect(result.version).toMatch(/[a-f0-9]{40}/);
    expect(result.warnings).toEqual([]);

    const read = await service.readAnchor("project/demo");
    expect(read.frontmatter.project).toEqual(["demo"]);
    expect(read.content).toContain("## Current State");

    const versions = await service.listVersions("project/demo");
    expect(versions).toHaveLength(1);
    expect(versions[0]?.message).toBe("test: add demo anchor");
  });

  it("blocks anchors missing required sections", async () => {
    const result = await service.writeAnchor({
      name: "bad",
      content: `---
project:
  - demo
type: design
tags: []
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

  it("requires last_validated to change when substantive sections change", async () => {
    await service.writeAnchor({
      name: "demo",
      content: anchorContent(),
      message: "test: add demo anchor",
    });

    const result = await service.writeAnchor({
      name: "demo",
      content: anchorContent({ currentState: "- Updated but same validation date." }),
      message: "test: update current state",
    });

    expect(result.version).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toContain("last_validated_bump");
  });

  it("requires explicit approval for decisions changes", async () => {
    await service.writeAnchor({
      name: "demo",
      content: anchorContent(),
      message: "test: add demo anchor",
    });

    const blocked = await service.writeAnchor({
      name: "demo",
      content: anchorContent({
        lastValidated: "2026-05-11",
        decisions: "- New decision.",
      }),
      message: "test: update decision",
    });

    expect(blocked.requiresApproval).toBe(true);
    expect(blocked.version).toBeUndefined();

    const approved = await service.writeAnchor({
      name: "demo",
      content: anchorContent({
        lastValidated: "2026-05-11",
        decisions: "- New decision.",
      }),
      message: "test: update decision",
      approved: true,
    });

    expect(approved.version).toMatch(/[a-f0-9]{40}/);
  });
});

function anchorContent(
  overrides: {
    currentState?: string;
    decisions?: string;
    constraints?: string;
    lastValidated?: string;
  } = {},
): string {
  return `---
project:
  - demo
type: design
tags:
  - context
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

