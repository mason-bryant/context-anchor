import { ASSERTION_KINDS, type AssertionKind } from "../src/db/createAssertion.js";
import { assertValidSchemaName } from "../src/db/config.js";

/**
 * Argument parsing for the authoring CLI, in its own module so it can be tested.
 *
 * It earned that: the inline `--flag=value` handling, the cursor stepping that depends on it,
 * and the known-flag test for a missing value are subtle enough that two bugs in them shipped
 * and were caught by hand rather than by anything automatic — an inline flag swallowing the
 * argument after it, and an `=` split that reintroduced the ambiguity it existed to remove.
 * This is the entry point that writes assertions to a real database.
 */

export type Args = {
  schema: string;
  scope: string | undefined;
  list: boolean;
  kind: AssertionKind | undefined;
  title: string | undefined;
  content: string | undefined;
  block: string | undefined;
  quote: string | undefined;
  minLength: number;
};

/**
 * Every flag this command accepts.
 *
 * Named so two things can be decided by lookup rather than by shape. A value is only "missing"
 * if the next token is a flag *this command knows* — testing for a leading `--` instead made it
 * impossible to quote text that begins with dashes, which is ordinary in the material being
 * cited: a SQL comment, a Markdown rule, a diff line. The whole job here is quoting source text
 * byte for byte, so a parser that refuses a legal quote is refusing the job.
 *
 * And an argument that is not in this set is a typo. Silently ignoring it in a command that
 * writes to the database means a dropped flag becomes an assertion nobody asked for.
 */
/** Same shape the rest of the codebase uses for a record guid. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const KNOWN_FLAGS = new Set([
  "--list",
  "--schema",
  "--scope",
  "--kind",
  "--title",
  "--content",
  "--block",
  "--quote",
  "--min-length",
  "--help",
  "-h",
]);

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    schema: "anchor_real",
    scope: undefined,
    list: false,
    kind: undefined,
    title: undefined,
    content: undefined,
    block: undefined,
    quote: undefined,
    minLength: 40,
  };
  // The EXTRA tokens a flag consumed beyond itself: 0 when its value is attached with `=`, 1
  // when the value is the next token. The loop's own `index += 1` supplies the rest, so a flag
  // advances by one or two in total -- but this function returns 0 or 1, and saying "one or two"
  // here would invite a reader to double-count and "fix" the code back to the bug it replaced.
  //
  // That bug: advancing by a fixed 1 swallowed the argument after every inline flag, so
  // `--title=x --content=y` lost the content and blamed --content for being absent.
  const step = (index: number): number => (inline.has(index) ? 0 : 1);
  const take = (index: number): string => {
    // An inline `=value` wins and is never ambiguous, whatever it contains.
    const attached = inline.get(index);
    if (attached !== undefined) {
      return attached;
    }
    const value = argv[index + 1];
    // Otherwise missing only when the next token is a flag this command knows. `--quote
    // '-- a comment'` is a legal quote and used to be rejected as a missing value. A value that
    // is *exactly* a flag name is ambiguous in this form and needs `--quote=--list`.
    if (value === undefined || KNOWN_FLAGS.has(value)) {
      throw new Error(
        `${argv[index]!} needs a value. If the value is itself a flag name, use ` +
          `${argv[index]!}=<value>.`,
      );
    }
    return value;
  };
  // `--flag=value` is read inline rather than split into two tokens. Splitting was the first
  // attempt and it defeats the purpose: `--quote=--list` became `--quote` followed by `--list`,
  // which is precisely the ambiguity the `=` form exists to remove.
  //
  // Space-separated, a value identical to a flag name cannot be told from the flag itself, so
  // `=` is how you cite text that happens to be exactly one of these tokens. Split on the first
  // `=` only, since a quote may contain more.
  const inline = new Map<number, string>();
  const names: string[] = argv.map((raw, index) => {
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    if (eq <= 2) {
      return raw;
    }
    inline.set(index, raw.slice(eq + 1));
    return raw.slice(0, eq);
  });
  argv = names;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list") {
      if (inline.has(index)) throw new Error("--list takes no value.");
      args.list = true;
    }
    else if (arg === "--schema") { args.schema = take(index); index += step(index); }
    else if (arg === "--scope") { args.scope = take(index); index += step(index); }
    else if (arg === "--kind") { args.kind = take(index) as AssertionKind; index += step(index); }
    else if (arg === "--title") { args.title = take(index); index += step(index); }
    else if (arg === "--content") { args.content = take(index); index += step(index); }
    else if (arg === "--block") { args.block = take(index); index += step(index); }
    else if (arg === "--quote") { args.quote = take(index); index += step(index); }
    else if (arg === "--min-length") {
      const raw = take(index);
      const parsed = Number(raw);
      // Checked here rather than left to Postgres. Unvalidated it reaches the query as NaN and
      // comes back as `invalid input syntax for type integer` with a stack trace — the one place
      // in this script where a mistake does not produce a sentence naming what was wrong.
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`--min-length needs a non-negative whole number, not ${JSON.stringify(raw)}.`);
      }
      args.minLength = parsed;
      index += step(index);
    }
    else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage:\n` +
          `  npm run author -- --scope <slug> --list [--min-length N]\n` +
          `      Blocks in that scope, with guids and text, as authoring material.\n\n` +
          `  npm run author -- --scope <slug> --kind <kind> --title "..." --content "..." \\\n` +
          `      --block <guid> --quote "exact text from the block"\n` +
          `      Write one assertion with one citation. Refuses if the quote is not in the block.\n\n` +
          `  kinds: ${ASSERTION_KINDS.join(", ")}\n` +
          `  --schema defaults to anchor_real.\n` +
          `  --flag=value is accepted too, and is required when a value is exactly a flag name,\n` +
          `  e.g. --quote=--list\n`,
      );
      process.exit(0);
    } else {
      // Fails rather than ignoring. A typo'd flag in a command that writes is a value silently
      // dropped, and the write still happens -- with the wrong content, or under a default the
      // author never chose.
      throw new Error(
        `Unknown argument ${JSON.stringify(arg)}. Known flags: ${[...KNOWN_FLAGS].join(", ")}.`,
      );
    }
  }
  assertValidSchemaName(args.schema);

  // Validated here, where a mistake is still a sentence. Left to the database, a blank scope is
  // an empty result that reads as "nothing to cite", a bad block guid is `invalid input syntax
  // for type uuid`, and a whitespace title is authored -- while the MCP surface for the same
  // operation trims and requires min(1) on all three. Two entry points to one command should
  // not disagree about what is a legal claim.
  args.scope = args.scope?.trim();
  if (args.scope === undefined || args.scope.length === 0) {
    throw new Error("--scope is required. See --help.");
  }
  if (args.list) {
    return args;
  }

  // Trimmed, not merely checked for blankness. The MCP surface trims these, and the default
  // idempotency key is a hash of title and content -- so `--title " a "` here and `--title "a"`
  // there are two different commands writing two assertions, and a retry of one never converges
  // on the other. Same text, same claim, same key.
  args.title = args.title?.trim();
  args.content = args.content?.trim();
  for (const [flag, value] of [
    ["--title", args.title],
    ["--content", args.content],
  ] as const) {
    if (value !== undefined && value.length === 0) {
      throw new Error(`${flag} cannot be blank.`);
    }
  }

  // --quote is deliberately NOT trimmed. It has to match the block byte for byte, and a citation
  // whose quote was silently reshaped is the failure the whole verification exists to prevent.
  if (args.block !== undefined && !UUID_PATTERN.test(args.block)) {
    throw new Error(`--block ${JSON.stringify(args.block)} is not a uuid.`);
  }
  return args;
}


export { ASSERTION_KINDS };
export type { AssertionKind };
