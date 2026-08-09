import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATABASE_POOL_SIZE,
  DEFAULT_DATABASE_SCHEMA_NAME,
  assertValidDatabaseUrl,
  assertValidSchemaName,
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
