import { AnchorService } from "./anchorService.js";
import { createKnowledgeDatabase, type KnowledgeDatabase } from "./db/knowledgeDb.js";
import { DEFAULT_TELEMETRY_RETENTION_SETTINGS } from "./db/config.js";
import { TelemetryRetentionJob } from "./db/telemetryRetentionJob.js";
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
  /**
   * Undefined without a database, since there is no telemetry schema to thin.
   *
   * Present but unscheduled when `intervalHours` is 0: the operator drives it from cron, and
   * `start()` returns without arming a timer. Configured and scheduled are separate questions,
   * and collapsing them here would leave no handle for a caller that wants to run a pass now.
   * This comment previously claimed the field was undefined in that case, which the code has
   * never done.
   */
  telemetryRetention?: TelemetryRetentionJob;
  /**
   * Starts every background job the transports own: the auto-sync pull and the telemetry
   * retention pass. One pair rather than one per job, because these were called from five places
   * across two transports and a second pair would have failed silently at whichever site nobody
   * remembered. Renaming the existing one made TypeScript find them all.
   */
  startBackgroundJobs(): void;
  stopBackgroundJobs(): void;
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

    // Only with a database to thin. Built here rather than inside KnowledgeDatabase because a
    // scheduled job is a property of a running server, and `db import` opens the same class
    // without wanting a timer attached to it.
    const retentionSettings = config.database?.telemetryRetention ?? DEFAULT_TELEMETRY_RETENTION_SETTINGS;
    const telemetryRetention = knowledgeDb
      ? new TelemetryRetentionJob(
          knowledgeDb,
          retentionSettings,
          retentionSettings.intervalHours * 60 * 60 * 1000,
          logger,
        )
      : undefined;

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
      telemetryRetention,
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
  telemetryRetention: TelemetryRetentionJob | undefined;
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
    telemetryRetention: parts.telemetryRetention,
    startBackgroundJobs() {
      if (config.autoSync) {
        autoSync.start();
      }
      // No `config` gate of its own: the schedule is off when intervalHours is 0, and start()
      // already returns for a non-positive interval. A second flag here would be a way for the
      // two to disagree.
      parts.telemetryRetention?.start();
    },
    stopBackgroundJobs() {
      autoSync.stop();
      parts.telemetryRetention?.stop();
    },
  };
}
