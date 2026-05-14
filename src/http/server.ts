import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";

import { createAnchorRuntime } from "../runtime.js";
import { createAnchorMcpServer } from "../server.js";
import type { ServerConfig } from "../types.js";

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

export async function startHttpServer(config: ServerConfig, options: HttpServerOptions): Promise<Server> {
  if (!isLocalhostBinding(options.host) && !options.authToken) {
    throw new Error(
      `HTTP server is bound to ${options.host} but no auth token is configured. ` +
        `Refusing to start an unauthenticated server on a non-localhost interface. ` +
        `Supply a token via --auth-token <token>, ANCHOR_MCP_AUTH_TOKEN, or "authToken" in --config, or bind to 127.0.0.1.`,
    );
  }

  const runtime = await createAnchorRuntime(config);
  runtime.startAutoSync();

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

  if (options.authToken) {
    app.use("/mcp", bearerAuth(options.authToken));
  }

  if (options.stateless) {
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await runtime.mcpServer.connect(transport);
    app.all("/mcp", async (req: Request, res: Response) => {
      await transport.handleRequest(req, res, req.body);
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
        await createAnchorMcpServer(runtime.service).connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    });
  }

  const server = app.listen(options.port, options.host);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  server.once("close", () => runtime.stopAutoSync());
  return server;
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
