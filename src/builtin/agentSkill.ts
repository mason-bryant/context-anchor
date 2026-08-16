/**
 * The cross-agent skill (T-42): one instruction set, rendered for every harness we support.
 *
 * The problem it exists to solve is not that agents cannot reach the anchors — they can, the
 * MCP tools are right there. It is that they do not reach for them at the moment it matters.
 * A session starts, `startTask` runs, work proceeds, and then the topic changes — "now write
 * the design doc" — and the agent answers that new question from AGENTS.md, or from nothing,
 * because retrieval already happened once and felt done. So the trigger this skill encodes is
 * the topic shift, not the session start.
 *
 * Both harnesses load a rule the same way: a name and a description the model reads to decide
 * relevance. That is why one body serves both and only the front matter differs — and why the
 * description is written to fire on a change of subject rather than on a keyword.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_SLUG = "anchor-context";

/**
 * How an installed file identifies itself as ours. `install` overwrites a file carrying this
 * and refuses one that does not, so upgrading is a re-run and a hand-written rule of the same
 * name is never silently destroyed.
 */
export const SKILL_MARKER = "installed by anchor-mcp";

function packageVersion(): string {
  try {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Read by both harnesses to decide whether to pull the rule in, so it has to describe the
 * *moment* rather than the subject: "context anchors" is not something the model knows it
 * needs, but "the task just changed to something new" is something it can notice.
 */
export const SKILL_DESCRIPTION =
  "Consult this project's context anchors (anchor-mcp) whenever the task shifts to a new subject — " +
  "writing a document, starting a feature, picking a convention, choosing where a file goes. The " +
  "anchors hold decisions, rules, and invariants that are not in the code and not in AGENTS.md, and " +
  "they take precedence over both.";

const SKILL_BODY = `# Consult the anchors when the topic shifts

This project's rules, decisions, and invariants live in **anchor-mcp**. They are not in the
code, and AGENTS.md / CLAUDE.md / .cursorrules hold at most a subset. Retrieval is routed:
you ask with the task in your own words and get back the routes that match, cheaply.

## When to call

Call \`planRoutedBundle\` on a **topic shift**, not only at the start of a session:

- the user names a new deliverable — "write the design doc", "add a migration", "draft the release notes"
- you are about to start a kind of work you have not done yet in this session
- you are about to pick a convention: where a file goes, what it is named, which library, which format
- you are about to write to the anchor repository

Session start is too early. Still open the session with \`startTask\` — it is the right first
call — but the topic is not known then, and it will change several times before the session
ends. Each of those changes is another call.

Call it **unconditionally**. Do not first judge whether this project "probably has a rule
about it" — you have not seen the corpus, so that judgement is a guess, and the call that
would settle it returns about a kilobyte.

## The call

    planRoutedBundle({
      task: "<the new topic, in the user's words>",
      referencedPaths: ["<files you are about to touch>"]
    })

Echo the \`traceId\` from \`startTask\` if you have one. The defaults return listings rather
than bodies: each route comes back with \`recordLinks\` — a ref, heading, kind, and status per
record, and no content — so choosing what to read costs one listing instead of a payload.

If \`planRoutedBundle\` is not among the tools offered, this server is running without its
database backend. Use \`planContextBundle\` with the same task instead; everything below about
reading the result and about precedence still applies.

## Reading the result

Every route carries \`matchReasons\` explaining why it matched. Read those first.

- A route whose match reasons name the topic **directly**: expand it. Call again with the same
  \`task\` plus \`routeKeys: ["<key>"]\`.
- A **long list of weakly matched routes** means nothing applies. Take none. Do not expand one
  to be safe — a route that matched on a shared word does not contain a rule about your topic,
  and reading it costs more than the listing that told you so.
- **Zero routes is an answer**, not a failure. This project has recorded nothing here. Proceed
  on your own judgement, and say that is what you are doing.

Once you act on a record, report it: \`reportRecordUse({ requestId, refs, useKind })\`, with the
\`requestId\` the bundle returned. Nothing else distinguishes a record that was served from one
that was useful, and that difference is what ranking is built from.

## Precedence

**The anchors win.** Where an anchor and AGENTS.md / CLAUDE.md / .cursorrules disagree, follow
the anchor.

Read the file rules anyway — you can only report a conflict you noticed. When you find one,
tell the user in a line or two: what each says, which you followed, and where the losing rule
lives so they can go fix it. Do not quietly reconcile them, and do not average them.

Never go looking for anchors on the filesystem. What a grep finds is one repository's copy at
one moment, with no route, no status, and no way to tell current from retired. Ask the tools.
`;

function marker(): string {
  return `<!-- ${SKILL_MARKER} v${packageVersion()} — re-run \`anchor-mcp install\` to update -->`;
}

/**
 * Claude Code reads `name` and `description` from front matter and loads the body on demand.
 */
export function renderClaudeSkill(): string {
  return [
    "---",
    `name: ${SKILL_SLUG}`,
    `description: ${SKILL_DESCRIPTION}`,
    "---",
    "",
    SKILL_BODY,
    marker(),
    "",
  ].join("\n");
}

/**
 * Cursor's "apply intelligently" mode: a description and no globs. `alwaysApply: false` is
 * stated rather than left to default because the whole design turns on this rule arriving on a
 * topic shift — an always-applied rule is one the model stops reading.
 */
export function renderCursorRule(): string {
  return [
    "---",
    `description: ${SKILL_DESCRIPTION}`,
    "alwaysApply: false",
    "---",
    "",
    SKILL_BODY,
    marker(),
    "",
  ].join("\n");
}

/** The shared instruction text, exported so tests can assert neither rendering drops any of it. */
export const SKILL_BODY_TEXT = SKILL_BODY;
