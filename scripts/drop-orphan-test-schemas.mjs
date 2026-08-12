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
 * Dry run by default. Pass --yes to actually drop.
 *
 *   node scripts/drop-orphan-test-schemas.mjs            # list what would go
 *   node scripts/drop-orphan-test-schemas.mjs --yes      # drop it
 */

import pg from "pg";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://anchor:anchor@127.0.0.1:55432/anchor_mcp";

/**
 * Deliberately narrow: a test schema is a known prefix, an underscore, and exactly twelve hex
 * digits from randomUUID, optionally with the `_ready` and `_telemetry` suffixes the suite
 * appends. A real workspace schema — `knowledge`, `anchor_real`, anything an operator named by
 * hand — cannot match this, which is the property that makes the script safe to point at a
 * database holding real content.
 */
const TEST_SCHEMA_PATTERN = /^[a-z0-9]+_test_[0-9a-f]{12}(_ready)?(_telemetry)?$/;

const apply = process.argv.includes("--yes");

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
try {
  const { rows } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
      WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'
      ORDER BY schema_name`,
  );
  const all = rows.map((row) => row.schema_name);
  const doomed = all.filter((name) => TEST_SCHEMA_PATTERN.test(name));
  const kept = all.filter((name) => !TEST_SCHEMA_PATTERN.test(name));

  console.log(`Database: ${DATABASE_URL.replace(/\/\/[^@]*@/, "//***@")}`);
  console.log(`Schemas: ${String(all.length)} total, ${String(doomed.length)} test-shaped.`);
  // Printed every time, not just on failure: the operator's real question before running this is
  // "what is it NOT going to touch", and that list is short enough to read.
  console.log(`Keeping (${String(kept.length)}): ${kept.join(", ")}`);

  if (doomed.length === 0) {
    console.log("Nothing to drop.");
  } else if (!apply) {
    console.log(`\nDry run. Would drop ${String(doomed.length)} schema(s). Re-run with --yes to apply.`);
    console.log(doomed.slice(0, 10).join(", ") + (doomed.length > 10 ? `, … and ${String(doomed.length - 10)} more` : ""));
  } else {
    let dropped = 0;
    for (const name of doomed) {
      await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      dropped += 1;
      if (dropped % 100 === 0) {
        console.log(`  dropped ${String(dropped)}/${String(doomed.length)}…`);
      }
    }
    console.log(`Dropped ${String(dropped)} schema(s).`);

    const after = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.schemata
        WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'`,
    );
    console.log(`Remaining schemas: ${String(after.rows[0].n)}.`);
  }
} finally {
  await pool.end();
}
