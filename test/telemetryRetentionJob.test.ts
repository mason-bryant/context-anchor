import { describe, expect, it, vi } from "vitest";

import type { TelemetryRetentionPolicy, TelemetryRetentionReport } from "../src/db/telemetryRetention.js";
import { TelemetryRetentionJob, type TelemetryThinner } from "../src/db/telemetryRetentionJob.js";

const POLICY: TelemetryRetentionPolicy = { taskTextDays: 90, requestDays: 365 };

const reportOf = (overrides: Partial<TelemetryRetentionReport> = {}): TelemetryRetentionReport => ({
  ranAt: new Date().toISOString(),
  policy: POLICY,
  taskTextRedacted: 0,
  requestsDeleted: 0,
  durationMs: 1,
  ...overrides,
});

/** A thinner whose pass finishes only when the test releases it. */
function blockingThinner(): TelemetryThinner & { release: () => void; calls: number } {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const thinner = {
    calls: 0,
    release: () => {
      release();
    },
    async thinTelemetry(): Promise<TelemetryRetentionReport> {
      thinner.calls += 1;
      await gate;
      return reportOf();
    },
  };
  return thinner;
}

describe("TelemetryRetentionJob", () => {
  it("runs a pass at startup rather than only after the first interval", async () => {
    // With a six-hour interval and an unref'd timer, a server restarted each morning would never
    // reach a tick. "Scheduled and never runs" is the exact failure T-41 is about, and a schedule
    // that only fires later is a slower version of it.
    const thinTelemetry = vi.fn(async () => reportOf());
    const job = new TelemetryRetentionJob({ thinTelemetry }, POLICY, 60_000);

    job.start();
    await vi.waitFor(() => {
      expect(thinTelemetry).toHaveBeenCalledTimes(1);
    });
    job.stop();
  });

  it("does not schedule anything when the interval is zero", async () => {
    // How an operator driving `db thin` from cron turns the in-process schedule off. If start()
    // still ran its opening pass, "disabled" would mean "runs once per server start".
    const thinTelemetry = vi.fn(async () => reportOf());
    const job = new TelemetryRetentionJob({ thinTelemetry }, POLICY, 0);

    job.start();
    await Promise.resolve();
    expect(thinTelemetry).not.toHaveBeenCalled();
  });

  it("skips a pass while the previous one is still running", async () => {
    // Two passes over the same rows contend on exactly the rows the other is deleting. A slow
    // pass must be allowed to finish, not raced by its own schedule.
    const thinner = blockingThinner();
    const job = new TelemetryRetentionJob(thinner, POLICY, 0);

    const first = job.tick();
    const second = await job.tick();

    expect(second).toBeUndefined();
    expect(thinner.calls).toBe(1);

    thinner.release();
    await first;

    // And the gate reopens afterward. A `running` flag left set would silently retire the job
    // for the life of the process -- the same "nothing thins it" state, harder to notice.
    expect(await job.tick()).toBeDefined();
  });

  it("survives a failed pass instead of taking the server down with it", async () => {
    // This runs on a background timer with no caller to catch it. Retention is housekeeping: a
    // failed pass means rows outlive the policy by a few hours, while a thrown error from a timer
    // ends a process that was answering queries perfectly well.
    const thinTelemetry = vi.fn().mockRejectedValueOnce(new Error("connection terminated"));
    const job = new TelemetryRetentionJob({ thinTelemetry }, POLICY, 0);

    await expect(job.tick()).resolves.toBeUndefined();

    thinTelemetry.mockResolvedValueOnce(reportOf({ requestsDeleted: 3 }));
    expect(await job.tick()).toMatchObject({ requestsDeleted: 3 });
  });

  it("stops cleanly, and stopping twice is not an error", async () => {
    const thinTelemetry = vi.fn(async () => reportOf());
    const job = new TelemetryRetentionJob({ thinTelemetry }, POLICY, 60_000);

    job.start();
    job.stop();
    job.stop();

    await vi.waitFor(() => {
      expect(thinTelemetry).toHaveBeenCalledTimes(1);
    });
  });
});
