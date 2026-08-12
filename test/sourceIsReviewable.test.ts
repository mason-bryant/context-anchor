import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source files must stay diffable.
 *
 * A single NUL byte makes Git classify a file as binary, and a binary file has no diff — on
 * GitHub, in `git diff`, or in any review tool reading either. That is a review-integrity
 * problem rather than a formatting one: `src/db/setRecordScopes.ts` carried two NUL bytes as
 * hash separators, and the automated review of the PR touching it reported "3 out of 4 files"
 * without saying which one it had skipped or why. The skipped file was the one implementing the
 * change under review.
 *
 * NUL is a good separator for hashing — it cannot occur in a slug or a stable key — so the point
 * is not to ban it, only to require it be written as an escape (`\u0000`) rather than typed as a
 * literal byte. The escape produces the identical string at runtime.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const DIRECTORIES = ["src", "test", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".sql", ".json", ".md"]);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      found.push(...(await sourceFiles(full)));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

describe("source files stay reviewable", () => {
  it("contains no NUL bytes, which would make Git treat a file as binary", async () => {
    const files = (await Promise.all(DIRECTORIES.map((d) => sourceFiles(path.join(ROOT, d))))).flat();
    // Guards the guard: a glob that matched nothing would report success over an empty set.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const contents = await readFile(file);
      if (contents.includes(0)) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
