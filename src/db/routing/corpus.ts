import type { Pool } from "pg";

import type { WorkspaceRole } from "../access.js";
import type { ScopeKind } from "../scopeDerivation.js";
import { planRoutedBundle, type PlanResult } from "./plan.js";

/**
 * The routing task corpus, as an instrument (T-50).
 *
 * It exists because a corpus run found in one afternoon what four review rounds had missed:
 * that 42% of the routes a signal added came from a single stopword, and that a measurement
 * repeated in four places was false. That run was a throwaway script, so nothing it established
 * could be re-checked after the next change.
 *
 * Two things follow from that and shape this file.
 *
 * The corpus carries its own fixture. Tasks, the documents they run against, and the expected
 * routes are versioned together, so an expectation cannot drift from the corpus it was written
 * for. The cost is that expectations do not transfer: run these tasks against a real workspace
 * and recall is meaningless, because the scopes named here do not exist there. That mode is
 * still worth having — zero-route rate and fan-out are properties of the selection code, not of
 * the expectations — so it is offered, and `scored` says which one you got.
 *
 * Every fixture scope carries the same four headings. That is deliberate. Template vocabulary
 * reaching every scope while topical vocabulary concentrates is the structure that defeated the
 * scope-frequency rule, and a corpus that quietly omitted it would report success on the one
 * shape the design is stuck on.
 */

export type CorpusScope = {
  scope: string;
  title: string;
  /** Typed here rather than cast at each caller, so a corpus naming a kind that does not exist fails to compile. */
  kind: ScopeKind;
  partOf?: string;
  currentState: string[];
  decisions: string[];
  constraints: string[];
  /**
   * Topical subheadings, which the template deliberately does not provide.
   *
   * record-lexical matches headings and assertion titles and never body text, so a fixture whose
   * only headings are the shared four gives it nothing topical to reach — every scope looks
   * identical to it, and the signal measures as useless when the real corpus it models has
   * topical headings throughout.
   */
  topics: Array<{ heading: string; bullets: string[] }>;
};

export type CorpusTask = {
  id: string;
  task: string;
  /** Routes a person judged relevant. Absent means "no judgement recorded", not "none relevant". */
  expectedScopes?: string[];
  /** Routes a person judged irrelevant. Fan-out onto these is the failure worth naming. */
  forbiddenScopes?: string[];
  /** Upper bound on offered routes. Present where the point of the task is that it must not widen. */
  maxRoutes?: number;
  rationale: string;
};

export type Corpus = {
  version: string;
  notes: string[];
  scopes: CorpusScope[];
  tasks: CorpusTask[];
};

export type CorpusTaskResult = {
  id: string;
  task: string;
  /** Scope slugs, which is what the corpus records expectations in and what a person reads. */
  offeredScopes: string[];
  /** The keys as the planner emitted them, kept so a report can be traced back to a plan. */
  offeredRouteKeys: string[];
  /** Expected routes that were offered, over expected routes. Undefined when nothing was expected. */
  recall?: number;
  missing: string[];
  forbiddenHits: string[];
  overMaxRoutes: boolean;
  /** Records actually returned inside the expanded budget. A route offered is not a caller served. */
  recordsReturned: number;
};

export type CorpusReport = {
  corpusVersion: string;
  /**
   * False when the run was against a workspace the corpus does not describe. Recall and missing
   * are then omitted per task, because the expectations name scopes that workspace never had.
   */
  scored: boolean;
  /** Authoring density, stamped because nine assertions in one of 23 scopes is not a workspace. */
  density: { routableScopes: number; scopesWithAssertions: number; assertions: number };
  taskCount: number;
  /** The failure this corpus was built to watch: tasks that route nowhere at all. */
  zeroRouteRate: number;
  /** Mean recall over tasks that recorded an expectation. Undefined on an unscored run. */
  meanRecall?: number;
  /** Tasks that reached a scope judged irrelevant. */
  forbiddenHitCount: number;
  /** Tasks that exceeded their own route ceiling. */
  overMaxRoutesCount: number;
  /** Tasks offered at least one route but returned no records inside the budget. */
  offeredButEmptyCount: number;
  results: CorpusTaskResult[];
};

/**
 * The shared heading template every fixture scope gets.
 *
 * Assembled here rather than stored as markdown in the corpus file so the repetition is visible
 * as a decision. Ten documents differing only in their bullets is the point; ten hand-written
 * documents that happened to share headings would be an accident nobody could see.
 */
export function corpusDocument(scope: CorpusScope): string {
  const section = (heading: string, bullets: string[]): string =>
    `## ${heading}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n`;

  return [
    "---",
    "project: anchor-mcp",
    "type: context-anchor",
    "---",
    "",
    `# ${scope.title}`,
    "",
    section("Current State", scope.currentState),
    // Nested under Current State, as real anchors nest them: the parent heading is the template
    // vocabulary and the child is what actually distinguishes this scope from its nine siblings.
    ...scope.topics.map((topic) => `### ${topic.heading}\n\n${topic.bullets.map((b) => `- ${b}`).join("\n")}\n`),
    section("Decisions", scope.decisions),
    section("Constraints", scope.constraints),
    // Present and empty of topical content on purpose: a heading with nothing under it still
    // supplies its own title to the lexical signal, which is exactly how template vocabulary
    // reaches a scope that has nothing to say about it.
    section("PRs", ["None yet."]),
  ].join("\n");
}

export type CorpusRunInput = {
  pool: Pool;
  schemaName: string;
  telemetrySchemaName: string;
  workspaceGuid: string;
  principalGuid: string;
  role: WorkspaceRole;
  corpus: Corpus;
  recordLexical?: boolean;
  /**
   * False when running against a workspace this corpus did not seed. Recall and missing are
   * suppressed rather than computed against scopes that were never there — a recall of zero
   * from a mismatched fixture reads exactly like a retrieval failure, and it is not one.
   */
  scored?: boolean;
  budget?: { listed?: number; expanded?: number; recordsPerRoute?: number };
};

export async function runCorpus(input: CorpusRunInput): Promise<CorpusReport> {
  const scored = input.scored ?? true;
  const results: CorpusTaskResult[] = [];

  for (const task of input.corpus.tasks) {
    const plan = await planRoutedBundle(input.pool, input.schemaName, input.telemetrySchemaName, {
      workspaceGuid: input.workspaceGuid,
      principalGuid: input.principalGuid,
      role: input.role,
      task: task.task,
      recordLexical: input.recordLexical,
      budget: input.budget,
      // Named so these impressions can be excluded from retrieval diagnostics. A thousand
      // impressions from a corpus run would otherwise answer "which routes are dead weight"
      // with routes only ever offered by the instrument asking the question.
      consumer: "routing-corpus",
    });

    results.push(scoreTask(task, plan, scored));
  }

  return {
    corpusVersion: input.corpus.version,
    scored,
    density: await measureDensity(input.pool, input.schemaName, input.workspaceGuid),
    ...summarise(results, scored),
    results,
  };
}

function scoreTask(task: CorpusTask, plan: PlanResult, scored: boolean): CorpusTaskResult {
  const offeredRouteKeys = plan.routes.map((route) => route.routeKey);
  const offeredScopes = offeredRouteKeys.map(scopeSlugOf);
  const offered = new Set(offeredScopes);

  // Counted from what came back rather than from recordCount, which describes the route rather
  // than the answer: a route can hold fifty records and return none inside the budget, and a
  // caller who received nothing was not served by it.
  const recordsReturned = plan.routes.reduce((total, route) => total + (route.records?.length ?? 0), 0);

  const expected = scored ? (task.expectedScopes ?? []) : [];
  const missing = expected.filter((scope) => !offered.has(scope));
  const forbiddenHits = scored
    ? (task.forbiddenScopes ?? []).filter((scope) => offered.has(scope))
    : [];

  return {
    id: task.id,
    task: task.task,
    offeredScopes,
    offeredRouteKeys,
    // Undefined rather than 1 when nothing was expected. A task with no recorded judgement
    // scoring a perfect recall would inflate the mean with an opinion nobody held.
    recall: scored && expected.length > 0 ? (expected.length - missing.length) / expected.length : undefined,
    missing,
    forbiddenHits,
    overMaxRoutes: task.maxRoutes !== undefined && offeredScopes.length > task.maxRoutes,
    recordsReturned,
  };
}

/**
 * The slug out of a `scope:<kind>:<slug>` route key.
 *
 * Expectations are recorded as slugs because that is the stable, readable name of a scope: its
 * kind is a property of how it was derived and can change without the scope becoming a
 * different one. Comparing whole route keys would make every expectation depend on a detail the
 * corpus has no opinion about — and getting this wrong is not hypothetical, it scored every task
 * at zero recall on the first run while the suite stayed green.
 *
 * Split from the last colon rather than the second: slugs are kebab-case and cannot contain a
 * colon, so the tail is unambiguous even if the prefix ever gains a segment.
 */
function scopeSlugOf(routeKey: string): string {
  const lastColon = routeKey.lastIndexOf(":");
  return lastColon === -1 ? routeKey : routeKey.slice(lastColon + 1);
}

function summarise(
  results: CorpusTaskResult[],
  scored: boolean,
): Omit<CorpusReport, "corpusVersion" | "scored" | "density" | "results"> {
  const judged = results.filter((result) => result.recall !== undefined);
  const zeroRoute = results.filter((result) => result.offeredScopes.length === 0);

  return {
    taskCount: results.length,
    zeroRouteRate: results.length === 0 ? 0 : zeroRoute.length / results.length,
    meanRecall:
      scored && judged.length > 0
        ? judged.reduce((total, result) => total + (result.recall ?? 0), 0) / judged.length
        : undefined,
    forbiddenHitCount: results.filter((result) => result.forbiddenHits.length > 0).length,
    overMaxRoutesCount: results.filter((result) => result.overMaxRoutes).length,
    offeredButEmptyCount: results.filter(
      (result) => result.offeredScopes.length > 0 && result.recordsReturned === 0,
    ).length,
  };
}

/**
 * Authoring density, so a verdict cannot be read as general when it was taken on a workspace
 * with assertions in one scope. Counted over scopes that hold records, not over every live
 * scope: a scope declared by a code-area mapping and holding nothing is not a scope the
 * assertion pass has skipped, it is a scope with nothing to assert about.
 */
async function measureDensity(
  pool: Pool,
  schemaName: string,
  workspaceGuid: string,
): Promise<CorpusReport["density"]> {
  const counts = await pool.query<{
    routable_scopes: string;
    scopes_with_assertions: string;
    assertions: string;
  }>(
    `SELECT
       (SELECT count(DISTINCT scope_guid) FROM "${schemaName}".record_scopes
         WHERE workspace_guid = $1 AND retired_at IS NULL) AS routable_scopes,
       (SELECT count(DISTINCT rs.scope_guid) FROM "${schemaName}".record_scopes rs
         WHERE rs.workspace_guid = $1 AND rs.retired_at IS NULL
           AND rs.record_type = 'assertion') AS scopes_with_assertions,
       (SELECT count(*) FROM "${schemaName}".assertions
         WHERE workspace_guid = $1 AND retired_at IS NULL) AS assertions`,
    [workspaceGuid],
  );

  const row = counts.rows[0];
  return {
    routableScopes: Number(row?.routable_scopes ?? 0),
    scopesWithAssertions: Number(row?.scopes_with_assertions ?? 0),
    assertions: Number(row?.assertions ?? 0),
  };
}
