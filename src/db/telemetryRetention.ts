import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { assertValidSchemaName } from "./config.js";

/**
 * Thinning the telemetry schema (T-41).
 *
 * The design has specified a ninety-day telemetry window since 2026-08-08 and nothing performed
 * it. That went unnoticed for as long as it did because telemetry was cheap and anonymous — a
 * task hash and some counts. It stopped being either on 2026-08-15, when task text began being
 * retained by default: the table now holds what people actually asked, it grows on every routed
 * request, and the only bound on it was that nobody had used the system very much yet.
 *
 * Two windows, not one, because "thin" and "delete" answer different questions:
 *
 *   - `taskTextDays` bounds how long the *questions* are readable. Past it the text is nulled and
 *     the row stays. Everything diagnostics aggregate on — the hash, the ranker, the routes
 *     offered, whether they were expanded, what was used — survives untouched, so the shape of
 *     traffic remains measurable for far longer than its content is legible.
 *   - `requestDays` bounds the rows themselves, and is what actually stops the table growing.
 *
 * A single window would have to pick one of those to be wrong about. Ninety days of readable
 * questions with the counts deleted alongside them throws away the cheap half of the data; a
 * year of readable questions keeps the expensive half far too long.
 *
 * Nothing here touches the knowledge schema, which is the reason telemetry was put in its own
 * schema in the first place: a retention job should never hold write access to the records.
 */

export type TelemetryRetentionPolicy = {
  /** Days a request's task text stays readable. Past this the text is nulled, the row remains. */
  taskTextDays: number;
  /** Days a request row survives at all. Impressions and uses cascade from it. */
  requestDays: number;
};

export const DEFAULT_TELEMETRY_RETENTION: TelemetryRetentionPolicy = {
  taskTextDays: 90,
  requestDays: 365,
};

export type TelemetryRetentionReport = {
  ranAt: string;
  policy: TelemetryRetentionPolicy;
  /** Requests whose text was nulled by this pass. Already-null rows are not counted again. */
  taskTextRedacted: number;
  /** Request rows deleted. Impressions and uses go with them by cascade, not by a second delete. */
  requestsDeleted: number;
  durationMs: number;
};

export type TelemetryRetentionOptions = {
  /** Narrow the pass to one workspace. Omitted means every workspace, the operator's normal case. */
  workspaceGuid?: string;
  /** The pass's clock, injectable so a test can age rows without waiting ninety days. */
  now?: () => Date;
};

/**
 * Applies both windows and records that it did so.
 *
 * Deletion runs before redaction: a row past `requestDays` is about to disappear, and redacting
 * its text first would spend the write and then inflate `taskTextRedacted` with rows no reader
 * will ever miss.
 *
 * One transaction, so the recorded run and the counts it claims cannot disagree. The thinning
 * itself does not need one — both statements are idempotent and monotonic, and a pass that dies
 * halfway simply leaves less work for the next one — but a run row asserting "redacted 4000" that
 * committed while the redaction rolled back is worse than no run row at all.
 */
export async function thinTelemetry(
  pool: Pool,
  telemetrySchemaName: string,
  policy: TelemetryRetentionPolicy = DEFAULT_TELEMETRY_RETENTION,
  options: TelemetryRetentionOptions = {},
): Promise<TelemetryRetentionReport> {
  assertValidSchemaName(telemetrySchemaName);
  assertUsableRetentionPolicy(policy);

  const now = options.now?.() ?? new Date();
  const startedAt = Date.now();
  const workspaceGuid = options.workspaceGuid ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Interval built from a bound parameter rather than interpolated: `make_interval` takes the
    // number as a value, so a day count can never reach SQL as text to be parsed.
    const deleted = await client.query(
      `DELETE FROM "${telemetrySchemaName}".retrieval_requests
        WHERE created_at < $1::timestamptz - make_interval(days => $2::integer)
          AND ($3::uuid IS NULL OR workspace_guid = $3::uuid)`,
      [now.toISOString(), policy.requestDays, workspaceGuid],
    );

    const redacted = await client.query(
      // `task_text IS NOT NULL` is what makes the count mean "questions this pass made
      // unreadable" rather than "rows older than ninety days", which would restate the same
      // number every run and read as though work were still being found.
      `UPDATE "${telemetrySchemaName}".retrieval_requests
          SET task_text = NULL
        WHERE created_at < $1::timestamptz - make_interval(days => $2::integer)
          AND task_text IS NOT NULL
          AND ($3::uuid IS NULL OR workspace_guid = $3::uuid)`,
      [now.toISOString(), policy.taskTextDays, workspaceGuid],
    );

    // The run log is telemetry too, and a table that records the thinning while growing without
    // bound would be its own counterexample. Bounded by the same window as the requests it
    // describes, so there is one rule rather than a second one to keep in step.
    await client.query(
      `DELETE FROM "${telemetrySchemaName}".telemetry_retention_runs
        WHERE ran_at < $1::timestamptz - make_interval(days => $2::integer)`,
      [now.toISOString(), policy.requestDays],
    );

    const durationMs = Date.now() - startedAt;
    await client.query(
      `INSERT INTO "${telemetrySchemaName}".telemetry_retention_runs
         (run_guid, workspace_guid, ran_at, task_text_days, request_days,
          task_text_redacted, requests_deleted, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        workspaceGuid,
        now.toISOString(),
        policy.taskTextDays,
        policy.requestDays,
        redacted.rowCount ?? 0,
        deleted.rowCount ?? 0,
        durationMs,
      ],
    );

    await client.query("COMMIT");

    return {
      ranAt: now.toISOString(),
      policy,
      taskTextRedacted: redacted.rowCount ?? 0,
      requestsDeleted: deleted.rowCount ?? 0,
      durationMs,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type TelemetryRetentionStatus = {
  /** Null when retention has never run, which is the state this whole task exists to make visible. */
  lastRanAt: string | null;
  lastTaskTextRedacted: number | null;
  lastRequestsDeleted: number | null;
  /** Rows that the current policy would act on if a pass ran right now. */
  requestsPastWindow: number;
  taskTextPastWindow: number;
};

/**
 * What `db status` reports, and the reason the run table exists.
 *
 * Both halves are needed. The last run alone cannot distinguish a job that is keeping up from one
 * that ran once at boot and never again; the pending counts alone cannot distinguish a job that
 * has never run from one that ran a minute ago against a quiet workspace. Together they say
 * whether retention is happening.
 */
export async function telemetryRetentionStatus(
  pool: Pool,
  telemetrySchemaName: string,
  policy: TelemetryRetentionPolicy = DEFAULT_TELEMETRY_RETENTION,
  options: { now?: () => Date } = {},
): Promise<TelemetryRetentionStatus> {
  assertValidSchemaName(telemetrySchemaName);
  // Validated here too, not only in the pass. This reports what is "past its window", and an
  // unusable policy does not make that question unanswerable — it makes it answerable and wrong,
  // which is worse: an operator reads a backlog of zero and concludes retention is keeping up.
  assertUsableRetentionPolicy(policy);
  const now = options.now?.() ?? new Date();

  const last = await pool.query<{
    ran_at: Date;
    task_text_redacted: number;
    requests_deleted: number;
  }>(
    `SELECT ran_at, task_text_redacted, requests_deleted
       FROM "${telemetrySchemaName}".telemetry_retention_runs
      ORDER BY ran_at DESC
      LIMIT 1`,
  );

  const pending = await pool.query<{ requests: string; texts: string }>(
    `SELECT
        count(*) FILTER (
          WHERE created_at < $1::timestamptz - make_interval(days => $2::integer)
        )::text AS requests,
        count(*) FILTER (
          WHERE created_at < $1::timestamptz - make_interval(days => $3::integer)
            AND task_text IS NOT NULL
        )::text AS texts
       FROM "${telemetrySchemaName}".retrieval_requests`,
    [now.toISOString(), policy.requestDays, policy.taskTextDays],
  );

  const row = last.rows[0];
  return {
    lastRanAt: row ? row.ran_at.toISOString() : null,
    lastTaskTextRedacted: row ? row.task_text_redacted : null,
    lastRequestsDeleted: row ? row.requests_deleted : null,
    requestsPastWindow: Number(pending.rows[0]?.requests ?? 0),
    taskTextPastWindow: Number(pending.rows[0]?.texts ?? 0),
  };
}

/**
 * Refuses a policy that cannot do what it says.
 *
 * `requestDays` below `taskTextDays` is the interesting one, and it is not merely odd: rows would
 * be deleted before their text window ever elapsed, so the text setting would have no effect at
 * any value. An operator who writes `taskTextDays: 90` has stated an intention, and silently
 * making it unreachable is worse than refusing to start.
 */
export function assertUsableRetentionPolicy(policy: TelemetryRetentionPolicy): void {
  for (const [key, value] of [
    ["taskTextDays", policy.taskTextDays],
    ["requestDays", policy.requestDays],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `Invalid telemetry retention ${key} "${String(value)}": expected a positive integer number of days.`,
      );
    }
  }

  if (policy.requestDays < policy.taskTextDays) {
    throw new Error(
      `Invalid telemetry retention: requestDays (${String(policy.requestDays)}) is below taskTextDays ` +
        `(${String(policy.taskTextDays)}), so request rows would be deleted before their task text was ever ` +
        `redacted and taskTextDays could never take effect.`,
    );
  }
}
