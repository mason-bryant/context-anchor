import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import { GraphIndex } from "../src/graph/index.js";
import { parsePeopleRegistry } from "../src/peopleRegistry.js";
import { parseProjectMappings } from "../src/projectMappings.js";

type Measurement = {
  anchors: number;
  operation: string;
  durationMs: string;
};

const DEFAULT_SIZES = [100, 120, 1000];

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

      if (size === GRAPH_BENCHMARK_SIZE) {
        measurements.push(...(await measureGraphBuild(repo, size)));
      }
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  }

  console.table(measurements);
}

// WP3 (claim knowledge graph): the M8 benchmark suite's fixture size the
// implementation plan asks for ("cold build and warm invalidate-one-doc on
// the 120-anchor fixture"). There is no separate checked-in 120-anchor
// markdown fixture set anywhere in the repo — M8's benchmarking always works
// by seeding a synthetic temp repo at a given size (see seedRepo below,
// matching this script's own pre-existing pattern) rather than a static
// fixture tree, so this reuses that same seeding approach at size 120.
const GRAPH_BENCHMARK_SIZE = 120;

async function measureGraphBuild(repo: AnchorRepository, size: number): Promise<Measurement[]> {
  const out: Measurement[] = [];
  const deps = {
    loadPeopleRegistry: async () => parsePeopleRegistry(await repo.readPeopleRegistryRaw()),
    loadProjectMappings: async () => parseProjectMappings(await repo.readProjectMappingsRaw()),
  };

  // Cold build: fresh GraphIndex, first ensureBuilt() call.
  const coldGraph = new GraphIndex(repo, deps);
  out.push(await measure(size, "GraphIndex cold build", () => coldGraph.ensureBuilt()));

  // Warm invalidate-one-document: graph already built once; touch a single
  // anchor's content in place (no new commit needed — invalidateDocument
  // re-reads from the store) and time just the targeted re-extraction.
  const warmGraph = new GraphIndex(repo, deps);
  await warmGraph.ensureBuilt();
  const anchors = await repo.listAnchors();
  const target = anchors[0]?.name;
  if (target) {
    out.push(await measure(size, "GraphIndex warm invalidate-one-doc", () => warmGraph.invalidateDocument(target)));
  }

  return out;
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
  // A relations link (to the previous anchor in the same dir/parity group)
  // and a claim-provenance annotation on every anchor, so a graph build over
  // this fixture actually exercises the anchor_anchor and claim_source
  // extractors, not just anchor_project.
  const previousIndex = index - 2 >= 0 ? index - 2 : undefined;
  const relatesTo =
    previousIndex !== undefined
      ? `relations:\n  depends_on:\n    - ${anchorRelPath(previousIndex, projectAnchor)}\n`
      : "";
  const claimId = `c-bm${String(index).padStart(4, "0")}`;
  return `---
${frontMatterProject}${relatesTo}type: context-anchor
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
  {src: PR #${index + 1}; observed: 2026-06-17; conf: medium; id: ${claimId}}
- It is intentionally small so fixture generation can scale to many files.

## Decisions

- Keep benchmark anchors schema-valid.

## Constraints

- Benchmark fixtures should avoid external services.

## PRs

None.
`;
}

function anchorRelPath(index: number, projectAnchor: boolean): string {
  const dir = projectAnchor ? "projects/demo" : "shared";
  const name = `${String(index).padStart(5, "0")}-benchmark.md`;
  return `${dir}/${name}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
