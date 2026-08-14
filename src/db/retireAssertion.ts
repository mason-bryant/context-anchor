import type { Pool } from "pg";

import { type CommandHandler, type CommandTransaction } from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";

/**
 * Tombstoning a claim (T3).
 *
 * Distinct from `setAssertionStatus("retracted")`, and the difference is not cosmetic.
 * Retracting says "we no longer stand behind this" — the claim stays in the workspace, keeps
 * routing to anyone who asks for it, and remains the answer to "what did we used to think".
 * Retiring says the record should not be in the workspace at all: an import artefact, a
 * duplicate, a claim authored against the wrong scope. A retired claim stops being returned.
 *
 * Prefer retraction. A reader who finds a retracted claim learns something; a reader who finds
 * nothing learns nothing, and cannot tell an absent claim from one that was removed.
 */

export class AssertionNotFoundError extends Error {
  constructor(assertionGuid: string) {
    super(`No live assertion ${assertionGuid} in this workspace.`);
    this.name = "AssertionNotFoundError";
  }
}

/**
 * Retiring a claim that supersession lineage runs through would break the invariant both other
 * assertion commands already defend: a `superseded` status must have a live supersedes relation
 * behind it, in both directions.
 *
 * Tombstone the *target* and the surviving claim's lineage points at a record that no longer
 * answers — "what did this replace" becomes unanswerable. Tombstone the *source* and the claim
 * it superseded is left marked superseded with nothing superseding it, which is exactly the
 * state `SupersededRequiresRelationError` exists to prevent. Neither is a cascade this command
 * can perform quietly, because both change the standing of a claim the caller did not name.
 */
export class SupersessionLineageError extends Error {
  constructor(assertionGuid: string) {
    super(
      `Cannot retire ${assertionGuid} while a live supersedes relation involves it. Retiring it ` +
        `would leave the other claim's lineage pointing at a tombstone, or leave a claim marked ` +
        `superseded with nothing superseding it. Resolve the supersession first — or retract the ` +
        `claim instead of retiring it, which keeps the lineage readable.`,
    );
    this.name = "SupersessionLineageError";
  }
}

export type RetireAssertionInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  assertionGuid: string;
  /**
   * Why the claim was removed. Carried into `mutation_log`, and for a tombstone it is the only
   * thing left that explains the absence.
   */
  reason: string;
  /** Optimistic concurrency: refuse if the claim moved since the caller read it. */
  expectedVersion?: number;
  idempotencyKey?: string;
};

export type RetireAssertionResult = {
  assertionGuid: string;
  version: number;
  replayed: boolean;
  /** Routing associations retired alongside the claim. */
  associationsRetired: number;
  /** Non-supersession relations retired alongside the claim. */
  relationsRetired: number;
};

export async function retireAssertion(input: RetireAssertionInput): Promise<RetireAssertionResult> {
  assertValidSchemaName(input.schemaName);
  const schema = input.schemaName;

  let version = 0;
  let associationsRetired = 0;
  let relationsRetired = 0;

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "assertion.retire",
    origin: "mcp",
    // Keyed on the claim alone: retiring is terminal, so a second call with a different reason
    // is a retry of the same removal rather than a second one.
    idempotencyKey: input.idempotencyKey ?? `assertion.retire:${input.assertionGuid}`,
    reason: input.reason,
    entity: { entityType: "assertion", entityGuid: input.assertionGuid },
    expectedVersion: input.expectedVersion,
    apply: async (tx) => {
      const current = await loadAssertion(tx, schema, input.workspaceGuid, input.assertionGuid);
      await assertNoLiveSupersession(tx, schema, input.workspaceGuid, input.assertionGuid);

      // The version column moves in step with `record_versions`, which is what `expectedVersion`
      // is actually checked against. A command that writes a snapshot without bumping the column
      // leaves callers reading a number that no longer matches the one their next write is
      // compared to.
      const updated = await tx.query<{ version: number }>(
        `UPDATE "${schema}".assertions
            SET retired_at = now(), version = version + 1
          WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL
        RETURNING version`,
        [input.workspaceGuid, input.assertionGuid],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new AssertionNotFoundError(input.assertionGuid);
      }
      version = row.version;

      // Membership is resolved from record_scopes, not from the assertion row. Leaving these
      // live would keep the tombstone in every route that named its scope, which is the one
      // outcome retiring is for.
      const associations = await tx.query(
        `UPDATE "${schema}".record_scopes
            SET retired_at = now()
          WHERE workspace_guid = $1 AND record_type = 'assertion' AND record_guid = $2
            AND retired_at IS NULL
        RETURNING association_guid`,
        [input.workspaceGuid, input.assertionGuid],
      );
      associationsRetired = associations.rows.length;

      // Supersession is refused above, so what is left here is `contradicts`, `split_from` and
      // `merged_from` — observations about the claim rather than standing conferred on another
      // one. Retiring them is safe in a way retiring a supersedes is not: a surviving conflict
      // against a tombstone would surface a contradiction the reader cannot go and look at.
      const relations = await tx.query(
        `UPDATE "${schema}".assertion_relations
            SET retired_at = now()
          WHERE workspace_guid = $1
            AND (source_assertion_guid = $2 OR target_assertion_guid = $2)
            AND retired_at IS NULL
        RETURNING relation_guid`,
        [input.workspaceGuid, input.assertionGuid],
      );
      relationsRetired = relations.rows.length;

      return {
        // Citations are left as they stand. They are declared immutable by the schema — no
        // retired_at column — and they describe where the text came from, which retiring the
        // claim does not make untrue. They are unreachable once the assertion is a tombstone.
        resultingValue: {
          assertionGuid: input.assertionGuid,
          retired: true,
          kind: current.kind,
          title: current.title,
          status: current.status,
          associationsRetired,
          relationsRetired,
        },
        entryType: "assertion.retired",
        ownerScopeGuid: current.owner_scope_guid,
      };
    },
  });

  if (!command.replayed) {
    return {
      assertionGuid: input.assertionGuid,
      version,
      replayed: false,
      associationsRetired,
      relationsRetired,
    };
  }

  // A replay applied nothing. The claim is already a tombstone, so it cannot be re-read from
  // the live table; the accepted command's own snapshot is the only account of what it did.
  const snapshot = await input.pool.query<{
    version: number;
    payload: { associationsRetired?: number; relationsRetired?: number };
  }>(
    `SELECT version, payload FROM "${schema}".record_versions
      WHERE workspace_guid = $1 AND entity_type = 'assertion' AND entity_guid = $2
      ORDER BY version DESC LIMIT 1`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const row = snapshot.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }
  return {
    assertionGuid: input.assertionGuid,
    version: row.version,
    replayed: true,
    associationsRetired: row.payload.associationsRetired ?? 0,
    relationsRetired: row.payload.relationsRetired ?? 0,
  };
}

async function assertNoLiveSupersession(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  assertionGuid: string,
): Promise<void> {
  const held = await tx.query(
    `SELECT 1 FROM "${schema}".assertion_relations
      WHERE workspace_guid = $1 AND relation_type = 'supersedes' AND retired_at IS NULL
        AND (source_assertion_guid = $2 OR target_assertion_guid = $2)
      LIMIT 1`,
    [workspaceGuid, assertionGuid],
  );
  if (held.rows.length > 0) {
    throw new SupersessionLineageError(assertionGuid);
  }
}

async function loadAssertion(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  assertionGuid: string,
): Promise<{ kind: string; title: string; status: string; owner_scope_guid: string }> {
  const result = await tx.query<{
    kind: string;
    title: string;
    status: string;
    owner_scope_guid: string;
  }>(
    `SELECT kind, title, status, owner_scope_guid FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [workspaceGuid, assertionGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(assertionGuid);
  }
  return row;
}
