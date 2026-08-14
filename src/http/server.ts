import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";

import type { AnchorService } from "../anchorService.js";
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

  // T8's surface: the comparison gate. Deliberately UI-only — an agent cannot judge whether
  // its own context was well chosen, because it never sees what it was not given. Both
  // answers to one real task, side by side, for a person to read.
  app.get("/api/db/comparison", auth, (req: Request, res: Response) => {
    void (async () => {
      const knowledgeDb = runtime.knowledgeDb;
      if (!knowledgeDb) {
        res.status(503).json({ error: "Database backend is not configured" });
        return;
      }

      let task: string | undefined;
      let referencedPaths: string[] = [];
      try {
        task = singleStringParam(req.query.task, "task");
        // Parsed like every other query param on this surface rather than by hand: a repeated
        // `paths` key arrives as an array, and the hand-rolled check treated that as "no paths
        // at all" — silently discarding the strongest signal the caller supplied, on the one
        // endpoint whose entire purpose is a fair comparison. Blank entries are dropped for the
        // same reason: "a,,b" must not offer the planners an empty path to resolve.
        const paths = singleStringParam(req.query.paths, "paths");
        referencedPaths = (paths ?? "")
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (!task) {
        res.status(400).json({ error: "task is required" });
        return;
      }

      try {
        // Both planners are asked the same question with the same evidence. Withholding the
        // caller's paths from the baseline would rig the gate in the routed side's favour:
        // path mapping is the strongest routed signal, so routed would win on evidence the
        // baseline was never given, and the comparison would measure the handicap rather than
        // the retrieval. A reader cannot see that from the two answers, which is what makes it
        // worth stating here.
        //
        // The routed planner is asked twice, with the record-lexical signal off and on. Nobody
        // has yet judged whether the routes that signal adds are relevant — it rescues tasks
        // that name no scope from reaching nothing at all, but widens one real task from 2
        // routes to 15 of 23 scopes — and that judgement is a person's to make from the two
        // answers side by side. Both run on every request rather than behind a toggle: the
        // comparison only means anything for the same task, and a reader who has to reload
        // with a flag is comparing two readings instead of one.
        // How much of each answer to disclose, and it is the reader's choice rather than this
        // endpoint's. The three levels answer different questions and the pane was previously
        // stuck on the third while looking like the second.
        //
        //   plan  — routes and their reasons, no records, against the legacy planner's own
        //           plan. The only symmetric comparison for judging *routing*, because both
        //           sides are then answering "which context would you pick".
        //   agent — exactly what planRoutedBundle hands an agent at its defaults, against the
        //           legacy plan with its anchors actually loaded. Symmetric, and the honest
        //           answer to "would an agent get a good answer".
        //   full  — everything both sides can offer. What this pane used to do unconditionally.
        //
        // `full` raises `listed` above the default 10 because this workspace holds 23 scopes
        // and the case worth judging is the one where the signal matches most of them: at the
        // default the pane saturates and a 14-scope widening and a 40-scope widening both
        // render as ten routes, so the instrument reports every blowout as the same size.
        // `expanded` is raised with it, because the default ranker sorts record-lexical last,
        // so a route the signal adds on title evidence alone sorts below every baseline route —
        // both expanded slots went to answers nobody is judging.
        const disclosure = singleStringParam(req.query.disclosure, "disclosure") ?? "plan";
        if (!["plan", "agent", "full"].includes(disclosure)) {
          res.status(400).json({ error: `disclosure must be one of: plan, agent, full` });
          return;
        }
        // `expanded` is the reader's, because it is the whole question. n routes come back with
        // their content and the rest come back as links to it, so this is the dial between "tell
        // me what exists" and "give me the top n". Absent, the disclosure preset picks it.
        let expandedParam: number | undefined;
        const rawExpanded = singleStringParam(req.query.expanded, "expanded");
        if (rawExpanded !== undefined && rawExpanded !== "") {
          expandedParam = Number(rawExpanded);
          if (!Number.isInteger(expandedParam) || expandedParam < 0 || expandedParam > 25) {
            res.status(400).json({ error: "expanded must be a whole number between 0 and 25" });
            return;
          }
        }

        const preset =
          disclosure === "plan"
            ? { listed: 25, expanded: 0 }
            : disclosure === "agent"
              ? undefined
              : { listed: 25, expanded: 8 };
        const budget =
          expandedParam === undefined
            ? preset
            : { listed: Math.max(preset?.listed ?? 10, expandedParam), expanded: expandedParam };

        // Identical inputs but for the one flag under test. Withholding anything else from
        // one side would show a difference the reader would attribute to recordLexical —
        // path mapping is the strongest signal kind, so a pane quietly denied referencedPaths
        // would look worse for a reason that has nothing to do with the signal. The same
        // argument the legacy baseline gets, applied between the two routed panes.
        const [routed, routedRecordLexical, legacy] = await Promise.allSettled([
          knowledgeDb.planRoutedBundleAsOwner({
            task,
            referencedPaths,
            ...(budget ? { budget } : {}),
            consumer: "comparison-gate",
          }),
          knowledgeDb.planRoutedBundleAsOwner({
            task,
            referencedPaths,
            ...(budget ? { budget } : {}),
            recordLexical: true,
            // Tagged apart from the signal-off call so the two remain separable in telemetry.
            // routingDiagnostics excludes both by this prefix, so neither counts as real
            // retrieval; keeping the tags distinct is what allows the two populations to be
            // told apart later if anyone wants to read the gate's own traffic deliberately.
            consumer: "comparison-gate-record-lexical",
          }),
          // The legacy side, taken to the same depth. At `plan` this is the planner alone,
          // which is what the pane always showed — and comparing that against routed answers
          // carrying expanded records made routed look richer on every task regardless of
          // whether it routed well. The planner returns a *suggested* loadContext call rather
          // than content, so matching the depth means making that call.
          legacyBundle(runtime.service, task, referencedPaths, disclosure),
        ]);

        // Settled rather than all: the record-lexical call is the newest and heaviest query
        // here, scanning every active assertion title and current section heading. If it
        // fails, the routed-versus-legacy comparison that worked before this pane existed
        // should still answer, rather than the whole gate returning 500. A pane that failed
        // says so in place, which is also the honest thing to show a reader judging results.
        const settled = (outcome: PromiseSettledResult<unknown>) =>
          outcome.status === "fulfilled" ? outcome.value : null;
        const failure = (outcome: PromiseSettledResult<unknown>) =>
          outcome.status === "rejected"
            ? { error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) }
            : null;

        for (const outcome of [routed, routedRecordLexical, legacy]) {
          if (outcome.status === "rejected") {
            runtime.logger.error("comparison pane failed", { error: errorMetadata(outcome.reason) });
          }
        }

        res.json({
          task,
          // Echoed so the pane can say which comparison the reader is looking at. A gate that
          // silently runs at a non-default budget shows an answer no agent would receive, and
          // a reader judging "would an agent do well here" cannot tell.
          disclosure,
          routed: settled(routed),
          routedRecordLexical: settled(routedRecordLexical),
          legacy: settled(legacy),
          failures: {
            routed: failure(routed),
            routedRecordLexical: failure(routedRecordLexical),
            legacy: failure(legacy),
          },
        });
      } catch (error) {
        runtime.logger.error("comparison request failed", { error: errorMetadata(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });

  app.get("/api/db/routing-diagnostics", auth, (req: Request, res: Response) => {
    void (async () => {
      const knowledgeDb = runtime.knowledgeDb;
      if (!knowledgeDb) {
        res.status(503).json({ error: "Database backend is not configured" });
        return;
      }
      let sinceDays: number | undefined;
      try {
        // Same parser as every other query param here: a repeated `days` key is ambiguous, and
        // reading it as "not supplied" would silently serve the default window to a reader who
        // asked for a different one — on the endpoint whose entire job is to report honestly.
        const daysParam = singleStringParam(req.query.days, "days");
        if (daysParam !== undefined) {
          // Number rather than parseInt, which accepts a numeric prefix: parseInt("10abc") is
          // 10, so a malformed window would be honoured instead of refused.
          sinceDays = Number(daysParam);
          if (!Number.isInteger(sinceDays) || sinceDays <= 0) {
            res.status(400).json({ error: "days must be a positive integer" });
            return;
          }
        }
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }

      try {
        res.json(await knowledgeDb.routingDiagnosticsAsOwner({ sinceDays }));
      } catch (error) {
        runtime.logger.error("routing diagnostics request failed", { error: errorMetadata(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
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

  // T2's surface: the scope browser's backing read — what the import produced, with each
  // derived association carrying the signal behind it so an inference is never mistaken for
  // a decision.
  app.get("/api/db/scopes", auth, (_req: Request, res: Response) => {
    void (async () => {
      const knowledgeDb = runtime.knowledgeDb;
      if (!knowledgeDb) {
        res.status(503).json({ error: "Database backend is not configured" });
        return;
      }

      try {
        res.json({ scopes: await knowledgeDb.listScopesForOwner() });
      } catch (error) {
        runtime.logger.error("scopes request failed", { error: errorMetadata(error) });
        res.status(500).json({ error: "Failed to read scopes" });
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
    // response is the one actually resolved.
    //
    // A present-but-blank value is returned as "" rather than collapsed to undefined, and
    // that distinction matters: undefined means "not supplied", and for `since` that means
    // no lower bound — so `?since=` would silently widen to all history, which is the
    // failure this route 400s on malformed and repeated `since` to prevent. Each parameter's
    // own validation rejects "" instead.
    return value.trim();
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

/**
 * The legacy answer at the requested disclosure depth.
 *
 * `planContextBundle` returns a plan — included anchors, why each was chosen, and a *suggested*
 * `loadContext` call. It never returns content. So a pane that put that plan beside routed
 * answers carrying expanded records was comparing a plan against a plan plus its content, and
 * routed looked richer on every task whether or not it had routed well.
 *
 * At `plan` the two sides are both plans. Above that the suggestion is followed, which is what
 * an agent driving the legacy path would do next.
 */
async function legacyBundle(
  service: AnchorService,
  task: string,
  filePaths: string[],
  disclosure: string,
): Promise<Record<string, unknown>> {
  const plan = await service.planContextBundle({ task, filePaths });
  if (disclosure === "plan") {
    return { ...plan };
  }

  const names = plan.included.map((anchor: { name: string }) => anchor.name);
  if (names.length === 0) {
    return { ...plan };
  }

  // Excerpts at `agent`, full bodies at `full`, mirroring what each level asks of the routed
  // side. `task` is passed so excerpting picks sections relevant to it rather than the head of
  // each anchor — withholding it would hand the baseline a worse answer for a reason that has
  // nothing to do with routing.
  const loaded = await service.loadContext({
    names,
    includeContent: disclosure === "agent" ? "excerpt" : "full",
    task,
  });
  return { ...plan, bundle: loaded };
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
