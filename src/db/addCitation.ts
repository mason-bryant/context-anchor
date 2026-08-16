import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";

import {
  BlockNotFoundError,
  CITATION_PARSER_VERSION,
  CITATION_RELATIONS,
  type CitationInput,
  QuoteNotFoundError,
} from "./createAssertion.js";
import {
  IdempotencyKeyReusedError,
  type CommandHandler,
  type CommandTransaction,
} from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";
import { loadCitableBlock } from "./citableBlock.js";

/**
 * Binding an existing claim to a second piece of source text (T3).
 *
 * `createAssertion` requires one citation, because a claim authored with no provenance is the
 * thing this store exists not to hold. This is for everything after that: the same claim
 * evidenced in a second document, a source that disputes it, a re-anchor after the text moved.
 *
 * Additive only. `source_citations` has no `retired_at` — the schema declares citations
 * immutable, and a citation that turned out to be wrong is corrected by adding the right one
 * and letting `reanchored_from_citation_guid` carry the chain, not by deleting the record of
 * what was once believed.
 */

export class AssertionNotFoundError extends Error {
  constructor(assertionGuid: string) {
    super(`No live assertion ${assertionGuid} in this workspace.`);
    this.name = "AssertionNotFoundError";
  }
}

export class ReanchorSourceNotFoundError extends Error {
  constructor(citationGuid: string, assertionGuid: string) {
    super(
      `Citation ${citationGuid} is not a citation of assertion ${assertionGuid}, so this citation ` +
        `cannot be recorded as re-anchoring it. A re-anchor chain that crosses claims describes a ` +
        `history that did not happen.`,
    );
    this.name = "ReanchorSourceNotFoundError";
  }
}

export type AddCitationInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  assertionGuid: string;
  citation: CitationInput;
  /**
   * Set when this citation replaces one whose source moved. The named citation stays; this
   * records that the two are the same provenance re-found, rather than two independent sources.
   */
  reanchoredFromCitationGuid?: string;
  /** Why the evidence was added. Carried into `mutation_log`. */
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

export type AddCitationResult = {
  citationGuid: string;
  assertionGuid: string;
  version: number;
  replayed: boolean;
  /**
   * Whether the claim is a tombstone now — not whether it was one when this command ran.
   *
   * Only ever true on a replay. The derived key is content-addressed, so "already accepted" means
   * this quote on this block, ever, by anyone: a caller can be told their citation is in place
   * without having written it, on a claim that has since been retired. Refusing would deny a
   * write that did happen; saying nothing would leave them believing a tombstone carries their
   * evidence.
   */
  assertionRetired: boolean;
};

export async function addCitation(input: AddCitationInput): Promise<AddCitationResult> {
  assertValidSchemaName(input.schemaName);
  const schema = input.schemaName;
  const relation = input.citation.relation ?? "supports";

  if (!CITATION_RELATIONS.includes(relation)) {
    throw new Error(
      `Unknown citation relation ${JSON.stringify(relation)}. Expected one of ${CITATION_RELATIONS.join(", ")}.`,
    );
  }

  const citationGuid = randomUUID();
  let version = 0;

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "assertion.addCitation",
    origin: "mcp",
    // Content-keyed like createAssertion: citing the same quote in the same block for the same
    // claim twice is a retry. Every field that makes one citation different from another is in
    // the digest, because a field left out is a write this command will silently drop — a
    // resubmission that adds the re-anchor source, or the prefix and suffix that let a quote be
    // re-found after the text moves, would otherwise match the earlier key and never land.
    idempotencyKey:
      input.idempotencyKey ??
      `assertion.addCitation:${input.assertionGuid}:${createHash("sha256")
        .update(
          [
            input.citation.blockGuid,
            input.citation.exactQuote,
            relation,
            input.citation.prefix ?? "",
            input.citation.suffix ?? "",
            input.reanchoredFromCitationGuid ?? "",
          ].join("\u0000"),
        )
        .digest("hex")}`,
    reason: input.reason,
    entity: { entityType: "assertion", entityGuid: input.assertionGuid },
    expectedVersion: input.expectedVersion,
    apply: async (tx) => {
      const claim = await loadAssertion(tx, schema, input.workspaceGuid, input.assertionGuid);
      const block = await loadBlock(tx, schema, input.workspaceGuid, input.citation.blockGuid);

      if (input.reanchoredFromCitationGuid !== undefined) {
        await assertCitesSameAssertion(
          tx,
          schema,
          input.workspaceGuid,
          input.reanchoredFromCitationGuid,
          input.assertionGuid,
        );
      }

      // Verified before writing, exactly as createAssertion does: a citation whose quote is not
      // in the block can never be re-anchored, so it is not provenance — it is a claim about
      // provenance.
      const quoteOffset = block.raw_content.indexOf(input.citation.exactQuote);
      if (input.citation.exactQuote.length === 0 || quoteOffset === -1) {
        throw new QuoteNotFoundError(input.citation.blockGuid);
      }

      await tx.query(
        `INSERT INTO "${schema}".source_citations
           (workspace_guid, citation_guid, assertion_guid, block_guid, relation, exact_quote,
            prefix, suffix, start_offset, end_offset, selected_content_hash, parser_version,
            reanchored_from_citation_guid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          input.workspaceGuid,
          citationGuid,
          input.assertionGuid,
          input.citation.blockGuid,
          relation,
          input.citation.exactQuote,
          input.citation.prefix ?? null,
          input.citation.suffix ?? null,
          quoteOffset,
          quoteOffset + input.citation.exactQuote.length,
          createHash("sha256").update(block.raw_content).digest("hex"),
          CITATION_PARSER_VERSION,
          input.reanchoredFromCitationGuid ?? null,
        ],
      );

      // The assertion row is not otherwise touched, but its version still moves. `version` is
      // kept in step with `record_versions`, which is what `expectedVersion` is compared
      // against; a snapshot written without bumping the column would leave every later caller
      // reading a number that no longer matches the one their write is checked on.
      const updated = await tx.query<{ version: number }>(
        `UPDATE "${schema}".assertions
            SET version = version + 1
          WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL
        RETURNING version`,
        [input.workspaceGuid, input.assertionGuid],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new AssertionNotFoundError(input.assertionGuid);
      }
      version = row.version;

      return {
        // The claim's own fields lead, because this payload is the assertion's version snapshot
        // and the handler feeds each snapshot forward as the next command's `prior_value` — which
        // listScopeChanges serves verbatim. A payload carrying only citation fields makes the
        // "before" of the next edit read as a citation record.
        resultingValue: {
          assertionGuid: input.assertionGuid,
          kind: claim.kind,
          title: claim.title,
          content: claim.content,
          status: claim.status,
          citationGuid,
          blockGuid: input.citation.blockGuid,
          relation,
          exactQuote: input.citation.exactQuote,
          reanchoredFromCitationGuid: input.reanchoredFromCitationGuid ?? null,
        },
        entryType: "assertion.citationAdded",
        ownerScopeGuid: claim.owner_scope_guid,
      };
    },
  });

  if (!command.replayed) {
    return {
      citationGuid,
      assertionGuid: input.assertionGuid,
      version,
      replayed: false,
      assertionRetired: false,
    };
  }

  // A replay applied nothing, so the GUID minted above was never written. Return the citation
  // the accepted command actually recorded rather than an identifier for a row that does not
  // exist.
  // Matched on the entry type, not merely on the entity or the command guid. Idempotency keys
  // are compared on (workspace, key) alone, so a caller reusing one key across a batch lands
  // here holding another command's acceptance — and createAssertion's snapshot for this same
  // assertion also carries a `citationGuid`, so a payload-shape check would hand back the
  // creation's citation and report a citation that was never added.
  const snapshot = await input.pool.query<{
    version: number;
    payload: { citationGuid?: string };
  }>(
    `SELECT v.version, v.payload
       FROM "${schema}".record_versions v
       JOIN "${schema}".mutation_log m
         ON m.workspace_guid = v.workspace_guid AND m.command_guid = v.command_guid
        AND m.entry_type = 'assertion.citationAdded'
      WHERE v.workspace_guid = $1 AND v.entity_type = 'assertion' AND v.entity_guid = $2
        AND v.command_guid = $3`,
    [input.workspaceGuid, input.assertionGuid, command.commandGuid],
  );
  const row = snapshot.rows[0];
  if (!row?.payload.citationGuid) {
    // The key was accepted for some other command, so no citation was added under it. Reporting
    // the claim as missing would send the caller to author a duplicate.
    throw new IdempotencyKeyReusedError("assertion.addCitation", `assertion ${input.assertionGuid}`);
  }
  // The claim as it stands, not as it stood when the citation was added. The snapshot's version
  // is a fact about that command; a caller feeding it back as expectedVersion after any later
  // edit would be refused for a conflict that is only an artefact of what this returned.
  //
  // Deliberately not filtered to live claims. A tombstoned claim keeps its row, and this citation
  // did land — refusing the redelivery with "no live assertion" would deny a write that happened
  // and send the caller to add it again. What the claim's standing is now is a separate question
  // from what this command did.
  const settled = await input.pool.query<{ version: number; retired_at: Date | null }>(
    `SELECT version, retired_at FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2`,
    [input.workspaceGuid, input.assertionGuid],
  );
  const current = settled.rows[0];
  if (!current) {
    throw new AssertionNotFoundError(input.assertionGuid);
  }

  return {
    citationGuid: row.payload.citationGuid,
    assertionGuid: input.assertionGuid,
    version: current.version,
    replayed: true,
    assertionRetired: current.retired_at !== null,
  };
}

async function assertCitesSameAssertion(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  citationGuid: string,
  assertionGuid: string,
): Promise<void> {
  const result = await tx.query(
    `SELECT 1 FROM "${schema}".source_citations
      WHERE workspace_guid = $1 AND citation_guid = $2 AND assertion_guid = $3`,
    [workspaceGuid, citationGuid, assertionGuid],
  );
  if (result.rows.length === 0) {
    throw new ReanchorSourceNotFoundError(citationGuid, assertionGuid);
  }
}

/**
 * The cheap path, not the guard. The liveness filter here is redundant with the one on the
 * version bump, which is inside the same transaction and is what actually refuses: drop this
 * filter alone and citing a tombstone still fails, drop both and a citation attaches to one.
 * It stays because it fails early with a name the caller can act on, before the insert.
 */
async function loadAssertion(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  assertionGuid: string,
): Promise<{ owner_scope_guid: string; kind: string; title: string; content: string; status: string }> {
  const result = await tx.query<{
    owner_scope_guid: string;
    kind: string;
    title: string;
    content: string;
    status: string;
  }>(
    `SELECT owner_scope_guid, kind, title, content, status FROM "${schema}".assertions
      WHERE workspace_guid = $1 AND assertion_guid = $2 AND retired_at IS NULL`,
    [workspaceGuid, assertionGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AssertionNotFoundError(assertionGuid);
  }
  return row;
}

async function loadBlock(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  blockGuid: string,
): Promise<{ raw_content: string }> {
  // Shared with createAssertion. This surface had no revision or retirement guard at all, so a
  // citation added to an existing claim could name text the pinned commit no longer contains --
  // the contract the other surface enforces, silently absent here.
  return loadCitableBlock(tx, schema, workspaceGuid, blockGuid, (guid) => new BlockNotFoundError(guid));
}
