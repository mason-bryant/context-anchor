#!/usr/bin/env tsx
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";

type EvalCase = {
  id: string;
  task: string;
  project?: string;
  expectedIncluded?: string[];
  forbiddenIncluded?: string[];
};

type EvalFixture = {
  minRecall?: number;
  /** Shared corpus seeded once; every case runs against the same anchor set. */
  anchors: Array<{ name: string; content: string }>;
  cases: EvalCase[];
};

type EvalResult = {
  id: string;
  recall: number;
  precision: number;
  missing: string[];
  forbiddenHits: string[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCasesPath = path.resolve(scriptDir, "../test/fixtures/planner-eval/cases.json");

function parseArgs(argv: string[]): { casesPath: string; minRecall: number | undefined } {
  let casesPath = defaultCasesPath;
  let minRecall: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cases" && argv[index + 1]) {
      casesPath = path.resolve(argv[index + 1]!);
      index += 1;
    } else if (arg === "--min-recall" && argv[index + 1]) {
      minRecall = Number.parseFloat(argv[index + 1]!);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run eval [-- --cases path/to/cases.json] [--min-recall 0.8]`);
      process.exit(0);
    }
  }

  return { casesPath, minRecall };
}

async function loadFixture(casesPath: string): Promise<EvalFixture> {
  const raw = await readFile(casesPath, "utf8");
  return JSON.parse(raw) as EvalFixture;
}

async function runCase(service: AnchorService, evalCase: EvalCase): Promise<EvalResult> {
  const plan = await service.planContextBundle({
    task: evalCase.task,
    project: evalCase.project,
    budgetTokens: 4000,
  });
  const included = new Set(plan.included.map((anchor) => anchor.name));
  const expected = evalCase.expectedIncluded ?? [];
  const forbidden = evalCase.forbiddenIncluded ?? [];
  const missing = expected.filter((name) => !included.has(name));
  const forbiddenHits = forbidden.filter((name) => included.has(name));
  const recall = expected.length === 0 ? 1 : (expected.length - missing.length) / expected.length;
  const precision =
    included.size === 0 ? (expected.length === 0 ? 1 : 0) : (included.size - forbiddenHits.length) / included.size;

  return { id: evalCase.id, recall, precision, missing, forbiddenHits };
}

async function main(): Promise<void> {
  const { casesPath, minRecall: minRecallOverride } = parseArgs(process.argv.slice(2));
  const fixture = await loadFixture(casesPath);
  const minRecall = minRecallOverride ?? fixture.minRecall ?? 1;

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "planner-eval-"));
  const repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();
  const service = new AnchorService(repo, {
    pushOnWrite: false,
    migrationWarnOnly: false,
    staleAfterDays: 45,
  });

  try {
    for (const anchor of fixture.anchors ?? []) {
      await service.writeAnchor({
        name: anchor.name,
        content: anchor.content,
        message: `eval: seed ${anchor.name}`,
      });
    }

    const results: EvalResult[] = [];
    for (const evalCase of fixture.cases) {
      results.push(await runCase(service, evalCase));
    }

    console.log("Planner eval summary");
    console.log("case\trecall\tprecision\tmissing\tforbidden");
    for (const result of results) {
      console.log(
        `${result.id}\t${result.recall.toFixed(2)}\t${result.precision.toFixed(2)}\t${result.missing.join(",") || "-"}\t${result.forbiddenHits.join(",") || "-"}`,
      );
    }

    const averageRecall = results.reduce((sum, result) => sum + result.recall, 0) / Math.max(results.length, 1);
    console.log(`averageRecall=${averageRecall.toFixed(2)} minRecall=${minRecall.toFixed(2)}`);

    if (averageRecall < minRecall) {
      console.error(`Planner eval failed: average recall ${averageRecall.toFixed(2)} below ${minRecall.toFixed(2)}`);
      process.exitCode = 1;
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
