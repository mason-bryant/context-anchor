import { AnchorService } from "./anchorService.js";
import { createKnowledgeDatabase, type KnowledgeDatabase } from "./db/knowledgeDb.js";
import { AutoSync } from "./git/autoSync.js";
import { AnchorRepository } from "./git/repo.js";
import { createAppLogger, createRequestLogger, type AppLogger, type RequestLogger } from "./logger.js";
import { createAnchorMcpServer } from "./server.js";
import { TraceIndex } from "./trace/index.js";
import { createTraceLogger, type TraceLogger } from "./trace/logger.js";
import { TraceRatingsStore } from "./trace/ratings.js";
import type { ServerConfig } from "./types.js";

export type AnchorRuntime = {
  repo: AnchorRepository;
  service: AnchorService;
  mcpServer: ReturnType<typeof createAnchorMcpServer>;
  autoSync: AutoSync;
  logger: AppLogger;
  requestLogger: RequestLogger;
  traceLogger: TraceLogger;
  traceIndex: TraceIndex;
  traceRatings: TraceRatingsStore;
  /** Undefined when no databaseUrl was supplied — the server serves Git-backed tools only. */
  knowledgeDb?: KnowledgeDatabase;
  startAutoSync(): void;
  stopAutoSync(): void;
};

export async function createAnchorRuntime(
  config: ServerConfig,
  options: { logger?: AppLogger; requestLogger?: RequestLogger; traceLogger?: TraceLogger; databaseUrl?: string } = {},
): Promise<AnchorRuntime> {
  const logger = options.logger ?? createAppLogger(config.logging);
  const requestLogger = options.requestLogger ?? createRequestLogger(config.logging);
  const traceLogger = options.traceLogger ?? createTraceLogger(config.logging);

  // Only loggers this function created are ours to close. A caller-supplied one outlives
  // this call — src/bin/anchor-mcp.ts keeps using its logger to report the very failure
  // that aborted startup — so closing it here would silence that report.
  const ownedLoggers: Array<AppLogger | RequestLogger | TraceLogger> = [
    ...(options.logger ? [] : [logger]),
    ...(options.requestLogger ? [] : [requestLogger]),
    ...(options.traceLogger ? [] : [traceLogger]),
  ];

  try {
    return await initializeRuntime(config, options, { logger, requestLogger, traceLogger });
  } catch (error) {
    // Nothing was returned, so the caller has no handle on these: without this they leak
    // file handles and their rotation timers can keep the process alive after a fail-fast
    // startup. Best-effort and settled, so a cleanup failure cannot mask the real error.
    await Promise.allSettled(ownedLoggers.map((closable) => closable.close()));
    throw error;
  }
}

async function initializeRuntime(
  config: ServerConfig,
  options: { databaseUrl?: string },
  loggers: { logger: AppLogger; requestLogger: RequestLogger; traceLogger: TraceLogger },
): Promise<AnchorRuntime> {
  const { logger, requestLogger, traceLogger } = loggers;
  const traceRatings = new TraceRatingsStore(traceLogger.dirname);
  const traceIndex = new TraceIndex(traceLogger, traceRatings);
  const repo = new AnchorRepository({
    repoPath: config.repoPath,
    anchorRoot: config.anchorRoot,
  });
  await repo.ensureReady();

  // Fail fast rather than boot with a half-usable database: an operator who set
  // DATABASE_URL meant to enable the backend, so a schema stuck mid-migration (or never
  // migrated) should stop the server with a clear fix, not silently serve Git-only.
  const knowledgeDb = options.databaseUrl
    ? await createKnowledgeDatabase(options.databaseUrl, config.database, logger)
    : undefined;

  // Everything past this point can throw while holding an open pool. The caller's catch
  // only closes loggers — it has no reference to knowledgeDb, which is created here — so
  // ownership of it has to be discharged here or its connections leak.
  try {
    logger.info("anchor runtime initialized", {
      repoPath: config.repoPath,
      anchorRoot: config.anchorRoot,
      autoSync: config.autoSync,
      pushOnWrite: config.pushOnWrite,
      migrationWarnOnly: config.migrationWarnOnly,
      staleAfterDays: config.staleAfterDays,
      graphScoringEnabled: config.graphScoring.enabled,
      graphScoringMaxBoost: config.graphScoring.maxBoost,
      databaseConfigured: Boolean(knowledgeDb),
    });

    const service = new AnchorService(repo, {
      pushOnWrite: config.pushOnWrite,
      migrationWarnOnly: config.migrationWarnOnly,
      staleAfterDays: config.staleAfterDays,
      graphScoring: config.graphScoring,
      anchorSchemaMode: config.anchorSchema?.mode ?? "legacy",
      graphUi: config.graphUi,
    });
    const mcpServer = createAnchorMcpServer(service, { requestLogger, trace: { logger: traceLogger }, knowledgeDb });
    // AutoSync pulls serialize on the service's write lock so a background
    // pull/rebase can never interleave with a write's identity snapshot +
    // duplicate check + commit (see AnchorService.runExclusiveWrite).
    const autoSync = new AutoSync(repo, config.syncIntervalMs, logger, (fn) => service.runExclusiveWrite(fn));

    return buildRuntime({
      config,
      repo,
      service,
      mcpServer,
      autoSync,
      logger,
      requestLogger,
      traceLogger,
      traceIndex,
      traceRatings,
      knowledgeDb,
    });
  } catch (error) {
    // Best-effort and settled, so a close failure cannot mask the real error.
    await Promise.allSettled([knowledgeDb?.close() ?? Promise.resolve()]);
    throw error;
  }
}

function buildRuntime(parts: {
  config: ServerConfig;
  repo: AnchorRepository;
  service: AnchorService;
  mcpServer: ReturnType<typeof createAnchorMcpServer>;
  autoSync: AutoSync;
  logger: AppLogger;
  requestLogger: RequestLogger;
  traceLogger: TraceLogger;
  traceIndex: TraceIndex;
  traceRatings: TraceRatingsStore;
  knowledgeDb: KnowledgeDatabase | undefined;
}): AnchorRuntime {
  const { config, autoSync } = parts;
  return {
    repo: parts.repo,
    service: parts.service,
    mcpServer: parts.mcpServer,
    autoSync,
    logger: parts.logger,
    requestLogger: parts.requestLogger,
    traceLogger: parts.traceLogger,
    traceIndex: parts.traceIndex,
    traceRatings: parts.traceRatings,
    knowledgeDb: parts.knowledgeDb,
    startAutoSync() {
      if (config.autoSync) {
        autoSync.start();
      }
    },
    stopAutoSync() {
      autoSync.stop();
    },
  };
}
