import type { Pool } from "pg";

import {
  IdempotencyKeyReusedError,
  type CommandHandler,
  type CommandTransaction,
} from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";

/**
 * Tombstoning a claim (T3).
 *
 * Distinct from `setAssertionStatus("retracted")`, but be precise about how. Neither is
 * returned by retrieval: both routing queries in selectRoutes.ts filter `status = 'active'`,
 * so a retracted claim is exactly as invisible to a reader as a tombstone. The difference is
 * what survives and what can still be done.
 *
 * Retracted is reversible and keeps its record intact: the row, its citations, its relations
 * and its scope associations all stay live, and setAssertionStatus can return it to active — at
 * which point retrieval serves it again. Nothing today fetches a non-active claim, so while it
 * is retracted it is reachable only through history; what retraction preserves is the ability to
 * bring it back, not a way to read it meanwhile.
 *
 * Retiring is terminal. It retires the scope associations and the non-supersession relations
 * with the claim, and no command reinstates any of them. It is for records that should not be
 * in the workspace at all — an import artefact, a duplicate, a claim authored against the
 * wrong scope — not for claims that turned out to be wrong.
 *
 * Prefer retraction for a claim that was wrong, because it is undoable and this is not.
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
        `superseded with nothing superseding it. There is no way round this today: this command ` +
        `retires the relations it finds, but it refuses before reaching them, and nothing else ` +
        `retires a supersedes — so a supersession recorded in error locks both of its claims out ` +
        `of retirement permanently. Retract the claim instead — it is equally invisible to ` +
        `retrieval, and it leaves the lineage intact and reversible.`,
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
  /**
   * Optimistic concurrency: refuse if the claim moved since the caller read it.
   *
   * Not re-checked on a replay: the handler returns before the check once a key has been
   * accepted, and a retry carries the version the caller read before the first attempt — which
   * that attempt has since moved past — so checking it would fail every successful retry.
   */
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
  // Identities, not counts. `mutation_log` is the only account of what a tombstone took with
  // it, and "one relation disappeared" cannot answer which conflict stopped being visible.
  let retiredAssociations: string[] = [];
  let retiredRelations: string[] = [];

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

      // Not what stops the claim being served — retrieval filters the assertion row itself, so
      // the tombstone is already excluded whether these are retired or not. They are retired
      // because an association pointing at a tombstone is a row asserting a membership that no
      // longer has a member, and every later reader of record_scopes would have to know to
      // discount it.
      const associations = await tx.query<{ association_guid: string }>(
        `UPDATE "${schema}".record_scopes
            SET retired_at = now()
          WHERE workspace_guid = $1 AND record_type = 'assertion' AND record_guid = $2
            AND retired_at IS NULL
        RETURNING association_guid`,
        [input.workspaceGuid, input.assertionGuid],
      );
      retiredAssociations = associations.rows.map((row) => row.association_guid);

      // Supersession is refused above, so what is left here is `contradicts`, `split_from` and
      // `merged_from` — observations about the claim rather than standing conferred on another
      // one. Retiring them is safe in a way retiring a supersedes is not: a surviving conflict
      // against a tombstone would surface a contradiction the reader cannot go and look at.
      const relations = await tx.query<{ relation_guid: string }>(
        `UPDATE "${schema}".assertion_relations
            SET retired_at = now()
          WHERE workspace_guid = $1
            AND (source_assertion_guid = $2 OR target_assertion_guid = $2)
            AND retired_at IS NULL
        RETURNING relation_guid`,
        [input.workspaceGuid, input.assertionGuid],
      );
      retiredRelations = relations.rows.map((row) => row.relation_guid);

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
          retiredAssociations,
          retiredRelations,
          associationsRetired: retiredAssociations.length,
          relationsRetired: retiredRelations.length,
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
      associationsRetired: retiredAssociations.length,
      relationsRetired: retiredRelations.length,
    };
  }

  // A replay applied nothing. The claim is already a tombstone, so it cannot be re-read from
  // the live table; the accepted command's own snapshot is the only account of what it did.
  // Matched on what the command actually did, not merely on which entity it touched.
  // Idempotency keys are compared on (workspace, key) alone — not on command type — so a caller
  // that reuses one key across a batch lands here holding some *other* command's acceptance.
  // That other command wrote a snapshot for this same assertion under this same command guid,
  // so filtering on the entity or on the command guid both still find a row: the only thing
  // that separates them is the entry type. Without this a reused key reports a claim as removed
  // while it is live and still routing.
  const snapshot = await input.pool.query<{
    version: number;
    payload: { associationsRetired?: number; relationsRetired?: number };
  }>(
    `SELECT v.version, v.payload
       FROM "${schema}".record_versions v
       JOIN "${schema}".mutation_log m
         ON m.workspace_guid = v.workspace_guid AND m.command_guid = v.command_guid
        AND m.entry_type = 'assertion.retired'
      WHERE v.workspace_guid = $1 AND v.entity_type = 'assertion' AND v.entity_guid = $2
        AND v.command_guid = $3`,
    [input.workspaceGuid, input.assertionGuid, command.commandGuid],
  );
  const row = snapshot.rows[0];
  if (!row) {
    // The key was accepted for some other command, so this retire did not happen. "No such
    // assertion" would be the wrong account of that — an agent told the claim is gone authors a
    // duplicate — and this command cannot say what state the claim is in either, because the
    // command that spent the key may have been a retire of its own.
    throw new IdempotencyKeyReusedError("assertion.retire", input.assertionGuid);
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
  // FOR UPDATE, and it is not decoration. The supersession check below reads
  // assertion_relations, and nothing stops a relate from inserting a row there after that read
  // — the target direction happens to be caught, because superseding UPDATEs the target and so
  // collides on the record_versions primary key, but the *source* direction touches no row this
  // command writes. Without a lock both could commit, leaving a tombstone as the live source of
  // a supersedes and the claim it replaced marked superseded with nothing superseding it.
  // createAssertionRelation takes the same lock on both of its endpoints, so one of the two
  // waits and then sees the other's work.
  const result = await tx.query<{
    kind: string;
    title: string;
    status: string;
    owner_scope_guid: string;
  }>(
    `SELECT kind, title, status, owner_scope_guid FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL
        FOR UPDATE`,
    [workspaceGuid, assertionGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(assertionGuid);
  }
  return row;
}
