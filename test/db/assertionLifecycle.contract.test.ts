import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addCitation,
  ReanchorSourceNotFoundError,
  AssertionNotFoundError as CitationAssertionNotFoundError,
} from "../../src/db/addCitation.js";
import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler, ConcurrentModificationError } from "../../src/db/commandHandler.js";
import { createAssertion, QuoteNotFoundError } from "../../src/db/createAssertion.js";
import { createAssertionRelation } from "../../src/db/createAssertionRelation.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import {
  retireAssertion,
  SupersessionLineageError,
  AssertionNotFoundError as RetireAssertionNotFoundError,
} from "../../src/db/retireAssertion.js";
import {
  updateAssertion,
  NoAssertionChangesError,
  AssertionNotFoundError as UpdateAssertionNotFoundError,
} from "../../src/db/updateAssertion.js";
import {
  dropAllSchemas,
  isTestDatabaseReachable,
  migrateAllSchemas,
  TEST_DATABASE_URL,
  testSchemaName,
} from "./testDatabase.js";

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token.

## Constraints

- Sessions expire after one hour of inactivity.
`;

describe.runIf(await isTestDatabaseReachable())("assertion lifecycle, T3 (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;
  let blockGuid: string;
  let otherBlockGuid: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("t52_test");
    await migrateAllSchemas(pool, schemaName);
    bootstrap = await ensureBootstrap(pool, { schemaName });
    handler = new CommandHandler(pool, schemaName);

    await importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "a".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      scopes: [{ scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] }],
    });

    blockGuid = await blockMatching("%bearer token%");
    otherBlockGuid = await blockMatching("%one hour of inactivity%");
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  async function blockMatching(pattern: string): Promise<string> {
    const block = await pool.query<{ block_guid: string }>(
      `SELECT block_guid FROM "${schemaName}".content_blocks
        WHERE raw_content LIKE $1 LIMIT 1`,
      [pattern],
    );
    // Asserted rather than non-null-asserted: if the fixture or block parsing ever changes,
    // every test in this file fails on a TypeError that names nothing.
    expect(block.rowCount, `fixture: no content block matched ${pattern}`).toBe(1);
    return block.rows[0]!.block_guid;
  }

  const context = () => ({
    pool,
    schemaName,
    handler,
    workspaceGuid: bootstrap.workspaceGuid,
    actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
  });

  const author = (title: string, content: string) =>
    createAssertion({
      ...context(),
      scopeSlug: "anchor-mcp",
      kind: "decision",
      title,
      content,
      citation: { blockGuid, exactQuote: "bearer token" },
    });

  const rowOf = async (assertionGuid: string) => {
    const row = await pool.query<{
      kind: string;
      title: string;
      content: string;
      status: string;
      version: number;
      retired_at: Date | null;
    }>(
      `SELECT kind, title, content, status, version, retired_at FROM "${schemaName}".assertions
        WHERE assertion_guid = $1`,
      [assertionGuid],
    );
    return row.rows[0]!;
  };

  /**
   * The version the handler will compare the next `expectedVersion` against. Read separately
   * from the column so the tests below can assert the two agree rather than assuming it.
   */
  const snapshotVersion = async (assertionGuid: string) => {
    const row = await pool.query<{ version: number }>(
      `SELECT max(version) AS version FROM "${schemaName}".record_versions
        WHERE entity_type = 'assertion' AND entity_guid = $1`,
      [assertionGuid],
    );
    return Number(row.rows[0]!.version);
  };

  const citationsOf = async (assertionGuid: string) => {
    const rows = await pool.query<{
      citation_guid: string;
      block_guid: string;
      relation: string;
      exact_quote: string;
      start_offset: number;
      end_offset: number;
      reanchored_from_citation_guid: string | null;
    }>(
      `SELECT citation_guid, block_guid, relation, exact_quote, start_offset, end_offset,
              reanchored_from_citation_guid
         FROM "${schemaName}".source_citations
        WHERE assertion_guid = $1
        ORDER BY created_at, citation_guid`,
      [assertionGuid],
    );
    return rows.rows;
  };

  describe("updateAssertion", () => {
    it("rewrites the claim, versions it, and records what moved", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      const result = await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Bearer tokens are required on the HTTP transport",
        kind: "requirement",
        reason: "the original title did not say which transport",
      });

      expect(result.changed).toEqual(["title", "kind"]);
      expect(result.replayed).toBe(false);

      const settled = await rowOf(created.assertionGuid);
      expect(settled.title).toBe("Bearer tokens are required on the HTTP transport");
      expect(settled.kind).toBe("requirement");
      // Untouched fields keep their value rather than being nulled by a partial update.
      expect(settled.content).toBe("The transport requires one.");
      expect(settled.status).toBe("active");
      expect(settled.version).toBe(2);
      expect(result.version).toBe(2);

      // The column and the snapshot counter move together. expectedVersion is checked against
      // record_versions, so a command that bumped only one would hand callers a number their
      // next write is not actually compared to.
      expect(await snapshotVersion(created.assertionGuid)).toBe(2);
    });

    it("keeps the prior wording in the snapshot, so an edit is readable without diffing", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Bearer tokens are mandatory",
        reason: "wording",
      });

      const snapshot = await pool.query<{ payload: { previous?: Record<string, string> } }>(
        `SELECT payload FROM "${schemaName}".record_versions
          WHERE entity_type = 'assertion' AND entity_guid = $1 AND version = 2`,
        [created.assertionGuid],
      );
      expect(snapshot.rows[0]!.payload.previous).toEqual({ title: "Bearer tokens are required" });
    });

    it("refuses an edit that resends the values already stored, and writes nothing", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      await expect(
        updateAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          title: "Bearer tokens are required",
          content: "The transport requires one.",
          reason: "no change at all",
        }),
      ).rejects.toBeInstanceOf(NoAssertionChangesError);

      // The refusal has to leave no trace: a version bump behind an edit that did not happen is
      // history describing a change that never occurred.
      expect((await rowOf(created.assertionGuid)).version).toBe(1);
      expect(await snapshotVersion(created.assertionGuid)).toBe(1);
      const commands = await pool.query(
        `SELECT 1 FROM "${schemaName}".commands WHERE command_type = 'assertion.update'`,
      );
      expect(commands.rowCount).toBe(0);
    });

    it("refuses a call that names no fields at all", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await expect(
        updateAssertion({ ...context(), assertionGuid: created.assertionGuid, reason: "nothing" }),
      ).rejects.toBeInstanceOf(NoAssertionChangesError);
    });

    it("refuses when the claim moved since the caller read it", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Someone else got here first",
        reason: "first writer",
      });

      await expect(
        updateAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          title: "Written against a stale reading",
          reason: "second writer",
          expectedVersion: 1,
        }),
      ).rejects.toBeInstanceOf(ConcurrentModificationError);
      expect((await rowOf(created.assertionGuid)).title).toBe("Someone else got here first");
    });

    it("leaves citations alone: rewording a claim does not change where it came from", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const before = await citationsOf(created.assertionGuid);

      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        content: "Every HTTP request carries one.",
        reason: "clarify",
      });

      expect(await citationsOf(created.assertionGuid)).toEqual(before);
    });

    it("applies once when the same edit is submitted twice", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const first = await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Bearer tokens are mandatory",
        reason: "wording",
      });
      const second = await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Bearer tokens are mandatory",
        reason: "wording, resubmitted after a timeout",
      });

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      // A replay reports the claim as it stands, not what this call would have done.
      expect(second.version).toBe(2);
      expect(second.changed).toEqual([]);
      expect((await rowOf(created.assertionGuid)).version).toBe(2);
    });

    it("will not edit a tombstoned claim", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });

      await expect(
        updateAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          title: "Editing a tombstone",
          reason: "should not land",
        }),
      ).rejects.toBeInstanceOf(UpdateAssertionNotFoundError);
    });
  });

  describe("retireAssertion", () => {
    it("tombstones the claim and stops it routing", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      const result = await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "the same claim was imported twice",
      });

      expect(result.replayed).toBe(false);
      expect(result.version).toBe(2);
      expect(await snapshotVersion(created.assertionGuid)).toBe(2);

      const settled = await rowOf(created.assertionGuid);
      expect(settled.retired_at).not.toBeNull();

      // Membership lives in record_scopes, not on the assertion row. Leaving it live would keep
      // the tombstone in every route that named its scope.
      expect(result.associationsRetired).toBe(1);
      const live = await pool.query(
        `SELECT 1 FROM "${schemaName}".record_scopes
          WHERE record_type = 'assertion' AND record_guid = $1 AND retired_at IS NULL`,
        [created.assertionGuid],
      );
      expect(live.rowCount).toBe(0);
    });

    it("retires the conflicts recorded against it", async () => {
      const first = await author("Bearer tokens are required", "The transport requires one.");
      const second = await author("Bearer tokens are optional", "The transport does not require one.");
      await createAssertionRelation({
        ...context(),
        sourceAssertionGuid: second.assertionGuid,
        targetAssertionGuid: first.assertionGuid,
        relationType: "contradicts",
        rationale: "they cannot both hold",
      });

      const result = await retireAssertion({
        ...context(),
        assertionGuid: first.assertionGuid,
        reason: "authored against the wrong scope",
      });

      // A surviving conflict against a tombstone surfaces a contradiction the reader cannot go
      // and look at.
      expect(result.relationsRetired).toBe(1);
      const live = await pool.query(
        `SELECT 1 FROM "${schemaName}".assertion_relations WHERE retired_at IS NULL`,
      );
      expect(live.rowCount).toBe(0);
    });

    it("refuses to tombstone the target of a live supersession", async () => {
      const superseded = await author("Tokens are optional", "An early reading.");
      const replacement = await author("Tokens are required", "The current reading.");
      await createAssertionRelation({
        ...context(),
        sourceAssertionGuid: replacement.assertionGuid,
        targetAssertionGuid: superseded.assertionGuid,
        relationType: "supersedes",
      });

      await expect(
        retireAssertion({
          ...context(),
          assertionGuid: superseded.assertionGuid,
          reason: "tidy up",
        }),
      ).rejects.toBeInstanceOf(SupersessionLineageError);
      expect((await rowOf(superseded.assertionGuid)).retired_at).toBeNull();
    });

    it("refuses to tombstone the source of a live supersession", async () => {
      const superseded = await author("Tokens are optional", "An early reading.");
      const replacement = await author("Tokens are required", "The current reading.");
      await createAssertionRelation({
        ...context(),
        sourceAssertionGuid: replacement.assertionGuid,
        targetAssertionGuid: superseded.assertionGuid,
        relationType: "supersedes",
      });

      // Retiring the replacement would leave the other claim marked superseded with nothing
      // superseding it — the state setAssertionStatus already refuses to create directly.
      await expect(
        retireAssertion({
          ...context(),
          assertionGuid: replacement.assertionGuid,
          reason: "tidy up",
        }),
      ).rejects.toBeInstanceOf(SupersessionLineageError);
      expect((await rowOf(superseded.assertionGuid)).status).toBe("superseded");
      expect((await rowOf(replacement.assertionGuid)).retired_at).toBeNull();
    });

    it("reports what the accepted command did when a retire is resubmitted", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const first = await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });
      const second = await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice, resubmitted after a timeout",
      });

      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      // The claim cannot be re-read from the live table, so the counts come from the snapshot.
      // Reporting zeroes would tell the caller the retry found nothing to retire.
      expect(second.associationsRetired).toBe(1);
      expect(second.version).toBe(first.version);
    });

    it("will not tombstone a claim that is already a tombstone under a different key", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });

      await expect(
        retireAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          reason: "a genuinely separate decision",
          idempotencyKey: "a-different-key",
        }),
      ).rejects.toBeInstanceOf(RetireAssertionNotFoundError);
    });
  });

  describe("addCitation", () => {
    it("binds a second source to a live claim and captures its selectors", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      const result = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour", relation: "mentions" },
        reason: "the constraints section touches on the same rule",
      });

      expect(result.replayed).toBe(false);
      const citations = await citationsOf(created.assertionGuid);
      expect(citations).toHaveLength(2);
      const added = citations.find((row) => row.citation_guid === result.citationGuid)!;
      expect(added.block_guid).toBe(otherBlockGuid);
      expect(added.relation).toBe("mentions");
      // The offsets have to locate the quote in the block, or the position selector points at
      // text the citation does not claim.
      const block = await pool.query<{ raw_content: string }>(
        `SELECT raw_content FROM "${schemaName}".content_blocks WHERE block_guid = $1`,
        [otherBlockGuid],
      );
      expect(block.rows[0]!.raw_content.slice(added.start_offset, added.end_offset)).toBe("one hour");

      // Versioned with the assertion, so expectedVersion stays meaningful after evidence moves.
      expect((await rowOf(created.assertionGuid)).version).toBe(2);
      expect(await snapshotVersion(created.assertionGuid)).toBe(2);
    });

    it("refuses a quote that is not in the block it cites, and writes nothing", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      await expect(
        addCitation({
          ...context(),
          assertionGuid: created.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "text that is not there" },
          reason: "should not land",
        }),
      ).rejects.toBeInstanceOf(QuoteNotFoundError);

      // A citation whose quote is not in the block can never be re-anchored, so it is not
      // provenance — it is a claim about provenance.
      expect(await citationsOf(created.assertionGuid)).toHaveLength(1);
      expect((await rowOf(created.assertionGuid)).version).toBe(1);
    });

    it("records a re-anchor chain when the replaced citation belongs to the same claim", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      const result = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reanchoredFromCitationGuid: created.citationGuid,
        reason: "the quoted text moved to the constraints section",
      });

      const citations = await citationsOf(created.assertionGuid);
      const added = citations.find((row) => row.citation_guid === result.citationGuid)!;
      expect(added.reanchored_from_citation_guid).toBe(created.citationGuid);
      // The replaced citation stays: the schema has no retired_at, and what was once believed
      // is part of the record.
      expect(citations).toHaveLength(2);
    });

    it("refuses a re-anchor that names a citation of a different claim", async () => {
      const first = await author("Bearer tokens are required", "The transport requires one.");
      const second = await author("Sessions expire", "After an hour.");

      await expect(
        addCitation({
          ...context(),
          assertionGuid: second.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
          reanchoredFromCitationGuid: first.citationGuid,
          reason: "should not land",
        }),
      ).rejects.toBeInstanceOf(ReanchorSourceNotFoundError);
      expect(await citationsOf(second.assertionGuid)).toHaveLength(1);
    });

    it("adds one citation when the same evidence is submitted twice", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const first = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reason: "second source",
      });
      const second = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reason: "second source, resubmitted after a timeout",
      });

      expect(second.replayed).toBe(true);
      // The GUID minted by the replayed call was never written; returning it would hand the
      // caller an identifier for a row that does not exist.
      expect(second.citationGuid).toBe(first.citationGuid);
      expect(await citationsOf(created.assertionGuid)).toHaveLength(2);
      expect((await rowOf(created.assertionGuid)).version).toBe(2);
    });

    it("will not cite a tombstoned claim", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });

      await expect(
        addCitation({
          ...context(),
          assertionGuid: created.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
          reason: "should not land",
        }),
      ).rejects.toBeInstanceOf(CitationAssertionNotFoundError);
      // The refusal happens after the insert, so what keeps a citation off a tombstone is the
      // transaction rolling back — assert the row is absent rather than trusting the throw.
      expect(await citationsOf(created.assertionGuid)).toHaveLength(1);
    });
  });
});
