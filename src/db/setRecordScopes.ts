import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { CommandHandler, CommandTransaction } from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";

/**
 * Correcting where a record routes (T3, slice 2).
 *
 * Import derives associations from where a document lives — its project, its milestone's goal
 * ids — which describes location rather than subject. A person reading a route is the first
 * signal that a derived association is wrong, and this is how they say so.
 *
 * Corrections are marked with their own `association_type` rather than overwriting the derived
 * row's signal. Import must be able to tell "nobody has judged this" from "a person decided
 * this", or the next reimport would silently undo the correction and the reader who made it
 * would have no way to know.
 */

/** Distinguishes a human judgement from anything import derived. Import must not clobber these. */
export const CORRECTED_ASSOCIATION_TYPE = "manual-correction";

/**
 * Scope membership versions as its own aggregate rather than as the record it describes. A
 * correction is not a change to the claim's text or the section's content, and folding it into
 * their streams would make `expectedVersion` disagree with `assertions.version`.
 */
export const MEMBERSHIP_ENTITY_TYPE = "record_scope_membership";

/**
 * A stable, derived guid for a section's membership stream. `record_versions.entity_guid` is a
 * uuid, but a section's durable identity is its text `stable_key` — so the key is hashed into a
 * well-formed uuid. Deterministic, so every call for one section lands on one stream, and
 * version-stamped so it can never collide with a minted v4.
 */
export function membershipGuidForStableKey(stableKey: string): string {
  const h = createHash("sha256").update(`record-scope-membership:${stableKey}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type SetRecordScopesInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  recordType: "section" | "assertion";
  /**
   * Required for an assertion, whose guid is its durable identity. Ignored for a section: the
   * provenance guid is resolved from `stableKey` internally, because a caller-supplied one can
   * name a section that does not exist — or, after a reimport, one that is no longer current.
   */
  recordGuid?: string;
  stableKey?: string;
  /** The complete set of scope slugs this record should route under. Absent slugs are retired. */
  scopeSlugs: string[];
  reason: string;
  idempotencyKey?: string;
};

export type SetRecordScopesResult = {
  added: string[];
  retired: string[];
  unchanged: string[];
  replayed: boolean;
};

export class SectionStableKeyRequiredError extends Error {
  constructor() {
    super(
      `A section association needs its stableKey. Section guids are revision-scoped, so an ` +
        `association keyed on the guid stops matching at the next import with nothing raised.`,
    );
    this.name = "SectionStableKeyRequiredError";
  }
}

export class AssertionRecordGuidRequiredError extends Error {
  constructor() {
    super(`An assertion association needs its recordGuid: the guid is the claim's durable identity.`);
    this.name = "AssertionRecordGuidRequiredError";
  }
}

export class UnknownScopeError extends Error {
  constructor(slugs: string[]) {
    super(`No live scope in this workspace for: ${slugs.join(", ")}.`);
    this.name = "UnknownScopeError";
  }
}

export async function setRecordScopes(input: SetRecordScopesInput): Promise<SetRecordScopesResult> {
  assertValidSchemaName(input.schemaName);
  const schema = input.schemaName;

  if (input.recordType === "section" && !input.stableKey) {
    throw new SectionStableKeyRequiredError();
  }
  if (input.recordType === "assertion" && !input.recordGuid) {
    throw new AssertionRecordGuidRequiredError();
  }

  // The stream this command versions is the record's scope membership, not the record. Keying
  // it on the record's own entity would advance the assertion's `record_versions` stream without
  // touching `assertions.version` — desyncing optimistic concurrency — and, for a section, would
  // start a fresh stream per call, since a section guid is revision-scoped.
  const membershipGuid =
    input.recordType === "assertion" ? input.recordGuid! : membershipGuidForStableKey(input.stableKey!);

  const desired = [...new Set(input.scopeSlugs.map((slug) => slug.trim()).filter(Boolean))].sort();
  let added: string[] = [];
  let retired: string[] = [];
  let unchanged: string[] = [];

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "record.setScopes",
    origin: "mcp",
    // Keyed on the record and the requested set: asking for the same membership twice is a
    // retry. The set is sorted first so argument order cannot mint a second key for one intent.
    idempotencyKey:
      input.idempotencyKey ??
      `record.setScopes:${input.recordType}:${input.stableKey ?? input.recordGuid}:${desired.join(",")}`,
    reason: input.reason,
    entity: { entityType: MEMBERSHIP_ENTITY_TYPE, entityGuid: membershipGuid },
    apply: async (tx) => {
      const scopes = await resolveScopes(tx, schema, input.workspaceGuid, desired);
      const owner = await resolveOwner(tx, schema, input);
      const live = await loadLiveAssociations(tx, schema, input);

      const liveBySlug = new Map(live.map((row) => [row.scope_slug, row]));
      added = desired.filter((slug) => !liveBySlug.has(slug));
      unchanged = desired.filter((slug) => liveBySlug.has(slug));
      retired = live.map((row) => row.scope_slug).filter((slug) => !desired.includes(slug));

      for (const slug of retired) {
        // Retired, never deleted: the association is history, and a reader asking why a record
        // stopped routing somewhere needs the row to still exist.
        await tx.query(
          `UPDATE "${schema}".record_scopes SET retired_at = now()
            WHERE workspace_guid = $1 AND association_guid = $2`,
          [input.workspaceGuid, liveBySlug.get(slug)!.association_guid],
        );
      }

      for (const slug of added) {
        await tx.query(
          `INSERT INTO "${schema}".record_scopes
             (workspace_guid, association_guid, record_type, record_guid, stable_key, scope_guid,
              association_type, derived_from_signal)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'corrected')`,
          [
            input.workspaceGuid,
            randomUUID(),
            input.recordType,
            owner.recordGuid,
            input.stableKey ?? null,
            scopes.get(slug)!,
            CORRECTED_ASSOCIATION_TYPE,
          ],
        );
      }

      return {
        resultingValue: { recordType: input.recordType, scopeSlugs: desired, added, retired },
        entryType: "record.scopesChanged",
        // The record's *owning* scope, never one of the scopes it was just associated with. An
        // association does not grant access, so filing this history under an associated scope
        // would expose the record's existence to readers of that scope — and it would leave
        // `scopeSlugs: []` with no scope to attribute the change to at all.
        ownerScopeGuid: owner.ownerScopeGuid,
      };
    },
  });

  if (!command.replayed) {
    return { added, retired, unchanged, replayed: false };
  }

  // A replay changed nothing, so the tallies above describe work that never happened. Report
  // the membership as it stands instead of a diff no one applied.
  const settled = await loadLiveAssociationsFromPool(input);
  return {
    added: [],
    retired: [],
    unchanged: settled.map((row) => row.scope_slug).sort(),
    replayed: true,
  };
}

type AssociationRow = { association_guid: string; scope_slug: string };

export class RecordNotFoundError extends Error {
  constructor(recordType: string, identity: string) {
    super(`No live ${recordType} ${identity} in this workspace to re-associate.`);
    this.name = "RecordNotFoundError";
  }
}

/**
 * The scope that owns the record, which is the permission boundary its history belongs under.
 * An assertion carries it directly; a section inherits its document's, reached through the
 * revision because a section row is revision-scoped.
 */
async function resolveOwner(
  tx: CommandTransaction,
  schema: string,
  input: SetRecordScopesInput,
): Promise<{ ownerScopeGuid: string; recordGuid: string }> {
  if (input.recordType === "assertion") {
    const result = await tx.query<{ owner_scope_guid: string }>(
      `SELECT owner_scope_guid FROM "${schema}".assertions
        WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
      [input.workspaceGuid, input.recordGuid],
    );
    const row = result.rows[0];
    if (!row) {
      throw new RecordNotFoundError("assertion", input.recordGuid ?? "");
    }
    return { ownerScopeGuid: row.owner_scope_guid, recordGuid: input.recordGuid! };
  }

  // The section guid is resolved here rather than trusted from the caller: `record_guid` is the
  // row the association was made against, so a guid naming no section would leave an audit trail
  // pointing at nothing.
  const result = await tx.query<{ owner_scope_guid: string; section_guid: string }>(
    `SELECT d.owner_scope_guid, s.section_guid
       FROM "${schema}".source_sections s
       JOIN "${schema}".document_revisions r
         ON r.workspace_guid = s.workspace_guid AND r.revision_guid = s.revision_guid
       JOIN "${schema}".source_documents d
         ON d.workspace_guid = r.workspace_guid AND d.document_guid = r.document_guid
      WHERE s.workspace_guid = $1 AND s.stable_key = $2 AND d.retired_at IS NULL
      -- A stable key spans every revision of its section, so take the newest owner rather
      -- than whichever row the planner happens to return first. revision_number is monotonic
      -- per document; imported_at is not, since a reimport can write several in one second.
      ORDER BY r.revision_number DESC, r.revision_guid DESC
      LIMIT 1`,
    [input.workspaceGuid, input.stableKey],
  );
  const row = result.rows[0];
  if (!row) {
    throw new RecordNotFoundError("section", input.stableKey ?? "");
  }
  return { ownerScopeGuid: row.owner_scope_guid, recordGuid: row.section_guid };
}

async function resolveScopes(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  slugs: string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) {
    return new Map();
  }
  const result = await tx.query<{ scope_slug: string; scope_guid: string }>(
    `SELECT scope_slug, scope_guid FROM "${schema}".scopes
      WHERE workspace_guid = $1 AND scope_slug = ANY($2) AND retired_at IS NULL`,
    [workspaceGuid, slugs],
  );
  const found = new Map(result.rows.map((row) => [row.scope_slug, row.scope_guid]));
  // Refused as a set rather than one at a time, so a caller fixing a typo learns about every
  // bad slug in one round trip instead of discovering them serially.
  const missing = slugs.filter((slug) => !found.has(slug));
  if (missing.length > 0) {
    throw new UnknownScopeError(missing);
  }
  return found;
}

const LIVE_ASSOCIATIONS_SQL = (schema: string, matchColumn: string) =>
  `SELECT a.association_guid, s.scope_slug
     FROM "${schema}".record_scopes a
     JOIN "${schema}".scopes s
       ON s.workspace_guid = a.workspace_guid AND s.scope_guid = a.scope_guid
    WHERE a.workspace_guid = $1 AND a.record_type = $2 AND a.${matchColumn} = $3
      AND a.retired_at IS NULL`;

async function loadLiveAssociations(
  tx: CommandTransaction,
  schema: string,
  input: SetRecordScopesInput,
): Promise<AssociationRow[]> {
  const matchColumn = input.recordType === "section" ? "stable_key" : "record_guid";
  const result = await tx.query<AssociationRow>(LIVE_ASSOCIATIONS_SQL(schema, matchColumn), [
    input.workspaceGuid,
    input.recordType,
    input.recordType === "section" ? input.stableKey : input.recordGuid,
  ]);
  return result.rows;
}

async function loadLiveAssociationsFromPool(input: SetRecordScopesInput): Promise<AssociationRow[]> {
  const matchColumn = input.recordType === "section" ? "stable_key" : "record_guid";
  const result = await input.pool.query<AssociationRow>(
    LIVE_ASSOCIATIONS_SQL(input.schemaName, matchColumn),
    [
      input.workspaceGuid,
      input.recordType,
      input.recordType === "section" ? input.stableKey : input.recordGuid,
    ],
  );
  return result.rows;
}
