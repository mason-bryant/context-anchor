-- Retrieval telemetry. Deliberately a separate schema from `knowledge`: this data is
-- thinned on a retention schedule while knowledge is durable, and separating them keeps a
-- retention job from ever needing write access to the records themselves.
--
-- Nothing here references the knowledge schema by foreign key. Telemetry describes what was
-- offered at a moment in time, and a scope or document deleted later must not make its own
-- history unwritable or cascade a retrieval record away.

-- One row per bundle generated.
CREATE TABLE retrieval_requests (
  request_guid uuid PRIMARY KEY,
  workspace_guid uuid NOT NULL,
  principal_guid uuid,
  trace_id text,
  -- Opt-in: expansion is stateless and the server never reads the task back, so storing it
  -- is a diagnostics choice rather than a requirement.
  task_text text,
  -- Always written, so tasks can be grouped and compared without retaining their text.
  task_hash text NOT NULL,
  planner_version text NOT NULL,
  -- Which ranker produced the order, and whether that ranker is reproducible. Without this
  -- a comparison silently mixes results from different rankers and reads as noise.
  ranker_id text NOT NULL,
  ranker_version text NOT NULL,
  ranker_deterministic boolean NOT NULL,
  consumer text,
  route_budget integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_requests_created_idx ON retrieval_requests (workspace_guid, created_at DESC);
CREATE INDEX retrieval_requests_task_idx ON retrieval_requests (workspace_guid, task_hash);

-- Which routes were offered, in what order, by which ranker.
CREATE TABLE retrieval_route_impressions (
  impression_guid uuid PRIMARY KEY,
  request_guid uuid NOT NULL REFERENCES retrieval_requests (request_guid) ON DELETE CASCADE,
  -- Repeated from the request so a shadow ranker's ordering can be recorded against the
  -- same request without inventing a second request row.
  ranker_id text NOT NULL,
  ranker_version text NOT NULL,
  -- False for the ranker that produced the answer, true for one running alongside it. A
  -- shadow ordering must never be mistaken for what the caller actually saw.
  is_shadow boolean NOT NULL DEFAULT false,
  route_key text NOT NULL,
  subject_type text NOT NULL,
  subject_guid uuid,
  offered_position integer NOT NULL,
  -- Reserved for the exploration mechanism that arrives with usage ranking; always false
  -- here, so ordering stays deterministic and diagnostics do not have to guess.
  position_randomized boolean NOT NULL DEFAULT false,
  is_exploration boolean NOT NULL DEFAULT false,
  match_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  record_count integer NOT NULL DEFAULT 0,
  expanded_at timestamptz
);

-- One position per route per ranker per request: a route offered twice at different
-- positions is a bug in ordering, not a fact worth storing.
CREATE UNIQUE INDEX retrieval_route_impressions_unique_idx
  ON retrieval_route_impressions (request_guid, ranker_id, ranker_version, route_key);

CREATE INDEX retrieval_route_impressions_request_idx
  ON retrieval_route_impressions (request_guid, is_shadow, offered_position);

CREATE INDEX retrieval_route_impressions_route_idx
  ON retrieval_route_impressions (route_key, ranker_id);

-- The outcome signal: whether a served record was actually used. Written by a later slice;
-- created now so the retention story covers one schema rather than growing into two.
CREATE TABLE retrieval_record_uses (
  use_guid uuid PRIMARY KEY,
  request_guid uuid NOT NULL REFERENCES retrieval_requests (request_guid) ON DELETE CASCADE,
  impression_guid uuid REFERENCES retrieval_route_impressions (impression_guid) ON DELETE SET NULL,
  record_type text NOT NULL CHECK (record_type IN ('assertion', 'section')),
  -- A node GUID for an assertion, a revision-scoped section GUID otherwise.
  record_guid uuid NOT NULL,
  -- What diagnostics aggregate on: section GUIDs change on every reimport, stable keys do not.
  stable_key text,
  use_kind text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retrieval_record_uses_section_has_stable_key
    CHECK (record_type <> 'section' OR stable_key IS NOT NULL)
);

CREATE INDEX retrieval_record_uses_request_idx ON retrieval_record_uses (request_guid);
CREATE INDEX retrieval_record_uses_stable_key_idx ON retrieval_record_uses (stable_key);
