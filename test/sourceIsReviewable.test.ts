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

/**
 * Scanned by exclusion at both levels — which directories to skip and which file types are
 * legitimately binary — rather than by allow-lists of either.
 *
 * Both allow-lists were wrong in the same way, one round apart. The directory list named src,
 * test and scripts while accepting .sql and .md, so it would have passed over a NUL in the very
 * migration this guard shipped beside. The extension list then named eight source types and
 * omitted the .yml workflows and .sh scripts that decide how this repository builds and
 * releases. An allow-list only ever covers what its author remembered; exclusion covers what
 * nobody has added yet, which is the whole point of a guard.
 */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", "build"]);

/**
 * Files that are supposed to be binary. Everything else is expected to diff as text, including
 * types this repository does not contain today.
 */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".bmp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z",
  ".mp3", ".mp4", ".mov", ".wav", ".webm",
  ".node", ".wasm", ".dylib", ".so", ".dll", ".exe",
]);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Build output is excluded because it is generated from sources this guard already
      // covers; a NUL there is a symptom, and failing on it would report the same defect twice
      // while pointing at the file nobody edits.
      // .github is scanned despite the leading dot: its workflows decide how this repository
      // builds and releases, so an unreadable diff there matters as much as one in src. Other
      // dot-directories are skipped because they hold tooling state and worktree copies, which
      // include their own node_modules.
      const hidden = entry.name.startsWith(".") && entry.name !== ".github";
      if (SKIPPED_DIRECTORIES.has(entry.name) || hidden) {
        continue;
      }
      found.push(...(await sourceFiles(full)));
      // isFile(), not "not a directory": a symlink is neither, and reading one that points at a
      // directory throws EISDIR. Following them would also risk walking outside the repository.
    } else if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

describe("source files stay reviewable", () => {
  it("contains no NUL bytes, which would make Git treat a file as binary", async () => {
    const files = await sourceFiles(ROOT);
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
