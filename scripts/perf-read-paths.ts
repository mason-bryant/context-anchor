import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";

type Measurement = {
  anchors: number;
  operation: string;
  durationMs: string;
};

const DEFAULT_SIZES = [100, 1000];

async function main(): Promise<void> {
  const sizes = parseSizes(process.env.ANCHOR_MCP_PERF_SIZES);
  const measurements: Measurement[] = [];

  for (const size of sizes) {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), `anchor-mcp-perf-${size}-`));
    try {
      const repo = new AnchorRepository({ repoPath });
      await repo.ensureReady();
      await seedRepo(repo, size);
      const service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });

      measurements.push(await measure(size, "listAnchors cold", () => service.listAnchors()));
      measurements.push(await measure(size, "listAnchors warm", () => service.listAnchors()));
      measurements.push(await measure(size, "contextRoot", () => service.contextRoot({ format: "json" })));
      measurements.push(await measure(size, "loadContext excerpt", () => service.loadContext({ project: "demo", limit: 12 })));
      measurements.push(await measure(size, "planContextBundle cold", () =>
        service.planContextBundle({ task: "storage cache benchmark", project: "demo" }),
      ));
      measurements.push(await measure(size, "planContextBundle warm", () =>
        service.planContextBundle({ task: "storage cache benchmark", project: "demo" }),
      ));
      measurements.push(await measure(size, "searchAnchors cold", () => service.searchAnchors("benchmark")));
      measurements.push(await measure(size, "searchAnchors warm", () => service.searchAnchors("benchmark")));
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  }

  console.table(measurements);
}

function parseSizes(raw: string | undefined): number[] {
  if (!raw?.trim()) {
    return DEFAULT_SIZES;
  }
  const sizes = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return sizes.length > 0 ? sizes : DEFAULT_SIZES;
}

async function measure(anchors: number, operation: string, fn: () => Promise<unknown>): Promise<Measurement> {
  const startedAt = performance.now();
  await fn();
  return {
    anchors,
    operation,
    durationMs: (performance.now() - startedAt).toFixed(1),
  };
}

async function seedRepo(repo: AnchorRepository, count: number): Promise<void> {
  await mkdir(path.join(repo.repoPath, "projects", "demo"), { recursive: true });
  await mkdir(path.join(repo.repoPath, "shared"), { recursive: true });

  for (let i = 0; i < count; i += 1) {
    const projectAnchor = i % 2 === 0;
    const dir = projectAnchor ? path.join(repo.repoPath, "projects", "demo") : path.join(repo.repoPath, "shared");
    const name = `${String(i).padStart(5, "0")}-benchmark.md`;
    await writeFile(path.join(dir, name), anchorContent(i, projectAnchor), "utf8");
  }

  await repo.git.add(".");
  await repo.git.raw([
    "-c",
    "user.name=anchor-mcp",
    "-c",
    "user.email=anchor-mcp@local",
    "commit",
    "-m",
    `test: seed ${count} benchmark anchors`,
  ]);
}

function anchorContent(index: number, projectAnchor: boolean): string {
  const frontMatterProject = projectAnchor ? "project:\n  - demo\n" : "";
  const name = `Benchmark ${index}`;
  return `---
${frontMatterProject}type: context-anchor
tags:
  - benchmark
summary: "${name} anchor for read-path performance measurements."
read_this_if:
  - "You are measuring anchor-mcp read path performance."
last_validated: 2026-06-17
---

# ${name}

## Current State

- This benchmark anchor contains searchable body text about storage cache benchmark indexing.
- It is intentionally small so fixture generation can scale to many files.

## Decisions

- Keep benchmark anchors schema-valid.

## Constraints

- Benchmark fixtures should avoid external services.

## PRs

None.
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
