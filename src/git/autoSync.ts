import { errorMetadata, noopLogger, type AppLogger } from "../logger.js";
import type { ConflictStatus } from "../types.js";
import type { SyncableAnchorStore } from "../storage/store.js";

export class AutoSync {
  private timer: NodeJS.Timeout | undefined;
  private lastConflict: ConflictStatus = { state: "clean" };
  private missingUpstreamLogged = false;

  constructor(
    private readonly repo: SyncableAnchorStore,
    private readonly intervalMs: number,
    private readonly logger: AppLogger = noopLogger,
    /**
     * Serialization hook for the pull itself. The runtime passes
     * `AnchorService.runExclusiveWrite` so a background pull can never
     * interleave with a write's identity snapshot + duplicate check +
     * commit (which read the tree outside the repo's commit lock).
     * Defaults to a pass-through for callers without a service.
     */
    private readonly runExclusive: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn(),
  ) {}

  start(): void {
    if (this.timer || this.intervalMs <= 0) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
    this.logger.info("auto sync started", { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger.info("auto sync stopped");
    }
  }

  async tick(): Promise<ConflictStatus> {
    const current = await this.repo.conflictStatus();
    if (current.state === "conflicted") {
      this.lastConflict = current;
      this.logger.warn("auto sync skipped while repository is conflicted", { paths: current.paths });
      return current;
    }

    let upstream: string | undefined;
    try {
      upstream = await this.repo.currentUpstream();
    } catch (error) {
      this.lastConflict = current;
      this.logger.warn("auto sync skipped because upstream lookup failed", {
        repoPath: this.repo.repoPath,
        error: errorMetadata(error),
      });
      return current;
    }

    if (!upstream) {
      this.lastConflict = current;
      if (!this.missingUpstreamLogged) {
        this.logger.warn("auto sync skipped because no upstream is configured for HEAD", {
          repoPath: this.repo.repoPath,
        });
        this.missingUpstreamLogged = true;
      }
      return current;
    }

    this.missingUpstreamLogged = false;
    try {
      await this.runExclusive(() => this.repo.pullRebase());
      this.lastConflict = await this.repo.conflictStatus();
    } catch (error) {
      this.logger.warn("auto sync pull failed", { error: errorMetadata(error) });
      this.lastConflict = await this.repo.conflictStatus();
    }

    return this.lastConflict;
  }

  status(): ConflictStatus {
    return this.lastConflict;
  }
}
