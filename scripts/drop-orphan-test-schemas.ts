#!/usr/bin/env node
/**
 * Drops leftover schemas from contract-test runs.
 *
 * The suite creates a uniquely named schema pair per test and drops it in teardown. When that
 * drop was incomplete — for a long time it dropped the knowledge schema and left the telemetry
 * one — the leftovers accumulated silently, because nothing ever looked at schemas no test had
 * named. This is the broom for what already piled up; `test/db/schemaLeakGuard.ts` is what stops
 * it happening again.
 *
 * TypeScript rather than plain `.mjs`, and run through tsx like the other scripts here, so it can
 * import the two rules it needs instead of restating them. It carried its own copy of the schema
 * pattern (kept honest only by a test asserting the literals matched) and its own credential
 * redaction, which was a regex that left the URL untouched when it had no `//user:pass@` segment
 * — printing an unexpected connection string verbatim. Both now come from the definitions the
 * rest of the codebase uses.
 *
 * Dry run by default. Pass --yes to actually drop.
 *
 *   npm run db:clean-test-schemas          # list what would go
 *   npm run db:clean-test-schemas -- --yes # drop it
 */

import pg from "pg";

import { redactDatabaseUrl } from "../src/db/config.js";
import { TEST_SCHEMA_PATTERN } from "../test/db/testDatabase.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://anchor:anchor@127.0.0.1:55432/anchor_mcp";

const apply = process.argv.includes("--yes");

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
        WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'
        ORDER BY schema_name`,
    );
    const all = rows.map((row) => row.schema_name);
    /**
     * The same pattern the leak guard matches on, imported rather than copied: a name the guard
     * reports but this script will not remove is a leak flagged on every run and cleaned by
     * nothing. It requires a twelve-hex-digit suffix, which is what separates a generated name
     * from anything a person would type, so a hand-named workspace schema cannot match.
     */
    const doomed = all.filter((name) => TEST_SCHEMA_PATTERN.test(name));
    const kept = all.filter((name) => !TEST_SCHEMA_PATTERN.test(name));

    console.log(`Database: ${redactDatabaseUrl(DATABASE_URL)}`);
    console.log(`Schemas: ${String(all.length)} total, ${String(doomed.length)} test-shaped.`);
    // Printed every time, not just on failure: the operator's real question before running this
    // is "what is it NOT going to touch", and that list is short enough to read.
    console.log(`Keeping (${String(kept.length)}): ${kept.join(", ")}`);

    if (doomed.length === 0) {
      console.log("Nothing to drop.");
      return;
    }

    if (!apply) {
      console.log(`\nDry run. Would drop ${String(doomed.length)} schema(s). Re-run with --yes to apply.`);
      console.log(
        doomed.slice(0, 10).join(", ") +
          (doomed.length > 10 ? `, … and ${String(doomed.length - 10)} more` : ""),
      );
      return;
    }

    let dropped = 0;
    for (const name of doomed) {
      // Interpolated, like every other DDL path here, so the name must have been proven safe
      // first — TEST_SCHEMA_PATTERN admits only lowercase letters, digits and underscores.
      await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      dropped += 1;
      if (dropped % 100 === 0) {
        console.log(`  dropped ${String(dropped)}/${String(doomed.length)}…`);
      }
    }
    console.log(`Dropped ${String(dropped)} schema(s).`);

    const after = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.schemata
        WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'`,
    );
    console.log(`Remaining schemas: ${String(after.rows[0]?.n ?? 0)}.`);
  } finally {
    await pool.end();
  }
}

await main();
