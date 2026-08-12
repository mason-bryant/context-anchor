import { defineConfig } from "vitest/config";

/**
 * One pattern for both the tests that run and the files the checker reads. Kept single because
 * the two drifting apart is not a cosmetic mismatch: if typecheck's glob stops matching
 * anything, Vitest reports "Type Errors  no errors" over an empty set, which looks exactly like
 * a real pass — the silent success this configuration exists to prevent.
 */
const TEST_FILES = "test/**/*.test.ts";

export default defineConfig({
  test: {
    include: [TEST_FILES],
    testTimeout: 20_000,
    // Vitest transpiles through esbuild, which strips type annotations without checking them —
    // so a green `vitest run` says nothing about whether the types hold. That is not theoretical:
    // a result type missing a field its returns already set passed 26 contract tests here, and
    // only `npm run check` caught it. Running the checker alongside the tests removes the need to
    // remember, at the cost of a few seconds per run.
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.check.json",
      // Pointed at the real test files, not the `**/*.test-d.ts` default, which would match
      // nothing here. These files import src, so type errors there surface through them.
      include: [TEST_FILES],
    },
  },
});

