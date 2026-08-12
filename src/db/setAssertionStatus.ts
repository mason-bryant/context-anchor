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
};

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

      const updated = await tx.query<{ status: AssertionStatus; version: number }>(
        `UPDATE "${input.schemaName}".assertions
            SET status = $3, version = version + 1
          WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL
        RETURNING status, version`,
        [input.workspaceGuid, input.assertionGuid, input.status],
      );
      version = updated.rows[0]!.version;

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
    return { assertionGuid: input.assertionGuid, status: input.status, previousStatus, version, replayed: false };
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
  return {
    assertionGuid: input.assertionGuid,
    status: row.status,
    previousStatus: row.status,
    version: row.version,
    replayed: true,
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
