import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addCitation,
  ReanchorSourceNotFoundError,
  AssertionNotFoundError as CitationAssertionNotFoundError,
} from "../../src/db/addCitation.js";
import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import {
  CommandHandler,
  ConcurrentModificationError,
  IdempotencyKeyReusedError,
} from "../../src/db/commandHandler.js";
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
  StaleIdempotentEditError,
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
      expect(result.assertionRetired).toBe(false);

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

    /**
     * Two writers changing different fields. Each computes every column from the row it read, so
     * the second to write would overwrite the first's field with the value it read before that
     * change existed — a lost update, and a direct contradiction of "fields left out keep their
     * current value".
     *
     * Nothing here takes a row lock, and this asserts that none is needed: the second writer's
     * record_versions insert collides with the first on the primary key, which is what actually
     * serializes writers, and surfaces as a refusal rather than a silent overwrite. Forced from
     * inside the first command's own read rather than raced, so the interleaving is the one being
     * reasoned about and not whichever one the scheduler happened to produce.
     */
    it("refuses the second of two concurrent edits rather than losing a field", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const second = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
      let interleaved = false;
      let secondOutcome: unknown = "never ran";

      const interleaving = new Proxy(pool, {
        get(target, property, receiver) {
          if (property !== "connect") {
            return Reflect.get(target, property, receiver) as unknown;
          }
          return (callback?: unknown) => {
            if (typeof callback === "function") {
              return (target.connect as (cb: unknown) => unknown)(callback);
            }
            return (async () => {
              const client = await target.connect();
              const realQuery = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
              client.query = (async (...args: unknown[]) => {
                const [text] = args;
                const fires =
                  !interleaved &&
                  typeof args[args.length - 1] !== "function" &&
                  typeof text === "string" &&
                  text.includes("SELECT kind, title, content, version, owner_scope_guid");
                const result = await realQuery(...args);
                if (fires) {
                  interleaved = true;
                  client.query = realQuery as typeof client.query;
                  // Changes a different field, from the same starting row.
                  secondOutcome = await updateAssertion({
                    ...context(),
                    pool: second,
                    handler: new CommandHandler(second, schemaName),
                    assertionGuid: created.assertionGuid,
                    content: "Rewritten by the other writer.",
                    reason: "concurrent edit to a different field",
                  }).catch((error: unknown) => error);
                }
                return result;
              }) as typeof client.query;
              return client;
            })();
          };
        },
      });

      let outerOutcome: unknown = "never ran";
      try {
        outerOutcome = await updateAssertion({
          ...context(),
          pool: interleaving,
          handler: new CommandHandler(interleaving, schemaName),
          assertionGuid: created.assertionGuid,
          title: "Rewritten by the first writer.",
          reason: "concurrent edit to the title",
        }).catch((error: unknown) => error);
      } finally {
        await second.end();
      }

      expect(interleaved, "the interleave never fired, so this test proved nothing").toBe(true);

      // The interleaved writer runs to completion inside the other's read, so it is the one that
      // commits; the outer writer then finds its version taken. Which one loses is an artefact of
      // the forced ordering. That exactly one loses is the point.
      expect(secondOutcome).not.toBeInstanceOf(Error);
      expect(outerOutcome).toBeInstanceOf(ConcurrentModificationError);

      // No field was lost. The refused writer would have written both columns from the row it
      // read before the other's change existed; its rollback is what keeps the title original.
      const settled = await rowOf(created.assertionGuid);
      expect(settled.content).toBe("Rewritten by the other writer.");
      expect(settled.title).toBe("Bearer tokens are required");
      expect(settled.version).toBe(2);
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
      expect(first.assertionRetired).toBe(false);
      expect(second.replayed).toBe(true);
      expect(second.assertionRetired).toBe(false);
      // A replay reports the claim as it stands, not what this call would have done.
      expect(second.version).toBe(2);
      expect(second.changed).toEqual([]);
      expect((await rowOf(created.assertionGuid)).version).toBe(2);
    });

    it("refuses to report success when the replayed edit has since been overwritten", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const edit = (title: string, reason: string) =>
        updateAssertion({ ...context(), assertionGuid: created.assertionGuid, title, reason });

      await edit("Revision B", "first");
      await edit("Revision A", "reverted");

      // The default key is derived from the target wording, so this matches the first command
      // and applies nothing. Reporting a replay would tell the caller their edit landed while
      // the claim still reads "Revision A".
      await expect(edit("Revision B", "re-applying B")).rejects.toBeInstanceOf(
        StaleIdempotentEditError,
      );
      expect((await rowOf(created.assertionGuid)).title).toBe("Revision A");

      // And the escape the error names actually works.
      const forced = await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Revision B",
        reason: "re-applying B under its own key",
        idempotencyKey: "deliberately-distinct",
      });
      expect(forced.replayed).toBe(false);
      expect((await rowOf(created.assertionGuid)).title).toBe("Revision B");
    });

    // commands.idempotency_key is btree-indexed and `content` is unbounded caller data, so an
    // embedded key fails at write time on the size of the claim rather than on anything about
    // the edit. Same contract setRecordScopes is held to.
    it("refuses rather than reporting an edit that another command's key swallowed", async () => {
      // Keyed off createAssertion, so the accepted command touched this same assertion and wrote
      // a snapshot for it. Neither the entity nor the command guid separates the two; the entry
      // type does.
      const created = await createAssertion({
        ...context(),
        scopeSlug: "anchor-mcp",
        kind: "decision",
        title: "Bearer tokens are required",
        content: "The transport requires one.",
        citation: { blockGuid, exactQuote: "bearer token" },
        idempotencyKey: "shared-request-key",
      });

      await expect(
        updateAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          title: "Edited under a key that was already spent",
          reason: "second use of the key",
          idempotencyKey: "shared-request-key",
        }),
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
      expect((await rowOf(created.assertionGuid)).title).toBe("Bearer tokens are required");
    });

    it("does not report an edit to one claim as covering an edit to another", async () => {
      const first = await author("Bearer tokens are required", "The transport requires one.");
      const second = await author("Sessions expire", "After an hour.");

      await updateAssertion({
        ...context(),
        assertionGuid: first.assertionGuid,
        title: "First claim, edited",
        reason: "first use of the key",
        idempotencyKey: "shared-request-key",
      });

      // Both commands are assertion.update, so the entry type alone does not separate them. A
      // replay lookup that matched on type without the entity finds the first claim's entry and
      // reports the second claim as already edited when it was never touched.
      await expect(
        updateAssertion({
          ...context(),
          assertionGuid: second.assertionGuid,
          title: "Second claim, edited",
          reason: "second use of the key",
          idempotencyKey: "shared-request-key",
        }),
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
      expect((await rowOf(second.assertionGuid)).title).toBe("Sessions expire");
    });

    it("honours an explicit key as at-most-once, even once a later edit has moved past it", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const edit = (title: string, reason: string, idempotencyKey?: string) =>
        updateAssertion({ ...context(), assertionGuid: created.assertionGuid, title, reason, idempotencyKey });

      await edit("Requested by request-42", "first delivery", "request-42");
      await edit("A newer human edit", "someone else, afterwards");

      // The redelivery an explicit key exists to make safe. The stale-value guard applies to the
      // derived key, whose meaning is "this wording, ever" — applying it here would refuse the
      // exact case the caller asked to be protected from, and the remedy the error names (supply
      // a key) is one they already followed.
      const redelivered = await edit("Requested by request-42", "redelivery after a timeout", "request-42");
      expect(redelivered.replayed).toBe(true);
      expect(redelivered.changed).toEqual([]);
      // And it must not resurrect the wording over the newer edit.
      expect((await rowOf(created.assertionGuid)).title).toBe("A newer human edit");
    });

    it("keeps the idempotency key bounded regardless of how long the claim is", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        content: "x".repeat(20_000),
        reason: "a very long claim",
      });

      const key = await pool.query<{ idempotency_key: string }>(
        `SELECT idempotency_key FROM "${schemaName}".commands
          WHERE command_type = 'assertion.update' ORDER BY accepted_at DESC LIMIT 1`,
      );
      expect(key.rows[0]!.idempotency_key.length).toBeLessThan(128);
    });

    it("still reports the edit it made once the claim has been retired", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const edit = (reason: string) =>
        updateAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          title: "Edited before the tombstone",
          reason,
          idempotencyKey: "request-42",
        });

      await edit("first delivery");
      await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });

      // Worst under an explicit key, which is the caller stating "at most once": refusing here
      // tells them their one delivery never happened.
      const replayed = await edit("redelivery after a timeout");
      expect(replayed.replayed).toBe(true);
      expect(replayed.version).toBe(3);
      expect(replayed.assertionRetired).toBe(true);
    });

    it("does not diagnose a stale edit on a tombstone, whose only remedy would fail", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const edit = (title: string, reason: string) =>
        updateAssertion({ ...context(), assertionGuid: created.assertionGuid, title, reason });

      await edit("Revision B", "first");
      await edit("Revision A", "reverted");
      await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });

      // On a live claim this is StaleIdempotentEditError, whose remedy is to re-apply the wording
      // under a fresh key. A retired claim refuses that, so raising it here would hand the caller
      // a diagnosis whose only prescribed cure is guaranteed to fail. The tombstone is the fact
      // they need, and it comes back on the result.
      const replayed = await edit("Revision B", "re-applying B after the tombstone");
      expect(replayed.replayed).toBe(true);
      expect(replayed.assertionRetired).toBe(true);
      expect(replayed.changed).toEqual([]);
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

  describe("createAssertion", () => {
    it("refuses rather than reporting a claim another command's key swallowed", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Edited under a key that is about to be reused",
        reason: "first use of the key",
        idempotencyKey: "shared-request-key",
      });

      // The last of the family. Every assertion command writes a record_versions row under
      // entity_type 'assertion', so matching on the command guid alone finds the edit's row and
      // reports a claim as already authored — handing back a citation guid from a command that
      // never made one.
      await expect(
        createAssertion({
          ...context(),
          scopeSlug: "anchor-mcp",
          kind: "decision",
          title: "A genuinely new claim",
          content: "Which was never written.",
          citation: { blockGuid, exactQuote: "bearer token" },
          idempotencyKey: "shared-request-key",
        }),
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
      // Named as a command, not an assertion. This branch has no assertion guid to give — the
      // record was never written — and a bare guid in that sentence reads as one that exists.
      await expect(
        createAssertion({
          ...context(),
          scopeSlug: "anchor-mcp",
          kind: "decision",
          title: "A genuinely new claim",
          content: "Which was never written.",
          citation: { blockGuid, exactQuote: "bearer token" },
          idempotencyKey: "shared-request-key",
        }),
      ).rejects.toThrow(/on command /);

      const claims = await pool.query(
        `SELECT 1 FROM "${schemaName}".assertions WHERE title = 'A genuinely new claim'`,
      );
      expect(claims.rowCount).toBe(0);
    });
  });

  describe("retireAssertion", () => {
    it("tombstones the claim and retires its scope associations", async () => {
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

      // Not what stops the claim being served: retrieval filters the assertion row itself, so
      // the tombstone is excluded either way. These are retired because an association pointing
      // at a tombstone asserts a membership with no member.
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

    /**
     * Guards the harness below, not the product. The pool proxy it uses has to stay usable for
     * ordinary queries: Pool.query drives connect through its callback form, and an earlier
     * version of the trap returned only a promise, which left every such caller waiting forever.
     * retireAssertion reaches input.pool.query on its replay path, so a regression here would
     * surface as a test that hangs rather than one that fails.
     */
    it("leaves a proxied pool usable for ordinary queries", async () => {
      const passthrough = new Proxy(pool, {
        get(target, property, receiver) {
          if (property !== "connect") {
            return Reflect.get(target, property, receiver) as unknown;
          }
          return (callback?: unknown) =>
            typeof callback === "function"
              ? (target.connect as (cb: unknown) => unknown)(callback)
              : target.connect();
        },
      });

      const answered = await passthrough.query<{ n: number }>("SELECT 1::int AS n");
      expect(answered.rows[0]!.n).toBe(1);
    });

    /**
     * The supersession check reads assertion_relations, and nothing stops a relate from
     * inserting a row there afterwards. The target direction is caught for free — superseding
     * UPDATEs the target, so the two collide on the record_versions primary key — but the source
     * direction touches no row retire writes, so both can commit.
     *
     * Forced rather than raced. A test that passes because a scheduler happened to interleave is
     * not a test, so the relate is driven from inside retire's own supersession check, which is
     * the exact window the lock exists to close. The relate is given a short lock_timeout: with
     * the locks in place it cannot acquire the row retire is holding and gives up, which is the
     * correct outcome, not a flake.
     *
     * The assertion is the invariant itself rather than either command's result, because which
     * one wins is not the point — that they cannot both win is.
     */
    it("cannot be outrun by a supersession recorded inside its own check", async () => {
      const superseded = await author("Tokens are optional", "An early reading.");
      const replacement = await author("Tokens are required", "The current reading.");

      const impatient = new pg.Pool({
        connectionString: TEST_DATABASE_URL,
        max: 2,
        options: "-c lock_timeout=400ms",
      });
      let interleaved = false;

      // Wraps the pool retire runs on, so the relate lands between retire's supersession check
      // and its write. Only the connect path needs wrapping: that is where the command's
      // transaction comes from.
      //
      // The patch is one-shot and undoes itself. Pool.query drives a pooled client through the
      // callback form, and a wrapper that returns a promise instead leaves that caller waiting
      // forever — so the client must go back to the pool exactly as it came out.
      const interleaving = new Proxy(pool, {
        get(target, property, receiver) {
          if (property !== "connect") {
            return Reflect.get(target, property, receiver) as unknown;
          }
          return (callback?: unknown) => {
            // Pool.connect has a callback form, and Pool.query uses it. A trap that only ever
            // returns a promise leaves that caller waiting forever — which is not hypothetical
            // here: retireAssertion reaches input.pool.query on its replay path.
            if (typeof callback === "function") {
              return (target.connect as (cb: unknown) => unknown)(callback);
            }
            return (async () => {
              const client = await target.connect();
              const realQuery = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
              client.query = (async (...args: unknown[]) => {
                const [text] = args;
                const fires =
                  !interleaved &&
                  typeof args[args.length - 1] !== "function" &&
                  typeof text === "string" &&
                  // Anchored on the command's own guard, not on the phrase: the invariant query at
                  // the end of this test also mentions the relation type, and a predicate that
                  // matched it would arm the interleave against the wrong statement.
                  text.includes("assertion_relations") &&
                  text.includes("relation_type = 'supersedes'") &&
                  text.includes("LIMIT 1");
                const result = await realQuery(...args);
                if (fires) {
                  interleaved = true;
                  client.query = realQuery as typeof client.query;
                  await createAssertionRelation({
                    pool: impatient,
                    schemaName,
                    handler: new CommandHandler(impatient, schemaName),
                    workspaceGuid: bootstrap.workspaceGuid,
                    actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
                    sourceAssertionGuid: replacement.assertionGuid,
                    targetAssertionGuid: superseded.assertionGuid,
                    relationType: "supersedes",
                  }).catch((error: unknown) => {
                    // Losing the lock is the designed outcome. Anything else is a real failure and
                    // must not be swallowed into a passing test.
                    if (!/lock timeout|deadlock/i.test(String(error))) {
                      throw error;
                    }
                  });
                }
                return result;
              }) as typeof client.query;
              return client;
            })();
          };
        },
      });

      try {
        await retireAssertion({
          pool: interleaving,
          schemaName,
          handler: new CommandHandler(interleaving, schemaName),
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          assertionGuid: replacement.assertionGuid,
          reason: "retiring while a supersession is being recorded",
        }).catch((error: unknown) => {
          // Either command may lose; a refusal here is a correct outcome.
          if (!/lock timeout|deadlock|Concurrent modification/i.test(String(error))) {
            throw error;
          }
        });
      } finally {
        await impatient.end();
      }

      expect(interleaved, "the interleave never fired, so this test proved nothing").toBe(true);

      // The invariant both other assertion commands already defend: a superseded standing must
      // have a live supersedes relation behind it. Retire's cascade would retire a relation it
      // did not know about, leaving exactly the state setAssertionStatus refuses to create.
      const orphaned = await pool.query<{ assertion_guid: string }>(
        `SELECT a.assertion_guid
           FROM "${schemaName}".assertions a
          WHERE a.status = 'superseded'
            AND NOT EXISTS (
              SELECT 1 FROM "${schemaName}".assertion_relations r
               WHERE r.workspace_guid = a.workspace_guid
                 AND r.target_assertion_guid = a.assertion_guid
                 AND r.relation_type = 'supersedes' AND r.retired_at IS NULL
            )`,
      );
      expect(
        orphaned.rows,
        "a claim is marked superseded with no live supersedes relation behind it",
      ).toEqual([]);
    });

    /** The other half of the same lock: createAssertionRelation must take it on both endpoints. */
    it("cannot record a supersession naming a claim whose row is locked", async () => {
      const superseded = await author("Tokens are optional", "An early reading.");
      const replacement = await author("Tokens are required", "The current reading.");

      const holder = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await holder.connect();
      const impatient = new pg.Pool({
        connectionString: TEST_DATABASE_URL,
        max: 2,
        options: "-c lock_timeout=400ms",
      });
      try {
        await holder.query("BEGIN");
        // FOR NO KEY UPDATE, deliberately, on the *source*. A plain FOR UPDATE here would prove
        // nothing: inserting the relation takes a FOR KEY SHARE on both endpoints for the
        // foreign keys, which FOR UPDATE already conflicts with, so the relate would block
        // whether or not it takes a lock of its own. FOR NO KEY UPDATE is compatible with
        // FOR KEY SHARE and conflicts only with the explicit FOR UPDATE this command now takes.
        await holder.query(
          `SELECT assertion_guid FROM "${schemaName}".assertions
            WHERE workspace_guid = $1 AND assertion_guid = $2 FOR NO KEY UPDATE`,
          [bootstrap.workspaceGuid, replacement.assertionGuid],
        );

        await expect(
          createAssertionRelation({
            pool: impatient,
            schemaName,
            handler: new CommandHandler(impatient, schemaName),
            workspaceGuid: bootstrap.workspaceGuid,
            actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
            sourceAssertionGuid: replacement.assertionGuid,
            targetAssertionGuid: superseded.assertionGuid,
            relationType: "supersedes",
          }),
        ).rejects.toThrow(/lock timeout/i);
      } finally {
        await holder.query("ROLLBACK");
        await holder.end();
        await impatient.end();
      }

      expect((await rowOf(superseded.assertionGuid)).status).toBe("active");
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

    it("refuses rather than reporting a retire that another command's key swallowed", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      // Idempotency keys are matched on (workspace, key) alone — not on command type — so a
      // caller reusing one key across a batch makes this retire replay someone else's command.
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Edited under a shared key",
        reason: "first use of the key",
        idempotencyKey: "shared-request-key",
      });

      await expect(
        retireAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          reason: "second use of the key",
          idempotencyKey: "shared-request-key",
        }),
        // Not "no such assertion": the claim is live and still routing, and an agent told it is
        // gone authors a duplicate. The cause is the reused key, and the error says so.
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

      // The point of the refusal: the claim must not be reported as removed while it is live
      // and still routing.
      const settled = await rowOf(created.assertionGuid);
      expect(settled.retired_at).toBeNull();
      const live = await pool.query(
        `SELECT 1 FROM "${schemaName}".record_scopes
          WHERE record_type = 'assertion' AND record_guid = $1 AND retired_at IS NULL`,
        [created.assertionGuid],
      );
      expect(live.rowCount).toBe(1);
    });

    it("names what it took with the claim, not just how many", async () => {
      const first = await author("Bearer tokens are required", "The transport requires one.");
      const second = await author("Bearer tokens are optional", "It does not require one.");
      const relation = await createAssertionRelation({
        ...context(),
        sourceAssertionGuid: second.assertionGuid,
        targetAssertionGuid: first.assertionGuid,
        relationType: "contradicts",
      });

      await retireAssertion({
        ...context(),
        assertionGuid: first.assertionGuid,
        reason: "authored against the wrong scope",
      });

      // "One relation disappeared" cannot answer which conflict stopped being visible, and the
      // mutation log is the only account left once the rows are retired.
      const snapshot = await pool.query<{
        payload: { retiredRelations?: string[]; retiredAssociations?: string[] };
      }>(
        `SELECT payload FROM "${schemaName}".record_versions
          WHERE entity_type = 'assertion' AND entity_guid = $1 AND version = 2`,
        [first.assertionGuid],
      );
      expect(snapshot.rows[0]!.payload.retiredRelations).toEqual([relation.relationGuid]);
      expect(snapshot.rows[0]!.payload.retiredAssociations).toHaveLength(1);
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
        retireAssertion({
          ...context(),
          assertionGuid: created.assertionGuid,
          reason: "written against a stale reading",
          expectedVersion: 1,
        }),
      ).rejects.toBeInstanceOf(ConcurrentModificationError);
      expect((await rowOf(created.assertionGuid)).retired_at).toBeNull();
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
      expect(result.assertionRetired).toBe(false);
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

      expect(first.assertionRetired).toBe(false);
      expect(second.replayed).toBe(true);
      // Both paths asserted, because the write path hardcodes this and a hardcoded field that
      // nothing reads is one that can be wrong in the direction that matters: an agent told the
      // claim it just wrote is a tombstone abandons the edit or authors a duplicate.
      expect(second.assertionRetired).toBe(false);
      // The GUID minted by the replayed call was never written; returning it would hand the
      // caller an identifier for a row that does not exist.
      expect(second.citationGuid).toBe(first.citationGuid);
      expect(await citationsOf(created.assertionGuid)).toHaveLength(2);
      expect((await rowOf(created.assertionGuid)).version).toBe(2);
    });

    it("treats a resubmission that adds a re-anchor source as a different citation", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const plain = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reason: "second source",
      });

      // The workflow the tool prescribes: realise the chain should have been recorded, and
      // resubmit naming the citation this one replaces. A digest that omitted the re-anchor
      // source would match the call above and drop this write silently.
      const chained = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reanchoredFromCitationGuid: created.citationGuid,
        reason: "recording the chain that was missed",
      });

      expect(chained.replayed).toBe(false);
      expect(chained.citationGuid).not.toBe(plain.citationGuid);
      const citations = await citationsOf(created.assertionGuid);
      expect(citations.map((row) => row.reanchored_from_citation_guid)).toContain(
        created.citationGuid,
      );
    });

    it("treats a resubmission that adds re-find context as a different citation", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const plain = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reason: "second source",
      });
      const withContext = await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: {
          blockGuid: otherBlockGuid,
          exactQuote: "one hour",
          prefix: "Sessions expire after ",
          suffix: " of inactivity.",
        },
        reason: "prefix and suffix let the quote be re-found after the text moves",
      });

      expect(withContext.replayed).toBe(false);
      expect(withContext.citationGuid).not.toBe(plain.citationGuid);
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
        addCitation({
          ...context(),
          assertionGuid: created.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
          reason: "written against a stale reading",
          expectedVersion: 1,
        }),
      ).rejects.toBeInstanceOf(ConcurrentModificationError);
      expect(await citationsOf(created.assertionGuid)).toHaveLength(1);
    });

    it("refuses rather than returning a citation another command's key swallowed", async () => {
      // Keyed off createAssertion deliberately. Its snapshot for this same assertion also
      // carries a `citationGuid`, so a replay lookup that matched on the entity or the command
      // alone would find it and hand back the *creation's* citation, reporting a citation that
      // was never added. An updateAssertion key would be caught by the payload shape instead,
      // and would not discriminate this.
      const created = await createAssertion({
        ...context(),
        scopeSlug: "anchor-mcp",
        kind: "decision",
        title: "Bearer tokens are required",
        content: "The transport requires one.",
        citation: { blockGuid, exactQuote: "bearer token" },
        idempotencyKey: "shared-request-key",
      });

      await expect(
        addCitation({
          ...context(),
          assertionGuid: created.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
          reason: "second use of the key",
          idempotencyKey: "shared-request-key",
        }),
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
      expect(await citationsOf(created.assertionGuid)).toHaveLength(1);
      expect((await citationsOf(created.assertionGuid))[0]!.citation_guid).toBe(
        created.citationGuid,
      );
    });

    it("reports the claim's current version on a replay, not the version it had when cited", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const cite = (reason: string) =>
        addCitation({
          ...context(),
          assertionGuid: created.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
          reason,
        });

      await cite("second source");
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Edited after the citation landed",
        reason: "a later edit",
      });

      const replayed = await cite("second source, resubmitted after a timeout");
      expect(replayed.replayed).toBe(true);
      // The snapshot says 2. Returning that would have the caller feed a stale expectedVersion
      // back and be refused for a conflict that only this return value created.
      expect(replayed.version).toBe(3);
      expect((await rowOf(created.assertionGuid)).version).toBe(3);
    });

    it("still reports the citation it added once the claim has been retired", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      const cite = (reason: string) =>
        addCitation({
          ...context(),
          assertionGuid: created.assertionGuid,
          citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
          reason,
        });

      const first = await cite("second source");
      await retireAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        reason: "imported twice",
      });

      // The citation did land. Refusing the redelivery with "no live assertion" would deny a
      // write that happened and send the caller to add it again — and a tombstoned claim keeps
      // its row, so there is nothing to stop this answering.
      const replayed = await cite("second source, resubmitted after a timeout");
      expect(replayed.replayed).toBe(true);
      expect(replayed.citationGuid).toBe(first.citationGuid);
      // The key is content-addressed, so a match does not prove this caller wrote it. Reporting
      // the replay without the standing would let someone who never wrote anything believe a
      // tombstone now carries their evidence.
      expect(replayed.assertionRetired).toBe(true);
    });

    it("snapshots the claim, not just the citation, so the next edit's prior value reads", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");
      await addCitation({
        ...context(),
        assertionGuid: created.assertionGuid,
        citation: { blockGuid: otherBlockGuid, exactQuote: "one hour" },
        reason: "second source",
      });
      await updateAssertion({
        ...context(),
        assertionGuid: created.assertionGuid,
        title: "Edited after the citation",
        reason: "a later edit",
      });

      // record_versions payloads are fed forward as the next command's prior_value, which
      // listScopeChanges serves verbatim. A payload of citation fields makes the "before" of an
      // edit render as a citation record rather than as the claim's previous wording.
      const prior = await pool.query<{ prior_value: Record<string, unknown> | null }>(
        `SELECT prior_value FROM "${schemaName}".mutation_log
          WHERE entry_type = 'assertion.updated' AND resulting_value->>'assertionGuid' = $1`,
        [created.assertionGuid],
      );
      expect(prior.rows[0]!.prior_value).toMatchObject({
        assertionGuid: created.assertionGuid,
        title: "Bearer tokens are required",
        content: "The transport requires one.",
        kind: "decision",
        status: "active",
      });
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
      // Asserted rather than inferred from the throw: the refusal comes from the pre-read, which
      // runs before the insert, so nothing should have been written to roll back in the first
      // place. This is what says so.
      expect(await citationsOf(created.assertionGuid)).toHaveLength(1);
    });
  });
});
