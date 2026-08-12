import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { createAssertion } from "../../src/db/createAssertion.js";
import { createAssertionRelation, SelfRelationError } from "../../src/db/createAssertionRelation.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import {
  setAssertionStatus,
  AssertionNotFoundError,
  SupersededByLiveRelationError,
  SupersededRequiresRelationError,
} from "../../src/db/setAssertionStatus.js";
import {
  setRecordScopes,
  CORRECTED_ASSOCIATION_TYPE,
  MEMBERSHIP_ENTITY_TYPE,
  SectionStableKeyRequiredError,
  UnknownScopeError,
} from "../../src/db/setRecordScopes.js";
import { dropAllSchemas, isTestDatabaseReachable, migrateAllSchemas, TEST_DATABASE_URL } from "./testDatabase.js";

const DOC = `---
project: anchor-mcp
type: context-anchor
---

# Anchor MCP

## Current State

- The HTTP transport requires a bearer token.
`;

describe.runIf(await isTestDatabaseReachable())("assertion writes, T3 slice 2 (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;
  let blockGuid: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `t3s2_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
      scopes: [
        { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] },
        { scope: "security", title: "Security", kind: "practice", locators: [] },
      ],
    });

    const block = await pool.query<{ block_guid: string }>(
      `SELECT block_guid FROM "${schemaName}".content_blocks
        WHERE raw_content LIKE '%bearer token%' LIMIT 1`,
    );
    // Asserted rather than non-null-asserted: if the fixture or block parsing ever changes,
    // every test in this file fails on a TypeError that names nothing.
    expect(block.rowCount, "fixture: no content block matched 'bearer token'").toBe(1);
    blockGuid = block.rows[0]!.block_guid;
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const author = (title: string, content: string) =>
    createAssertion({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      scopeSlug: "anchor-mcp",
      kind: "decision",
      title,
      content,
      citation: { blockGuid, exactQuote: "bearer token" },
    });

  const statusOf = async (assertionGuid: string) => {
    const row = await pool.query<{ status: string; version: number }>(
      `SELECT status, version FROM "${schemaName}".assertions WHERE assertion_guid = $1`,
      [assertionGuid],
    );
    return row.rows[0]!;
  };

  describe("setAssertionStatus", () => {
    it("changes the standing of a claim and versions it", async () => {
      const created = await author("Bearer tokens are required", "The transport requires one.");

      const result = await setAssertionStatus({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        assertionGuid: created.assertionGuid,
        status: "disputed",
        reason: "a second reading contradicts it",
      });

      expect(result.previousStatus).toBe("active");
      expect(result.status).toBe("disputed");
      const settled = await statusOf(created.assertionGuid);
      expect(settled.status).toBe("disputed");
      // Versioned, because a reader comparing snapshots must see that something changed.
      expect(settled.version).toBe(2);
    });

    // The replay branch is the only path some callers ever take, so a liveness filter missing
    // there would hand back a retired claim as live while the write path refuses the same one.
    it("refuses a retired claim on the replay path too", async () => {
      const created = await author("Tokens are required", "The reading.");
      const args = {
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        assertionGuid: created.assertionGuid,
        status: "disputed" as const,
        reason: "a second reading contradicts it",
      };
      await setAssertionStatus(args);

      await pool.query(
        `UPDATE "${schemaName}".assertions SET retired_at = now() WHERE assertion_guid = $1`,
        [created.assertionGuid],
      );

      // Same idempotency key, so this takes the replay branch rather than the write path.
      await expect(setAssertionStatus(args)).rejects.toThrow(AssertionNotFoundError);
    });

    // A replay must not imply nothing moved: the change did happen, just not on this call. The
    // original command's mutation_log entry is the only record of what the status was before.
    //
    // Reached with an explicit shared key across two different targets, because the same-status
    // path is now a no-op that returns before the command handler ever sees a replay.
    it("reports the original previous status on a replay", async () => {
      const created = await author("Tokens are required", "The reading.");
      const base = {
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        assertionGuid: created.assertionGuid,
        reason: "a second reading contradicts it",
        idempotencyKey: "shared-key-for-this-decision",
      };

      const first = await setAssertionStatus({ ...base, status: "disputed" });
      const replay = await setAssertionStatus({ ...base, status: "retracted" });

      expect(first.previousStatus).toBe("active");
      expect(replay.replayed).toBe(true);
      // The accepted command stands: the claim is disputed, not retracted.
      expect(replay.status).toBe("disputed");
      expect(replay.previousStatus).toBe("active");
    });

    it("refuses to mark a claim superseded without a relation saying what replaced it", async () => {
      const created = await author("Tokens are required", "The reading.");

      await expect(
        setAssertionStatus({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          assertionGuid: created.assertionGuid,
          status: "superseded",
          reason: "superseded by nothing in particular",
        }),
      ).rejects.toThrow(SupersededRequiresRelationError);
    });

    it("refuses to move a claim out of superseded while a live relation holds it there", async () => {
      const older = await author("Tokens are optional", "Older reading.");
      const newer = await author("Tokens are required", "Newer reading.");
      await createAssertionRelation({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: newer.assertionGuid,
        targetAssertionGuid: older.assertionGuid,
        relationType: "supersedes",
      });

      await expect(
        setAssertionStatus({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          assertionGuid: older.assertionGuid,
          status: "active",
          reason: "actually it still stands",
        }),
      ).rejects.toThrow(SupersededByLiveRelationError);
    });

    // Retiring the relation releases the claim, so the invariant constrains without trapping.
    it("allows the standing to change once the relation is retired", async () => {
      const older = await author("Tokens are optional", "Older reading.");
      const newer = await author("Tokens are required", "Newer reading.");
      await createAssertionRelation({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: newer.assertionGuid,
        targetAssertionGuid: older.assertionGuid,
        relationType: "supersedes",
      });
      await pool.query(
        `UPDATE "${schemaName}".assertion_relations SET retired_at = now()
          WHERE target_assertion_guid = $1`,
        [older.assertionGuid],
      );

      const result = await setAssertionStatus({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        assertionGuid: older.assertionGuid,
        status: "active",
        reason: "the replacement was withdrawn",
      });

      expect(result.status).toBe("active");
    });

    // A version bump and a statusChanged entry for a status that did not change is history
    // describing a change that never happened.
    it("writes nothing when the claim already holds the requested standing", async () => {
      const created = await author("Tokens are required", "The reading.");
      const before = await statusOf(created.assertionGuid);

      const result = await setAssertionStatus({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        assertionGuid: created.assertionGuid,
        status: "active",
        reason: "already active",
      });

      expect(result.changed).toBe(false);
      expect((await statusOf(created.assertionGuid)).version).toBe(before.version);
      const entries = await pool.query<{ count: string }>(
        `SELECT count(*) FROM "${schemaName}".mutation_log WHERE entry_type = 'assertion.statusChanged'`,
      );
      expect(Number(entries.rows[0]!.count)).toBe(0);
    });

    it("refuses a claim that does not exist rather than reporting success", async () => {
      await expect(
        setAssertionStatus({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          assertionGuid: randomUUID(),
          status: "retracted",
          reason: "nothing to retract",
        }),
      ).rejects.toThrow(AssertionNotFoundError);
    });
  });

  describe("createAssertionRelation", () => {
    // The design rule: status and lineage cannot disagree, and cannot disagree transiently
    // either — two live answers with nothing to say which one won.
    it("transitions the target to superseded in the same command", async () => {
      const older = await author("Tokens are optional", "Older reading.");
      const newer = await author("Tokens are required", "Newer reading.");

      const result = await createAssertionRelation({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: newer.assertionGuid,
        targetAssertionGuid: older.assertionGuid,
        relationType: "supersedes",
        rationale: "the transport was changed",
      });

      expect(result.targetStatus).toBe("superseded");
      expect((await statusOf(older.assertionGuid)).status).toBe("superseded");
      // The superseding claim keeps its own standing.
      expect((await statusOf(newer.assertionGuid)).status).toBe("active");
    });

    // The handler snapshots its own entity — the relation — so the target's version advancing
    // without a row here would leave assertions.version ahead of its own history, and
    // record_versions' primary key is what serializes concurrent writers.
    it("snapshots the superseded target, not only the relation", async () => {
      const older = await author("Tokens are optional", "Older reading.");
      const newer = await author("Tokens are required", "Newer reading.");

      await createAssertionRelation({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: newer.assertionGuid,
        targetAssertionGuid: older.assertionGuid,
        relationType: "supersedes",
      });

      const settled = await statusOf(older.assertionGuid);
      const snapshots = await pool.query<{ version: number; payload: { status: string } }>(
        `SELECT version, payload FROM "${schemaName}".record_versions
          WHERE entity_type = 'assertion' AND entity_guid = $1 ORDER BY version DESC`,
        [older.assertionGuid],
      );
      // The newest snapshot's version matches the row it describes, with no gap behind it.
      expect(snapshots.rows[0]!.version).toBe(settled.version);
      expect(snapshots.rows[0]!.payload.status).toBe("superseded");
      expect(snapshots.rows.map((r) => r.version)).toEqual([2, 1]);
    });

    it("leaves standing alone for a relation that is not supersedes", async () => {
      const left = await author("Tokens are optional", "One reading.");
      const right = await author("Tokens are required", "Another reading.");

      await createAssertionRelation({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: right.assertionGuid,
        targetAssertionGuid: left.assertionGuid,
        relationType: "contradicts",
      });

      // A contradiction is not a resolution: both stay active until someone decides.
      expect((await statusOf(left.assertionGuid)).status).toBe("active");
      expect((await statusOf(right.assertionGuid)).status).toBe("active");
    });

    // The payload is what mutation_log renders from. Recording the target's unchanged status
    // under a field named for a transition would read as a transition that never happened.
    it("records no target status for a relation that transitions nothing", async () => {
      const left = await author("Tokens are optional", "One reading.");
      const right = await author("Tokens are required", "Another reading.");

      await createAssertionRelation({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: right.assertionGuid,
        targetAssertionGuid: left.assertionGuid,
        relationType: "contradicts",
      });

      const logged = await pool.query<{ resulting_value: Record<string, unknown> }>(
        `SELECT resulting_value FROM "${schemaName}".mutation_log
          WHERE entry_type = 'assertion.related' ORDER BY recorded_at DESC LIMIT 1`,
      );
      expect(logged.rows[0]!.resulting_value).not.toHaveProperty("targetStatus");
    });

    it("refuses a claim relating to itself", async () => {
      const one = await author("Tokens are required", "Only reading.");

      await expect(
        createAssertionRelation({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          sourceAssertionGuid: one.assertionGuid,
          targetAssertionGuid: one.assertionGuid,
          relationType: "contradicts",
        }),
      ).rejects.toThrow(SelfRelationError);
    });

    it("records one live relation per type per pair", async () => {
      const left = await author("Tokens are optional", "One reading.");
      const right = await author("Tokens are required", "Another reading.");
      const args = {
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        sourceAssertionGuid: right.assertionGuid,
        targetAssertionGuid: left.assertionGuid,
        relationType: "contradicts" as const,
      };

      const first = await createAssertionRelation(args);
      const second = await createAssertionRelation(args);

      // Recording "contradicts" twice is not two conflicts, and the replay must name the row
      // that exists rather than the guid it would have minted.
      expect(second.replayed).toBe(true);
      expect(second.relationGuid).toBe(first.relationGuid);
      const count = await pool.query<{ count: string }>(
        `SELECT count(*) FROM "${schemaName}".assertion_relations WHERE retired_at IS NULL`,
      );
      expect(Number(count.rows[0]!.count)).toBe(1);
    });
  });

  describe("setRecordScopes", () => {
    const scopesOf = async (assertionGuid: string) => {
      const rows = await pool.query<{ scope_slug: string; association_type: string }>(
        `SELECT s.scope_slug, a.association_type
           FROM "${schemaName}".record_scopes a
           JOIN "${schemaName}".scopes s ON s.scope_guid = a.scope_guid
          WHERE a.record_guid = $1 AND a.retired_at IS NULL
          ORDER BY s.scope_slug`,
        [assertionGuid],
      );
      return rows.rows;
    };

    it("adds and retires associations to match the requested set", async () => {
      const created = await author("Tokens are required", "The reading.");
      expect((await scopesOf(created.assertionGuid)).map((r) => r.scope_slug)).toEqual(["anchor-mcp"]);

      const result = await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: ["security"],
        reason: "this is about auth, not the project",
      });

      expect(result.added).toEqual(["security"]);
      expect(result.retired).toEqual(["anchor-mcp"]);
      const live = await scopesOf(created.assertionGuid);
      expect(live.map((r) => r.scope_slug)).toEqual(["security"]);
      // Marked as a judgement so a later import can tell it from anything derived.
      expect(live[0]!.association_type).toBe(CORRECTED_ASSOCIATION_TYPE);
    });

    it("keeps the retired association as history rather than deleting it", async () => {
      const created = await author("Tokens are required", "The reading.");
      await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: ["security"],
        reason: "moved",
      });

      // A reader asking why a record stopped routing somewhere needs the row to still exist.
      const retired = await pool.query<{ count: string }>(
        `SELECT count(*) FROM "${schemaName}".record_scopes
          WHERE record_guid = $1 AND retired_at IS NOT NULL`,
        [created.assertionGuid],
      );
      expect(Number(retired.rows[0]!.count)).toBe(1);
    });

    // record_scopes associations do not grant access, so filing the history under a scope the
    // record was merely associated with would expose its existence to that scope's readers.
    it("files the change under the record's owning scope, not one it was associated with", async () => {
      const created = await author("Tokens are required", "The reading.");
      const owner = await pool.query<{ owner_scope_guid: string }>(
        `SELECT owner_scope_guid FROM "${schemaName}".assertions WHERE assertion_guid = $1`,
        [created.assertionGuid],
      );

      await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: ["security"],
        reason: "this is about auth",
      });

      const logged = await pool.query<{ owner_scope_guid: string }>(
        `SELECT owner_scope_guid FROM "${schemaName}".mutation_log
          WHERE entry_type = 'record.scopesChanged' ORDER BY recorded_at DESC LIMIT 1`,
      );
      expect(logged.rows[0]!.owner_scope_guid).toBe(owner.rows[0]!.owner_scope_guid);
    });

    // Clearing every association has no requested scope to borrow an owner from, which is the
    // case that made the previous attribution impossible rather than merely wrong.
    it("can clear every association", async () => {
      const created = await author("Tokens are required", "The reading.");

      const result = await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: [],
        reason: "routes nowhere for now",
      });

      expect(result.retired).toEqual(["anchor-mcp"]);
      expect(await scopesOf(created.assertionGuid)).toEqual([]);
    });

    // record_guid is the row the association was made against, so a caller-supplied guid could
    // leave an audit trail pointing at a section that does not exist. It is resolved internally.
    it("resolves a section's owning scope and provenance guid from its stable key alone", async () => {
      const section = await pool.query<{ stable_key: string; section_guid: string }>(
        `SELECT stable_key, section_guid FROM "${schemaName}".source_sections
          WHERE title = 'Current State' LIMIT 1`,
      );

      const result = await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "section",
        // Deliberately absent: a section's provenance guid is not the caller's to supply.
        stableKey: section.rows[0]!.stable_key,
        scopeSlugs: ["security"],
        reason: "this section is about auth",
      });

      expect(result.added).toEqual(["security"]);
      const written = await pool.query<{ record_guid: string }>(
        `SELECT record_guid FROM "${schemaName}".record_scopes
          WHERE stable_key = $1 AND retired_at IS NULL AND association_type = $2`,
        [section.rows[0]!.stable_key, CORRECTED_ASSOCIATION_TYPE],
      );
      expect(written.rows[0]!.record_guid).toBe(section.rows[0]!.section_guid);
    });

    // Membership versions as its own aggregate: folding it into the assertion's stream would
    // advance record_versions without touching assertions.version, desyncing expectedVersion.
    it("versions membership as its own stream, not the record's", async () => {
      const created = await author("Tokens are required", "The reading.");
      const before = await statusOf(created.assertionGuid);

      await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: ["security"],
        reason: "this is about auth",
      });

      // The claim itself did not change, so its version must not have moved.
      expect((await statusOf(created.assertionGuid)).version).toBe(before.version);
      const streams = await pool.query<{ entity_type: string }>(
        `SELECT DISTINCT entity_type FROM "${schemaName}".record_versions
          WHERE entity_guid = $1`,
        [created.assertionGuid],
      );
      expect(streams.rows.map((r) => r.entity_type).sort()).toEqual(["assertion", MEMBERSHIP_ENTITY_TYPE].sort());
    });

    // An association to a retired scope is not a live membership; counting it would report a
    // scope as unchanged that nothing else in the codebase considers to exist.
    it("ignores associations whose scope has been retired", async () => {
      const created = await author("Tokens are required", "The reading.");
      await pool.query(
        `UPDATE "${schemaName}".scopes SET retired_at = now() WHERE scope_slug = 'anchor-mcp'`,
      );

      const result = await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: ["security"],
        reason: "the old scope is gone",
      });

      // The dead scope is neither retired again nor reported as still live membership.
      expect(result.retired).toEqual([]);
      expect(result.added).toEqual(["security"]);
    });

    // commands.idempotency_key is a btree index, so a literal key built from a long stable key
    // and a large scope set fails at write time on the size of the caller's data.
    it("keeps the idempotency key bounded regardless of input size", async () => {
      const created = await author("Tokens are required", "The reading.");
      const many = Array.from({ length: 60 }, (_, i) => `bulk-scope-${String(i).padStart(3, "0")}`);
      for (const slug of many) {
        await pool.query(
          `INSERT INTO "${schemaName}".scopes (workspace_guid, scope_guid, scope_slug, title, scope_kind)
           VALUES ($1, gen_random_uuid(), $2, $2, 'practice')`,
          [bootstrap.workspaceGuid, slug],
        );
      }

      await setRecordScopes({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        recordType: "assertion",
        recordGuid: created.assertionGuid,
        scopeSlugs: many,
        reason: "a very wide correction",
      });

      const key = await pool.query<{ idempotency_key: string }>(
        `SELECT idempotency_key FROM "${schemaName}".commands
          WHERE command_type = 'record.setScopes' ORDER BY accepted_at DESC LIMIT 1`,
      );
      expect(key.rows[0]!.idempotency_key.length).toBeLessThan(128);
    });

    it("refuses a section association given no stable key", async () => {
      await expect(
        setRecordScopes({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          recordType: "section",
          scopeSlugs: ["security"],
          reason: "no stable key supplied",
        }),
      ).rejects.toThrow(SectionStableKeyRequiredError);
    });

    it("names every unknown scope at once rather than one per round trip", async () => {
      const created = await author("Tokens are required", "The reading.");

      await expect(
        setRecordScopes({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          recordType: "assertion",
          recordGuid: created.assertionGuid,
          scopeSlugs: ["security", "nope-one", "nope-two"],
          reason: "two typos",
        }),
      ).rejects.toThrow(/nope-one, nope-two/);
      await expect(
        setRecordScopes({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          recordType: "assertion",
          recordGuid: created.assertionGuid,
          scopeSlugs: ["nope-one"],
          reason: "one typo",
        }),
      ).rejects.toThrow(UnknownScopeError);
    });
  });
});
