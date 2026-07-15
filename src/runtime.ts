import { AnchorService } from "./anchorService.js";
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
  startAutoSync(): void;
  stopAutoSync(): void;
};

export async function createAnchorRuntime(
  config: ServerConfig,
  options: { logger?: AppLogger; requestLogger?: RequestLogger; traceLogger?: TraceLogger } = {},
): Promise<AnchorRuntime> {
  const logger = options.logger ?? createAppLogger(config.logging);
  const requestLogger = options.requestLogger ?? createRequestLogger(config.logging);
  const traceLogger = options.traceLogger ?? createTraceLogger(config.logging);
  const traceRatings = new TraceRatingsStore(traceLogger.dirname);
  const traceIndex = new TraceIndex(traceLogger, traceRatings);
  const repo = new AnchorRepository({
    repoPath: config.repoPath,
    anchorRoot: config.anchorRoot,
  });
  await repo.ensureReady();
  logger.info("anchor runtime initialized", {
    repoPath: config.repoPath,
    anchorRoot: config.anchorRoot,
    autoSync: config.autoSync,
    pushOnWrite: config.pushOnWrite,
    migrationWarnOnly: config.migrationWarnOnly,
    staleAfterDays: config.staleAfterDays,
    graphScoringEnabled: config.graphScoring.enabled,
    graphScoringMaxBoost: config.graphScoring.maxBoost,
  });

  const service = new AnchorService(repo, {
    pushOnWrite: config.pushOnWrite,
    migrationWarnOnly: config.migrationWarnOnly,
    staleAfterDays: config.staleAfterDays,
    graphScoring: config.graphScoring,
    anchorSchemaMode: config.anchorSchema?.mode ?? "legacy",
  });
  const mcpServer = createAnchorMcpServer(service, { requestLogger, trace: { logger: traceLogger } });
  // AutoSync pulls serialize on the service's write lock so a background
  // pull/rebase can never interleave with a write's identity snapshot +
  // duplicate check + commit (see AnchorService.runExclusiveWrite).
  const autoSync = new AutoSync(repo, config.syncIntervalMs, logger, (fn) => service.runExclusiveWrite(fn));

  return {
    repo,
    service,
    mcpServer,
    autoSync,
    logger,
    requestLogger,
    traceLogger,
    traceIndex,
    traceRatings,
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
