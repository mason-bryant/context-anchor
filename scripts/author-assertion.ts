#!/usr/bin/env tsx
import pg from "pg";

import { COMPOSE_MANAGED_DATABASE_URL } from "../src/db/cliArgs.js";
import { CommandHandler } from "../src/db/commandHandler.js";
import { createAssertion } from "../src/db/createAssertion.js";
import { parseArgs } from "./authorAssertionArgs.js";

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
 * which is the material. Without `--list`, the same command writes one assertion with one
 * citation and refuses if the quote is not found in the block byte for byte — there is no
 * `--create` flag, and this comment claimed one for a while. Nothing here can author without
 * provenance, which is the property the whole store is for.
 *
 * Idempotency is content-derived by createAssertion, so re-running the same authoring command is
 * a retry rather than a duplicate — which matters when several agents work a scope list and one
 * of them is restarted.
 */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // The entry point decides what --help does. The parser only reports that it was asked for,
  // so it stays callable from anywhere that is not a terminal.
  if (args.mode === "help") {
    console.log(args.usage);
    return;
  }
  const schema = args.schema;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? COMPOSE_MANAGED_DATABASE_URL,
    max: 4,
  });

  try {
    // Refuses rather than guessing. The sibling corpus script does the same, and the stakes are
    // higher here: that one reads, this one writes assertions, so picking the wrong workspace
    // authors real claims into the wrong place and nothing in the output would say so.
    const workspaces = await pool.query<{ workspace_guid: string; workspace_slug: string }>(
      `SELECT workspace_guid, workspace_slug FROM "${schema}".workspaces ORDER BY workspace_slug`,
    );
    if (workspaces.rows.length === 0) {
      throw new Error(`Schema ${schema} holds no workspace.`);
    }
    if (workspaces.rows.length > 1) {
      throw new Error(
        `Schema ${schema} holds ${String(workspaces.rows.length)} workspaces ` +
          `(${workspaces.rows.map((row) => row.workspace_slug).join(", ")}). This command writes ` +
          `assertions and will not guess which one you meant.`,
      );
    }
    const workspaceGuid = workspaces.rows[0]!.workspace_guid;

    if (args.mode === "list") {
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
        // Printed exactly as stored, not trimmed. createAssertion matches the quote against the
        // untrimmed raw_content, so a listing that trims its edges can show text that cannot be
        // copied back as a citation — the one thing this listing exists to make possible.
        console.log(`\n--- block ${row.block_guid}  [section: ${row.title ?? "(untitled)"}]`);
        console.log(row.raw_content);
      }
      console.log(`\n${String(blocks.rows.length)} blocks in ${args.scope}.`);
      return;
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
      scopeSlug: args.scope,
      kind: args.kind,
      title: args.title,
      content: args.content,
      citation: { blockGuid: args.block, exactQuote: args.quote },
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
