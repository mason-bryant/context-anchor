-- 0001_identity_and_scopes.sql
-- Tenancy and identity spine plus scopes (PR1 of the database-backed redesign, G-042/M12).
--
-- Scope of this migration is deliberately narrow: enough to bootstrap one workspace, one
-- owner principal, and the default `workspace` scope, and to make deny-by-default access
-- resolution real and testable from the first migration. `user_identities` (populated by
-- import, PR3), `assertions`, `record_scopes`, `commands`, and every later table are not
-- created here.
--
-- Conventions (see ai-output/markdowns/context-conductor/database_backed_redesign.md,
-- "Schema" section): every tenant table carries workspace_guid; foreign keys into another
-- tenant table are composite (workspace_guid, x) so a row can never reference a parent row
-- that belongs to a different workspace; UUIDs are application-generated, never
-- DEFAULT gen_random_uuid(), so a command can know a record's identity before it writes the
-- first row that references it.
--
-- `scopes.retired_by_principal_guid` is the only tombstone actor column this migration can
-- add a foreign key for, since `principals` already exists; `retirement_command_guid` and
-- `retirement_batch_guid` are plain uuid columns with no FK yet because the `commands` table
-- (PR2) does not exist. Their FK constraints land in the PR2 migration.

CREATE TABLE workspaces (
  workspace_guid uuid PRIMARY KEY,
  workspace_slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

-- Global: a human identity from an external issuer, shared across workspaces. Not a tenant
-- table, so it carries no workspace_guid.
CREATE TABLE users (
  user_guid uuid PRIMARY KEY,
  identity_issuer text NOT NULL,
  identity_subject text NOT NULL,
  display_name text NOT NULL,
  suspended_at timestamptz,
  UNIQUE (identity_issuer, identity_subject)
);

-- The authorization subject inside one workspace; what grants, commands, and audit point at.
CREATE TABLE principals (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  principal_guid uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'service')),
  user_guid uuid REFERENCES users (user_guid),
  display_name text NOT NULL,
  PRIMARY KEY (workspace_guid, principal_guid)
);

-- Whether a principal belongs to the workspace and owns it; carries no knowledge access by
-- itself (see scope_grants). role='owner' has full access with no grant row required —
-- deny-by-default only governs 'member'.
CREATE TABLE workspace_memberships (
  workspace_guid uuid NOT NULL,
  principal_guid uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  PRIMARY KEY (workspace_guid, principal_guid),
  FOREIGN KEY (workspace_guid, principal_guid) REFERENCES principals (workspace_guid, principal_guid)
);

-- The subjects people work in, and therefore the routing keys the retrieval answer (T1,
-- future PR) is organized around. Created here so listScopes has something to enumerate.
CREATE TABLE scopes (
  workspace_guid uuid NOT NULL REFERENCES workspaces (workspace_guid),
  scope_guid uuid NOT NULL,
  scope_slug text NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('initiative', 'component', 'domain', 'practice', 'workspace')),
  title text NOT NULL,
  summary text,
  aliases text[] NOT NULL DEFAULT '{}',
  retired_at timestamptz,
  retired_by_principal_guid uuid,
  retirement_reason text,
  retirement_command_guid uuid,
  retirement_batch_guid uuid,
  PRIMARY KEY (workspace_guid, scope_guid),
  UNIQUE (workspace_guid, scope_slug),
  FOREIGN KEY (workspace_guid, retired_by_principal_guid) REFERENCES principals (workspace_guid, principal_guid)
);

-- Per-scope read or write access. Created and left empty by bootstrap in this redesign;
-- retrofitting the permission boundary later is the expensive path. Resolution (owner always
-- allowed, member denied without a live grant) lives in application code — src/db/access.ts —
-- not in this schema; SQL only narrows to candidate rows.
CREATE TABLE scope_grants (
  grant_guid uuid PRIMARY KEY,
  workspace_guid uuid NOT NULL,
  scope_guid uuid NOT NULL,
  principal_guid uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('read', 'write')),
  granted_by_principal_guid uuid NOT NULL,
  retired_at timestamptz,
  FOREIGN KEY (workspace_guid, scope_guid) REFERENCES scopes (workspace_guid, scope_guid),
  FOREIGN KEY (workspace_guid, principal_guid) REFERENCES principals (workspace_guid, principal_guid),
  FOREIGN KEY (workspace_guid, granted_by_principal_guid) REFERENCES principals (workspace_guid, principal_guid)
);

CREATE INDEX scope_grants_principal_idx ON scope_grants (workspace_guid, principal_guid) WHERE retired_at IS NULL;
