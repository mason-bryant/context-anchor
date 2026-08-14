import { createHash } from "node:crypto";
import type { Pool } from "pg";

import { ASSERTION_KINDS, type AssertionKind } from "./createAssertion.js";
import {
  IdempotencyKeyReusedError,
  type CommandHandler,
  type CommandTransaction,
} from "./commandHandler.js";
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

/**
 * A resubmitted edit whose earlier application has since been overwritten.
 *
 * Not a concurrency error: nothing raced. The *derived* idempotency key is a function of the
 * target values, so re-applying wording this claim has held before matches the original command
 * and is treated as a retry of it. Silently reporting success there would tell a caller their
 * edit landed when the claim still holds someone else's.
 *
 * Raised only when the key was derived. A caller that supplied its own key is asserting "this is
 * one command, delivered at most once", and an at-most-once redelivery is exactly what an
 * explicit key is for — refusing it there would break the guarantee it was given for.
 */
export class StaleIdempotentEditError extends Error {
  constructor(assertionGuid: string, fields: readonly string[]) {
    super(
      `This edit to ${assertionGuid} matches an earlier command with the same derived ` +
        `idempotency key, but ${fields.join(" and ")} ${fields.length === 1 ? "does" : "do"} not ` +
        `hold the requested value — a later edit replaced it. Nothing was written. Supply an ` +
        `explicit idempotencyKey to re-apply this wording as a new edit.`,
    );
    this.name = "StaleIdempotentEditError";
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
  /**
   * Optimistic concurrency: refuse if the claim moved since the caller read it.
   *
   * Not re-checked on a replay. The handler returns before the check when a key has already been
   * accepted, and that is the right behaviour rather than an oversight: a retry carries the
   * version the caller read *before* the first attempt, which the first attempt itself has since
   * moved past, so checking it would fail every successful retry.
   */
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
    //
    // Hashed, not embedded. `commands.idempotency_key` is btree-indexed, and `content` is
    // unbounded caller data — a long enough claim would fail at write time on the index entry
    // size rather than on anything about the edit. createAssertion and addCitation hash for the
    // same reason.
    idempotencyKey:
      input.idempotencyKey ??
      `assertion.update:${input.assertionGuid}:${createHash("sha256")
        .update(JSON.stringify([input.title ?? null, input.content ?? null, input.kind ?? null]))
        .digest("hex")}`,
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

  // What the accepted command actually did, matched on the entry type. Idempotency keys are
  // compared on (workspace, key) alone — not on command type — so a caller reusing one key
  // across a batch lands here holding an unrelated acceptance. Value comparison cannot separate
  // that from a legitimate redelivery whose effect a later edit overwrote: both leave the
  // requested wording absent. This can.
  const applied = await input.pool.query(
    `SELECT 1 FROM "${schema}".mutation_log
      WHERE workspace_guid = $1 AND command_guid = $2 AND entry_type = 'assertion.updated'
      LIMIT 1`,
    [input.workspaceGuid, command.commandGuid],
  );
  if (applied.rows.length === 0) {
    throw new IdempotencyKeyReusedError("assertion.update", input.assertionGuid);
  }

  // A replay applied nothing, so the values above were never written. Read the claim as it
  // actually stands rather than echoing what this call would have done.
  const settled = await input.pool.query<AssertionRow>(
    `SELECT kind, title, content, version, owner_scope_guid FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const row = settled.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }

  // The key is content-addressed, which means it says "this wording, ever" — not "this wording,
  // now". Edit to B, edit back to A, then edit to B again and the third call matches the first
  // and applies nothing, leaving the claim on A while the caller is told it succeeded.
  //
  // The stored values are what settle it. If every field this call named is already in place,
  // the earlier command's effect stands and this genuinely is a retry. If any differs, a later
  // edit overwrote it, and returning success here would report a change that is not there.
  // Only for the derived key. An explicit key is the caller stating "this is one command,
  // delivered at most once"; a redelivery arriving after someone else's edit is precisely what
  // that guarantee covers, and refusing it would break the promise the key was given for.
  if (input.idempotencyKey === undefined) {
    const notApplied = EDITABLE_FIELDS.filter(
      (field) => input[field] !== undefined && input[field] !== row[field],
    );
    if (notApplied.length > 0) {
      throw new StaleIdempotentEditError(input.assertionGuid, notApplied);
    }
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
