#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { ensureBootstrap } from "../src/db/bootstrap.js";
import { CommandHandler } from "../src/db/commandHandler.js";
import { telemetrySchemaNameFor } from "../src/db/config.js";
import { COMPOSE_MANAGED_DATABASE_URL } from "../src/db/cliArgs.js";
import { importDocuments } from "../src/db/importDocuments.js";
import { runMigrations } from "../src/db/migrate.js";
import { corpusDocument, runCorpus, type Corpus, type CorpusReport } from "../src/db/routing/corpus.js";

/**
 * The routing corpus, runnable by hand (T-50).
 *
 * Two modes, and the difference between them is the whole point.
 *
 * `--seed` builds a throwaway schema from the corpus's own fixture and scores it: recall and
 * fan-out mean something, because the expectations were written for exactly these scopes. This
 * is what the committed contract test runs, offered here so a person can read the per-task
 * detail the test only asserts over.
 *
 * `--schema <name>` runs the same tasks against a workspace that already exists — the real one.
 * That run is unscored, because the corpus's expectations name scopes that workspace never had
 * and a recall of zero from a mismatched fixture reads exactly like a retrieval failure. What
 * survives is the zero-route rate and the fan-out, which are properties of the selection code
 * rather than of the expectations, and those are the numbers T-45 is about.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.resolve(scriptDir, "../test/fixtures/routing-corpus/corpus.json");

type Args = { seed: boolean; schema: string | undefined; recordLexical: boolean; json: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: false, schema: undefined, recordLexical: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed") {
      args.seed = true;
    } else if (arg === "--schema" && argv[index + 1] !== undefined && !argv[index + 1]!.startsWith("--")) {
      // Guarded against the next flag: `--schema --json` otherwise takes "--json" as the schema
      // name, fails on a nonsense schema, and loses the flag without saying so.
      args.schema = argv[index + 1];
      index += 1;
    } else if (arg === "--record-lexical") {
      args.recordLexical = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage:\n` +
          `  npm run corpus -- --seed [--record-lexical] [--json]\n` +
          `      Seed a throwaway schema from the corpus fixture and score it.\n` +
          `  npm run corpus -- --schema <name> [--record-lexical] [--json]\n` +
          `      Run the same tasks against an existing workspace. Unscored: the corpus's\n` +
          `      expectations name scopes that workspace does not have.\n`,
      );
      process.exit(0);
    }
  }
  if (!args.seed && args.schema === undefined) {
    throw new Error("Give either --seed or --schema <name>. See --help.");
  }
  if (args.seed && args.schema !== undefined) {
    throw new Error("--seed builds its own schema; --schema names an existing one. Pick one.");
  }
  return args;
}

function render(report: CorpusReport, recordLexical: boolean): string {
  const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;
  const lines: string[] = [];

  lines.push(`corpus         ${report.corpusVersion}`);
  lines.push(`record-lexical ${recordLexical ? "on" : "off"}`);
  lines.push(
    `density        ${String(report.density.assertions)} assertions across ` +
      `${String(report.density.scopesWithAssertions)} of ${String(report.density.routableScopes)} routable scopes`,
  );
  lines.push(`tasks          ${String(report.taskCount)}`);
  lines.push(`zero-route     ${pct(report.zeroRouteRate)}`);
  lines.push(
    `recall         ${report.meanRecall === undefined ? "not scored (fixture does not describe this workspace)" : pct(report.meanRecall)}`,
  );
  lines.push(`forbidden hits ${String(report.forbiddenHitCount)} tasks`);
  lines.push(`over ceiling   ${String(report.overMaxRoutesCount)} tasks`);
  lines.push(`offered, empty ${String(report.offeredButEmptyCount)} tasks`);
  lines.push(`whole workspace ${String(report.wholeWorkspaceCount)} tasks`);
  lines.push("");

  // Per task, because the aggregate is what hid the stopword problem for four review rounds.
  // "118 added routes" reads as a win; "50 of them came from the word and" does not.
  const width = Math.max(...report.results.map((result) => result.id.length));
  for (const result of report.results) {
    const marks = [
      result.offeredScopes.length === 0 ? "SILENT" : "",
      result.missing.length > 0 ? `missing ${result.missing.join(",")}` : "",
      result.forbiddenHits.length > 0 ? `forbidden ${result.forbiddenHits.join(",")}` : "",
      result.overMaxRoutes ? "over ceiling" : "",
      result.offeredScopes.length > 0 && result.recordsReturned === 0 ? "no records" : "",
    ].filter((mark) => mark.length > 0);

    lines.push(
      `${result.id.padEnd(width)}  ${String(result.candidateCount).padStart(2)} cand  ` +
        `${String(result.offeredScopes.length).padStart(2)} routes  ` +
        `${String(result.recordsReturned).padStart(3)} records  ${marks.join("; ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * The workspace and an owner principal in an existing schema, without writing anything.
 *
 * Refuses rather than guessing when there is more than one workspace: measuring the wrong one
 * would report a retrieval failure that is really a selection of the wrong subject, and the
 * report has no field that would show it.
 */
async function readWorkspace(
  pool: pg.Pool,
  schemaName: string,
): Promise<{ workspaceGuid: string; ownerPrincipalGuid: string }> {
  const workspaces = await pool.query<{ workspace_guid: string; workspace_slug: string }>(
    `SELECT workspace_guid, workspace_slug FROM "${schemaName}".workspaces ORDER BY workspace_slug`,
  );
  if (workspaces.rows.length === 0) {
    throw new Error(
      `Schema ${schemaName} holds no workspace. Use --seed to build one, or point --schema at a ` +
        `schema that has been bootstrapped.`,
    );
  }
  if (workspaces.rows.length > 1) {
    throw new Error(
      `Schema ${schemaName} holds ${String(workspaces.rows.length)} workspaces ` +
        `(${workspaces.rows.map((row) => row.workspace_slug).join(", ")}). This script will not ` +
        `guess which one you meant.`,
    );
  }

  const workspaceGuid = workspaces.rows[0]!.workspace_guid;
  const owner = await pool.query<{ principal_guid: string }>(
    `SELECT m.principal_guid FROM "${schemaName}".workspace_memberships m
      WHERE m.workspace_guid = $1 AND m.role = 'owner'
      ORDER BY m.principal_guid LIMIT 1`,
    [workspaceGuid],
  );
  const ownerPrincipalGuid = owner.rows[0]?.principal_guid;
  if (ownerPrincipalGuid === undefined) {
    throw new Error(`Workspace in ${schemaName} has no owner principal to run the corpus as.`);
  }
  return { workspaceGuid, ownerPrincipalGuid };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as Corpus;
  // Same default the CLI uses, overridable for a run against a real workspace.
  const databaseUrl = process.env.DATABASE_URL ?? COMPOSE_MANAGED_DATABASE_URL;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

  // Named for what it is, so an operator reading pg_stat_activity or a stray schema can tell
  // this apart from a real workspace at a glance.
  const schemaName = args.schema ?? `knowledge_corpus_${Date.now().toString(36)}`;

  try {
    if (args.seed) {
      const root = path.resolve(scriptDir, "..");
      await runMigrations(pool, { schemaName, migrationsDir: path.join(root, "migrations", "knowledge") });
      await runMigrations(pool, {
        schemaName: telemetrySchemaNameFor(schemaName),
        migrationsDir: path.join(root, "migrations", "telemetry"),
      });
      const bootstrap = await ensureBootstrap(pool, { schemaName });
      await importDocuments({
        pool,
        schemaName,
        handler: new CommandHandler(pool, schemaName),
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        repository: "agent-context",
        commitSha: "c".repeat(40),
        files: corpus.scopes.map((scope) => ({
          path: `projects/${scope.scope}/${scope.scope}.md`,
          content: corpusDocument(scope),
        })),
        scopes: corpus.scopes.map((scope) => ({
          scope: scope.scope,
          title: scope.title,
          kind: scope.kind,
          ...(scope.partOf === undefined ? {} : { partOf: scope.partOf }),
          locators: [],
        })),
      });
    }

    // Read, never bootstrap, when pointed at a workspace someone else owns.
    //
    // ensureBootstrap writes: it upserts a user keyed on the OS username, an owner principal, a
    // membership and a default scope. Against a real schema whose workspace slug is not
    // "default" it would quietly mint a second, empty workspace and then measure 100% zero-route
    // against it — a measurement tool reporting total failure because it created the thing it
    // measured. The only tell would be a density of 0 of 0.
    const identity = args.seed
      ? await ensureBootstrap(pool, { schemaName })
      : await readWorkspace(pool, schemaName);

    const report = await runCorpus({
      pool,
      schemaName,
      telemetrySchemaName: telemetrySchemaNameFor(schemaName),
      workspaceGuid: identity.workspaceGuid,
      principalGuid: identity.ownerPrincipalGuid,
      role: "owner",
      corpus,
      recordLexical: args.recordLexical,
      // Scored only against the fixture the expectations were written for.
      scored: args.seed,
    });

    console.log(args.json ? JSON.stringify(report, null, 2) : render(report, args.recordLexical));
  } finally {
    if (args.seed) {
      // Dropped even on failure. A corpus run that leaves schemas behind is the same problem the
      // test-schema leak guard exists for, arriving by a different road — and the telemetry
      // schema is dropped even if the knowledge drop throws, or a failure halfway leaves exactly
      // the orphan this is here to prevent.
      for (const schema of [schemaName, telemetrySchemaNameFor(schemaName)]) {
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } catch (error) {
          console.error(`Failed to drop ${schema}:`, error);
        }
      }
    }
    // Outside the drop entirely: a pool left open holds the process alive, and a cleanup failure
    // that also hangs the run is two problems where there was one.
    await pool.end();
  }
}

await main();
