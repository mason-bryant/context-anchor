import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKnowledgeDatabase, MigrationsPendingError } from "../../src/db/knowledgeDb.js";
import { runMigrations } from "../../src/db/migrate.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

describe.runIf(await isTestDatabaseReachable())("createKnowledgeDatabase startup checks (real Postgres)", () => {
  let adminPool: Pool;
  let schemaName: string;

  beforeEach(() => {
    adminPool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  });

  afterEach(async () => {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  it("refuses to start when the schema has never been migrated", async () => {
    await expect(
      createKnowledgeDatabase(TEST_DATABASE_URL, { poolSize: 2, schemaName }),
    ).rejects.toThrow(MigrationsPendingError);
  });

  it("the failure message tells the operator to run db migrate", async () => {
    await expect(createKnowledgeDatabase(TEST_DATABASE_URL, { poolSize: 2, schemaName })).rejects.toThrow(
      /db migrate/,
    );
  });

  it("starts successfully once migrations have been applied", async () => {
    const readySchema = `${schemaName}_ready`;
    await runMigrations(adminPool, { schemaName: readySchema, migrationsDir: REAL_MIGRATIONS_DIR });

    const db = await createKnowledgeDatabase(TEST_DATABASE_URL, { poolSize: 2, schemaName: readySchema });
    try {
      const scopes = await db.listScopesForOwner();
      expect(scopes.map((s) => s.scopeSlug)).toContain("workspace");
    } finally {
      await db.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}_ready" CASCADE`);
    }
  });
});
