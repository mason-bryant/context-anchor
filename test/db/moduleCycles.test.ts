import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Modules that must load on their own, in a process that has imported nothing else.
 *
 * `config.ts` and `telemetryRetention.ts` imported each other for the length of one review round.
 * ESM tolerates most cycles, and this one was not tolerable: `config.ts` builds
 * `DEFAULT_TELEMETRY_RETENTION_SETTINGS` at module scope from a const in `telemetryRetention.ts`,
 * so any entry point reaching the retention module first began evaluating config, hit that const
 * in its temporal dead zone, and threw at startup before a line of work was done.
 *
 * Nothing in the suite noticed. Every test file imported something that pulled in `config` first,
 * so the cycle was only ever traversed in the direction that happens to work — which is exactly
 * why this spawns a process per module rather than importing them here.
 */
const LEAF_ENTRY_POINTS = [
  "src/db/telemetryRetention.ts",
  "src/db/schemaName.ts",
  "src/db/config.ts",
  "src/db/telemetryRetentionJob.ts",
  "src/db/questions.ts",
  "src/db/instrumentConsumers.ts",
];

describe("module load order", () => {
  it.each(LEAF_ENTRY_POINTS)("loads %s as the first module in a process", (entry) => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "anchor-cycle-"));
    try {
      // Written inside the repo tree would risk being picked up by tsc or eslint; written outside
      // it, tsx still resolves the absolute import fine.
      const probe = path.join(tmpDir, "probe.ts");
      writeFileSync(probe, `import ${JSON.stringify(path.join(REPO_ROOT, entry))};\n`, "utf8");

      const result = spawnSync("npx", ["tsx", probe], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60_000,
      });

      // The message is asserted, not just the exit code: a TDZ failure from a cycle reads very
      // differently from a missing dependency, and conflating them would let this pass while
      // reporting the wrong problem.
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/before initialization/);
      expect(result.status).toBe(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
