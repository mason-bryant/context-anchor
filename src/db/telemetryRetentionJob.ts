import { errorMetadata, noopLogger, type AppLogger } from "../logger.js";
import type { TelemetryRetentionPolicy, TelemetryRetentionReport } from "./telemetryRetention.js";

/**
 * What the job needs from the database, which is one method.
 *
 * Narrow rather than the whole KnowledgeDatabase so a test can drive the schedule -- the skip
 * when a pass overruns, the swallowed failure -- against a stub, without a live Postgres and
 * without the timing being at the mercy of a real query.
 */
export type TelemetryThinner = {
  thinTelemetry(policy: TelemetryRetentionPolicy): Promise<TelemetryRetentionReport>;
};

/**
 * The thing T-41 is actually named for: something that runs the retention pass.
 *
 * `thinTelemetry` on its own would have left the task exactly where it was — a window the design
 * promises and no code performs. A policy nobody executes is indistinguishable from no policy.
 *
 * Deliberately in-process rather than a cron entry the operator is told to add. This ships as a
 * single-operator local server; a retention window that depends on a manual step is a retention
 * window most installations will not have. `db thin` still exists for anyone who would rather
 * drive it externally, and `intervalHours: 0` turns this off for them.
 */
export class TelemetryRetentionJob {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: TelemetryThinner,
    private readonly policy: TelemetryRetentionPolicy,
    private readonly intervalMs: number,
    private readonly logger: AppLogger = noopLogger,
  ) {}

  start(): void {
    if (this.timer || this.intervalMs <= 0) {
      return;
    }

    // Once at startup, before the first interval elapses. With a daily interval and an unref'd
    // timer, a server restarted each morning would otherwise never reach a tick at all — the
    // exact shape of "scheduled and never runs" this task exists to end.
    void this.tick();

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // unref, so retention never holds the process open. A pass that would have run in six hours
    // is not a reason to keep a server alive that has otherwise finished.
    this.timer.unref();
    this.logger.info("telemetry retention scheduled", {
      intervalMs: this.intervalMs,
      taskTextDays: this.policy.taskTextDays,
      requestDays: this.policy.requestDays,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.logger.info("telemetry retention stopped");
    }
  }

  /**
   * Exposed so a test can drive a pass without a timer, and so `db thin` and the scheduled path
   * share one implementation rather than two that agree by inspection.
   *
   * Never throws. Retention is housekeeping: a failed pass means rows survive a few hours longer
   * than the policy says, while a thrown error from a background timer takes down a server that
   * was answering queries perfectly well.
   */
  async tick(): Promise<TelemetryRetentionReport | undefined> {
    // A pass that overruns its interval must not have a second one started on top of it. Both
    // would scan the same rows, and the deletes would contend on exactly the rows the other is
    // removing.
    if (this.running) {
      this.logger.warn("telemetry retention skipped: the previous pass is still running");
      return undefined;
    }
    this.running = true;

    try {
      const report = await this.database.thinTelemetry(this.policy);
      // Logged only when it did something. A daily no-op line for a workspace inside its window
      // is noise, and noise is how the useful line gets missed.
      if (report.requestsDeleted > 0 || report.taskTextRedacted > 0) {
        this.logger.info("telemetry thinned", {
          requestsDeleted: report.requestsDeleted,
          taskTextRedacted: report.taskTextRedacted,
          durationMs: report.durationMs,
        });
      }
      return report;
    } catch (error) {
      this.logger.error("telemetry retention pass failed", { error: errorMetadata(error) });
      return undefined;
    } finally {
      this.running = false;
    }
  }
}
