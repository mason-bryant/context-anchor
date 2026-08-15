import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { thinTelemetry } from "../src/db/telemetryRetention.js";

const POLICY = { taskTextDays: 90, requestDays: 365 };

/**
 * A pool whose client fails on a named statement, and optionally on ROLLBACK too.
 *
 * Hand-built rather than driven through Postgres because the case worth covering is a connection
 * that has already died: a real database cannot be asked to fail a rollback on cue, and the whole
 * question is which of two errors reaches the caller.
 */
function poolFailingOn(statement: string, options: { rollbackAlsoFails?: boolean } = {}): Pool {
  const client = {
    query: async (text: string): Promise<unknown> => {
      if (text === "ROLLBACK" && options.rollbackAlsoFails) {
        throw new Error("Connection terminated unexpectedly");
      }
      if (text.includes(statement)) {
        throw new Error(`deliberate failure in ${statement}`);
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => {},
  };
  return { connect: async () => client } as unknown as Pool;
}

describe("thinTelemetry transaction handling", () => {
  it("reports the failure that happened, not the rollback that followed it", async () => {
    // A dropped connection fails the pass and is guaranteed to fail the ROLLBACK with it. If the
    // rollback's error escaped, it would replace the error explaining the problem with one that
    // merely restates its consequence. Raised in review on d0ac9cf.
    await expect(
      thinTelemetry(poolFailingOn("DELETE FROM", { rollbackAlsoFails: true }), "telemetry_test", POLICY),
    ).rejects.toThrow(/deliberate failure in DELETE FROM/);
  });

  it("still rolls back and rethrows when the rollback succeeds", async () => {
    // The ordinary case, so discarding the rollback's error cannot quietly become discarding the
    // rollback.
    const attempted: string[] = [];
    const client = {
      query: async (text: string): Promise<unknown> => {
        attempted.push(text.trim().split("\n")[0]!.trim());
        if (text.includes("UPDATE")) {
          throw new Error("deliberate failure in UPDATE");
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    };
    const pool = { connect: async () => client } as unknown as Pool;

    await expect(thinTelemetry(pool, "telemetry_test", POLICY)).rejects.toThrow(/deliberate failure in UPDATE/);
    expect(attempted).toContain("BEGIN");
    expect(attempted).toContain("ROLLBACK");
    expect(attempted).not.toContain("COMMIT");
  });
});
