import { randomUUID } from "node:crypto";

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

export type SetRecordScopesInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  recordType: "section" | "assertion";
  /** Assertions resolve by guid; sections resolve by `stable_key` because section guids are revision-scoped. */
  recordGuid: string;
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
    entity: { entityType: input.recordType, entityGuid: input.recordGuid },
    apply: async (tx) => {
      const scopes = await resolveScopes(tx, schema, input.workspaceGuid, desired);
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
            input.recordGuid,
            input.stableKey ?? null,
            scopes.get(slug)!,
            CORRECTED_ASSOCIATION_TYPE,
          ],
        );
      }

      return {
        resultingValue: { recordType: input.recordType, scopeSlugs: desired, added, retired },
        entryType: "record.scopesChanged",
        // Undefined when the caller cleared every association: there is no owning scope left to
        // attribute the change to, and inventing one would misfile the history.
        ownerScopeGuid: desired.length > 0 ? scopes.get(desired[0]!) : undefined,
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
