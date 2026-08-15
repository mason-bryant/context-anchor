import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { planRoutedBundle } from "../../src/db/routing/plan.js";
import {
  DEFAULT_TELEMETRY_RETENTION,
  telemetryRetentionStatus,
  thinTelemetry,
} from "../../src/db/telemetryRetention.js";
import {
  dropAllSchemas,
  isTestDatabaseReachable,
  migrateAllSchemas,
  TEST_DATABASE_URL,
  testSchemaName,
} from "./testDatabase.js";

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token.
`;

const POLICY = { taskTextDays: 90, requestDays: 365 };

/** Days before the pass's clock, so rows can be aged without waiting for the calendar. */
const NOW = new Date("2026-08-15T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe.runIf(await isTestDatabaseReachable())("telemetry retention (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("retention_test");
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
      commitSha: "r".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      scopes: [{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }],
    });
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  /** A real routed request, then backdated. Real, so impressions exist to cascade. */
  const askAt = async (task: string, at: Date) => {
    const planned = await planRoutedBundle(pool, schemaName, telemetrySchema, {
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      task,
    });
    await pool.query(
      `UPDATE "${telemetrySchema}".retrieval_requests SET created_at = $2 WHERE request_guid = $1`,
      [planned.requestId, at.toISOString()],
    );
    return planned;
  };

  const thin = (policy = POLICY) => thinTelemetry(pool, telemetrySchema, policy, { now: () => NOW });

  const countOf = async (sql: string, params: unknown[] = []) =>
    Number((await pool.query<{ n: string }>(sql, params)).rows[0]!.n);

  it("makes an old question unreadable while leaving what it can be counted by", async () => {
    const old = await askAt("anchor mcp", daysAgo(120));
    const impressionsBefore = await countOf(
      `SELECT count(*)::text AS n FROM "${telemetrySchema}".retrieval_route_impressions WHERE request_guid = $1`,
      [old.requestId],
    );
    expect(impressionsBefore).toBeGreaterThan(0);

    const report = await thin();
    expect(report.taskTextRedacted).toBe(1);
    expect(report.requestsDeleted).toBe(0);

    // The row survives with everything diagnostics aggregate on. This is the whole reason there
    // are two windows: the expensive half of the data is the text, and the cheap half stays
    // useful for far longer than the text should stay legible.
    const row = await pool.query<{ task_text: string | null; task_hash: string }>(
      `SELECT task_text, task_hash FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
      [old.requestId],
    );
    expect(row.rows[0]?.task_text).toBeNull();
    expect(row.rows[0]?.task_hash).toHaveLength(64);
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM "${telemetrySchema}".retrieval_route_impressions WHERE request_guid = $1`,
        [old.requestId],
      ),
    ).toBe(impressionsBefore);
  });

  it("leaves a question inside the window alone", async () => {
    const recent = await askAt("anchor mcp", daysAgo(10));

    const report = await thin();
    expect(report.taskTextRedacted).toBe(0);
    expect(report.requestsDeleted).toBe(0);

    const row = await pool.query<{ task_text: string | null }>(
      `SELECT task_text FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
      [recent.requestId],
    );
    expect(row.rows[0]?.task_text).toBe("anchor mcp");
  });

  it("deletes a request past the outer window, and its impressions with it", async () => {
    // The point of the outer window: redaction alone bounds what is readable and not what the
    // table costs, so without this the schema grows forever holding rows nobody can read.
    const ancient = await askAt("anchor mcp", daysAgo(400));

    const report = await thin();
    expect(report.requestsDeleted).toBe(1);

    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
        [ancient.requestId],
      ),
    ).toBe(0);
    // By cascade, declared on the foreign key. Asserted because a retention pass that deleted
    // requests and left their impressions would grow the schema while reporting that it shrank it.
    expect(
      await countOf(
        `SELECT count(*)::text AS n FROM "${telemetrySchema}".retrieval_route_impressions WHERE request_guid = $1`,
        [ancient.requestId],
      ),
    ).toBe(0);
  });

  it("does not count a row it deletes as a row it redacted", async () => {
    // A request past both windows is past the text window too. Redacting first would spend a
    // write on a row about to disappear and report work that helped nobody -- so deletion runs
    // first, and this is what says so.
    await askAt("anchor mcp", daysAgo(400));

    const report = await thin();
    expect(report.requestsDeleted).toBe(1);
    expect(report.taskTextRedacted).toBe(0);
  });

  it("reports nothing on a second pass, having already done the work", async () => {
    await askAt("anchor mcp", daysAgo(120));
    await askAt("http transport", daysAgo(400));

    const first = await thin();
    expect(first.taskTextRedacted).toBe(1);
    expect(first.requestsDeleted).toBe(1);

    // Not merely "does not crash". A pass that reported the same numbers every run would read as
    // though it were still finding work, and an operator watching the counts could never tell a
    // backlog from a job spinning on rows it already handled.
    const second = await thin();
    expect(second.taskTextRedacted).toBe(0);
    expect(second.requestsDeleted).toBe(0);
  });

  it("records every pass, so a job that stopped is visible as a gap", async () => {
    await thinTelemetry(pool, telemetrySchema, POLICY, { now: () => daysAgo(2) });
    await thinTelemetry(pool, telemetrySchema, POLICY, { now: () => daysAgo(1) });
    await thin();

    const runs = await pool.query<{ ran_at: Date; task_text_days: number }>(
      `SELECT ran_at, task_text_days FROM "${telemetrySchema}".telemetry_retention_runs ORDER BY ran_at`,
    );
    // Three rows, not one upserted in place: a job that ran daily and stopped three weeks ago is
    // the failure worth catching, and only the gaps between runs can show it.
    expect(runs.rows).toHaveLength(3);
    expect(runs.rows.map((row) => row.task_text_days)).toEqual([90, 90, 90]);
  });

  it("records the windows it applied, not the ones configured later", async () => {
    // Counts are only interpretable against the policy that produced them, and the policy is
    // editable. A run row carrying today's config would misdate every historical count.
    await thinTelemetry(pool, telemetrySchema, { taskTextDays: 7, requestDays: 30 }, { now: () => NOW });

    const run = await pool.query<{ task_text_days: number; request_days: number }>(
      `SELECT task_text_days, request_days FROM "${telemetrySchema}".telemetry_retention_runs`,
    );
    expect(run.rows[0]?.task_text_days).toBe(7);
    expect(run.rows[0]?.request_days).toBe(30);
  });

  it("thins its own run log, rather than being its own counterexample", async () => {
    await thinTelemetry(pool, telemetrySchema, POLICY, { now: () => daysAgo(400) });
    expect(
      await countOf(`SELECT count(*)::text AS n FROM "${telemetrySchema}".telemetry_retention_runs`),
    ).toBe(1);

    await thin();

    // The ancient run is gone and only the pass that removed it remains. A retention table that
    // grew without bound while recording the thinning would be exactly the defect T-41 exists
    // to fix, reintroduced one table over.
    const remaining = await pool.query<{ ran_at: Date }>(
      `SELECT ran_at FROM "${telemetrySchema}".telemetry_retention_runs`,
    );
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0]?.ran_at.toISOString()).toBe(NOW.toISOString());
  });

  it("reports never having run, which is the state this exists to make visible", async () => {
    await askAt("anchor mcp", daysAgo(120));

    const status = await telemetryRetentionStatus(pool, telemetrySchema, POLICY, { now: () => NOW });
    expect(status.lastRanAt).toBeNull();
    // A backlog with no run beside it is the case that went unnoticed for a week: rows present,
    // nothing saying whether anything was ever going to remove them.
    expect(status.taskTextPastWindow).toBe(1);
    expect(status.requestsPastWindow).toBe(0);
  });

  it("reports the last run and an emptied backlog once it has run", async () => {
    await askAt("anchor mcp", daysAgo(120));
    await thin();

    const status = await telemetryRetentionStatus(pool, telemetrySchema, POLICY, { now: () => NOW });
    expect(status.lastRanAt).toBe(NOW.toISOString());
    expect(status.lastTaskTextRedacted).toBe(1);
    expect(status.taskTextPastWindow).toBe(0);
  });

  it("touches only the workspace it was narrowed to", async () => {
    const other = "00000000-0000-4000-8000-0000000000ff";
    const mine = await askAt("anchor mcp", daysAgo(120));
    await pool.query(
      `INSERT INTO "${telemetrySchema}".retrieval_requests
         (request_guid, workspace_guid, task_text, task_hash, planner_version,
          ranker_id, ranker_version, ranker_deterministic, created_at)
       VALUES (gen_random_uuid(), $1, 'someone else', repeat('0', 64), 'v1', 'precedence', '1.0.0', true, $2)`,
      [other, daysAgo(120).toISOString()],
    );

    await thinTelemetry(pool, telemetrySchema, POLICY, {
      now: () => NOW,
      workspaceGuid: bootstrap.workspaceGuid,
    });

    const mineRow = await pool.query<{ task_text: string | null }>(
      `SELECT task_text FROM "${telemetrySchema}".retrieval_requests WHERE request_guid = $1`,
      [mine.requestId],
    );
    expect(mineRow.rows[0]?.task_text).toBeNull();
    // Untouched. Narrowing that leaked across workspaces would make a per-tenant retention
    // setting silently global the moment there is more than one tenant.
    const theirs = await pool.query<{ task_text: string | null }>(
      `SELECT task_text FROM "${telemetrySchema}".retrieval_requests WHERE workspace_guid = $1`,
      [other],
    );
    expect(theirs.rows[0]?.task_text).toBe("someone else");
  });

  it("refuses a policy it cannot honour, rather than applying half of it", async () => {
    // The pass validates for itself and does not rely on config having done so. `db thin`, a
    // test, and any future caller reach this function directly, and a requestDays below
    // taskTextDays would delete rows before their text window ever elapsed -- quietly doing
    // something other than what the numbers say.
    await expect(
      thinTelemetry(pool, telemetrySchema, { taskTextDays: 90, requestDays: 30 }),
    ).rejects.toThrow(/requestDays \(30\) is below taskTextDays \(90\)/);
    await expect(
      thinTelemetry(pool, telemetrySchema, { taskTextDays: 0, requestDays: 30 }),
    ).rejects.toThrow(/taskTextDays "0"/);
  });

  it("refuses an unusable policy when reporting status, not only when applying it", async () => {
    // Status reports what is "past its window". An unusable policy does not make that question
    // unanswerable -- it makes it answerable and wrong, which is worse: a backlog of zero reads
    // as retention keeping up. Raised in review on f2a9185; the pass validated and this did not.
    await expect(
      telemetryRetentionStatus(pool, telemetrySchema, { taskTextDays: 90, requestDays: 30 }),
    ).rejects.toThrow(/is below taskTextDays/);
  });

  it("refuses a schema name that would reach SQL as an identifier", async () => {
    await expect(
      thinTelemetry(pool, 'evil"; DROP SCHEMA public CASCADE; --', DEFAULT_TELEMETRY_RETENTION),
    ).rejects.toThrow(/Invalid database schemaName/);
  });
});
