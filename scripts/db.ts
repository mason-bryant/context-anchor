#!/usr/bin/env node
/**
 * Local Postgres lifecycle CLI for the database-backed redesign (G-042/M12 PR1).
 * Dev-only: this script is not part of the published `anchor-mcp` package, unlike
 * `migrations/`, which the server itself reads at startup.
 *
 * Usage: npm run db:<command>, or `tsx scripts/db.ts <command>`.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import pg from "pg";

import { parseDbCliArgs, resolveDbCliSchemaName } from "../src/db/cliArgs.js";
import { redactDatabaseUrl } from "../src/db/config.js";
import { getMigrationStatus, runMigrations } from "../src/db/migrate.js";

// Must match docker-compose.yml's postgres service (also mirrored in
// test/db/testDatabase.ts, which is why CI's Postgres service binds the same port).
const DEFAULT_DEV_DATABASE_URL = "postgres://anchor:anchor@127.0.0.1:55432/anchor_mcp";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations", "knowledge");
const DATA_DIR = path.join(REPO_ROOT, ".data", "postgres");
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, "anchor-mcp.config.json");

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
}

/**
 * Same `database.schemaName` the server resolves, so `db migrate` cannot quietly target a
 * different schema than the one the server then refuses to start against.
 */
function schemaName(): string {
  const configPath = process.env.ANCHOR_MCP_CONFIG
    ? path.resolve(process.env.ANCHOR_MCP_CONFIG)
    : existsSync(DEFAULT_CONFIG_PATH)
      ? DEFAULT_CONFIG_PATH
      : undefined;
  return resolveDbCliSchemaName({ env: process.env, configPath });
}

function dockerCompose(args: string[], options: { stdio?: "inherit" | "pipe" } = {}): void {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: REPO_ROOT,
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} exited with code ${String(result.status)}`);
  }
}

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: databaseUrl() });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `Postgres did not become ready within ${String(timeoutMs)}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function migrate(): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  try {
    const { applied } = await runMigrations(pool, { schemaName: schemaName(), migrationsDir: MIGRATIONS_DIR });
    if (applied.length === 0) {
      console.log("No pending migrations.");
    } else {
      for (const file of applied) {
        console.log(`Applied ${file.filename}`);
      }
    }
  } finally {
    await pool.end();
  }
}

async function printStatus(): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  try {
    const status = await getMigrationStatus(pool, { schemaName: schemaName(), migrationsDir: MIGRATIONS_DIR });
    console.log(`schema: ${status.schemaName}`);
    console.log(`applied: ${String(status.appliedCount)}`);
    console.log(`pending: ${String(status.pendingCount)}`);
    console.log(`current version: ${status.currentVersion ?? "none"}`);
    for (const file of status.pending) {
      console.log(`  pending: ${file.filename}`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseDbCliArgs(process.argv.slice(2));

  switch (args.command) {
    case "up": {
      dockerCompose(["up", "-d", "postgres"]);
      await waitForReady();
      await migrate();
      console.log(`Postgres ready at ${redactDatabaseUrl(databaseUrl())}`);
      break;
    }
    case "down": {
      dockerCompose(["down"]);
      break;
    }
    case "status": {
      await printStatus();
      break;
    }
    case "migrate": {
      await migrate();
      break;
    }
    case "psql": {
      dockerCompose(["exec", "postgres", "psql", "-U", "anchor", "-d", "anchor_mcp"]);
      break;
    }
    case "reset": {
      dockerCompose(["down"]);
      if (existsSync(DATA_DIR)) {
        await rm(DATA_DIR, { recursive: true, force: true });
      }
      dockerCompose(["up", "-d", "postgres"]);
      await waitForReady();
      await migrate();
      console.log(`Postgres reset and ready at ${redactDatabaseUrl(databaseUrl())}`);
      break;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
