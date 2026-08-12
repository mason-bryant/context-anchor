import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATABASE_POOL_SIZE,
  DEFAULT_DATABASE_SCHEMA_NAME,
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
    });
  });

  it("keeps an explicit poolSize and schemaName", () => {
    expect(resolveDatabaseConfig({ poolSize: 4, schemaName: "knowledge_test" })).toEqual({
      poolSize: 4,
      schemaName: "knowledge_test",
    });
  });

  it("fills in only the missing field", () => {
    expect(resolveDatabaseConfig({ poolSize: 20 })).toEqual({
      poolSize: 20,
      schemaName: DEFAULT_DATABASE_SCHEMA_NAME,
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
