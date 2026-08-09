import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import pg from "pg";

import type { CliOptions } from "./args.js";
import { isPortListening, readPidFile, runtimePaths, type ProcessProbe, defaultProcessProbe } from "./lifecycle.js";
import { MIGRATIONS_DIR } from "./dbCommands.js";
import { getMigrationStatus } from "../db/migrate.js";
import { DEFAULT_DATABASE_SCHEMA_NAME, redactDatabaseUrl } from "../db/config.js";

export type StatusOptions = {
  home?: string;
  probe?: ProcessProbe;
  /** Injected in tests; defaults to a real migration-status query. */
  readDatabase?: (databaseUrl: string, schemaName: string) => Promise<{ version: number | null; pending: number }>;
};

async function readDatabaseStatus(
  databaseUrl: string,
  schemaName: string,
): Promise<{ version: number | null; pending: number }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 3_000 });
  try {
    const status = await getMigrationStatus(pool, { schemaName, migrationsDir: MIGRATIONS_DIR });
    return { version: status.currentVersion ?? null, pending: status.pendingCount };
  } finally {
    await pool.end();
  }
}

/**
 * An anchor repository is created on demand if the path does not exist, so a mistyped or
 * defaulted `repo` produces an empty repo that serves 500s on every lookup rather than
 * failing at startup. Naming that here is the difference between "wrong path" and an
 * inscrutable ENOENT from the UI.
 */
function describeRepo(repoPath: string): string {
  if (!existsSync(repoPath)) {
    return " — does not exist yet (it will be created on first use)";
  }

  let anchors = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || anchors > 0) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.name.endsWith(".md")) {
        anchors += 1;
        return;
      }
    }
  };

  try {
    walk(repoPath, 0);
  } catch {
    return " — unreadable";
  }

  return anchors > 0 ? "" : " — EMPTY: no anchors found, every lookup will 404/500";
}

/**
 * Reports resolved setup rather than a supervised process: which config was used, where the
 * anchor repo is, whether the database is reachable and migrated, and whether anything is
 * answering on the configured port. Nothing here needs a daemon.
 */
export async function statusReport(options: CliOptions, statusOptions: StatusOptions = {}): Promise<string[]> {
  const lines: string[] = [];
  const { pidFile, logFile } = runtimePaths(options.host, options.port, statusOptions.home);

  lines.push(`config     ${options.configPath ?? "none found (using flags, environment, and defaults)"}`);
  lines.push(`repo       ${options.config.repoPath}${describeRepo(options.config.repoPath)}`);
  lines.push(`transport  ${options.transport}`);
  // Never the token itself: `status` is the command people paste into issues.
  lines.push(`auth       ${options.authToken ? "token configured" : "no token"}`);

  if (!options.databaseUrl) {
    lines.push("database   not configured (Git-backed tools only)");
  } else {
    const schemaName = options.config.database?.schemaName ?? DEFAULT_DATABASE_SCHEMA_NAME;
    const read = statusOptions.readDatabase ?? readDatabaseStatus;
    try {
      const { version, pending } = await read(options.databaseUrl, schemaName);
      lines.push(
        `database   ${redactDatabaseUrl(options.databaseUrl)} — schema "${schemaName}", ` +
          `version ${version ?? "none"}, ${String(pending)} pending`,
      );
      if (pending > 0) {
        lines.push(`           run \`anchor-mcp db migrate\` — the server will not start with pending migrations`);
      }
    } catch (error) {
      lines.push(
        `database   ${redactDatabaseUrl(options.databaseUrl)} — unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const record = await readPidFile(pidFile);
  const listening = await isPortListening(options.host, options.port);
  const probe = statusOptions.probe ?? defaultProcessProbe;

  if (record && probe.isAlive(record.pid)) {
    lines.push(`server     running detached (pid ${String(record.pid)}) on ${options.host}:${String(options.port)}`);
    lines.push(`log        ${logFile}`);
  } else if (record) {
    lines.push(`server     stale pidfile at ${pidFile} (process ${String(record.pid)} is gone)`);
  } else if (listening) {
    // Someone else's process, or a foreground `serve` — either way we did not start it.
    lines.push(`server     something is listening on ${options.host}:${String(options.port)}, not started by \`start\``);
  } else {
    lines.push(`server     nothing listening on ${options.host}:${String(options.port)}`);
  }

  return lines;
}
