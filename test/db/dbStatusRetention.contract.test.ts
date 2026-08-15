import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDbCommand } from "../../src/cli/dbCommands.js";
import { telemetrySchemaNameFor } from "../../src/db/config.js";
import { thinTelemetry } from "../../src/db/telemetryRetention.js";
import {
  dropAllSchemas,
  isTestDatabaseReachable,
  migrateAllSchemas,
  TEST_DATABASE_URL,
  testSchemaName,
} from "./testDatabase.js";

/**
 * What `db status` says about retention — the command an operator runs to find out whether
 * thinning is happening at all.
 */
describe.runIf(await isTestDatabaseReachable())("db status retention lines (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    schemaName = testSchemaName("dbstatus_test");
    await migrateAllSchemas(pool, schemaName);
  });

  afterEach(async () => {
    await dropAllSchemas(pool, schemaName);
    await pool.end();
  });

  const status = async (context: Record<string, unknown> = {}): Promise<string> => {
    const lines: string[] = [];
    await runDbCommand(
      { command: "status" },
      { databaseUrl: TEST_DATABASE_URL, schemaName, log: (message) => lines.push(message), ...context },
    );
    return lines.join("\n");
  };

  it("reports never having run, beside what is waiting", async () => {
    const output = await status();
    expect(output).toContain("retention: task text 90d, requests 365d");
    // The state that went unnoticed for a week. "never" has to be a word on the screen, because
    // its absence looked exactly like success.
    expect(output).toContain("last run: never");
    expect(output).toContain("past window now:");
  });

  it("reports the last run once retention has run", async () => {
    await thinTelemetry(pool, telemetrySchemaNameFor(schemaName), {
      taskTextDays: 90,
      requestDays: 365,
    });

    const output = await status();
    expect(output).not.toContain("last run: never");
    expect(output).toMatch(/last run: \d{4}-\d{2}-\d{2}T/);
  });

  it("applies the configured windows rather than its own", async () => {
    // A CLI with its own defaults would give "how long is telemetry kept" two answers, and the
    // operator would find out from data that outlived the number they set.
    const output = await status({ telemetryRetention: { taskTextDays: 7, requestDays: 30 } });
    expect(output).toContain("retention: task text 7d, requests 30d");
  });

  it("says so when the retention status cannot be read", async () => {
    // Began as a bare `catch {}`, which swallowed permission errors, a dropped connection, and
    // any bug in the query as readily as a missing table -- so the one command that answers
    // "is retention happening" would have answered by omission. Raised in review on 15da6eb.
    //
    // Driven with an unusable policy because that is a real error from this call that is not a
    // missing relation: the status reader validates, and its Error carries no Postgres code.
    const output = await status({ telemetryRetention: { taskTextDays: 90, requestDays: 30 } });
    expect(output).toContain("retention: status unavailable");
    expect(output).toContain("is below taskTextDays");
  });

  it("stays quiet about retention when the telemetry schema is not there yet", async () => {
    // The migration lines above already say the schema is absent. Repeating it as a retention
    // failure would describe a migration problem as a retention problem.
    const absent = `${schemaName}_missing`;
    const lines: string[] = [];
    await runDbCommand(
      { command: "status" },
      { databaseUrl: TEST_DATABASE_URL, schemaName: absent, log: (message) => lines.push(message) },
    );
    const output = lines.join("\n");

    expect(output).toContain("(does not exist)");
    expect(output).not.toContain("status unavailable");
    expect(output).not.toContain("last run:");
  });
});
