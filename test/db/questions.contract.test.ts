import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { importDocuments } from "../../src/db/importDocuments.js";
import { recordedQuestions } from "../../src/db/questions.js";
import { planRoutedBundle } from "../../src/db/routing/plan.js";
import { defaultRanker, type Ranker } from "../../src/db/routing/ranker.js";
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
`;

describe.runIf(await isTestDatabaseReachable())("recorded questions (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let telemetrySchema: string;
  let bootstrap: BootstrapResult;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = testSchemaName("questions_test");
    telemetrySchema = telemetrySchemaNameFor(schemaName);
    await migrateAllSchemas(pool, schemaName);
    bootstrap = await ensureBootstrap(pool, { schemaName });

    await importDocuments({
      pool,
      schemaName,
      handler: new CommandHandler(pool, schemaName),
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "agent-context",
      commitSha: "q".repeat(40),
      files: [{ path: "projects/anchor-mcp/anchor-mcp-project-context.md", content: DOC }],
      // Two scopes, deliberately. With one route there is no order to get wrong, and the
      // ordering assertion below would pass against any ORDER BY at all.
      scopes: [
        { scope: "anchor-mcp", title: "Anchor MCP", kind: "domain", locators: [] },
        { scope: "http-transport", title: "HTTP Transport", kind: "domain", partOf: "anchor-mcp", locators: [] },
      ],
    });
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const ask = (task: string, extra: Record<string, unknown> = {}) =>
    planRoutedBundle(pool, schemaName, telemetrySchema, {
      workspaceGuid: bootstrap.workspaceGuid,
      principalGuid: bootstrap.ownerPrincipalGuid,
      role: "owner",
      task,
      ...extra,
    });

  const list = (query: Record<string, unknown> = {}) =>
    recordedQuestions(pool, telemetrySchema, { workspaceGuid: bootstrap.workspaceGuid, ...query });

  it("returns the question and the answer beside it", async () => {
    // Names both scopes, so more than one route comes back and their order is testable.
    const planned = await ask("anchor mcp http transport");
    expect(planned.routes.length).toBeGreaterThan(1);

    const [question] = await list();
    expect(question?.requestId).toBe(planned.requestId);
    expect(question?.taskText).toBe("anchor mcp http transport");
    expect(question?.taskHash).toHaveLength(64);
    expect(question?.routesOffered).toBe(planned.routes.length);
    expect(question?.routes.map((route) => route.routeKey)).toEqual(
      planned.routes.map((route) => route.routeKey),
    );
    // Ordered by offered position, so the reader sees the answer in the order the caller did.
    // Compared against a range built from the route COUNT rather than from the same array --
    // deriving the expectation from the thing under test asserts nothing.
    expect(question?.routes.map((route) => route.position)).toEqual(
      Array.from({ length: planned.routes.length }, (_, index) => index),
    );
  });

  it("reports a question whose text was never recorded, rather than hiding it", async () => {
    // Text was opt-in before 2026-08-15, so real rows predate retention. A question that was
    // asked and not recorded is a different thing from no question, and dropping it would
    // misrepresent how much traffic this view covers.
    // A task that actually routes, so this checks the withheld *text* rather than accidentally
    // checking a zero-route question twice.
    await ask("anchor mcp", { storeTaskText: false });

    const [question] = await list();
    expect(question?.taskText).toBeNull();
    expect(question?.taskHash).toHaveLength(64);
    expect(question?.routesOffered).toBeGreaterThan(0);
  });

  it("can be narrowed to questions whose text survives", async () => {
    await ask("anchor mcp", { storeTaskText: false });
    await ask("anchor mcp");

    const all = await list();
    const readable = await list({ withTextOnly: true });
    expect(all).toHaveLength(2);
    expect(readable).toHaveLength(1);
    expect(readable[0]?.taskText).toBe("anchor mcp");
  });

  it("keeps a zero-route question, which is the most interesting row here", async () => {
    // The join to impressions is LEFT for this: a question that routed nowhere has no impression
    // rows at all, and an inner join would drop precisely the failure a reader came to see.
    // Deliberately free of any term this fixture holds -- "workspace" is a scope slug here, so
    // a task mentioning it routes and would quietly test the opposite of what this says.
    await ask("upgrade the kubernetes ingress controller");

    const [question] = await list();
    expect(question?.taskText).toBe("upgrade the kubernetes ingress controller");
    expect(question?.routesOffered).toBe(0);
    expect(question?.routes).toEqual([]);
  });

  it("counts routes offered, not rows recorded, when a shadow ranker also ordered them", async () => {
    // A shadow ranker records its own impressions and can never change the answer. Counting
    // them as offered would double the number a reader sees and attribute routes to the caller
    // that the caller was never shown.
    const reversed: Ranker = {
      id: "reversed",
      version: "1.0.0",
      deterministic: true,
      // Delegates to the real ranker and reverses it: a shadow must return RankedRoute, and
      // hand-building those here would test my construction rather than the query.
      rank: async (candidates) => (await defaultRanker.rank(candidates)).reverse(),
    };
    const planned = await planRoutedBundle(
      pool,
      schemaName,
      telemetrySchema,
      {
        workspaceGuid: bootstrap.workspaceGuid,
        principalGuid: bootstrap.ownerPrincipalGuid,
        role: "owner",
        task: "anchor mcp http transport",
      },
      { shadowRankers: [reversed] },
    );

    const shadowRows = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${telemetrySchema}".retrieval_route_impressions
        WHERE request_guid = $1 AND is_shadow = true`,
      [planned.requestId],
    );
    expect(Number(shadowRows.rows[0]!.n)).toBeGreaterThan(0);

    const [question] = await list();
    expect(question?.routesOffered).toBe(planned.routes.length);
    expect(question?.routes).toHaveLength(planned.routes.length);
  });

  it("excludes the instruments unless asked, because they are nobody's questions", async () => {
    await ask("a real question");
    await ask("a corpus task", { consumer: "routing-corpus" });
    await ask("a gate task", { consumer: "comparison-gate" });

    const real = await list();
    expect(real.map((question) => question.taskText)).toEqual(["a real question"]);

    const everything = await list({ includeInstruments: true });
    expect(everything).toHaveLength(3);
  });

  it("returns newest first, with a stable order under identical timestamps", async () => {
    // created_at is not unique under load, and a list that reorders between reads cannot be
    // paged or compared. The guid breaks the tie.
    const fixed = new Date("2026-08-15T00:00:00.000Z");
    for (const task of ["first", "second", "third"]) {
      await planRoutedBundle(
        pool,
        schemaName,
        telemetrySchema,
        {
          workspaceGuid: bootstrap.workspaceGuid,
          principalGuid: bootstrap.ownerPrincipalGuid,
          role: "owner",
          task,
        },
        { now: () => fixed },
      );
    }

    const once = await list();
    const twice = await list();
    expect(once.map((question) => question.requestId)).toEqual(
      twice.map((question) => question.requestId),
    );
    expect(once).toHaveLength(3);
  });

  it("bounds the number of rows it will return", async () => {
    for (const task of ["one", "two", "three"]) {
      await ask(task);
    }
    expect(await list({ limit: 2 })).toHaveLength(2);
    // Clamped upward too. A limit of zero would otherwise reach SQL as LIMIT 0 and return an
    // empty list that reads as "no questions" rather than as a bad argument.
    expect((await list({ limit: 0 })).length).toBeGreaterThan(0);
    // Clamped rather than trusted: this reads a table that only grows and has no retention job
    // behind it yet.
    expect((await list({ limit: 100_000 })).length).toBeLessThanOrEqual(500);
  });

  it("refuses a schema name that would reach SQL as an identifier", async () => {
    await expect(
      recordedQuestions(pool, 'evil"; DROP SCHEMA public CASCADE; --', {
        workspaceGuid: bootstrap.workspaceGuid,
      }),
    ).rejects.toThrow(/Invalid database schemaName/);
  });
});
