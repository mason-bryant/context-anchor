import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { routingDiagnostics } from "../../src/db/comparison.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import {
  corpusDocument,
  runCorpus,
  WHOLE_WORKSPACE_FRACTION,
  type Corpus,
  type CorpusReport,
} from "../../src/db/routing/corpus.js";
import {
  dropAllSchemas,
  isTestDatabaseReachable,
  migrateAllSchemas,
  TEST_DATABASE_URL,
  testSchemaName,
} from "./testDatabase.js";

const corpusPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/routing-corpus/corpus.json",
);
const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as Corpus;

describe.runIf(await isTestDatabaseReachable())("routing task corpus (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("corpus_test");
    telemetrySchema = telemetrySchemaNameFor(schemaName);
    await migrateAllSchemas(pool, schemaName);
    bootstrap = await ensureBootstrap(pool, { schemaName });

    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "c".repeat(40),
      files: corpus.scopes.map((scope) => ({
        // One project per scope: the importer derives a document's scope from its path, so ten
        // documents under one project import as one scope and there is nothing to fan out across.
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
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const run = (recordLexical: boolean): Promise<CorpusReport> =>
    runCorpus({
      pool,
      schemaName,
      telemetrySchemaName: telemetrySchema,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      corpus,
      ...(recordLexical ? { recordLexical: true } : {}),
    });

  it("refuses a schema name that would reach SQL as an identifier", async () => {
    // Postgres cannot parameterize an identifier, so every schema name here is interpolated, and
    // this one arrives from a --schema flag as readily as from a test. The cleanup path makes it
    // worse than a bad read: a crafted name would drop the wrong schema.
    await expect(
      runCorpus({
        pool,
        schemaName: 'evil"; DROP SCHEMA public CASCADE; --',
        telemetrySchemaName: telemetrySchema,
        workspaceGuid: bootstrap.workspaceGuid,
        principalGuid: bootstrap.ownerPrincipalGuid,
        role: "owner",
        corpus,
      }),
    ).rejects.toThrow(/Invalid database schemaName/);

    // The telemetry name travels to the planner rather than through anything in corpus.ts, so
    // validating only the knowledge schema would leave it unchecked.
    await expect(
      runCorpus({
        pool,
        schemaName,
        telemetrySchemaName: 'evil"; DROP SCHEMA public CASCADE; --',
        workspaceGuid: bootstrap.workspaceGuid,
        principalGuid: bootstrap.ownerPrincipalGuid,
        role: "owner",
        corpus,
      }),
      // Matched on the guard's own message, not on "it threw". Bad SQL throws too, so a bare
      // toThrow() passes with the guard deleted — which is exactly what it did.
    ).rejects.toThrow(/Invalid database schemaName/);
  });

  it("holds a corpus large enough for the gate to accept, with judgements recorded", () => {
    // The gate criteria, checked on the file rather than assumed by whoever runs it. A corpus
    // that quietly shrank below the bar would still produce numbers, and they would be read the
    // same way.
    expect(corpus.tasks.length).toBeGreaterThanOrEqual(25);
    expect(new Set(corpus.tasks.map((task) => task.id)).size).toBe(corpus.tasks.length);

    // "Expected routes recorded per task" is the criterion route counts alone cannot satisfy.
    // Not every task needs a positive expectation — two exist to prove silence is correct, and
    // two to watch template vocabulary — but every task needs *some* recorded judgement.
    for (const task of corpus.tasks) {
      const judged =
        task.expectedScopes !== undefined ||
        task.forbiddenScopes !== undefined ||
        task.maxRoutes !== undefined;
      expect(judged, `task ${task.id} records no judgement of any kind`).toBe(true);
      expect(task.rationale.length, `task ${task.id} has no rationale`).toBeGreaterThan(0);
    }

    // Every scope a task names must exist in the fixture, or the expectation is unfalsifiable:
    // a route that cannot be offered is missing from every run, and reads as a retrieval failure.
    const known = new Set(corpus.scopes.map((scope) => scope.scope));
    for (const task of corpus.tasks) {
      for (const scope of [...(task.expectedScopes ?? []), ...(task.forbiddenScopes ?? [])]) {
        expect(known.has(scope), `task ${task.id} names unknown scope ${scope}`).toBe(true);
      }
    }
  });

  it("reproduces the template structure the frequency rule died on", async () => {
    // Not a property of the runner but of the fixture, and the fixture is the whole instrument.
    // A corpus of ten documents with distinct headings would measure a workspace nobody has and
    // would have reported the scope-frequency rule as fine.
    const headings = await pool.query<{ title: string; scopes: string }>(
      `SELECT ss.title, count(DISTINCT rs.scope_guid)::text AS scopes
         FROM "${schemaName}".source_sections ss
         JOIN "${schemaName}".record_scopes rs
           ON rs.workspace_guid = ss.workspace_guid AND rs.record_type = 'section'
          AND rs.stable_key = ss.stable_key AND rs.retired_at IS NULL
        WHERE ss.workspace_guid = $1
        GROUP BY ss.title
        ORDER BY count(DISTINCT rs.scope_guid) DESC`,
      [bootstrap.workspaceGuid],
    );

    const reach = new Map(headings.rows.map((row) => [row.title, Number(row.scopes)]));
    for (const template of ["Current State", "Decisions", "Constraints", "PRs"]) {
      expect(reach.get(template), `template heading ${template} should reach every scope`).toBe(
        corpus.scopes.length,
      );
    }
  });

  it("stamps the corpus version and the authoring density on every report", async () => {
    const report = await run(false);

    // A verdict that does not say what it was taken on will be read as general. This corpus has
    // no authored assertions at all, and the report has to say so rather than let a reader
    // assume the assertion pass was represented.
    expect(report.corpusVersion).toBe(corpus.version);
    expect(report.scored).toBe(true);
    expect(report.density.routableScopes).toBe(corpus.scopes.length);
    expect(report.density.assertions).toBe(0);
    expect(report.density.scopesWithAssertions).toBe(0);
  });

  it("measures the zero-route failure rather than reporting a pass", async () => {
    const report = await run(false);

    // This is the T-45 measurement, and it is asserted as a *range* deliberately. Pinning it to
    // an exact figure would make every selection change a test edit, and pinning it to "low"
    // would assert an improvement nobody has made: routed retrieval is known to return nothing
    // for most ordinary phrasings, and the corpus exists to keep that visible, not to hide it.
    expect(report.taskCount).toBe(corpus.tasks.length);
    expect(report.zeroRouteRate).toBeGreaterThan(0);
    expect(report.zeroRouteRate).toBeLessThan(1);

    // Tasks that name a scope outright must never be among the silent ones, and must reach the
    // scope they name. Route *counts* are not enough here, and this is not a hypothetical: the
    // first version of this runner compared expectations against the full route key
    // `scope:<kind>:<slug>` rather than the slug, scored every task at zero recall — and every
    // assertion in this file still passed, because they were all ranges and equalities.
    const byId = new Map(report.results.map((result) => [result.id, result]));
    for (const id of ["scope-named-transport", "scope-named-logging", "scope-named-people"]) {
      const result = byId.get(id);
      expect(result?.offeredScopes.length, `${id} routed nowhere`).toBeGreaterThan(0);
      expect(result?.recall, `${id} did not reach the scope it names`).toBe(1);
      expect(result?.missing, `${id} missed a scope it names`).toEqual([]);
    }

    // And the aggregate, for the same reason. A recall that collapses to zero across the board
    // means the scoring is broken, not that retrieval got worse.
    expect(report.meanRecall).toBeGreaterThan(0.25);

    // Tasks that record no positive expectation are excluded from the mean rather than scored.
    // Counting them as misses would drag the headline number down with tasks nobody judged, and
    // counting them as hits would inflate it with an opinion nobody held — either way the number
    // stops meaning "of the routes a person said were relevant, how many arrived".
    for (const id of ["template-decisions", "template-constraints"]) {
      expect(byId.get(id)?.recall, `${id} records no expectation and must not be scored`).toBeUndefined();
    }
  });

  it("keeps silence correct: a task about nothing here routes nowhere", async () => {
    const report = await run(true);
    const result = report.results.find((each) => each.id === "topical-no-match");

    // Run with the signal ON, because that is the setting where this can fail. A signal that
    // widens until an unrelated task matches has stopped selecting.
    expect(result?.offeredScopes).toEqual([]);
    expect(result?.overMaxRoutes).toBe(false);
  });

  it("detects a stopword filter regression, which the headline numbers cannot", async () => {
    const on = await run(true);
    const byId = new Map(on.results.map((result) => [result.id, result]));

    // The founding purpose of this corpus, and it does not follow from the headline. Delete the
    // stopword filter and both silence and recall get BETTER — the corpus reports the regression
    // as an improvement. Only precision moves the other way, which is why these assertions are on
    // ceilings and forbidden sets rather than on the headline numbers.
    //
    // stopword-only-terms is built entirely from words in the filter's own list, each of which
    // appears in some heading: 0 candidates with the filter, 7 without. Its predecessor read 7
    // either way while claiming to detect exactly this, because "why", "when" and "do" are
    // deliberately not stopwords — they head real content.
    // The ceilings themselves, pinned in the fixture. Without this, deleting the filter is fixed
    // by editing one integer upward — a green change indistinguishable from restoring the
    // filter, and the cheaper of the two to make. A probe whose bar moves is not a probe.
    const ceilings = Object.fromEntries(
      corpus.tasks.filter((task) => task.id.startsWith("stopword-")).map((task) => [task.id, task.maxRoutes]),
    );
    expect(ceilings).toEqual({ "stopword-only-terms": 0, "stopword-how-and-when": 4 });

    for (const id of ["stopword-only-terms", "stopword-how-and-when"]) {
      expect(byId.get(id)?.overMaxRoutes, `${id} spread past its ceiling`).toBe(false);
    }

    // Asserted as an exact set. A count alone lets one task stop failing while another starts,
    // and the two template tasks are expected to exceed their ceilings — that is the known
    // fan-out this corpus records rather than hides.
    const overCeiling = on.results.filter((result) => result.overMaxRoutes).map((result) => result.id);
    expect(overCeiling.sort()).toEqual(["template-constraints", "template-decisions"]);

    const forbidden = on.results.filter((result) => result.forbiddenHits.length > 0).map((r) => r.id);
    expect(forbidden.sort()).toEqual([
      "topical-bearer-token",
      "topical-existing-database",
      "topical-session-expiry",
    ]);
  });

  it("counts answers that cover the workspace, which the zero-route rate hides", async () => {
    const off = await run(false);
    const on = await run(true);

    // A task rescued from silence by selecting every scope improves zeroRouteRate exactly as
    // much as one rescued by finding the right scope. Three of this corpus's first ten rescues
    // were of that kind, and nothing in the headline said so.
    expect(on.wholeWorkspaceCount).toBeGreaterThan(off.wholeWorkspaceCount);
    expect(on.wholeWorkspaceCount).toBeGreaterThan(0);

    // Measured before the listed budget clips, or every blowout reports as the same size: with
    // a listed budget of ten, selecting eleven scopes and selecting the whole workspace both
    // come back as ten routes.
    const widest = on.results.reduce((most, result) => Math.max(most, result.candidateCount), 0);
    expect(widest).toBeGreaterThanOrEqual(corpus.scopes.length);

    // Proved under a budget that actually clips. With ten scopes and a listed budget of ten the
    // two counts are equal for every task, so scoring ceilings against the clipped list looks
    // identical to scoring them against the candidates — and on a real workspace, where fan-out
    // runs past the budget, it would silently stop measuring.
    const clipped = await runCorpus({
      pool,
      schemaName,
      telemetrySchemaName: telemetrySchema,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      corpus,
      recordLexical: true,
      budget: { listed: 3 },
    });

    const template = clipped.results.find((result) => result.id === "template-decisions");
    expect(template?.offeredScopes.length).toBe(3);
    expect(template?.candidateCount).toBeGreaterThan(3);
    // Its ceiling is 4. Judged on the clipped three it would pass; judged on the candidates it
    // does not, and the fan-out is the thing being measured.
    expect(template?.overMaxRoutes).toBe(true);
    expect(clipped.wholeWorkspaceCount).toBe(on.wholeWorkspaceCount);
  });

  it("shows the record-lexical trade rather than judging it", async () => {
    const off = await run(false);
    const on = await run(true);

    // The signal's whole claim is that it rescues tasks naming no scope. If a run ever shows it
    // rescuing nothing, the signal has regressed to inert — which is exactly what happened once
    // and passed every test, because nothing compared the two settings.
    expect(on.zeroRouteRate).toBeLessThan(off.zeroRouteRate);

    // Rescuing a task from silence is worth nothing if the route it adds is the wrong one, which
    // is exactly what the run against the real workspace found. Recall is what tells those apart,
    // and it is the number the aggregate route count cannot give.
    expect(on.meanRecall ?? 0).toBeGreaterThan(off.meanRecall ?? 0);

    // And the cost side, which is why it is off by default. Recorded, not asserted as good:
    // this is the trade the gate has to judge, and a test that demanded it be small would be
    // this file deciding the question it says a person must decide.
    expect(on.forbiddenHitCount).toBeGreaterThanOrEqual(off.forbiddenHitCount);

    // The aggregate is guarded too. Folding unjudged tasks into the mean silently moved it from
    // 87% to 77% and every per-task assertion still passed, because they are all per-task.
    const judged = on.results.filter((result) => result.recall !== undefined);
    const byHand = judged.reduce((total, result) => total + (result.recall ?? 0), 0) / judged.length;
    expect(on.meanRecall).toBeCloseTo(byHand, 10);
    expect(judged.length).toBeLessThan(on.taskCount);
  });

  it("pins every judged task, not a chosen five", async () => {
    const on = await run(true);
    const byId = new Map(on.results.map((result) => [result.id, result]));

    // The whole vector. Pinning a handful left everything else free: renaming "Ninety Day
    // Thinning" moved recall 91% to 89% with a green suite, and renaming one heading added in
    // the last round moved it to 87% and took a task silent. Brittle on purpose -- this is a
    // regression instrument, and a change that moves any of these should force a read rather
    // than be absorbed into an average.
    //
    // The two zeroes are pinned in the other direction. Matching is whole-word with no stemming,
    // so "resolve" misses "Identity Resolution" and "reviews" misses "Review Before Apply". If
    // either starts passing, something real changed.
    const expected: Record<string, number> = {
      "scope-named-transport": 1,
      "scope-named-logging": 1,
      "topical-retention": 1,
      "topical-bearer-token": 1,
      "topical-session-expiry": 1,
      "topical-secrets-in-logs": 1,
      "topical-citation": 1,
      "topical-quote-resolve": 1,
      "topical-thinning": 1,
      "topical-ranker": 1,
      "topical-reorder-drop": 1,
      "topical-identity": 0,
      "scope-named-people": 1,
      "topical-review-flow": 0,
      "scope-named-proposals": 1,
      "topical-forward-only": 1,
      "topical-existing-database": 1,
      "topical-telemetry-schema": 1,
      "topical-write-failure": 1,
      "cross-scope-transport-logging": 1,
      "topical-stdio": 1,
      // topical-tool-parity and topical-stdio are what hold the relation-hop signal: both reach
      // anchor-mcp only by hopping from http-transport, and disabling the hop drops recall to
      // 85% and fails this. topical-conflict-detection is not one of them — it reaches
      // claim-provenance directly through a heading, and that scope has no parent to hop to.
      "topical-tool-parity": 1,
      "topical-conflict-detection": 1,
    };

    const actual = Object.fromEntries(Object.keys(expected).map((id) => [id, byId.get(id)?.recall]));
    expect(actual).toEqual(expected);

    // Every judged task appears above, so one added without an expectation cannot slip past.
    const judged = on.results.filter((result) => result.recall !== undefined).map((r) => r.id);
    expect(judged.sort()).toEqual(Object.keys(expected).sort());
  });

  it("pins the whole-workspace metric by its effect, not only its constant", async () => {
    const off = await run(false);
    const on = await run(true);

    // Pinning the constant alone was not enough, and that is the third time this shape has come
    // up here. Changing `>=` to `>` drops the count 4 to 3, and dropping the fraction out of the
    // comparison altogether drops it to 2 — both with the constant untouched at 0.5 and both
    // green, because every other assertion on this metric is relative and `off` is zero.
    //
    // So the counts are pinned outright. This is the counter-metric to the zero-route headline:
    // without it a change that widens fan-out reads as a pure improvement.
    expect(off.wholeWorkspaceCount).toBe(0);
    expect(on.wholeWorkspaceCount).toBe(4);
    expect(WHOLE_WORKSPACE_FRACTION).toBe(0.5);
  });
  it("gives the lexical signal topical headings to reach, not only the shared template", async () => {
    // The fixture needs both halves and it is easy to build only one. record-lexical matches
    // headings and assertion titles and never body text, so a fixture whose only headings were
    // the shared four would make every scope look identical to it — the signal would score as
    // useless against a corpus that misrepresents the one it models. The first version of this
    // fixture had exactly that shape and measured the signal as adding nothing.
    const distinct = await pool.query<{ scopes: string }>(
      `SELECT count(DISTINCT rs.scope_guid)::text AS scopes
         FROM "${schemaName}".source_sections ss
         JOIN "${schemaName}".record_scopes rs
           ON rs.workspace_guid = ss.workspace_guid AND rs.record_type = 'section'
          AND rs.stable_key = ss.stable_key AND rs.retired_at IS NULL
        WHERE ss.workspace_guid = $1 AND ss.heading_level = 3`,
      [bootstrap.workspaceGuid],
    );
    expect(Number(distinct.rows[0]!.scopes)).toBe(corpus.scopes.length);

    // Every topical heading belongs to exactly one scope. That is the property the template
    // headings deliberately lack, and having both in one corpus is the whole design.
    const shared = await pool.query<{ title: string }>(
      `SELECT ss.title
         FROM "${schemaName}".source_sections ss
         JOIN "${schemaName}".record_scopes rs
           ON rs.workspace_guid = ss.workspace_guid AND rs.record_type = 'section'
          AND rs.stable_key = ss.stable_key AND rs.retired_at IS NULL
        WHERE ss.workspace_guid = $1 AND ss.heading_level = 3
        GROUP BY ss.title
       HAVING count(DISTINCT rs.scope_guid) > 1`,
      [bootstrap.workspaceGuid],
    );
    expect(shared.rows.map((row) => row.title)).toEqual([]);
  });

  it("keeps its own traffic out of the retrieval diagnostics", async () => {
    // The tag alone excludes nothing: the exclusion lives in comparison.ts's exact list, and for
    // one round the tag was set and the list did not mention it, so 28 requests an run were
    // counted as real retrieval — one of them offering every scope in the workspace by design.
    //
    // Deleting either half passed all 3493 tests, because the diagnostics tests only exercise the
    // two comparison-gate tags and this file never read telemetry. This is the assertion that
    // makes the pair load-bearing.
    await run(true);

    const diagnostics = await routingDiagnostics(pool, telemetrySchema, bootstrap.workspaceGuid);
    expect(diagnostics.totals.requests).toBe(0);
    expect(diagnostics.totals.routesOffered).toBe(0);
    expect(diagnostics.neverExpanded).toEqual([]);

    // And the impressions really were written, so the zeros above are an exclusion rather than
    // an empty table.
    const impressions = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${telemetrySchema}".retrieval_route_impressions`,
    );
    expect(Number(impressions.rows[0]!.n)).toBeGreaterThan(0);
  });

  it("produces the same answer twice, so a difference between runs means a change", async () => {
    // Telemetry is compared across runs, so a corpus that drifted on its own would make every
    // comparison unreadable. Route order included: ranking is part of what is being measured.
    const first = await run(true);
    const second = await run(true);

    expect(second.results.map((result) => result.offeredScopes)).toEqual(
      first.results.map((result) => result.offeredScopes),
    );
    expect(second.zeroRouteRate).toBe(first.zeroRouteRate);
    expect(second.meanRecall).toBe(first.meanRecall);
  });

  it("counts what the caller received, not what the route said it held", async () => {
    // "Records relevant to the task inside the expanded budget" is a gate criterion, and the
    // distinction only shows under a budget tight enough to clip. A route can hold five records
    // and return one; counting its recordCount would report the caller as served five.
    const clipped = await runCorpus({
      pool,
      schemaName,
      telemetrySchemaName: telemetrySchema,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      corpus,
      recordLexical: true,
      budget: { recordsPerRoute: 1 },
    });
    const generous = await run(true);

    const total = (report: CorpusReport): number =>
      report.results.reduce((sum, result) => sum + result.recordsReturned, 0);

    expect(total(clipped)).toBeLessThan(total(generous));
    expect(total(clipped)).toBeGreaterThan(0);
  });

  it("suppresses recall on an unscored run instead of reporting zero", async () => {
    const report = await runCorpus({
      pool,
      schemaName,
      telemetrySchemaName: telemetrySchema,
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      corpus,
      scored: false,
    });

    // A recall of zero from a workspace the corpus never described reads exactly like a
    // retrieval failure and is not one. Zero-route rate stays, because it is a property of the
    // selection code rather than of the expectations.
    expect(report.scored).toBe(false);
    expect(report.meanRecall).toBeUndefined();
    expect(report.results.every((result) => result.recall === undefined)).toBe(true);
    expect(report.results.every((result) => result.missing.length === 0)).toBe(true);
    expect(report.zeroRouteRate).toBeGreaterThan(0);
  });

  it("counts records returned, not records a route claims to hold", async () => {
    const report = await run(true);
    const served = report.results.filter((result) => result.recordsReturned > 0);

    // "Most offered routes carry no records, so a route being offered is not the caller
    // receiving anything" is one of the gate criteria. It needs a number, and this is it.
    expect(served.length).toBeGreaterThan(0);
    expect(report.offeredButEmptyCount).toBeLessThan(report.taskCount);
  });
});
