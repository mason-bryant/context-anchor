import { describe, expect, it } from "vitest";

import { parseArgs } from "../scripts/authorAssertionArgs.js";

const BLOCK = "0bf16885-9dfe-489a-9f6f-820b7baedddd";
const create = (...extra: string[]): string[] => [
  "--scope", "abac",
  "--kind", "decision",
  "--title", "a title",
  "--content", "some content",
  "--block", BLOCK,
  "--quote", "a quote",
  ...extra,
];

/**
 * The parser for the command that writes assertions into a real workspace.
 *
 * Tested because two bugs shipped in it and both were found by hand: an inline `--flag=value`
 * swallowing the argument after it, and an earlier attempt that split `--quote=--list` into two
 * tokens and so handed the value back to the ambiguity the `=` form exists to remove. Neither
 * was visible to typecheck or lint, and the second reported the *following* flag as missing —
 * so the error blamed the wrong argument.
 */
describe("author-assertion argument parsing", () => {
  it("reads a value attached with = as one token", () => {
    const args = parseArgs(["--scope=abac", "--list"]);
    expect(args.scope).toBe("abac");
    expect(args.list).toBe(true);
  });

  it("does not let an inline flag swallow the argument after it", () => {
    // The regression: every branch advanced the cursor by one, which is right for `--flag value`
    // and wrong for `--flag=value`. `--title=x --content=y` lost the content, and the error
    // named --content rather than the parser.
    const inlined = parseArgs(["--scope=abac", "--kind=decision", "--title=x", "--content=y", "--block=" + BLOCK, "--quote=z"]);
    expect(inlined.title).toBe("x");
    expect(inlined.content).toBe("y");
    expect(inlined.quote).toBe("z");
    expect(inlined.block).toBe(BLOCK);
  });

  it("accepts a value that is exactly a flag name, via =", () => {
    // The case the = form exists for. Space-separated this is genuinely ambiguous.
    const args = parseArgs(["--scope=abac", "--kind=decision", "--title=--list", "--content=y", "--block=" + BLOCK, "--quote=--list"]);
    expect(args.quote).toBe("--list");
    expect(args.title).toBe("--list");
  });

  it("accepts a quote that merely starts with dashes", () => {
    // Ordinary in the material being cited: a SQL comment, a Markdown rule, a diff line.
    const args = parseArgs(create().slice(0, -1).concat(["-- a sql comment"]));
    expect(args.quote).toBe("-- a sql comment");
  });

  it("mixes = and space forms in one command", () => {
    const args = parseArgs(["--scope", "abac", "--kind=decision", "--title", "t", "--content=c", "--block", BLOCK, "--quote=q"]);
    expect(args).toMatchObject({ scope: "abac", kind: "decision", title: "t", content: "c", quote: "q" });
  });

  it("refuses a flag with no value, and says how to pass one that looks like a flag", () => {
    expect(() => parseArgs(["--scope", "abac", "--title", "--content", "x"])).toThrow(/--title needs a value/);
    expect(() => parseArgs(["--scope", "abac", "--title", "--content", "x"])).toThrow(/--title=<value>/);
  });

  it("refuses an unknown argument rather than dropping it", () => {
    // In a command that writes, a typo'd flag is a value silently discarded while the write
    // still happens.
    expect(() => parseArgs(["--scope", "abac", "--list", "--min-lenght", "5"])).toThrow(/Unknown argument "--min-lenght"/);
  });

  it("refuses a value on a flag that takes none", () => {
    expect(() => parseArgs(["--scope=abac", "--list=5"])).toThrow(/--list takes no value/);
  });

  it("validates what the MCP surface validates, rather than leaving it to Postgres", () => {
    // Two entry points to one operation should not disagree about what is a legal claim.
    expect(() => parseArgs(["--scope", "   "])).toThrow(/--scope is required/);
    expect(() => parseArgs(create().map((t) => (t === "a title" ? "   " : t)))).toThrow(/--title cannot be blank/);
    expect(() => parseArgs(create().map((t) => (t === "some content" ? "  " : t)))).toThrow(/--content cannot be blank/);
    expect(() => parseArgs(create().map((t) => (t === BLOCK ? "not-a-uuid" : t)))).toThrow(/is not a uuid/);
  });

  it("trims title and content but never the quote", () => {
    // The key is a hash of title and content, so an untrimmed title is a different command
    // writing a second assertion that a retry never converges on. The quote is the opposite
    // case: it must match the block byte for byte, and reshaping it silently is the failure
    // the citation check exists to prevent.
    const args = parseArgs(create().map((t) =>
      t === "a title" ? "  a title  " : t === "a quote" ? "  a quote  " : t,
    ));
    expect(args.title).toBe("a title");
    expect(args.quote).toBe("  a quote  ");
  });

  it("does not demand authoring fields when only listing", () => {
    // --list is a read. Requiring a block guid to look at a scope's material would make the
    // listing useless for deciding what to cite.
    expect(() => parseArgs(["--scope", "abac", "--list"])).not.toThrow();
  });

  it("refuses a schema name that would reach SQL as an identifier", () => {
    expect(() => parseArgs(["--scope", "abac", "--list", "--schema", 'evil"; DROP SCHEMA public; --'])).toThrow(
      /Invalid database schemaName/,
    );
  });

  it("rejects a non-numeric or negative --min-length before it reaches the query", () => {
    expect(() => parseArgs(["--scope", "abac", "--list", "--min-length", "abc"])).toThrow(/non-negative whole number/);
    expect(() => parseArgs(["--scope", "abac", "--list", "--min-length", "-5"])).toThrow(/non-negative whole number/);
    expect(parseArgs(["--scope", "abac", "--list", "--min-length", "0"]).minLength).toBe(0);
  });
});
