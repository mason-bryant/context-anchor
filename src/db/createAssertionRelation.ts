import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { CommandHandler, CommandTransaction } from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";
import { AssertionNotFoundError } from "./setAssertionStatus.js";

/**
 * Conflict and lineage between claims (T3, slice 2).
 *
 * These relations are what make a contradiction surface even when the two records are routed
 * separately — the case the file-backed system could not represent at all, because a claim's
 * only relationship was the document it happened to sit in.
 *
 * Recording `supersedes` also transitions the target to `superseded` in the same command. That
 * coupling is a design rule rather than a convenience: status and lineage cannot disagree. A
 * superseding claim whose target still reads `active` would put two live answers in front of a
 * reader with nothing to say which one won, and the two writes landing separately would leave a
 * window where exactly that is true.
 */

export const RELATION_TYPES = ["contradicts", "supersedes", "split_from", "merged_from"] as const;
export type AssertionRelationType = (typeof RELATION_TYPES)[number];

export type CreateAssertionRelationInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  sourceAssertionGuid: string;
  targetAssertionGuid: string;
  relationType: AssertionRelationType;
  /** Why the two relate. Carried into `mutation_log` and shown beside the conflict. */
  rationale?: string;
  idempotencyKey?: string;
};

export type CreateAssertionRelationResult = {
  relationGuid: string;
  relationType: AssertionRelationType;
  /** Set when the relation transitioned the target's standing, so the caller sees the coupled write. */
  targetStatus?: "superseded";
  replayed: boolean;
};

export class SelfRelationError extends Error {
  constructor(assertionGuid: string) {
    super(
      `An assertion cannot relate to itself (${assertionGuid}). A self-relation makes lineage ` +
        `cyclic on a single row and states nothing a reader can act on.`,
    );
    this.name = "SelfRelationError";
  }
}

export class CrossScopeRelationError extends Error {
  constructor() {
    super(
      `Both assertions must be readable under the same owning scope to relate them. Relating ` +
        `across scopes would let a caller infer the existence of a claim it cannot read.`,
    );
    this.name = "CrossScopeRelationError";
  }
}

export async function createAssertionRelation(
  input: CreateAssertionRelationInput,
): Promise<CreateAssertionRelationResult> {
  assertValidSchemaName(input.schemaName);
  const schema = input.schemaName;
  const relationGuid = randomUUID();

  // Refused before the command opens rather than by the table's CHECK: the constraint would
  // surface as a database error, and this is caller error with a specific remedy.
  if (input.sourceAssertionGuid === input.targetAssertionGuid) {
    throw new SelfRelationError(input.sourceAssertionGuid);
  }

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "assertion.relate",
    origin: "mcp",
    // One live relation of a given type between a given pair, matching the table's partial
    // unique index: recording "contradicts" twice is not two conflicts.
    idempotencyKey:
      input.idempotencyKey ??
      `assertion.relate:${input.relationType}:${input.sourceAssertionGuid}:${input.targetAssertionGuid}`,
    reason: input.rationale ?? `record ${input.relationType}`,
    entity: { entityType: "assertion_relation", entityGuid: relationGuid },
    apply: async (tx) => {
      const source = await loadAssertion(tx, schema, input.workspaceGuid, input.sourceAssertionGuid);
      const target = await loadAssertion(tx, schema, input.workspaceGuid, input.targetAssertionGuid);

      // The relation is owned by the source's scope, so a reader who cannot see that scope
      // cannot see the relation. Relating across scopes would leak the target's existence.
      if (source.owner_scope_guid !== target.owner_scope_guid) {
        throw new CrossScopeRelationError();
      }

      await tx.query(
        `INSERT INTO "${schema}".assertion_relations
           (workspace_guid, relation_guid, owner_scope_guid, source_assertion_guid,
            target_assertion_guid, relation_type, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.workspaceGuid,
          relationGuid,
          source.owner_scope_guid,
          input.sourceAssertionGuid,
          input.targetAssertionGuid,
          input.relationType,
          input.rationale ?? null,
        ],
      );

      // Status and lineage cannot disagree, and they cannot disagree *transiently* either —
      // which is why this is the same transaction rather than a second command.
      if (input.relationType === "supersedes") {
        await tx.query(
          `UPDATE "${schema}".assertions
              SET status = 'superseded', version = version + 1
            WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
          [input.workspaceGuid, input.targetAssertionGuid],
        );
      }

      return {
        resultingValue: {
          relationGuid,
          relationType: input.relationType,
          sourceAssertionGuid: input.sourceAssertionGuid,
          targetAssertionGuid: input.targetAssertionGuid,
          targetStatus: input.relationType === "supersedes" ? "superseded" : target.status,
        },
        entryType: "assertion.related",
        ownerScopeGuid: source.owner_scope_guid,
      };
    },
  });

  const targetStatus = input.relationType === "supersedes" ? ("superseded" as const) : undefined;

  if (!command.replayed) {
    return { relationGuid, relationType: input.relationType, targetStatus, replayed: false };
  }

  // A replay minted no row, so the GUID above names nothing. Return the relation that actually
  // exists rather than an identifier that will fail the first time something dereferences it.
  const existing = await input.pool.query<{ relation_guid: string }>(
    `SELECT relation_guid FROM "${schema}".assertion_relations
      WHERE workspace_guid = $1 AND source_assertion_guid = $2 AND target_assertion_guid = $3
        AND relation_type = $4 AND retired_at IS NULL
      LIMIT 1`,
    [input.workspaceGuid, input.sourceAssertionGuid, input.targetAssertionGuid, input.relationType],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error(
      `Command for ${input.relationType} was already accepted, but no live relation from it remains.`,
    );
  }
  return { relationGuid: row.relation_guid, relationType: input.relationType, targetStatus, replayed: true };
}

async function loadAssertion(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  assertionGuid: string,
): Promise<{ owner_scope_guid: string; status: string }> {
  const result = await tx.query<{ owner_scope_guid: string; status: string }>(
    `SELECT owner_scope_guid, status FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [workspaceGuid, assertionGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(assertionGuid);
  }
  return row;
}
