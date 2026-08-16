import type { CommandTransaction } from "./commandHandler.js";

/**
 * Resolving a block that a citation may legitimately point at (T-53).
 *
 * One definition, deliberately. createAssertion and addCitation each had their own `loadBlock`
 * doing the same thing, and when the revision guard was added to the first, the second kept
 * accepting exactly what the first had started refusing -- so "authoring cannot cite superseded
 * text" was true of one authoring surface and false of the other. Two copies that must agree is
 * the shape that produced the gap; this is the fix for the shape, not only for the sighting.
 */

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

/**
 * The block's text, or a refusal.
 *
 * content_blocks are revision-scoped and re-minted on every import, so a block_guid alone names
 * text in *some* revision rather than text the workspace holds now. Selecting by guid with no
 * revision test let a claim be authored against a passage a later commit had already rewritten --
 * provenance that was wrong the moment it was written, and which selected_content_hash exists to
 * detect but nothing read.
 *
 * Retirement counts as well as supersession: a document dropped because the pinned commit no
 * longer contains it keeps its blocks and keeps a latest revision, so a revision test alone let a
 * claim be authored against a deleted file.
 *
 * Refused here rather than accepted-and-marked, which is what the read path does for a citation
 * that goes stale afterwards. The two are different situations: a claim whose source moved later
 * is history worth keeping and re-anchoring, while one authored against text the pinned commit
 * does not contain is simply wrong, and the author is present to be told so.
 *
 * `notFound` is supplied by the caller because each surface has its own error for it, and this
 * module has no business deciding which.
 */
export async function loadCitableBlock(
  tx: CommandTransaction,
  schema: string,
  workspaceGuid: string,
  blockGuid: string,
  notFound: (blockGuid: string) => Error,
): Promise<{ raw_content: string }> {
  const result = await tx.query<{ raw_content: string; is_current: boolean; is_live: boolean }>(
    `SELECT cb.raw_content,
            dr.revision_number = (
              SELECT max(dr2.revision_number)
                FROM "${schema}".document_revisions dr2
               WHERE dr2.workspace_guid = dr.workspace_guid
                 AND dr2.document_guid = dr.document_guid
            ) AS is_current,
            sd.retired_at IS NULL AS is_live
       FROM "${schema}".content_blocks cb
       JOIN "${schema}".document_revisions dr
         ON dr.workspace_guid = cb.workspace_guid AND dr.revision_guid = cb.revision_guid
       JOIN "${schema}".source_documents sd
         ON sd.workspace_guid = dr.workspace_guid AND sd.document_guid = dr.document_guid
      WHERE cb.workspace_guid = $1 AND cb.block_guid = $2`,
    [workspaceGuid, blockGuid],
  );

  const row = result.rows[0];
  if (!row) {
    throw notFound(blockGuid);
  }
  if (!row.is_current || !row.is_live) {
    throw new StaleBlockError(blockGuid, row.is_live ? "superseded" : "retired");
  }
  return { raw_content: row.raw_content };
}
