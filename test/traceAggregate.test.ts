import { describe, expect, it } from "vitest";

import {
  aggregateBudget,
  aggregateFollowUps,
  aggregateFrequency,
  filterEvents,
  filterSessions,
} from "../src/trace/aggregate.js";
import type { TraceEvent } from "../src/trace/events.js";
import { buildSessions } from "../src/trace/index.js";

let ordinal = 0;

function ev(overrides: Partial<TraceEvent>): TraceEvent {
  ordinal += 1;
  return {
    v: 1,
    id: `id-${ordinal}`,
    timestamp: overrides.timestamp ?? "2026-07-12T12:00:00.000Z",
    tool: overrides.tool ?? "startTask",
    ordinal,
    outcome: "success",
    durationMs: 5,
    correlation: "transport",
    processId: "proc-1",
    transport: "http",
    sessionId: "sess-a",
    ...overrides,
  };
}

describe("aggregateBudget", () => {
  it("extracts displaced anchors with their budget consumers", () => {
    const event = ev({
      tool: "startTask",
      traceId: "t-1",
      budgetTokens: 4000,
      included: [
        { name: "project-context", score: 30, estimatedTokens: 900 },
        { name: "roadmap", score: 25, estimatedTokens: 1200 },
      ],
      excluded: [{ name: "testing-rules", score: 21, estimatedTokens: 900, reason: "excluded because outside token budget" }],
      timestamp: "2026-07-12T12:00:00.000Z",
    });

    const result = aggregateBudget([event]);

    expect(result.displaced).toHaveLength(1);
    expect(result.displaced[0]).toMatchObject({
      name: "testing-rules",
      score: 21,
      estimatedTokens: 900,
      budgetTokens: 4000,
      sessionId: "sess-a",
      tool: "startTask",
    });
    expect(result.displaced[0]!.consumers).toEqual([
      { name: "project-context", estimatedTokens: 900 },
      { name: "roadmap", estimatedTokens: 1200 },
    ]);
  });

  it("does not treat low-relevance exclusions as displacement", () => {
    const event = ev({
      excluded: [{ name: "irrelevant-anchor", score: 2, reason: "below minimum relevance threshold" }],
    });
    const result = aggregateBudget([event]);
    expect(result.displaced).toHaveLength(0);
  });

  it("collects downgraded reads (requested full, delivered excerpt)", () => {
    const event = ev({
      tool: "readAnchor",
      delivered: [
        {
          name: "testing-rules",
          mode: "excerpt",
          bytes: 120,
          requestedMode: "full",
          degradation: "row-byte-limit",
        },
        { name: "clean-anchor", mode: "full", bytes: 500 },
      ],
    });

    const result = aggregateBudget([event]);
    expect(result.downgraded).toEqual([
      {
        name: "testing-rules",
        requestedMode: "full",
        deliveredMode: "excerpt",
        bytes: 120,
        timestamp: event.timestamp,
        sessionId: "sess-a",
      },
    ]);
  });

  it("collects truncated events with delivered item names", () => {
    const event = ev({
      tool: "loadContext",
      truncated: true,
      delivered: [
        { name: "a", mode: "excerpt", bytes: 10 },
        { name: "b", mode: "excerpt", bytes: 20 },
      ],
    });

    const result = aggregateBudget([event]);
    expect(result.truncated).toEqual([
      { tool: "loadContext", timestamp: event.timestamp, sessionId: "sess-a", deliveredNames: ["a", "b"] },
    ]);
  });

  it("aggregates per-anchor displacement and consumer counts across events", () => {
    const events = [
      ev({
        included: [{ name: "roadmap", estimatedTokens: 1000 }],
        excluded: [{ name: "testing-rules", reason: "outside token budget" }],
      }),
      ev({
        included: [{ name: "roadmap", estimatedTokens: 1100 }],
        excluded: [{ name: "testing-rules", reason: "excluded: outside token budget (needed more)" }],
      }),
      ev({
        included: [{ name: "project-context", estimatedTokens: 800 }],
        excluded: [{ name: "coding-rules", reason: "outside token budget" }],
      }),
    ];

    const result = aggregateBudget(events);
    expect(result.displacementCounts).toEqual([
      { name: "testing-rules", count: 2 },
      { name: "coding-rules", count: 1 },
    ]);
    expect(result.consumerCounts).toEqual([
      { name: "roadmap", count: 2 },
      { name: "project-context", count: 1 },
    ]);
  });
});

describe("aggregateFollowUps", () => {
  function sessionEvents(sessionId: string, calls: Array<{ tool: string; cursor?: "initial" | "continuation"; ts: string }>) {
    return calls.map((call, i) =>
      ev({
        sessionId,
        traceId: sessionId,
        tool: call.tool,
        cursor: call.cursor,
        timestamp: call.ts,
        ordinal: i + 1,
      }),
    );
  }

  it("buckets sessions with zero, one, two-to-three, and four-plus semantic follow-ups", () => {
    const events = [
      ...sessionEvents("s-zero", [{ tool: "startTask", ts: "2026-07-12T12:00:00.000Z" }]),
      ...sessionEvents("s-one", [
        { tool: "startTask", ts: "2026-07-12T12:00:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:01:00.000Z" },
      ]),
      ...sessionEvents("s-two", [
        { tool: "startTask", ts: "2026-07-12T12:00:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:01:00.000Z" },
        { tool: "searchAnchors", ts: "2026-07-12T12:02:00.000Z" },
      ]),
      ...sessionEvents("s-four", [
        { tool: "startTask", ts: "2026-07-12T12:00:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:01:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:02:00.000Z" },
        { tool: "searchAnchors", ts: "2026-07-12T12:03:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:04:00.000Z" },
      ]),
    ];

    const sessions = buildSessions(events);
    const result = aggregateFollowUps(sessions);

    expect(result.buckets.zero).toBe(1);
    expect(result.buckets.one).toBe(1);
    expect(result.buckets.twoToThree).toBe(1);
    expect(result.buckets.fourPlus).toBe(1);
    expect(result.representativeSessionIds.zero).toContain("s-zero");
  });

  it("classifies pagination-only follow-ups separately from zero", () => {
    const events = sessionEvents("s-page", [
      { tool: "startTask", ts: "2026-07-12T12:00:00.000Z" },
      { tool: "loadContext", cursor: "continuation", ts: "2026-07-12T12:01:00.000Z" },
      { tool: "loadContext", cursor: "continuation", ts: "2026-07-12T12:02:00.000Z" },
    ]);

    const sessions = buildSessions(events);
    const result = aggregateFollowUps(sessions);

    expect(result.buckets.paginationOnly).toBe(1);
    expect(result.buckets.zero).toBe(0);
    expect(result.representativeSessionIds.paginationOnly).toContain("s-page");
  });

  it("computes a cumulative at-least-N series across sessions", () => {
    const events = [
      ...sessionEvents("s-zero", [{ tool: "startTask", ts: "2026-07-12T12:00:00.000Z" }]),
      ...sessionEvents("s-one", [
        { tool: "startTask", ts: "2026-07-12T12:00:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:01:00.000Z" },
      ]),
      ...sessionEvents("s-two", [
        { tool: "startTask", ts: "2026-07-12T12:00:00.000Z" },
        { tool: "readAnchor", ts: "2026-07-12T12:01:00.000Z" },
        { tool: "searchAnchors", ts: "2026-07-12T12:02:00.000Z" },
      ]),
    ];

    const sessions = buildSessions(events);
    const result = aggregateFollowUps(sessions);

    // 3 sessions total (>=0), 2 with >=1, 1 with >=2.
    expect(result.cumulative).toEqual([
      { atLeast: 0, sessions: 3 },
      { atLeast: 1, sessions: 2 },
      { atLeast: 2, sessions: 1 },
    ]);
  });
});

describe("aggregateFrequency", () => {
  it("tracks eligible-vs-delivered denominators independently", () => {
    const events = [
      ev({ sessionId: "s1", traceId: "s1", included: [{ name: "roadmap" }], delivered: [{ name: "roadmap", mode: "excerpt", bytes: 100 }] }),
      ev({ sessionId: "s2", traceId: "s2", excluded: [{ name: "roadmap", reason: "below relevance" }] }),
    ];
    const sessions = buildSessions(events);
    const rows = aggregateFrequency(sessions);
    const roadmap = rows.find((r) => r.name === "roadmap")!;

    expect(roadmap.eligibleSessions).toBe(2);
    expect(roadmap.consideredSessions).toBe(2);
    expect(roadmap.selectedSessions).toBe(1);
    expect(roadmap.deliveredSessions).toBe(1);
    expect(roadmap.neverDelivered).toBe(false);
  });

  it("marks never-delivered items while preserving their eligible-session denominator", () => {
    const events = [
      ev({ sessionId: "s1", traceId: "s1", excluded: [{ name: "cold-anchor", reason: "outside token budget" }] }),
      ev({ sessionId: "s2", traceId: "s2", excluded: [{ name: "cold-anchor", reason: "outside token budget" }] }),
    ];
    const sessions = buildSessions(events);
    const rows = aggregateFrequency(sessions);
    const cold = rows.find((r) => r.name === "cold-anchor")!;

    expect(cold.neverDelivered).toBe(true);
    expect(cold.eligibleSessions).toBe(2);
    expect(cold.deliveredSessions).toBe(0);
    expect(cold.lastDelivered).toBeNull();
    expect(cold.medianBytesDelivered).toBeNull();
  });

  it("counts full-read conversion when an excerpt delivery is later followed by a full delivery in the same session", () => {
    const events = [
      ev({
        sessionId: "s1",
        traceId: "s1",
        tool: "startTask",
        timestamp: "2026-07-12T12:00:00.000Z",
        delivered: [{ name: "ui-milestone", mode: "excerpt", bytes: 200 }],
      }),
      ev({
        sessionId: "s1",
        traceId: "s1",
        tool: "readAnchor",
        timestamp: "2026-07-12T12:01:00.000Z",
        delivered: [{ name: "ui-milestone", mode: "full", bytes: 900 }],
      }),
    ];
    const sessions = buildSessions(events);
    const rows = aggregateFrequency(sessions);
    const row = rows.find((r) => r.name === "ui-milestone")!;

    expect(row.fullReadSessions).toBe(1);
    expect(row.fullReadConversion).toBe(1);
    expect(row.medianBytesDelivered).toBe(550);
    expect(row.lastDelivered).toBe("2026-07-12T12:01:00.000Z");
  });

  it("sorts rows by deliveredSessions descending", () => {
    const events = [
      ev({ sessionId: "s1", traceId: "s1", delivered: [{ name: "popular", mode: "excerpt", bytes: 10 }] }),
      ev({ sessionId: "s2", traceId: "s2", delivered: [{ name: "popular", mode: "excerpt", bytes: 10 }] }),
      ev({ sessionId: "s3", traceId: "s3", delivered: [{ name: "rare", mode: "excerpt", bytes: 10 }] }),
    ];
    const sessions = buildSessions(events);
    const rows = aggregateFrequency(sessions);

    expect(rows[0]!.name).toBe("popular");
    expect(rows[0]!.deliveredSessions).toBe(2);
  });
});

describe("project/since filters", () => {
  it("filterEvents matches project exactly and since inclusively", () => {
    const events = [
      ev({ project: "alpha", timestamp: "2026-07-01T00:00:00.000Z" }),
      ev({ project: "beta", timestamp: "2026-07-10T00:00:00.000Z" }),
      ev({ project: "alpha", timestamp: "2026-07-12T00:00:00.000Z" }),
    ];

    expect(filterEvents(events, { project: "alpha" })).toHaveLength(2);
    expect(filterEvents(events, { since: "2026-07-10T00:00:00.000Z" })).toHaveLength(2);
    expect(filterEvents(events, { project: "alpha", since: "2026-07-05T00:00:00.000Z" })).toHaveLength(1);
  });

  it("filterSessions drops sessions with no matching events and trims non-matching events from the rest", () => {
    const events = [
      ev({ sessionId: "s1", traceId: "s1", project: "alpha", timestamp: "2026-07-01T00:00:00.000Z" }),
      ev({ sessionId: "s1", traceId: "s1", project: "beta", timestamp: "2026-07-02T00:00:00.000Z" }),
      ev({ sessionId: "s2", traceId: "s2", project: "beta", timestamp: "2026-07-03T00:00:00.000Z" }),
    ];
    const sessions = buildSessions(events);

    const filtered = filterSessions(sessions, { project: "alpha" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("s1");
    expect(filtered[0]!.events).toHaveLength(1);
    expect(filtered[0]!.events[0]!.project).toBe("alpha");
  });

  it("recomputes startedAt/endedAt/eventCount on trimmed sessions", () => {
    const events = [
      ev({ sessionId: "s1", traceId: "s1", project: "beta", timestamp: "2026-07-01T00:00:00.000Z" }),
      ev({ sessionId: "s1", traceId: "s1", project: "alpha", timestamp: "2026-07-02T00:00:00.000Z" }),
      ev({ sessionId: "s1", traceId: "s1", project: "alpha", timestamp: "2026-07-03T00:00:00.000Z" }),
      ev({ sessionId: "s1", traceId: "s1", project: "beta", timestamp: "2026-07-04T00:00:00.000Z" }),
    ];
    const sessions = buildSessions(events);

    const trimmed = filterSessions(sessions, { project: "alpha" })[0]!;
    expect(trimmed.eventCount).toBe(2);
    expect(trimmed.startedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(trimmed.endedAt).toBe("2026-07-03T00:00:00.000Z");
  });

  it("recomputes task and project metadata from surviving events on trimmed sessions", () => {
    const events = [
      ev({
        sessionId: "s1",
        traceId: "s1",
        tool: "startTask",
        project: "beta",
        task: { sha256: "beta-task", length: 9 },
        timestamp: "2026-07-01T00:00:00.000Z",
      }),
      ev({ sessionId: "s1", traceId: "s1", project: "alpha", timestamp: "2026-07-02T00:00:00.000Z" }),
    ];
    const sessions = buildSessions(events);
    expect(sessions[0]!.taskSha256).toBe("beta-task");

    const trimmed = filterSessions(sessions, { project: "alpha" })[0]!;
    expect(trimmed.taskSha256).toBeUndefined();
    expect(trimmed.taskText).toBeUndefined();
    expect(trimmed.project).toBe("alpha");
  });
});

describe("buildSessions event cap", () => {
  it("caps retained events by default but keeps eventCount, and is uncapped for aggregation callers", () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      ev({
        sessionId: "s1",
        traceId: "s1",
        ordinal: i,
        timestamp: `2026-07-01T00:00:0${i}.000Z`,
      }),
    );

    const capped = buildSessions(events, { maxEventsPerSession: 5 })[0]!;
    expect(capped.eventCount).toBe(7);
    expect(capped.events).toHaveLength(5);

    const uncapped = buildSessions(events, { maxEventsPerSession: Number.POSITIVE_INFINITY })[0]!;
    expect(uncapped.events).toHaveLength(7);
  });
});
