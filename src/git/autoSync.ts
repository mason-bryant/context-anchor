import { errorMetadata, noopLogger, type AppLogger } from "../logger.js";
import type { ConflictStatus } from "../types.js";
import type { AnchorRepository } from "./repo.js";

export class AutoSync {
  private timer: NodeJS.Timeout | undefined;
  private lastConflict: ConflictStatus = { state: "clean" };

  constructor(
    private readonly repo: AnchorRepository,
    private readonly intervalMs: number,
    private readonly logger: AppLogger = noopLogger,
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

    try {
      await this.repo.pullRebase();
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
