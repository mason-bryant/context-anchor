-- Retention needs a record of itself (T-41).
--
-- The design has promised a ninety-day telemetry window since 2026-08-08 and nothing ran it.
-- What made that survivable is that its absence looked exactly like its success: an operator
-- reading the telemetry tables sees rows, and rows are what a working retention pass leaves
-- behind too. There was no way to tell "thinned yesterday" from "never thinned".
--
-- One row per pass rather than one row upserted in place, because absence and staleness are
-- different failures and a single "last run" row can only show the first. A job that ran daily
-- and stopped three weeks ago is the case worth catching, and it is invisible unless the gaps
-- are visible.

CREATE TABLE telemetry_retention_runs (
  run_guid uuid PRIMARY KEY,
  -- NULL when the pass covered every workspace, which is the operator's normal case. A value
  -- means the pass was deliberately narrowed, and a reader must not mistake its counts for
  -- the whole schema's.
  workspace_guid uuid,
  ran_at timestamptz NOT NULL DEFAULT now(),
  -- The windows this pass actually applied, not the ones configured now. Counts are only
  -- interpretable against the policy that produced them, and the policy is editable.
  task_text_days integer NOT NULL,
  request_days integer NOT NULL,
  task_text_redacted integer NOT NULL,
  requests_deleted integer NOT NULL,
  duration_ms integer NOT NULL
);

CREATE INDEX telemetry_retention_runs_ran_idx ON telemetry_retention_runs (ran_at DESC);
