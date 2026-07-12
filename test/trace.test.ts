import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTEXT_TOOLS,
  newTraceId,
  projectToolResult,
  taskIdentity,
  type TraceEvent,
} from "../src/trace/events.js";
import { buildSessions, TraceIndex } from "../src/trace/index.js";
import { createTraceLogger, noopTraceLogger } from "../src/trace/logger.js";
import { PROCESS_ID, TraceRecorder } from "../src/trace/recorder.js";

async function findLogFile(dir: string, prefix: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const files = await readdir(dir);
    const logFile = files.find((file) => file.startsWith(prefix) && file.endsWith(".log"));
    if (logFile) {
      return logFile;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

function baseEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    v: 1,
    id: Math.random().toString(36).slice(2),
    timestamp: "2026-07-12T12:00:00.000Z",
    tool: "readAnchor",
    ordinal: 0,
    outcome: "success",
    durationMs: 5,
    correlation: "process",
    processId: "proc-1",
    transport: "process",
    ...overrides,
  };
}

describe("trace event projection", () => {
  it("projects startTask plans and delivered excerpts", () => {
    const projected = projectToolResult(
      "startTask",
      { task: "review assignment UI" },
      {
        traceId: "t-abc",
        plan: {
          budgetTokens: 4000,
          estimatedTokens: 3200,
          included: [{ name: "project-context", score: 30, estimatedTokens: 900, reason: "project matches" }],
          excluded: [{ name: "testing-rules", score: 21, estimatedTokens: 900, reason: "excluded because outside token budget" }],
          missingContext: ["Some relevant anchors were excluded by the token budget."],
        },
        anchors: [
          { name: "project-context", excerpt: "## Current State\nstuff" },
          { name: "index-only", summary: "meta only" },
        ],
        activeMilestones: [{ name: "ui-milestone", theme: "UI", goalIds: ["G-041"] }],
        truncated: false,
      },
    );

    expect(projected.budgetTokens).toBe(4000);
    expect(projected.estimatedTokens).toBe(3200);
    expect(projected.included).toEqual([
      { name: "project-context", score: 30, estimatedTokens: 900, reason: "project matches" },
    ]);
    expect(projected.excluded?.[0]?.reason).toContain("outside token budget");
    expect(projected.delivered).toEqual([
      { name: "project-context", mode: "excerpt", bytes: 22 },
      { name: "index-only", mode: "metadata", bytes: undefined },
    ]);
    expect(projected.structured).toEqual({ kind: "milestone", ids: ["ui-milestone"] });
    expect(projected.missingContext).toHaveLength(1);
    expect(projected.cursor).toBe("initial");
  });

  it("marks full-read requests downgraded to excerpts as row-byte-limit degradation", () => {
    const projected = projectToolResult(
      "loadContext",
      { includeContent: "full" },
      {
        entries: [{ name: "a" }, { name: "b" }],
        anchors: [
          { name: "a", content: "full body" },
          { name: "b", excerpt: "short" },
        ],
        truncated: true,
        returnedCount: 2,
      },
    );

    expect(projected.delivered).toEqual([
      { name: "a", mode: "full", bytes: 9 },
      { name: "b", mode: "excerpt", bytes: 5, requestedMode: "full", degradation: "row-byte-limit" },
    ]);
    expect(projected.listed).toEqual(["a", "b"]);
    expect(projected.truncated).toBe(true);
  });

  it("reports pagination cursors and zero-hit searches", () => {
    const paginated = projectToolResult("loadContext", { cursor: "abc" }, { anchors: [], entries: [], returnedCount: 0 });
    expect(paginated.cursor).toBe("continuation");
    expect(paginated.zeroHit).toBe(true);

    const dry = projectToolResult("searchAnchors", { query: "nope" }, { hits: [] });
    expect(dry.zeroHit).toBe(true);
    expect(dry.listed).toEqual([]);

    const hit = projectToolResult("searchAnchors", { query: "ui" }, { hits: [{ name: "a" }, { name: "a" }, { name: "b" }] });
    expect(hit.listed).toEqual(["a", "b"]);
    expect(hit.zeroHit).toBeUndefined();
  });

  it("projects roadmap goals and milestone reads as structured records", () => {
    const goals = projectToolResult("listRoadmapGoals", { project: "p" }, { goals: [{ id: "G-041" }, { id: "G-042" }] });
    expect(goals.structured).toEqual({ kind: "roadmap-goal", ids: ["G-041", "G-042"] });

    const milestone = projectToolResult(
      "readMilestone",
      { name: "m1" },
      { milestone: { name: "m1", content: "body" }, goals: [{ id: "G-041" }] },
    );
    expect(milestone.delivered).toEqual([{ name: "m1", mode: "full", bytes: 4 }]);
    expect(milestone.structured).toEqual({ kind: "roadmap-goal", ids: ["G-041"] });
  });

  it("hashes task text and only includes raw text when configured", () => {
    const hashed = taskIdentity("review things", false);
    expect(hashed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed.length).toBe(13);
    expect(hashed.text).toBeUndefined();

    expect(taskIdentity("review things", true).text).toBe("review things");
  });

  it("mints distinct trace ids", () => {
    expect(newTraceId()).toMatch(/^t-[0-9a-f]{16}$/);
    expect(newTraceId()).not.toBe(newTraceId());
  });
});

describe("trace recorder", () => {
  function collectingLogger(includeTaskText = false) {
    const events: TraceEvent[] = [];
    return {
      logger: {
        enabled: true,
        includeTaskText,
        dirname: undefined,
        log(event: TraceEvent) {
          events.push(event);
        },
        onEvent() {},
        async close() {},
      },
      events,
    };
  }

  it("records exact correlation from an input trace id", () => {
    const { logger, events } = collectingLogger();
    const recorder = new TraceRecorder(logger);
    recorder.record({
      toolName: "readAnchor",
      input: { traceId: "t-123", name: "a" },
      result: { structuredContent: { name: "a", content: "body" } },
      durationMs: 3,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool: "readAnchor",
      traceId: "t-123",
      correlation: "exact",
      transport: "process",
      processId: PROCESS_ID,
      outcome: "success",
      delivered: [{ name: "a", mode: "full", bytes: 4 }],
    });
  });

  it("marks minted startTask trace ids and hashes task text", () => {
    const { logger, events } = collectingLogger();
    const recorder = new TraceRecorder(logger);
    recorder.record({
      toolName: "startTask",
      input: { task: "review" },
      result: { structuredContent: { traceId: "t-minted", plan: {}, anchors: [] } },
      durationMs: 10,
    });

    expect(events[0]).toMatchObject({ traceId: "t-minted", mintedTraceId: true, correlation: "exact" });
    expect(events[0].task?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(events[0].task?.text).toBeUndefined();
  });

  it("falls back to transport then process correlation", () => {
    const { logger, events } = collectingLogger();
    const withSession = new TraceRecorder(logger, { transport: "http", getSessionId: () => "sess-1" });
    withSession.record({ toolName: "searchAnchors", input: { query: "x" }, result: { structuredContent: { hits: [] } }, durationMs: 1 });
    expect(events[0]).toMatchObject({ correlation: "transport", sessionId: "sess-1", transport: "http" });

    const withoutSession = new TraceRecorder(logger, { transport: "http", getSessionId: () => undefined });
    withoutSession.record({ toolName: "searchAnchors", input: { query: "x" }, result: { structuredContent: { hits: [] } }, durationMs: 1 });
    expect(events[1].correlation).toBe("process");
  });

  it("records exceptions without projecting results", () => {
    const { logger, events } = collectingLogger();
    const recorder = new TraceRecorder(logger);
    recorder.record({ toolName: "readAnchor", input: { name: "a" }, error: new Error("boom"), durationMs: 2 });

    expect(events[0]).toMatchObject({ outcome: "exception", error: { message: "boom" } });
    expect(events[0].delivered).toBeUndefined();
  });

  it("increments ordinals per recorder", () => {
    const { logger, events } = collectingLogger();
    const recorder = new TraceRecorder(logger);
    recorder.record({ toolName: "searchAnchors", input: {}, result: { structuredContent: { hits: [] } }, durationMs: 1 });
    recorder.record({ toolName: "searchAnchors", input: {}, result: { structuredContent: { hits: [] } }, durationMs: 1 });
    expect(events.map((event) => event.ordinal)).toEqual([0, 1]);
  });

  it("covers every context tool the design names", () => {
    for (const tool of ["startTask", "planContextBundle", "loadContext", "contextRoot", "searchAnchors", "readAnchor", "readAnchorBatch", "listRoadmapGoals", "readMilestone"]) {
      expect(CONTEXT_TOOLS.has(tool)).toBe(true);
    }
  });
});

describe("trace session grouping", () => {
  it("groups by trace id and lets traceless follow-ups join the current transport session", () => {
    const events: TraceEvent[] = [
      baseEvent({
        tool: "startTask",
        traceId: "t-1",
        correlation: "exact",
        sessionId: "sess-1",
        transport: "http",
        timestamp: "2026-07-12T12:00:00.000Z",
        task: { sha256: "abc", length: 6 },
      }),
      baseEvent({
        tool: "readAnchor",
        sessionId: "sess-1",
        transport: "http",
        correlation: "transport",
        timestamp: "2026-07-12T12:01:00.000Z",
        ordinal: 1,
      }),
      baseEvent({
        tool: "loadContext",
        traceId: "t-1",
        correlation: "exact",
        sessionId: "sess-1",
        transport: "http",
        timestamp: "2026-07-12T12:02:00.000Z",
        ordinal: 2,
      }),
    ];

    const sessions = buildSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("t-1");
    expect(sessions[0].correlation).toBe("exact");
    expect(sessions[0].eventCount).toBe(3);
    expect(sessions[0].taskSha256).toBe("abc");
  });

  it("subdivides traceless transport sessions at startTask boundaries", () => {
    const events: TraceEvent[] = [
      baseEvent({ tool: "startTask", sessionId: "sess-1", transport: "http", correlation: "transport", timestamp: "2026-07-12T12:00:00.000Z" }),
      baseEvent({ tool: "readAnchor", sessionId: "sess-1", transport: "http", correlation: "transport", timestamp: "2026-07-12T12:01:00.000Z", ordinal: 1 }),
      baseEvent({ tool: "startTask", sessionId: "sess-1", transport: "http", correlation: "transport", timestamp: "2026-07-12T12:05:00.000Z", ordinal: 2 }),
      baseEvent({ tool: "searchAnchors", sessionId: "sess-1", transport: "http", correlation: "transport", timestamp: "2026-07-12T12:06:00.000Z", ordinal: 3 }),
    ];

    const sessions = buildSessions(events);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].eventCount).toBe(2);
    expect(sessions[1].eventCount).toBe(2);
    expect(sessions[0].id).not.toBe(sessions[1].id);
  });

  it("keeps different processes in different sessions", () => {
    const events: TraceEvent[] = [
      baseEvent({ processId: "proc-1", timestamp: "2026-07-12T12:00:00.000Z" }),
      baseEvent({ processId: "proc-2", timestamp: "2026-07-12T12:00:30.000Z" }),
    ];

    expect(buildSessions(events)).toHaveLength(2);
  });
});

describe("trace logger and index", () => {
  it("writes JSON-line trace events with one-year retention defaults and reloads them via the index", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-traces-"));
    const logger = createTraceLogger({ traces: { enabled: true, dirname: tmpDir, zippedArchive: false } });
    expect(logger.enabled).toBe(true);

    const recorder = new TraceRecorder(logger);
    recorder.record({
      toolName: "startTask",
      input: { task: "review" },
      result: { structuredContent: { traceId: "t-file", plan: { budgetTokens: 4000 }, anchors: [] } },
      durationMs: 7,
    });
    await logger.close();

    const logFile = await findLogFile(tmpDir, "anchor-mcp-traces-");
    expect(logFile).toBeDefined();
    const lines = (await readFile(path.join(tmpDir, logFile ?? ""), "utf8")).trim().split("\n");
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.v).toBe(1);
    expect(parsed.tool).toBe("startTask");
    expect(parsed.traceId).toBe("t-file");

    const reloadLogger = createTraceLogger({ traces: { enabled: true, dirname: tmpDir, zippedArchive: false } });
    const index = new TraceIndex(reloadLogger);
    const sessions = await index.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("t-file");
    expect(sessions[0].events[0].budgetTokens).toBe(4000);
    await reloadLogger.close();
  });

  it("indexes live events without reading files and dedupes reloaded ones", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-traces-"));
    const logger = createTraceLogger({ traces: { enabled: true, dirname: tmpDir, zippedArchive: false } });
    const index = new TraceIndex(logger);
    const recorder = new TraceRecorder(logger);

    recorder.record({
      toolName: "searchAnchors",
      input: { traceId: "t-live", query: "x" },
      result: { structuredContent: { hits: [{ name: "a" }] } },
      durationMs: 2,
    });

    const sessions = await index.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].events[0].listed).toEqual(["a"]);

    // A second query re-runs grouping over the same deduped event set.
    const again = await index.getSessions();
    expect(again).toHaveLength(1);
    expect(again[0].eventCount).toBe(1);
    await logger.close();
  });

  it("is disabled by default and inert when disabled", async () => {
    expect(createTraceLogger(undefined).enabled).toBe(false);
    expect(createTraceLogger({}).enabled).toBe(false);
    expect(createTraceLogger({ traces: { enabled: false } }).enabled).toBe(false);

    const index = new TraceIndex(noopTraceLogger);
    expect(index.enabled).toBe(false);
    await expect(index.getSessions()).resolves.toEqual([]);
  });
});
