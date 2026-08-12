import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    // Vitest transpiles through esbuild, which strips type annotations without checking them —
    // so a green `vitest run` says nothing about whether the types hold. That is not theoretical:
    // a result type missing a field its returns already set passed 26 contract tests here, and
    // only `npm run check` caught it. Running the checker alongside the tests removes the need to
    // remember, at the cost of a few seconds per run.
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.check.json",
      // Pointed at the real test files, not the `**/*.test-d.ts` default. With the default this
      // setting checks nothing at all and still reports "Type Errors  no errors" — a silent
      // pass that looks exactly like a real one, which is the failure it exists to prevent.
      // These files import src, so type errors there surface through them.
      include: ["test/**/*.test.ts"],
    },
  },
});

