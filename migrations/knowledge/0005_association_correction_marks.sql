-- Records WHY an association was retired, which `retired_at` alone cannot say.
--
-- Import retires associations whose document left the pinned commit, and a human retires one
-- when the derivation was simply wrong about what a section is for. Both wrote the same
-- timestamp, so nothing downstream could tell them apart — and import treated every retired row
-- as its own to reinstate or re-derive. A correction therefore lasted only until the next
-- import, silently.
--
-- Deliberately a mark on the association rather than a separate suppression table: the row is
-- already the record of the relationship, and a reader asking why a section stopped routing
-- somewhere should find the answer on it rather than by joining somewhere else.
ALTER TABLE record_scopes
  ADD COLUMN retired_by_correction boolean NOT NULL DEFAULT false;

-- Existing retired rows keep the default. They were all written by import, which is the only
-- thing that had retired an association before this column existed, so `false` is accurate
-- history rather than an assumption.

-- Import consults this on every derived association it is about to write, so the lookup is on
-- the path it takes for each section, not an occasional one.
--
-- The predicate mirrors that lookup exactly, record_type included. Without it the index also
-- covers corrected assertion rows -- which the query can never match, and many of which have a
-- null stable_key -- making it larger and less selective than the one access path it exists for.
CREATE INDEX record_scopes_corrected_retirement_idx
  ON record_scopes (workspace_guid, stable_key, scope_guid)
  WHERE retired_by_correction AND record_type = 'section';
