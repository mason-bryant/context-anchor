-- 0003_source_documents_and_associations.sql
-- Source documents, routing associations, and the tables bootstrap import populates
-- (PR3 of G-042/M12, thread T2).
--
-- Deliberately NOT here: assertions, assertion_relations, source_citations. Import extracts
-- nothing into assertions by design, and a citation has no assertion to hang off yet, so
-- both land with authoring (PR6). record_scopes is created now, typed from the start,
-- because in a zero-assertion workspace every association is section-level.

-- Every address, handle, and name a person is known by, so an importer can resolve "@mason",
-- a commit trailer, or a name in prose to one person. Populated by import from the legacy
-- people registry; nothing in this redesign reads it. It exists now because reconstructing
-- identity history later costs far more than carrying it across.
CREATE TABLE user_identities (
  identity_guid uuid PRIMARY KEY,
  user_guid uuid NOT NULL REFERENCES users (user_guid),
  -- Null means the identity is global rather than scoped to one workspace.
  workspace_guid uuid REFERENCES workspaces (workspace_guid),
  identity_kind text NOT NULL CHECK (identity_kind IN ('email', 'slack', 'github', 'confluence', 'nickname', 'alias')),
  value text NOT NULL,
  normalized_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  retired_at timestamptz
);

-- Addressable identity kinds are unique among LIVE rows only, so a retired identity can be
-- reissued. Nicknames and aliases are deliberately excluded: they collide legitimately, and
-- an ambiguous match is surfaced rather than guessed.
CREATE UNIQUE INDEX user_identities_addressable_unique_idx
  ON user_identities (identity_kind, normalized_value)
  WHERE retired_at IS NULL AND identity_kind IN ('email', 'slack', 'github', 'confluence');

CREATE INDEX user_identities_user_idx ON user_identities (user_guid) WHERE retired_at IS NULL;

-- The only traversal in this redesign: one hop from a matched scope to the scope it is
-- part_of. Not a general edge table — nothing walks it further than a single step.
CREATE TABLE scope_relations (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  relation_guid uuid NOT NULL,
  from_scope_guid uuid NOT NULL,
  to_scope_guid uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('part_of', 'related_to')),
  -- How this edge was arrived at, so a derived relation is never mistaken for a curated one.
  derived_from_signal text,
  retired_at timestamptz,
  PRIMARY KEY (workspace_guid, relation_guid),
  FOREIGN KEY (workspace_guid, from_scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  FOREIGN KEY (workspace_guid, to_scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  CONSTRAINT scope_relation_not_self CHECK (from_scope_guid <> to_scope_guid)
);

CREATE UNIQUE INDEX scope_relations_live_unique_idx
  ON scope_relations (workspace_guid, from_scope_guid, to_scope_guid, relation_type)
  WHERE retired_at IS NULL;

CREATE INDEX scope_relations_from_idx
  ON scope_relations (workspace_guid, from_scope_guid) WHERE retired_at IS NULL;

-- Turns a referenced file path into a component scope. Imported from project-mappings.json
-- rather than read from Git at query time, so routing is reproducible from the database
-- alone — the dependency this redesign exists to remove.
CREATE TABLE repository_mappings (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  mapping_guid uuid NOT NULL,
  scope_guid uuid NOT NULL,
  repository text NOT NULL,
  path_prefix text NOT NULL,
  web_config jsonb,
  retired_at timestamptz,
  PRIMARY KEY (workspace_guid, mapping_guid),
  FOREIGN KEY (workspace_guid, scope_guid) REFERENCES scopes (workspace_guid, scope_guid)
);

-- Longest matching path_prefix wins; ties resolve on mapping_guid so the choice is
-- deterministic rather than dependent on scan order.
CREATE UNIQUE INDEX repository_mappings_live_unique_idx
  ON repository_mappings (workspace_guid, repository, path_prefix)
  WHERE retired_at IS NULL;

-- The authored artifact as provenance and authoring surface — not a container that owns the
-- knowledge inside it. Routing points at sections and (later) assertions, not at documents.
CREATE TABLE source_documents (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  document_guid uuid NOT NULL,
  owner_scope_guid uuid NOT NULL,
  document_type text NOT NULL,
  name text NOT NULL,
  title text,
  locator text,
  metadata jsonb,
  retired_at timestamptz,
  retired_by_principal_guid uuid,
  retirement_reason text,
  retirement_command_guid uuid,
  retirement_batch_guid uuid,
  PRIMARY KEY (workspace_guid, document_guid),
  UNIQUE (workspace_guid, owner_scope_guid, name),
  FOREIGN KEY (workspace_guid, owner_scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  FOREIGN KEY (workspace_guid, retired_by_principal_guid) REFERENCES principals (workspace_guid, principal_guid),
  FOREIGN KEY (workspace_guid, retirement_command_guid) REFERENCES commands (workspace_guid, command_guid)
);

-- Byte-complete content at a point in time. Imports deduplicate against the LATEST revision
-- only, so reverting a document to earlier content still produces a new revision — history
-- records what happened, not the set of distinct states.
CREATE TABLE document_revisions (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  revision_guid uuid NOT NULL,
  document_guid uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  content text NOT NULL,
  content_hash text NOT NULL,
  -- Import provenance: which repository and commit this byte content came from.
  repository text,
  commit_sha text,
  source_path text,
  authored_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_guid, revision_guid),
  UNIQUE (workspace_guid, document_guid, revision_number),
  FOREIGN KEY (workspace_guid, document_guid) REFERENCES source_documents (workspace_guid, document_guid)
);

CREATE INDEX document_revisions_latest_idx
  ON document_revisions (workspace_guid, document_guid, revision_number DESC);

-- The heading structure of one revision, and the retrieval unit when a scope has no
-- assertions yet — which is every scope until PR6.
CREATE TABLE source_sections (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  section_guid uuid NOT NULL,
  revision_guid uuid NOT NULL,
  parent_section_guid uuid,
  heading_level integer NOT NULL CHECK (heading_level BETWEEN 1 AND 6),
  title text NOT NULL,
  -- Document plus normalized heading path. Survives reimport, unlike section_guid, which is
  -- revision-scoped; this is what associations and diagnostics aggregate on.
  stable_key text NOT NULL,
  ordinal integer NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  PRIMARY KEY (workspace_guid, section_guid),
  FOREIGN KEY (workspace_guid, revision_guid) REFERENCES document_revisions (workspace_guid, revision_guid),
  FOREIGN KEY (workspace_guid, parent_section_guid) REFERENCES source_sections (workspace_guid, section_guid)
);

CREATE INDEX source_sections_revision_idx ON source_sections (workspace_guid, revision_guid, ordinal);
CREATE INDEX source_sections_stable_key_idx ON source_sections (workspace_guid, stable_key);

-- The addressable paragraphs, tables, and code blocks a citation will point at (PR6).
CREATE TABLE content_blocks (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  block_guid uuid NOT NULL,
  revision_guid uuid NOT NULL,
  section_guid uuid,
  block_type text NOT NULL,
  ordinal integer NOT NULL,
  raw_content text NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  PRIMARY KEY (workspace_guid, block_guid),
  FOREIGN KEY (workspace_guid, revision_guid) REFERENCES document_revisions (workspace_guid, revision_guid),
  FOREIGN KEY (workspace_guid, section_guid) REFERENCES source_sections (workspace_guid, section_guid)
);

CREATE INDEX content_blocks_revision_idx ON content_blocks (workspace_guid, revision_guid, ordinal);
CREATE INDEX content_blocks_section_idx ON content_blocks (workspace_guid, section_guid, ordinal);

-- Secondary routing associations: one record routes under several subjects without that
-- granting access to any of them. Typed from the start rather than assertion-only, because a
-- section routes under scopes its document does not belong to — a roadmap goal associating
-- to the initiative that references it is the ordinary case.
CREATE TABLE record_scopes (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  association_guid uuid NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('assertion', 'section')),
  record_guid uuid NOT NULL,
  -- Section associations RESOLVE on this, not on record_guid. Section guids are
  -- revision-scoped, so a reimport mints new ones and a join through record_guid would
  -- silently stop matching — routes would come back empty with nothing raised. record_guid
  -- records the row the association was made against and is deliberately not a live pointer;
  -- import never rewrites it. stable_key is null for assertions, whose guids are durable and
  -- are what their associations resolve by; record_guid is NOT NULL for both kinds.
  stable_key text,
  scope_guid uuid NOT NULL,
  association_type text NOT NULL,
  derived_from_signal text,
  retired_at timestamptz,
  PRIMARY KEY (workspace_guid, association_guid),
  FOREIGN KEY (workspace_guid, scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  CONSTRAINT record_scopes_section_has_stable_key CHECK (record_type <> 'section' OR stable_key IS NOT NULL)
);

-- Sections dedupe on stable_key, assertions on record_guid, because those are the identities
-- each kind actually resolves by.
CREATE UNIQUE INDEX record_scopes_section_live_unique_idx
  ON record_scopes (workspace_guid, stable_key, scope_guid, association_type)
  WHERE retired_at IS NULL AND record_type = 'section';

CREATE UNIQUE INDEX record_scopes_assertion_live_unique_idx
  ON record_scopes (workspace_guid, record_guid, scope_guid, association_type)
  WHERE retired_at IS NULL AND record_type = 'assertion';

CREATE INDEX record_scopes_scope_idx ON record_scopes (workspace_guid, scope_guid) WHERE retired_at IS NULL;
