import type { Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorRepository } from "../../src/git/repo.js";
import { startHttpServer } from "../../src/http/server.js";
import { removeTempDir } from "../tempDir.js";

let tmpDir: string;
let server: Server | undefined;
let baseUrl: string;

const TOKEN = "test-token";

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-db-status-"));
  const repo = new AnchorRepository({ repoPath: tmpDir });
  await repo.ensureReady();

  server = await startHttpServer(
    {
      repoPath: tmpDir,
      anchorRoot: ".",
      autoSync: false,
      pushOnWrite: false,
      syncIntervalMs: 0,
      migrationWarnOnly: false,
      staleAfterDays: 45,
      graphScoring: { enabled: false, maxBoost: 8 },
    },
    {
      host: "127.0.0.1",
      port: 0,
      authToken: TOKEN,
      stateless: true,
    },
  );

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected HTTP server to listen on a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  await removeTempDir(tmpDir);
});

describe("GET /api/db/status", () => {
  it("reports the database backend as unconfigured when no databaseUrl is set", async () => {
    const response = await fetch(`${baseUrl}/api/db/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it("requires authentication", async () => {
    const response = await fetch(`${baseUrl}/api/db/status`);
    expect(response.status).toBe(401);
  });
});
