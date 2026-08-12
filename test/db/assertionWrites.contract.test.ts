import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { createAssertion } from "../../src/db/createAssertion.js";
import { createAssertionRelation, SelfRelationError } from "../../src/db/createAssertionRelation.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { setAssertionStatus, AssertionNotFoundError } from "../../src/db/setAssertionStatus.js";
import {
  setRecordScopes,
  CORRECTED_ASSOCIATION_TYPE,
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

    it("refuses a section association given no stable key", async () => {
      await expect(
        setRecordScopes({
          pool,
          schemaName,
          handler,
          workspaceGuid: bootstrap.workspaceGuid,
          actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
          recordType: "section",
          recordGuid: randomUUID(),
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
