-- Assertions, their citations, and the relations between them (T3).
--
-- This is the unit routing points at instead of whole documents. Sections were routable
-- from the first import, which is what made a workspace useful before any assertion
-- existed; assertions are what let a claim be addressed, disputed, and superseded on its
-- own rather than inheriting the standing of the document it happens to sit in.

CREATE TABLE assertions (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  assertion_guid uuid NOT NULL,
  -- The scope that owns it, and therefore the permission boundary it inherits.
  owner_scope_guid uuid NOT NULL,
  -- What sort of claim this is. Travels with the record into every response, because a
  -- reader weighing a `hypothesis` differently from an `invariant` is the entire point.
  kind text NOT NULL CHECK (kind IN ('fact', 'inference', 'definition', 'requirement', 'decision', 'invariant', 'goal', 'hypothesis')),
  -- What standing it currently has. Deliberately separate from kind: a retracted decision
  -- is still a decision. New claims are active.
  --
  -- Note for authoring: this describes the standing of the *claim*, not the outcome of
  -- whatever the claim describes. "We tried X and it failed" is an active fact — filing it
  -- as retracted would hide the record that was meant to surface.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disputed', 'superseded', 'retracted')),
  title text NOT NULL,
  content text NOT NULL,
  -- Optimistic concurrency, and the counter record_versions snapshots against.
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  retired_at timestamptz,
  PRIMARY KEY (workspace_guid, assertion_guid),
  FOREIGN KEY (workspace_guid, owner_scope_guid) REFERENCES scopes (workspace_guid, scope_guid)
);

CREATE INDEX assertions_owner_idx
  ON assertions (workspace_guid, owner_scope_guid) WHERE retired_at IS NULL;

-- Routing excludes non-active claims by default, so the common read is "live and active".
CREATE INDEX assertions_active_idx
  ON assertions (workspace_guid, owner_scope_guid) WHERE retired_at IS NULL AND status = 'active';

-- The immutable link from an assertion to the exact text it came from.
--
-- W3C quote and position selectors together: the offsets locate it cheaply while the quote
-- and its surrounding context re-find it when the source moves, which it will — a reimport
-- mints new block GUIDs for the same text, and an edit above a quote shifts every offset
-- below it. Neither selector alone survives both.
CREATE TABLE source_citations (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  citation_guid uuid NOT NULL,
  assertion_guid uuid NOT NULL,
  block_guid uuid NOT NULL,
  -- How the cited text relates to the claim: it may support it or dispute it.
  relation text NOT NULL DEFAULT 'supports' CHECK (relation IN ('supports', 'disputes', 'mentions')),
  exact_quote text NOT NULL,
  prefix text,
  suffix text,
  start_offset integer,
  end_offset integer,
  -- The content this citation was made against, so a later reader can tell whether the
  -- source has changed underneath it rather than assuming it has not.
  selected_content_hash text NOT NULL,
  parser_version text,
  -- Set when a citation is re-anchored after its source moved, so the chain is visible
  -- rather than the original silently disappearing.
  reanchored_from_citation_guid uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_guid, citation_guid),
  FOREIGN KEY (workspace_guid, assertion_guid) REFERENCES assertions (workspace_guid, assertion_guid),
  FOREIGN KEY (workspace_guid, block_guid) REFERENCES content_blocks (workspace_guid, block_guid),
  FOREIGN KEY (workspace_guid, reanchored_from_citation_guid) REFERENCES source_citations (workspace_guid, citation_guid)
);

CREATE INDEX source_citations_assertion_idx ON source_citations (workspace_guid, assertion_guid);
CREATE INDEX source_citations_block_idx ON source_citations (workspace_guid, block_guid);

-- Conflict and lineage between claims, so contradictions surface even when the two records
-- are routed separately. Nothing else creates these.
CREATE TABLE assertion_relations (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  relation_guid uuid NOT NULL,
  owner_scope_guid uuid NOT NULL,
  source_assertion_guid uuid NOT NULL,
  target_assertion_guid uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('contradicts', 'supersedes', 'split_from', 'merged_from')),
  rationale text,
  retired_at timestamptz,
  PRIMARY KEY (workspace_guid, relation_guid),
  FOREIGN KEY (workspace_guid, owner_scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  FOREIGN KEY (workspace_guid, source_assertion_guid) REFERENCES assertions (workspace_guid, assertion_guid),
  FOREIGN KEY (workspace_guid, target_assertion_guid) REFERENCES assertions (workspace_guid, assertion_guid),
  -- A claim relating to itself is never meaningful and would make lineage cyclic on one row.
  CONSTRAINT assertion_relation_not_self CHECK (source_assertion_guid <> target_assertion_guid)
);

-- One live relation of a given type between a given pair. Recording "contradicts" twice is
-- not two conflicts, and a retired relation stays as history rather than blocking a redo.
CREATE UNIQUE INDEX assertion_relations_live_unique_idx
  ON assertion_relations (workspace_guid, source_assertion_guid, target_assertion_guid, relation_type)
  WHERE retired_at IS NULL;

-- Conflicts must surface from either side: T1 shows them on both records, so both
-- directions are read as often as each other.
CREATE INDEX assertion_relations_source_idx
  ON assertion_relations (workspace_guid, source_assertion_guid) WHERE retired_at IS NULL;
CREATE INDEX assertion_relations_target_idx
  ON assertion_relations (workspace_guid, target_assertion_guid) WHERE retired_at IS NULL;
