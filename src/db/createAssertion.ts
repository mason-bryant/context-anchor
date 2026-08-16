import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  IdempotencyKeyReusedError,
  type CommandHandler,
  type CommandTransaction,
} from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";
// Re-exported: callers and tests have imported StaleBlockError from this module since it landed.
export { StaleBlockError } from "./citableBlock.js";
import { loadCitableBlock } from "./citableBlock.js";

/**
 * Authoring with provenance (T3).
 *
 * One command writes the assertion, its first `record_versions` snapshot, the citation with
 * W3C quote and position selectors, the routing association, and a `mutation_log` entry, in
 * a single transaction. A failed command writes nothing — an assertion without its citation
 * is exactly the unprovenanced claim this system exists to avoid.
 */

export const ASSERTION_KINDS = [
  "fact",
  "inference",
  "definition",
  "requirement",
  "decision",
  "invariant",
  "goal",
  "hypothesis",
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const CITATION_RELATIONS = ["supports", "disputes", "mentions"] as const;
export type CitationRelation = (typeof CITATION_RELATIONS)[number];

export type CitationInput = {
  blockGuid: string;
  exactQuote: string;
  /** Surrounding text, so the quote can be re-found when offsets shift. */
  prefix?: string;
  suffix?: string;
  relation?: CitationRelation;
};

export type CreateAssertionInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  scopeSlug: string;
  kind: AssertionKind;
  title: string;
  content: string;
  citation: CitationInput;
  /** Caller-supplied so a retried request is not authored twice. */
  idempotencyKey?: string;
};

export type CreateAssertionResult = {
  assertionGuid: string;
  citationGuid: string;
  version: number;
  scopeGuid: string;
  /** True when this call replayed an already-accepted command and wrote nothing. */
  replayed: boolean;
};

export class QuoteNotFoundError extends Error {
  constructor(blockGuid: string) {
    super(
      `The quoted text does not appear in block ${blockGuid}. A citation must point at text that ` +
        `actually exists in the source, or it cannot be re-found when the source moves.`,
    );
    this.name = "QuoteNotFoundError";
  }
}

export class ScopeNotFoundForAssertionError extends Error {
  constructor(scopeSlug: string) {
    super(`No live scope ${JSON.stringify(scopeSlug)} in this workspace to own the assertion.`);
    this.name = "ScopeNotFoundForAssertionError";
  }
}

export class BlockNotFoundError extends Error {
  constructor(blockGuid: string) {
    super(`No content block ${blockGuid} in this workspace to cite.`);
    this.name = "BlockNotFoundError";
  }
}

export async function createAssertion(input: CreateAssertionInput): Promise<CreateAssertionResult> {
  assertValidSchemaName(input.schemaName);
  const schema = input.schemaName;
  const assertionGuid = randomUUID();
  const citationGuid = randomUUID();
  let scopeGuid = "";

  const command = await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "assertion.create",
    origin: "mcp",
    // Content-keyed by default: authoring the same claim citing the same text twice is a
    // retry, not two claims. A caller that genuinely means two can supply its own key.
    idempotencyKey:
      input.idempotencyKey ??
      `assertion.create:${input.scopeSlug}:${createHash("sha256")
        .update(`${input.title}\u0000${input.content}\u0000${input.citation.blockGuid}\u0000${input.citation.exactQuote}`)
        .digest("hex")}`,
    reason: `author ${input.kind}`,
    entity: { entityType: "assertion", entityGuid: assertionGuid },
    apply: async (tx) => {
      scopeGuid = await resolveScope(tx, input);
      const block = await loadBlock(tx, input);

      // Verified before writing, not after: a citation whose quote is not in the block can
      // never be re-anchored, so it is not provenance — it is a claim about provenance.
      const quoteOffset = block.raw_content.indexOf(input.citation.exactQuote);
      if (input.citation.exactQuote.length === 0 || quoteOffset === -1) {
        throw new QuoteNotFoundError(input.citation.blockGuid);
      }

      await tx.query(
        `INSERT INTO "${schema}".assertions
           (workspace_guid, assertion_guid, owner_scope_guid, kind, status, title, content, version)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, 1)`,
        [input.workspaceGuid, assertionGuid, scopeGuid, input.kind, input.title, input.content],
      );

      await tx.query(
        `INSERT INTO "${schema}".source_citations
           (workspace_guid, citation_guid, assertion_guid, block_guid, relation, exact_quote,
            prefix, suffix, start_offset, end_offset, selected_content_hash, parser_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          input.workspaceGuid,
          citationGuid,
          assertionGuid,
          input.citation.blockGuid,
          input.citation.relation ?? "supports",
          input.citation.exactQuote,
          input.citation.prefix ?? null,
          input.citation.suffix ?? null,
          quoteOffset,
          quoteOffset + input.citation.exactQuote.length,
          // The block as it stood when cited, so a later reader can tell the source changed
          // rather than assuming it did not.
          createHash("sha256").update(block.raw_content).digest("hex"),
          CITATION_PARSER_VERSION,
        ],
      );

      // Without this the assertion exists but routes nowhere: membership is resolved from
      // record_scopes, and an owning scope is not implied by owner_scope_guid alone.
      await tx.query(
        `INSERT INTO "${schema}".record_scopes
           (workspace_guid, association_guid, record_type, record_guid, scope_guid, association_type, derived_from_signal)
         VALUES ($1, $2, 'assertion', $3, $4, 'owning-scope', 'authored')
         ON CONFLICT DO NOTHING`,
        [input.workspaceGuid, randomUUID(), assertionGuid, scopeGuid],
      );

      return {
        resultingValue: {
          assertionGuid,
          kind: input.kind,
          title: input.title,
          scopeSlug: input.scopeSlug,
          citationGuid,
        },
        entryType: "assertion.created",
        ownerScopeGuid: scopeGuid,
      };
    },
  });

  if (!command.replayed) {
    return { assertionGuid, citationGuid, version: 1, scopeGuid, replayed: false };
  }

  // A replay applied nothing, so the GUIDs minted above were never written. Returning them
  // would hand the caller identifiers for a record that does not exist — worse than an
  // error, because it looks like success and fails only when something tries to use them.
  // The original command's snapshot is the link back to what was actually created.
  return resolveReplayed(input, command.commandGuid);
}

async function resolveReplayed(
  input: CreateAssertionInput,
  commandGuid: string,
): Promise<CreateAssertionResult> {
  const schema = input.schemaName;
  const original = await input.pool.query<{
    entity_guid: string;
    version: number;
    owner_scope_guid: string;
    citation_guid: string | null;
  }>(
    `SELECT v.entity_guid, v.version, a.owner_scope_guid,
            (SELECT c.citation_guid FROM "${schema}".source_citations c
              WHERE c.workspace_guid = v.workspace_guid AND c.assertion_guid = v.entity_guid
              -- Same reason as the routing aggregate: now() is transaction-constant, so
              -- created_at alone would not pick the same row every time.
              ORDER BY c.created_at, c.citation_guid LIMIT 1) AS citation_guid
       FROM "${schema}".record_versions v
       JOIN "${schema}".assertions a
         ON a.workspace_guid = v.workspace_guid AND a.assertion_guid = v.entity_guid
       -- Matched on what the accepted command actually did. Idempotency keys are compared on
       -- (workspace, key) alone, not on command type, so a caller reusing one key across a batch
       -- lands here holding an unrelated acceptance — and every other assertion command writes a
       -- record_versions row under entity_type 'assertion' too. Without this a spent key reports
       -- a claim as already authored and hands back a citation guid from a different command.
       JOIN "${schema}".mutation_log m
         ON m.workspace_guid = v.workspace_guid AND m.command_guid = v.command_guid
        AND m.entry_type = 'assertion.created'
      WHERE v.workspace_guid = $1 AND v.command_guid = $2 AND v.entity_type = 'assertion'
      ORDER BY v.version DESC
      LIMIT 1`,
    [input.workspaceGuid, commandGuid],
  );

  const row = original.rows[0];
  if (!row) {
    // Either the key was spent by a command that authored nothing, or the assertion it authored
    // is gone. Both mean there is no identifier to hand back, and inventing one would be worse.
    throw new IdempotencyKeyReusedError("assertion.create", `command ${commandGuid}`);
  }

  return {
    assertionGuid: row.entity_guid,
    citationGuid: row.citation_guid ?? "",
    version: row.version,
    scopeGuid: row.owner_scope_guid,
    replayed: true,
  };
}

/** Bumped when selector capture changes, so a citation records how it was made. */
export const CITATION_PARSER_VERSION = "citation-1.0.0";

async function resolveScope(tx: CommandTransaction, input: CreateAssertionInput): Promise<string> {
  const result = await tx.query<{ scope_guid: string }>(
    `SELECT scope_guid FROM "${input.schemaName}".scopes
      WHERE workspace_guid = $1 AND scope_slug = $2 AND retired_at IS NULL`,
    [input.workspaceGuid, input.scopeSlug],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ScopeNotFoundForAssertionError(input.scopeSlug);
  }
  return row.scope_guid;
}

async function loadBlock(
  tx: CommandTransaction,
  input: CreateAssertionInput,
): Promise<{ raw_content: string }> {
  // Shared with addCitation. Two copies of this drifted once already: the revision guard was
  // added here and the other surface kept accepting what this one had started refusing.
  return loadCitableBlock(
    tx,
    input.schemaName,
    input.workspaceGuid,
    input.citation.blockGuid,
    (blockGuid) => new BlockNotFoundError(blockGuid),
  );
}
