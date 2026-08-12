import type { Pool } from "pg";

import type { CommandHandler, CommandTransaction } from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";

/**
 * Changing what a claim stands for (T3, slice 2).
 *
 * Status is deliberately separate from kind: a retracted decision is still a decision. This
 * changes only the standing of the claim, never what it says — editing content is a different
 * command with a different version, so a reader can tell "we no longer stand behind this" apart
 * from "this now says something else".
 *
 * Note for callers: status describes the standing of the *claim*, not the outcome of whatever
 * the claim describes. "We tried X and it failed" is an active fact; filing it as retracted
 * would hide the record that was meant to surface.
 */

export const ASSERTION_STATUSES = ["active", "disputed", "superseded", "retracted"] as const;
export type AssertionStatus = (typeof ASSERTION_STATUSES)[number];

export type SetAssertionStatusInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  assertionGuid: string;
  status: AssertionStatus;
  /** Why the standing changed. Carried into `mutation_log`, where it is the only account of intent. */
  reason: string;
  /** Optimistic concurrency: refuse if the claim moved since the caller read it. */
  expectedVersion?: number;
  idempotencyKey?: string;
};

export type SetAssertionStatusResult = {
  assertionGuid: string;
  status: AssertionStatus;
  previousStatus: AssertionStatus;
  version: number;
  replayed: boolean;
  /**
   * False when the claim already held the requested standing, so nothing was written. A version
   * bump and a `statusChanged` entry for a status that did not change is history describing a
   * change that never happened, and it makes callers reconcile versions that mean nothing.
   */
  changed: boolean;
};

/**
 * Both directions of the design's rule that status and lineage cannot disagree. The coupling in
 * createAssertionRelation only enforces it forwards — recording a supersedes transitions the
 * target — which leaves two ways to break it here: marking a claim superseded when nothing
 * supersedes it, and moving a claim out of superseded while the relation that put it there is
 * still live.
 */
export class SupersededRequiresRelationError extends Error {
  constructor(assertionGuid: string) {
    super(
      `Cannot mark ${assertionGuid} superseded directly. Superseding is a relationship, not a ` +
        `standing: record it with createAssertionRelation(relationType: "supersedes"), which ` +
        `transitions the target in the same command. Setting the status alone would leave a ` +
        `claim that nothing supersedes.`,
    );
    this.name = "SupersededRequiresRelationError";
  }
}

export class SupersededByLiveRelationError extends Error {
  constructor(assertionGuid: string) {
    super(
      `Cannot change the standing of ${assertionGuid} while a live supersedes relation targets ` +
        `it. Retire the relation first, or the claim's status and its lineage would disagree.`,
    );
    this.name = "SupersededByLiveRelationError";
  }
}

export class AssertionNotFoundError extends Error {
  constructor(assertionGuid: string) {
    super(`No live assertion ${assertionGuid} in this workspace.`);
    this.name = "AssertionNotFoundError";
  }
}

export async function setAssertionStatus(
  input: SetAssertionStatusInput,
): Promise<SetAssertionStatusResult> {
  assertValidSchemaName(input.schemaName);

  // Checked before the command opens, because a no-op must not write. Re-read inside apply as
  // well, where the transaction makes it authoritative — this is the cheap path, not the guard.
  const existing = await input.pool.query<{ status: AssertionStatus; version: number }>(
    `SELECT status, version FROM "${input.schemaName}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const held = existing.rows[0];
  if (!held) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }
  if (held.status === input.status) {
    return {
      assertionGuid: input.assertionGuid,
      status: held.status,
      previousStatus: held.status,
      version: held.version,
      replayed: false,
      changed: false,
    };
  }

  let previousStatus: AssertionStatus = "active";
  let version = 0;

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "assertion.setStatus",
    origin: "mcp",
    // Keyed on the target standing rather than the reason text: setting the same claim to the
    // same status twice is a retry. Rewording the reason does not make it a second decision.
    idempotencyKey: input.idempotencyKey ?? `assertion.setStatus:${input.assertionGuid}:${input.status}`,
    reason: input.reason,
    entity: { entityType: "assertion", entityGuid: input.assertionGuid },
    expectedVersion: input.expectedVersion,
    apply: async (tx) => {
      const current = await loadAssertion(tx, input);
      previousStatus = current.status;

      // Superseding is a relationship, not a standing. Allowing it to be set directly would
      // produce a claim marked superseded with no record of what replaced it — the reader's
      // obvious next question, unanswerable.
      if (input.status === "superseded") {
        throw new SupersededRequiresRelationError(input.assertionGuid);
      }

      // And the reverse: moving out of superseded while the relation that put it there is still
      // live would leave lineage asserting a replacement that the status denies.
      if (current.status === "superseded") {
        const held = await tx.query(
          `SELECT 1 FROM "${input.schemaName}".assertion_relations
            WHERE workspace_guid = $1 AND target_assertion_guid = $2
              AND relation_type = 'supersedes' AND retired_at IS NULL
            LIMIT 1`,
          [input.workspaceGuid, input.assertionGuid],
        );
        if (held.rows.length > 0) {
          throw new SupersededByLiveRelationError(input.assertionGuid);
        }
      }

      const updated = await tx.query<{ status: AssertionStatus; version: number }>(
        `UPDATE "${input.schemaName}".assertions
            SET status = $3, version = version + 1
          WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL
        RETURNING status, version`,
        [input.workspaceGuid, input.assertionGuid, input.status],
      );
      // Zero rows means the claim stopped being live between the read above and this write —
      // another transaction retired it. Without this check that surfaces as a TypeError on an
      // undefined row rather than the domain refusal the caller can act on.
      const row = updated.rows[0];
      if (!row) {
        throw new AssertionNotFoundError(input.assertionGuid);
      }
      version = row.version;

      return {
        resultingValue: {
          assertionGuid: input.assertionGuid,
          status: input.status,
          previousStatus,
          title: current.title,
        },
        entryType: "assertion.statusChanged",
        ownerScopeGuid: current.owner_scope_guid,
      };
    },
  });

  if (!command.replayed) {
    return {
      assertionGuid: input.assertionGuid,
      status: input.status,
      previousStatus,
      version,
      replayed: false,
      changed: true,
    };
  }

  // A replay applied nothing, so the values above were never written. Read the claim as it
  // actually stands rather than echoing what this call would have done.
  const settled = await input.pool.query<{ status: AssertionStatus; version: number }>(
    // Same liveness filter as the write path: a retired claim returned here would look live to
    // a caller that only ever sees this branch, and contradicts what AssertionNotFoundError says.
    `SELECT status, version FROM "${input.schemaName}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const row = settled.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }

  // The original command's own record of what it changed. Reporting the current status as
  // `previousStatus` would tell the caller nothing moved, which is the one thing a replay must
  // not imply — the change did happen, just not on this call.
  const original = await input.pool.query<{ resulting_value: { previousStatus?: AssertionStatus } }>(
    `SELECT resulting_value FROM "${input.schemaName}".mutation_log
      WHERE workspace_guid = $1 AND command_guid = $2 AND entry_type = 'assertion.statusChanged'
      LIMIT 1`,
    // The handler returns the *original* command's guid on a replay, which is the one whose
    // mutation_log entry recorded the transition.
    [input.workspaceGuid, command.commandGuid],
  );

  return {
    assertionGuid: input.assertionGuid,
    status: row.status,
    previousStatus: original.rows[0]?.resulting_value?.previousStatus ?? row.status,
    version: row.version,
    replayed: true,
    changed: true,
  };
}

async function loadAssertion(
  tx: CommandTransaction,
  input: SetAssertionStatusInput,
): Promise<{ status: AssertionStatus; title: string; owner_scope_guid: string }> {
  const result = await tx.query<{ status: AssertionStatus; title: string; owner_scope_guid: string }>(
    `SELECT status, title, owner_scope_guid FROM "${input.schemaName}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }
  return row;
}
