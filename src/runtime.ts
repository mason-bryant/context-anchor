import { AnchorService } from "./anchorService.js";
import { AutoSync } from "./git/autoSync.js";
import { AnchorRepository } from "./git/repo.js";
import { createAppLogger, createRequestLogger, type AppLogger, type RequestLogger } from "./logger.js";
import { createAnchorMcpServer } from "./server.js";
import type { ServerConfig } from "./types.js";

export type AnchorRuntime = {
  repo: AnchorRepository;
  service: AnchorService;
  mcpServer: ReturnType<typeof createAnchorMcpServer>;
  autoSync: AutoSync;
  logger: AppLogger;
  requestLogger: RequestLogger;
  startAutoSync(): void;
  stopAutoSync(): void;
};

export async function createAnchorRuntime(
  config: ServerConfig,
  options: { logger?: AppLogger; requestLogger?: RequestLogger } = {},
): Promise<AnchorRuntime> {
  const logger = options.logger ?? createAppLogger(config.logging);
  const requestLogger = options.requestLogger ?? createRequestLogger(config.logging);
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
  });

  const service = new AnchorService(repo, {
    pushOnWrite: config.pushOnWrite,
    migrationWarnOnly: config.migrationWarnOnly,
  });
  const mcpServer = createAnchorMcpServer(service, { requestLogger });
  const autoSync = new AutoSync(repo, config.syncIntervalMs, logger);

  return {
    repo,
    service,
    mcpServer,
    autoSync,
    logger,
    requestLogger,
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
