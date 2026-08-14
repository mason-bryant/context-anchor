#!/usr/bin/env tsx
import pg from "pg";

import { COMPOSE_MANAGED_DATABASE_URL } from "../src/db/cliArgs.js";
import { assertValidSchemaName } from "../src/db/config.js";
import { CommandHandler } from "../src/db/commandHandler.js";
import { ASSERTION_KINDS, createAssertion, type AssertionKind } from "../src/db/createAssertion.js";

/**
 * Authoring assertions against a real workspace, one command at a time.
 *
 * The assertion pass the build order asks for before the gate (T8) is authoring work, not
 * engineering: a person or an agent reads a scope's own documents and records the claims worth
 * addressing on their own. What that needs is a narrow interface, because the failure mode is
 * not writing bad TypeScript — it is authoring a citation whose quote is not in the block it
 * names, which is a claim about provenance rather than provenance.
 *
 * So this offers exactly two verbs. `--list` shows a scope's blocks with their guids and text,
 * which is the material. `--create` writes one assertion with one citation, and refuses if the
 * quote is not found in the block byte for byte. Nothing here can author without provenance,
 * which is the property the whole store is for.
 *
 * Idempotency is content-derived by createAssertion, so re-running the same authoring command is
 * a retry rather than a duplicate — which matters when several agents work a scope list and one
 * of them is restarted.
 */

type Args = {
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

function parseArgs(argv: string[]): Args {
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
  const take = (index: number): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argv[index]!} needs a value.`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list") args.list = true;
    else if (arg === "--schema") { args.schema = take(index); index += 1; }
    else if (arg === "--scope") { args.scope = take(index); index += 1; }
    else if (arg === "--kind") { args.kind = take(index) as AssertionKind; index += 1; }
    else if (arg === "--title") { args.title = take(index); index += 1; }
    else if (arg === "--content") { args.content = take(index); index += 1; }
    else if (arg === "--block") { args.block = take(index); index += 1; }
    else if (arg === "--quote") { args.quote = take(index); index += 1; }
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
      index += 1;
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
          `  --schema defaults to anchor_real.\n`,
      );
      process.exit(0);
    }
  }
  assertValidSchemaName(args.schema);
  if (args.scope === undefined) throw new Error("--scope is required. See --help.");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const schema = args.schema;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? COMPOSE_MANAGED_DATABASE_URL,
    max: 4,
  });

  try {
    const workspace = await pool.query<{ workspace_guid: string }>(
      `SELECT workspace_guid FROM "${schema}".workspaces ORDER BY workspace_slug LIMIT 1`,
    );
    const workspaceGuid = workspace.rows[0]?.workspace_guid;
    if (workspaceGuid === undefined) throw new Error(`Schema ${schema} holds no workspace.`);

    if (args.list) {
      // Current revision only. A block from a superseded revision still has a row, and citing it
      // would anchor a claim to text the commit no longer contains.
      const blocks = await pool.query<{
        block_guid: string;
        title: string | null;
        raw_content: string;
      }>(
        // LEFT JOIN to sections, not INNER. `content_blocks.section_guid` is nullable, and the
        // importer leaves it null for any content before a document's first heading — an
        // ordinary Markdown shape. createAssertion has no section requirement, so those blocks
        // are perfectly citable; an inner join made them invisible to the only tool an author
        // uses, which is under-reporting the material rather than filtering it.
        //
        // Scopes are filtered to live ones because createAssertion refuses a retired scope. The
        // two verbs disagreeing meant a listing could offer blocks that the write would then
        // reject, which teaches an author to distrust the listing.
        `SELECT b.block_guid, ss.title, b.raw_content
           FROM "${schema}".content_blocks b
           LEFT JOIN "${schema}".source_sections ss
             ON ss.workspace_guid = b.workspace_guid AND ss.section_guid = b.section_guid
           JOIN "${schema}".document_revisions dr
             ON dr.workspace_guid = b.workspace_guid AND dr.revision_guid = b.revision_guid
           JOIN "${schema}".source_documents d
             ON d.workspace_guid = dr.workspace_guid AND d.document_guid = dr.document_guid
            AND d.retired_at IS NULL
           JOIN "${schema}".scopes s
             ON s.workspace_guid = d.workspace_guid AND s.scope_guid = d.owner_scope_guid
            AND s.retired_at IS NULL
          WHERE b.workspace_guid = $1 AND s.scope_slug = $2
            AND length(b.raw_content) >= $3
            AND dr.revision_number = (
              SELECT max(dr2.revision_number) FROM "${schema}".document_revisions dr2
               WHERE dr2.workspace_guid = dr.workspace_guid AND dr2.document_guid = dr.document_guid
            )
          ORDER BY ss.ordinal NULLS FIRST, b.ordinal`,
        [workspaceGuid, args.scope, args.minLength],
      );

      if (blocks.rows.length === 0) {
        // Told apart from a scope that exists and is empty. The audience is several authors
        // working a list of slugs, and a typo that reads as "nothing to do here" is a scope
        // quietly skipped rather than an error anybody sees.
        const known = await pool.query(
          `SELECT 1 FROM "${schema}".scopes
            WHERE workspace_guid = $1 AND scope_slug = $2 AND retired_at IS NULL`,
          [workspaceGuid, args.scope],
        );
        if (known.rows.length === 0) {
          throw new Error(
            `No live scope ${JSON.stringify(args.scope)} in ${schema}. Check the slug — this is ` +
              `not the same as a scope with nothing to cite.`,
          );
        }
        console.log(`No blocks of at least ${String(args.minLength)} characters in scope ${args.scope}.`);
        return;
      }
      for (const row of blocks.rows) {
        console.log(`\n--- block ${row.block_guid}  [section: ${row.title ?? "(untitled)"}]`);
        console.log(row.raw_content.trim());
      }
      console.log(`\n${String(blocks.rows.length)} blocks in ${args.scope}.`);
      return;
    }

    for (const [flag, value] of [
      ["--kind", args.kind],
      ["--title", args.title],
      ["--content", args.content],
      ["--block", args.block],
      ["--quote", args.quote],
    ] as const) {
      if (value === undefined) throw new Error(`${flag} is required to create an assertion.`);
    }
    if (!ASSERTION_KINDS.includes(args.kind!)) {
      throw new Error(`--kind ${JSON.stringify(args.kind)} is not one of: ${ASSERTION_KINDS.join(", ")}.`);
    }

    const owner = await pool.query<{ principal_guid: string }>(
      `SELECT principal_guid FROM "${schema}".workspace_memberships
        WHERE workspace_guid = $1 AND role = 'owner' ORDER BY principal_guid LIMIT 1`,
      [workspaceGuid],
    );
    const actorPrincipalGuid = owner.rows[0]?.principal_guid;
    if (actorPrincipalGuid === undefined) throw new Error("No owner principal to author as.");

    const result = await createAssertion({
      pool,
      schemaName: schema,
      handler: new CommandHandler(pool, schema),
      workspaceGuid,
      actorPrincipalGuid,
      scopeSlug: args.scope!,
      kind: args.kind!,
      title: args.title!,
      content: args.content!,
      citation: { blockGuid: args.block!, exactQuote: args.quote! },
    });

    console.log(
      JSON.stringify(
        {
          assertionGuid: result.assertionGuid,
          citationGuid: result.citationGuid,
          scope: args.scope,
          // True when this exact claim and citation were already authored. Not an error: several
          // agents working one scope list, or one of them restarted, should converge rather than
          // duplicate.
          replayed: result.replayed,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

await main();
