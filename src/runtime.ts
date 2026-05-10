import { AnchorService } from "./anchorService.js";
import { AutoSync } from "./git/autoSync.js";
import { AnchorRepository } from "./git/repo.js";
import { createAnchorMcpServer } from "./server.js";
import type { ServerConfig } from "./types.js";

export type AnchorRuntime = {
  repo: AnchorRepository;
  service: AnchorService;
  mcpServer: ReturnType<typeof createAnchorMcpServer>;
  autoSync: AutoSync;
  startAutoSync(): void;
  stopAutoSync(): void;
};

export async function createAnchorRuntime(config: ServerConfig): Promise<AnchorRuntime> {
  const repo = new AnchorRepository({
    repoPath: config.repoPath,
    anchorRoot: config.anchorRoot,
  });
  await repo.ensureReady();

  const service = new AnchorService(repo, {
    pushOnWrite: config.pushOnWrite,
    migrationWarnOnly: config.migrationWarnOnly,
  });
  const mcpServer = createAnchorMcpServer(service);
  const autoSync = new AutoSync(repo, config.syncIntervalMs);

  return {
    repo,
    service,
    mcpServer,
    autoSync,
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

