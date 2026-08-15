import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATABASE_POOL_SIZE,
  DEFAULT_DATABASE_SCHEMA_NAME,
  DEFAULT_TELEMETRY_RETENTION_SETTINGS,
  assertValidDatabaseUrl,
  assertValidSchemaName,
  redactDatabaseUrl,
  resolveDatabaseConfig,
} from "../../src/db/config.js";

describe("resolveDatabaseConfig", () => {
  it("applies defaults when nothing is supplied", () => {
    expect(resolveDatabaseConfig(undefined)).toEqual({
      poolSize: DEFAULT_DATABASE_POOL_SIZE,
      schemaName: DEFAULT_DATABASE_SCHEMA_NAME,
      // On by default, and asserted rather than assumed: this one flipped, and a default that
      // decides whether questions are retained should not move without a test noticing.
      storeTaskText: true,
      // Ninety days of readable questions, a year of countable ones. Asserted rather than
      // assumed for the same reason storeTaskText is: this is the only bound on a table that
      // grows on every routed request, and it should not move without a test noticing.
      telemetryRetention: { taskTextDays: 90, requestDays: 365, intervalHours: 6 },
    });
  });

  it("takes retention settings one at a time, keeping the defaults for the rest", () => {
    // A partial block must not blank the fields it omits. Supplying intervalHours alone -- the
    // realistic edit, from an operator moving to cron -- would otherwise silently drop both
    // windows to undefined and take retention with them.
    expect(resolveDatabaseConfig({ telemetryRetention: { intervalHours: 0 } }).telemetryRetention).toEqual({
      taskTextDays: 90,
      requestDays: 365,
      intervalHours: 0,
    });
  });

  it("refuses a request window below the task-text window", () => {
    // Not merely odd: rows would be deleted before their text window elapsed, so taskTextDays
    // could never take effect at any value. An operator who wrote 90 there stated an intention,
    // and making it silently unreachable is worse than refusing to start.
    expect(() =>
      resolveDatabaseConfig({ telemetryRetention: { taskTextDays: 90, requestDays: 30 } }),
    ).toThrow(/requestDays \(30\) is below taskTextDays \(90\)/);
  });

  it("refuses day counts that are not positive integers", () => {
    expect(() => resolveDatabaseConfig({ telemetryRetention: { taskTextDays: 0 } })).toThrow(
      /taskTextDays "0"/,
    );
    expect(() => resolveDatabaseConfig({ telemetryRetention: { requestDays: 1.5 } })).toThrow(
      /requestDays "1.5"/,
    );
    expect(() => resolveDatabaseConfig({ telemetryRetention: { taskTextDays: -1 } })).toThrow(
      /taskTextDays "-1"/,
    );
  });

  it("accepts a zero interval but refuses a negative one", () => {
    // Zero is meaningful -- it hands the schedule to cron -- so it cannot be validated the same
    // way as the day counts, which have no useful zero.
    expect(resolveDatabaseConfig({ telemetryRetention: { intervalHours: 0 } })).toBeTruthy();
    expect(() => resolveDatabaseConfig({ telemetryRetention: { intervalHours: -1 } })).toThrow(
      /intervalHours "-1"/,
    );
  });

  it("lets an operator turn task-text retention off for the whole workspace", () => {
    // The per-request flag cannot express this: every client would have to agree, and traffic
    // from one you do not control never will.
    expect(resolveDatabaseConfig({ storeTaskText: false }).storeTaskText).toBe(false);
    expect(resolveDatabaseConfig({ storeTaskText: true }).storeTaskText).toBe(true);
  });

  it("keeps an explicit poolSize and schemaName", () => {
    expect(resolveDatabaseConfig({ poolSize: 4, schemaName: "knowledge_test" })).toEqual({
      poolSize: 4,
      schemaName: "knowledge_test",
      storeTaskText: true,
      telemetryRetention: DEFAULT_TELEMETRY_RETENTION_SETTINGS,
    });
  });

  it("fills in only the missing field", () => {
    expect(resolveDatabaseConfig({ poolSize: 20 })).toEqual({
      poolSize: 20,
      schemaName: DEFAULT_DATABASE_SCHEMA_NAME,
      storeTaskText: true,
      telemetryRetention: DEFAULT_TELEMETRY_RETENTION_SETTINGS,
    });
  });

  it("rejects a non-positive poolSize", () => {
    expect(() => resolveDatabaseConfig({ poolSize: 0 })).toThrow(/poolSize/);
    expect(() => resolveDatabaseConfig({ poolSize: -1 })).toThrow(/poolSize/);
  });

  it("rejects a non-integer poolSize", () => {
    expect(() => resolveDatabaseConfig({ poolSize: 1.5 })).toThrow(/poolSize/);
  });

  it("rejects an invalid schemaName", () => {
    expect(() => resolveDatabaseConfig({ schemaName: "Knowledge" })).toThrow(/schemaName/);
    expect(() => resolveDatabaseConfig({ schemaName: "1knowledge" })).toThrow(/schemaName/);
    expect(() => resolveDatabaseConfig({ schemaName: "knowledge;drop table x" })).toThrow(/schemaName/);
  });
});

describe("assertValidSchemaName", () => {
  it("accepts lowercase identifiers with underscores", () => {
    expect(() => assertValidSchemaName("knowledge")).not.toThrow();
    expect(() => assertValidSchemaName("knowledge_test_2")).not.toThrow();
    expect(() => assertValidSchemaName("_private")).not.toThrow();
  });

  it("rejects identifiers that are not safe to interpolate into DDL", () => {
    expect(() => assertValidSchemaName("")).toThrow();
    expect(() => assertValidSchemaName("knowledge-test")).toThrow();
    expect(() => assertValidSchemaName("knowledge test")).toThrow();
    expect(() => assertValidSchemaName('"knowledge"')).toThrow();
    expect(() => assertValidSchemaName("knowledge; DROP SCHEMA public CASCADE;--")).toThrow();
  });
});

describe("redactDatabaseUrl", () => {
  it("replaces the password while keeping the parts an operator needs to identify the target", () => {
    const redacted = redactDatabaseUrl("postgres://anchor:sup3rs3cret@db.example.com:55432/anchor_mcp");
    expect(redacted).not.toContain("sup3rs3cret");
    expect(redacted).toBe("postgres://anchor:***@db.example.com:55432/anchor_mcp");
  });

  it("leaves a URL with no password untouched in substance", () => {
    const redacted = redactDatabaseUrl("postgres://anchor@127.0.0.1:55432/anchor_mcp");
    expect(redacted).toContain("anchor@127.0.0.1:55432/anchor_mcp");
    expect(redacted).not.toContain(":***@");
  });

  it("handles a URL with no userinfo at all", () => {
    expect(redactDatabaseUrl("postgres://127.0.0.1:55432/anchor_mcp")).toContain("127.0.0.1:55432/anchor_mcp");
  });

  it("never echoes an unparseable value back verbatim", () => {
    const redacted = redactDatabaseUrl("not a url with a s3cret in it");
    expect(redacted).not.toContain("s3cret");
  });

  it("redacts a password passed as a query parameter, not just as userinfo", () => {
    // Postgres accepts any connection parameter as a query key, and pg-connection-string honours
    // it — this is a working connection string, not a malformed one, and it used to pass through
    // this function untouched.
    const redacted = redactDatabaseUrl("postgres://db.example.com:55432/anchor_mcp?password=sup3rs3cret");
    expect(redacted).not.toContain("sup3rs3cret");
    expect(redacted).toContain("password=***");
    // The locator survives, which is the whole reason for redacting rather than dropping.
    expect(redacted).toContain("db.example.com:55432/anchor_mcp");
  });

  it("redacts every credential-bearing parameter, including repeats", () => {
    const redacted = redactDatabaseUrl(
      "postgres://host/db?password=one&sslpassword=two&password=three&application_name=anchor",
    );
    for (const secret of ["one", "two", "three"]) {
      expect(redacted).not.toContain(secret);
    }
    // Non-secret parameters are left alone; redacting them would cost diagnosability for nothing.
    expect(redacted).toContain("application_name=anchor");
  });

  it("keeps TLS file paths visible, since they locate rather than authenticate", () => {
    const redacted = redactDatabaseUrl("postgres://host/db?sslkey=/etc/certs/client.key&sslcert=/etc/certs/client.crt");
    expect(redacted).toContain("sslkey=");
    expect(redacted).toContain("client.key");
  });
});

describe("assertValidDatabaseUrl", () => {
  it("accepts postgres:// and postgresql:// connection strings", () => {
    expect(() => assertValidDatabaseUrl("postgres://user:pass@localhost:5432/db")).not.toThrow();
    expect(() => assertValidDatabaseUrl("postgresql://user:pass@localhost:55432/db")).not.toThrow();
  });

  it("rejects a value that is not a Postgres connection string", () => {
    expect(() => assertValidDatabaseUrl("mysql://user:pass@localhost/db")).toThrow(/postgres/i);
    expect(() => assertValidDatabaseUrl("not-a-url")).toThrow(/postgres/i);
    expect(() => assertValidDatabaseUrl("")).toThrow(/postgres/i);
  });
});
