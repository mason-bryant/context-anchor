-- 0002_commands_and_history.sql
-- Command handler, typed history, and version snapshots (PR2 of G-042/M12).
--
-- Establishes the auditability and transactional-integrity guarantees the design doc puts
-- in its Critical NFR table: every mutation has an actor, a command, and a batch; nothing
-- mutates outside a command handler; a command's writes commit atomically or not at all.
--
-- Deliberately NOT here: notifications, restore/undo (T5/T6 own the compensating-command
-- machinery), and the retention thinning job. record_versions keeps every snapshot for now;
-- the 90-day-then-thinned policy is a scheduled concern, not a schema one.

-- One row per accepted mutation. idempotency_key is what makes a replayed command a no-op
-- rather than a second application, which is how import (PR3) and undo (T6) stay safe to
-- retry. batch_guid groups the commands that must reverse as a unit.
CREATE TABLE commands (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  command_guid uuid NOT NULL,
  actor_principal_guid uuid NOT NULL,
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  batch_guid uuid,
  origin text NOT NULL CHECK (origin IN ('ui', 'mcp')),
  reason text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_guid, command_guid),
  UNIQUE (workspace_guid, idempotency_key),
  FOREIGN KEY (workspace_guid, actor_principal_guid) REFERENCES principals (workspace_guid, principal_guid)
);

CREATE INDEX commands_batch_idx ON commands (workspace_guid, batch_guid) WHERE batch_guid IS NOT NULL;

-- The domain-shaped narrative behind "what changed in this area this week". Self-describing:
-- prior_value and resulting_value are carried inline so an entry renders without replaying
-- anything. Indexed for exactly the per-scope, newest-first read T4 performs.
CREATE TABLE mutation_log (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  entry_guid uuid NOT NULL,
  owner_scope_guid uuid NOT NULL,
  stream_id text NOT NULL,
  entry_type text NOT NULL,
  prior_value jsonb,
  resulting_value jsonb,
  command_guid uuid NOT NULL,
  batch_guid uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_guid, entry_guid),
  FOREIGN KEY (workspace_guid, owner_scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  FOREIGN KEY (workspace_guid, command_guid) REFERENCES commands (workspace_guid, command_guid)
);

CREATE INDEX mutation_log_scope_recorded_idx ON mutation_log (workspace_guid, owner_scope_guid, recorded_at DESC);

-- One generic history table, so point-in-time restore (T5) is a query rather than a replay.
-- Full row snapshots keyed by (entity_type, entity_guid, version); no per-entity tables.
CREATE TABLE record_versions (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  entity_type text NOT NULL,
  entity_guid uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  changed_by_principal_guid uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  command_guid uuid NOT NULL,
  PRIMARY KEY (workspace_guid, entity_type, entity_guid, version),
  FOREIGN KEY (workspace_guid, changed_by_principal_guid) REFERENCES principals (workspace_guid, principal_guid),
  FOREIGN KEY (workspace_guid, command_guid) REFERENCES commands (workspace_guid, command_guid)
);

CREATE INDEX record_versions_changed_at_idx ON record_versions (workspace_guid, entity_type, entity_guid, changed_at DESC);

-- Optimistic concurrency needs somewhere to hold the current version. 0001 shipped scopes
-- before `commands` existed, so the column lands here alongside the machinery that uses it.
ALTER TABLE scopes ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK (version >= 0);

-- Exactly one of 0001's two bare tombstone columns gains a foreign key here.
--
-- `retirement_command_guid` gets one now that `commands` exists, so a tombstone can never
-- name a command that was never accepted.
--
-- `retirement_batch_guid` stays a bare uuid, and not just for now: a batch has no table of
-- its own. It is a grouping value repeated across the `commands` rows that must reverse
-- together, so `commands.batch_guid` is deliberately non-unique and cannot be the target of
-- a foreign key. The same is true of `mutation_log.batch_guid`. 0001's comment calling both
-- columns "no FK yet" reads as though both were waiting on this migration; only one was.
-- That file is already applied elsewhere, so its checksum is fixed and the correction lives
-- here rather than as an edit to it.
ALTER TABLE scopes
  ADD CONSTRAINT scopes_retirement_command_fk
  FOREIGN KEY (workspace_guid, retirement_command_guid) REFERENCES commands (workspace_guid, command_guid);
