import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  IdempotencyKeyReusedError,
  type CommandHandler,
  type CommandTransaction,
} from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";

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

/**
 * A citation naming a block whose text the workspace no longer holds.
 *
 * Two ways that happens, and `reason` says which: the block's revision has been superseded by a
 * later import, or its whole document has been retired because the pinned commit no longer
 * contains that file. They need different things done about them -- a superseded block has a
 * current revision to cite instead, a retired one has nothing.
 *
 * Distinct from BlockNotFoundError either way: the block exists, and pointing at it is exactly
 * the mistake, so a caller told "not found" would go looking for a typo in a guid that resolves
 * perfectly well.
 */
export class StaleBlockError extends Error {
  constructor(
    public readonly blockGuid: string,
    /** Which way it is out of date, since the two need different things done about them. */
    public readonly reason: "superseded" | "retired" = "superseded",
  ) {
    super(
      reason === "retired"
        ? `Block ${blockGuid} belongs to a document the workspace has retired. There is no current ` +
          `revision to cite: the pinned commit no longer contains that file.`
        : `Block ${blockGuid} belongs to a superseded revision of its document. Cite a block from ` +
          `the current revision: the text this one holds is not text the workspace now contains.`,
    );
    this.name = "StaleBlockError";
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
  const result = await tx.query<{ raw_content: string; is_current: boolean; is_live: boolean }>(
    // content_blocks are revision-scoped and re-minted on every import, so a block_guid alone
    // identifies text in *some* revision rather than text the workspace currently holds. Selecting
    // by guid with no revision test let a claim be authored against a passage a later commit had
    // already rewritten -- provenance that was wrong the moment it was written, and which
    // selected_content_hash exists to detect but nothing read.
    `SELECT cb.raw_content,
            dr.revision_number = (
              SELECT max(dr2.revision_number)
                FROM "${input.schemaName}".document_revisions dr2
               WHERE dr2.workspace_guid = dr.workspace_guid
                 AND dr2.document_guid = dr.document_guid
            ) AS is_current,
            sd.retired_at IS NULL AS is_live
       FROM "${input.schemaName}".content_blocks cb
       JOIN "${input.schemaName}".document_revisions dr
         ON dr.workspace_guid = cb.workspace_guid AND dr.revision_guid = cb.revision_guid
       JOIN "${input.schemaName}".source_documents sd
         ON sd.workspace_guid = dr.workspace_guid AND sd.document_guid = dr.document_guid
      WHERE cb.workspace_guid = $1 AND cb.block_guid = $2`,
    [input.workspaceGuid, input.citation.blockGuid],
  );
  const row = result.rows[0];
  if (!row) {
    throw new BlockNotFoundError(input.citation.blockGuid);
  }
  // Refused rather than accepted-and-marked, which is what the read path does for a citation
  // that went stale after the fact. The two are different situations: a claim whose source moved
  // later is history worth keeping and re-anchoring, while one authored against text the pinned
  // commit does not contain is simply wrong, and the author is present to be told so.
  // Retirement as well as supersession: a document dropped because the pinned commit no longer
  // contains it keeps its blocks and its latest revision, so a revision test alone let a claim be
  // authored against a deleted file.
  if (!row.is_current || !row.is_live) {
    throw new StaleBlockError(input.citation.blockGuid, row.is_live ? "superseded" : "retired");
  }
  return row;
}
