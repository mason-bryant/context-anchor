import type { ConflictStatus } from "../types.js";
import type { AnchorRepository } from "./repo.js";

export class AutoSync {
  private timer: NodeJS.Timeout | undefined;
  private lastConflict: ConflictStatus = { state: "clean" };

  constructor(
    private readonly repo: AnchorRepository,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer || this.intervalMs <= 0) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<ConflictStatus> {
    const current = await this.repo.conflictStatus();
    if (current.state === "conflicted") {
      this.lastConflict = current;
      return current;
    }

    try {
      await this.repo.pullRebase();
      this.lastConflict = await this.repo.conflictStatus();
    } catch {
      this.lastConflict = await this.repo.conflictStatus();
    }

    return this.lastConflict;
  }

  status(): ConflictStatus {
    return this.lastConflict;
  }
}

