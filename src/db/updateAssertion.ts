import type { Pool } from "pg";

import { ASSERTION_KINDS, type AssertionKind } from "./createAssertion.js";
import { type CommandHandler, type CommandTransaction } from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";

/**
 * Editing what a claim says (T3).
 *
 * Deliberately separate from `setAssertionStatus`, which changes only standing. A reader has to
 * be able to tell "we no longer stand behind this" from "this now says something else", and
 * collapsing them into one command makes the history unable to answer that.
 *
 * Citations are not touched. A citation records the source text a claim was drawn from, and
 * rewording the claim does not change where it came from — `selected_content_hash` still
 * describes the block, not the assertion. A citation that no longer supports the revised wording
 * is a judgement for the author, expressed by adding or retiring one, not a side effect of an
 * edit.
 */

export class AssertionNotFoundError extends Error {
  constructor(assertionGuid: string) {
    super(`No live assertion ${assertionGuid} in this workspace.`);
    this.name = "AssertionNotFoundError";
  }
}

export class NoAssertionChangesError extends Error {
  constructor(assertionGuid: string) {
    super(
      `updateAssertion for ${assertionGuid} was given no fields to change. A version bump and a ` +
        `history entry describing an edit that did not happen makes the record less trustworthy, ` +
        `not more.`,
    );
    this.name = "NoAssertionChangesError";
  }
}

export type UpdateAssertionInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  assertionGuid: string;
  /** Any subset. Fields left undefined keep their current value. */
  title?: string;
  content?: string;
  kind?: AssertionKind;
  /** Why the claim changed. Carried into `mutation_log`, where it is the only account of intent. */
  reason: string;
  /** Optimistic concurrency: refuse if the claim moved since the caller read it. */
  expectedVersion?: number;
  idempotencyKey?: string;
};

/** The fields an edit may touch. Status is not among them — that is setAssertionStatus. */
const EDITABLE_FIELDS = ["title", "content", "kind"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export type UpdateAssertionResult = {
  assertionGuid: string;
  version: number;
  replayed: boolean;
  /** Which fields this call actually changed, in the order they are declared above. */
  changed: EditableField[];
};

type AssertionRow = {
  kind: AssertionKind;
  title: string;
  content: string;
  version: number;
  owner_scope_guid: string;
};

export async function updateAssertion(input: UpdateAssertionInput): Promise<UpdateAssertionResult> {
  assertValidSchemaName(input.schemaName);
  const schema = input.schemaName;

  if (input.title === undefined && input.content === undefined && input.kind === undefined) {
    throw new NoAssertionChangesError(input.assertionGuid);
  }
  if (input.kind !== undefined && !ASSERTION_KINDS.includes(input.kind)) {
    throw new Error(
      `Unknown assertion kind ${JSON.stringify(input.kind)}. Expected one of ${ASSERTION_KINDS.join(", ")}.`,
    );
  }

  let version = 0;
  let changed: EditableField[] = [];

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "assertion.update",
    origin: "mcp",
    // Keyed on the target values rather than on the reason: setting a claim to the same wording
    // twice is a retry, and rewording the justification does not make it a second edit.
    idempotencyKey:
      input.idempotencyKey ??
      `assertion.update:${input.assertionGuid}:${JSON.stringify([input.title, input.content, input.kind])}`,
    reason: input.reason,
    entity: { entityType: "assertion", entityGuid: input.assertionGuid },
    expectedVersion: input.expectedVersion,
    apply: async (tx) => {
      const current = await loadAssertion(tx, schema, input.workspaceGuid, input.assertionGuid);

      const next = {
        title: input.title ?? current.title,
        content: input.content ?? current.content,
        kind: input.kind ?? current.kind,
      };
      // Compared against what is stored, not against what was supplied. A caller that resends the
      // current wording has changed nothing, and recording an edit there would put a version bump
      // in the history with no difference behind it.
      changed = EDITABLE_FIELDS.filter((field) => next[field] !== current[field]);
      if (changed.length === 0) {
        throw new NoAssertionChangesError(input.assertionGuid);
      }
      // Carried inside resultingValue because the handler has no separate prior-value slot, and
      // a version snapshot that records only the new wording leaves a reader unable to say what
      // an edit actually did without diffing two snapshots by hand.
      const previous = Object.fromEntries(changed.map((field) => [field, current[field]]));

      const updated = await tx.query<{ version: number }>(
        `UPDATE "${schema}".assertions
            SET title = $3, content = $4, kind = $5, version = version + 1
          WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL
        RETURNING version`,
        [input.workspaceGuid, input.assertionGuid, next.title, next.content, next.kind],
      );
      // Zero rows means the claim stopped being live between the read above and this write.
      // Without this it surfaces as a TypeError rather than the refusal a caller can act on.
      const row = updated.rows[0];
      if (!row) {
        throw new AssertionNotFoundError(input.assertionGuid);
      }
      version = row.version;

      return {
        resultingValue: { assertionGuid: input.assertionGuid, ...next, changed, previous },
        entryType: "assertion.updated",
        ownerScopeGuid: current.owner_scope_guid,
      };
    },
  });

  if (!command.replayed) {
    return { assertionGuid: input.assertionGuid, version, replayed: false, changed };
  }

  // A replay applied nothing, so the values above were never written. Read the claim as it
  // actually stands rather than echoing what this call would have done.
  const settled = await input.pool.query<{ version: number }>(
    `SELECT version FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const row = settled.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }
  return { assertionGuid: input.assertionGuid, version: row.version, replayed: true, changed: [] };
}

/**
 * The cheap path, not the guard. Its liveness filter is redundant with the one on the UPDATE
 * below, which is inside the same transaction and is what actually refuses an edit to a
 * tombstone. It stays because it fails with a name rather than a zero-row TypeError.
 */
async function loadAssertion(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  assertionGuid: string,
): Promise<AssertionRow> {
  const result = await tx.query<AssertionRow>(
    `SELECT kind, title, content, version, owner_scope_guid FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [workspaceGuid, assertionGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(assertionGuid);
  }
  return row;
}
