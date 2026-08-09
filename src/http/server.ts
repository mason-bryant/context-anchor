import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";

import { errorMetadata, type AppLogger } from "../logger.js";
import { createAnchorRuntime } from "../runtime.js";
import { createAnchorMcpServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { registerUiRoutes } from "../ui/routes.js";

export type HttpServerOptions = {
  host: string;
  port: number;
  allowedHosts?: string[];
  authToken?: string;
  stateless: boolean;
};

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCALHOST_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isLocalhostBinding(host: string): boolean {
  return LOCALHOST_HOSTS.has(host);
}

export async function startHttpServer(
  config: ServerConfig,
  options: HttpServerOptions,
  runtimeOptions: { logger?: AppLogger; databaseUrl?: string } = {},
): Promise<Server> {
  if (!options.authToken) {
    throw new Error(
      `HTTP transport requires an auth token. ` +
        `Supply one via --auth-token <token>, ANCHOR_MCP_AUTH_TOKEN, or "authToken" in --config.`,
    );
  }

  const runtime = await createAnchorRuntime(config, runtimeOptions);
  runtime.startAutoSync();
  runtime.logger.info("http server starting", {
    host: options.host,
    port: options.port,
    stateless: options.stateless,
    allowedHosts: options.allowedHosts,
  });

  const corsOrigin = isLocalhostBinding(options.host)
    ? (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || LOCALHOST_HOSTS.has(new URL(origin).hostname)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      }
    : false;

  const app = createMcpExpressApp({
    host: options.host,
    allowedHosts: buildAllowedHosts(options.allowedHosts),
    jsonLimit: "10mb",
  });
  app.use(
    cors({
      origin: corsOrigin,
      exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id", "Last-Event-Id", "Mcp-Protocol-Version"],
    }),
  );

  const auth = bearerAuth(options.authToken);
  app.use("/mcp", auth);
  registerUiRoutes(app, runtime.service, {
    authMiddleware: auth,
    traceIndex: runtime.traceIndex,
    traceRatings: runtime.traceRatings,
  });

  // T4's surface: the per-scope history view. The thread ships with its UI rather than
  // waiting for a batched UI phase (M12 decision).
  app.get("/api/db/scope-changes", auth, (req: Request, res: Response) => {
    void (async () => {
      const knowledgeDb = runtime.knowledgeDb;
      if (!knowledgeDb) {
        res.status(503).json({ error: "Database backend is not configured" });
        return;
      }

      // A repeated key arrives as an array. Treating that as absent would let an ambiguous
      // `?since=7d&since=24h` widen silently to all history — the very thing this route
      // 400s to prevent — and would let `limit` skip its validation entirely.
      let scope: string | undefined;
      let sinceParam: string | undefined;
      try {
        scope = singleStringParam(req.query.scope, "scope");
        sinceParam = singleStringParam(req.query.since, "since");
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }

      if (!scope) {
        res.status(400).json({ error: "scope is required (slug or guid)" });
        return;
      }

      // Validate before it can reach SQL: an unparseable limit would otherwise arrive as
      // NaN in the LIMIT parameter and surface as a 500 for what is caller error.
      let limit: number | undefined;
      let limitParam: string | undefined;
      try {
        limitParam = singleStringParam(req.query.limit, "limit");
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (limitParam !== undefined) {
        limit = Number(limitParam);
        if (!Number.isInteger(limit) || limit <= 0) {
          res.status(400).json({ error: "limit must be a positive integer" });
          return;
        }
      }

      try {
        const changes = await knowledgeDb.listScopeChangesForOwner({
          scope,
          since: sinceParam,
          limit,
        });
        res.json({ scope, changes });
      } catch (error) {
        // A bad scope or a malformed `since` is caller error, not a server fault; anything
        // else keeps its 500 so a real defect is not disguised as a validation message.
        const name = error instanceof Error ? error.name : "";
        if (name === "ScopeNotFoundError" || /invalid since/i.test(String(error))) {
          res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
          return;
        }
        runtime.logger.error("scope-changes request failed", { scope, error: errorMetadata(error) });
        res.status(500).json({ error: "Failed to read scope changes" });
      }
    })();
  });

  // Minimal "backend indicator" (design doc UI capability list): whether the database
  // backend is configured, and if so which schema and migration version answered. The full
  // routes/scope browser surface lands with later PRs; this is only enough to make a
  // missing tool diagnosable rather than mysterious.
  app.get("/api/db/status", auth, (_req: Request, res: Response) => {
    res.json(
      runtime.knowledgeDb
        ? {
            configured: true,
            schemaName: runtime.knowledgeDb.schemaName,
            schemaVersion: runtime.knowledgeDb.schemaVersion ?? null,
          }
        : { configured: false },
    );
  });

  if (options.stateless) {
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await runtime.mcpServer.connect(transport);
    app.all("/mcp", async (req: Request, res: Response) => {
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        runtime.logger.error("mcp http request failed", {
          method: req.method,
          path: req.path,
          error: errorMetadata(error),
        });
        throw error;
      }
    });
  } else {
    const transports = new Map<string, NodeStreamableHTTPServerTransport>();
    app.all("/mcp", async (req: Request, res: Response) => {
      const sessionId = req.header("mcp-session-id");
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) {
              transports.set(newSessionId, transport);
            }
          },
        });
        transport.onclose = () => {
          const closingSessionId = transport?.sessionId;
          if (closingSessionId) {
            transports.delete(closingSessionId);
          }
        };
        const sessionTransport = transport;
        await createAnchorMcpServer(runtime.service, {
          requestLogger: runtime.requestLogger,
          trace: {
            logger: runtime.traceLogger,
            connection: { transport: "http", getSessionId: () => sessionTransport.sessionId },
          },
          knowledgeDb: runtime.knowledgeDb,
        }).connect(transport);
      }

      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        runtime.logger.error("mcp http request failed", {
          method: req.method,
          path: req.path,
          sessionId: transport.sessionId,
          error: errorMetadata(error),
        });
        throw error;
      }
    });
  }

  const server = app.listen(options.port, options.host);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    runtime.stopAutoSync();
    runtime.logger.error("http server failed to start", {
      host: options.host,
      port: options.port,
      error: errorMetadata(error),
    });
    // Close the database pool too, or a failed bind (port in use) leaks its connections.
    // Every teardown is best-effort and individually caught so a cleanup failure cannot
    // mask the bind error the caller actually needs to see.
    await Promise.allSettled([
      runtime.requestLogger.close(),
      runtime.traceLogger.close(),
      runtime.logger.close(),
      runtime.knowledgeDb?.close() ?? Promise.resolve(),
    ]);
    throw error;
  }

  runtime.logger.info("http server listening", { host: options.host, port: options.port });
  server.once("close", () => {
    runtime.stopAutoSync();
    runtime.logger.info("http server closed", { host: options.host, port: options.port });
    // allSettled, matching the bind-failure path: nothing awaits this, so a rejecting
    // close (a pool already ended, a logger transport gone) would otherwise surface as an
    // unhandled rejection during shutdown.
    void Promise.allSettled([
      runtime.requestLogger.close(),
      runtime.traceLogger.close(),
      runtime.logger.close(),
      runtime.knowledgeDb?.close() ?? Promise.resolve(),
    ]);
  });
  return server;
}

/**
 * Read a query parameter that must appear at most once. Express represents a repeated key
 * as an array; accepting the first or last value would silently pick a winner among
 * contradictory inputs, so an ambiguous parameter is rejected instead.
 */
function singleStringParam(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    // Trimmed once here so a padded value resolves normally instead of failing downstream
    // with a misleading "no scope matched ' workspace '", and so the echoed value in the
    // response is the one actually resolved. An all-whitespace value becomes undefined,
    // which the caller then reports as missing rather than as not-found.
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  throw new Error(`${name} must be given at most once`);
}

export function buildAllowedHosts(configuredHosts: string[] | undefined): string[] | undefined {
  if (!configuredHosts?.length) {
    return undefined;
  }

  return [...new Set([...LOCALHOST_ALLOWED_HOSTS, ...configuredHosts])];
}

function safeTokenCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function bearerAuth(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    const explicit = req.header("x-anchor-mcp-token");

    const candidate = bearer ?? explicit ?? "";
    if (candidate && safeTokenCompare(candidate, expectedToken)) {
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", 'Bearer realm="anchor-mcp"');
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  };
}
