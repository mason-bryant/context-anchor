import type { TraceEvent } from "./events.js";
import type { TraceSessionView } from "./index.js";

/** Reason substring the planner uses when an anchor is excluded for budget, not relevance. */
const BUDGET_EXCLUSION_REASON = "outside token budget";

// ---------------------------------------------------------------------------
// A. Budget degradation and displacement (design §3 / Phase 4)
// ---------------------------------------------------------------------------

export type BudgetConsumer = {
  name: string;
  estimatedTokens?: number;
};

export type DisplacedRow = {
  name: string;
  score?: number;
  estimatedTokens?: number;
  budgetTokens?: number;
  consumers: BudgetConsumer[];
  timestamp: string;
  sessionId?: string;
  tool: string;
};

export type DowngradedRow = {
  name: string;
  requestedMode: string;
  deliveredMode: string;
  bytes?: number;
  timestamp: string;
  sessionId?: string;
};

export type TruncatedRow = {
  tool: string;
  timestamp: string;
  sessionId?: string;
  deliveredNames: string[];
};

export type BudgetAggregate = {
  displaced: DisplacedRow[];
  downgraded: DowngradedRow[];
  truncated: TruncatedRow[];
  /** Anchors repeatedly excluded for budget reasons, most displaced first. */
  displacementCounts: Array<{ name: string; count: number }>;
  /** Anchors that consumed budget ahead of a displacement, most frequent first. */
  consumerCounts: Array<{ name: string; count: number }>;
};

/**
 * Extract budget-degradation views from raw trace events. Pure and
 * unit-testable: callers filter events (project/since) before calling.
 */
export function aggregateBudget(events: TraceEvent[]): BudgetAggregate {
  const displaced: DisplacedRow[] = [];
  const downgraded: DowngradedRow[] = [];
  const truncated: TruncatedRow[] = [];
  const displacementCounts = new Map<string, number>();
  const consumerCounts = new Map<string, number>();

  for (const event of events) {
    const excludedForBudget = (event.excluded ?? []).filter((item) =>
      (item.reason ?? "").toLowerCase().includes(BUDGET_EXCLUSION_REASON),
    );
    if (excludedForBudget.length > 0) {
      const consumers: BudgetConsumer[] = (event.included ?? []).map((item) => ({
        name: item.name,
        estimatedTokens: item.estimatedTokens,
      }));
      for (const item of excludedForBudget) {
        displaced.push({
          name: item.name,
          score: item.score,
          estimatedTokens: item.estimatedTokens,
          budgetTokens: event.budgetTokens,
          consumers,
          timestamp: event.timestamp,
          sessionId: event.sessionId,
          tool: event.tool,
        });
        displacementCounts.set(item.name, (displacementCounts.get(item.name) ?? 0) + 1);
        for (const consumer of consumers) {
          consumerCounts.set(consumer.name, (consumerCounts.get(consumer.name) ?? 0) + 1);
        }
      }
    }

    for (const item of event.delivered ?? []) {
      if (item.requestedMode && item.degradation && item.requestedMode !== item.mode) {
        downgraded.push({
          name: item.name,
          requestedMode: item.requestedMode,
          deliveredMode: item.mode,
          bytes: item.bytes,
          timestamp: event.timestamp,
          sessionId: event.sessionId,
        });
      }
    }

    if (event.truncated) {
      truncated.push({
        tool: event.tool,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        deliveredNames: (event.delivered ?? []).map((item) => item.name),
      });
    }
  }

  return {
    displaced,
    downgraded,
    truncated,
    displacementCounts: sortedCounts(displacementCounts),
    consumerCounts: sortedCounts(consumerCounts),
  };
}

// ---------------------------------------------------------------------------
// B. Follow-up distribution (design §5 / Phase 4)
// ---------------------------------------------------------------------------

export type FollowUpBucket = "zero" | "one" | "twoToThree" | "fourPlus" | "paginationOnly";

export type FollowUpAggregate = {
  buckets: Record<FollowUpBucket, number>;
  /** "sessions with at least N semantic follow-ups", N = 0..max observed. */
  cumulative: Array<{ atLeast: number; sessions: number }>;
  representativeSessionIds: Record<FollowUpBucket, string[]>;
};

const MAX_REPRESENTATIVE = 5;

/**
 * Bucket sessions by semantic follow-up count. A semantic follow-up is any
 * context query after the session's first, excluding cursor:"continuation"
 * (pagination) events. Sessions whose only follow-ups are pagination land in
 * the pagination-only bucket rather than zero, per design §5.
 */
export function aggregateFollowUps(sessions: TraceSessionView[]): FollowUpAggregate {
  const buckets: Record<FollowUpBucket, number> = {
    zero: 0,
    one: 0,
    twoToThree: 0,
    fourPlus: 0,
    paginationOnly: 0,
  };
  const representativeSessionIds: Record<FollowUpBucket, string[]> = {
    zero: [],
    one: [],
    twoToThree: [],
    fourPlus: [],
    paginationOnly: [],
  };
  const semanticCountBySession = new Map<string, number>();

  for (const session of sessions) {
    const ordered = orderedEvents(session.events);
    if (ordered.length === 0) {
      continue;
    }
    const followUps = ordered.slice(1);
    const semanticFollowUps = followUps.filter((event) => event.cursor !== "continuation");
    const paginationFollowUps = followUps.filter((event) => event.cursor === "continuation");
    const semanticCount = semanticFollowUps.length;
    semanticCountBySession.set(session.id, semanticCount);

    let bucket: FollowUpBucket;
    if (semanticCount === 0 && paginationFollowUps.length > 0) {
      bucket = "paginationOnly";
    } else if (semanticCount === 0) {
      bucket = "zero";
    } else if (semanticCount === 1) {
      bucket = "one";
    } else if (semanticCount <= 3) {
      bucket = "twoToThree";
    } else {
      bucket = "fourPlus";
    }

    buckets[bucket] += 1;
    if (representativeSessionIds[bucket].length < MAX_REPRESENTATIVE) {
      representativeSessionIds[bucket].push(session.id);
    }
  }

  const maxSemantic = Math.max(0, ...semanticCountBySession.values());
  const cumulative: Array<{ atLeast: number; sessions: number }> = [];
  for (let n = 0; n <= maxSemantic; n += 1) {
    let count = 0;
    for (const semanticCount of semanticCountBySession.values()) {
      if (semanticCount >= n) {
        count += 1;
      }
    }
    cumulative.push({ atLeast: n, sessions: count });
  }

  return { buckets, cumulative, representativeSessionIds };
}

function orderedEvents(events: TraceEvent[]): TraceEvent[] {
  return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.ordinal - b.ordinal);
}

// ---------------------------------------------------------------------------
// C. Content frequency and coverage (design §6 / Phase 5)
// ---------------------------------------------------------------------------

export type FrequencyRow = {
  name: string;
  eligibleSessions: number;
  consideredSessions: number;
  selectedSessions: number;
  deliveredSessions: number;
  fullReadSessions: number;
  fullReadConversion: number;
  /** Null (not omitted) when the item was never delivered, per the endpoint contract. */
  medianBytesDelivered: number | null;
  lastDelivered: string | null;
  neverDelivered: boolean;
};

/**
 * Per-content-unit (anchor name) frequency and coverage counts, session-scoped
 * so each measure is deduplicated once per session rather than once per event.
 * Eligibility counts sessions where the item appeared in included, excluded,
 * or delivered lists: direct reads (readAnchor et al.) deliver items that
 * never pass through a plan, and counting them keeps deliveredSessions from
 * exceeding its own denominator. Sorted by deliveredSessions desc per the
 * design's "sortable by delivery rate" requirement (callers may re-sort).
 */
export function aggregateFrequency(sessions: TraceSessionView[]): FrequencyRow[] {
  type Accum = {
    eligibleSessions: Set<string>;
    selectedSessions: Set<string>;
    deliveredSessions: Set<string>;
    fullReadSessions: Set<string>;
    fullReadConversionSessions: Set<string>;
    bytesDelivered: number[];
    lastDelivered: string | null;
  };
  const byName = new Map<string, Accum>();

  const ensure = (name: string): Accum => {
    let accum = byName.get(name);
    if (!accum) {
      accum = {
        eligibleSessions: new Set(),
        selectedSessions: new Set(),
        deliveredSessions: new Set(),
        fullReadSessions: new Set(),
        fullReadConversionSessions: new Set(),
        bytesDelivered: [],
        lastDelivered: null,
      };
      byName.set(name, accum);
    }
    return accum;
  };

  for (const session of sessions) {
    const ordered = orderedEvents(session.events);
    // Track, per anchor, whether we've seen an excerpt delivery yet this
    // session so a later full delivery counts as a full-read conversion.
    const excerptSeen = new Set<string>();

    for (const event of ordered) {
      for (const item of event.included ?? []) {
        ensure(item.name).eligibleSessions.add(session.id);
        ensure(item.name).selectedSessions.add(session.id);
      }
      for (const item of event.excluded ?? []) {
        ensure(item.name).eligibleSessions.add(session.id);
      }
      for (const item of event.delivered ?? []) {
        const accum = ensure(item.name);
        accum.eligibleSessions.add(session.id);
        if (item.mode === "excerpt" || item.mode === "full" || item.mode === "structured") {
          accum.deliveredSessions.add(session.id);
          if (typeof item.bytes === "number") {
            accum.bytesDelivered.push(item.bytes);
          }
          if (!accum.lastDelivered || event.timestamp > accum.lastDelivered) {
            accum.lastDelivered = event.timestamp;
          }
          if (item.mode === "full") {
            accum.fullReadSessions.add(session.id);
            if (excerptSeen.has(item.name)) {
              accum.fullReadConversionSessions.add(session.id);
            }
          }
          if (item.mode === "excerpt") {
            excerptSeen.add(item.name);
          }
        }
      }
    }
  }

  const rows: FrequencyRow[] = [...byName.entries()].map(([name, accum]) => ({
    name,
    eligibleSessions: accum.eligibleSessions.size,
    consideredSessions: accum.eligibleSessions.size,
    selectedSessions: accum.selectedSessions.size,
    deliveredSessions: accum.deliveredSessions.size,
    fullReadSessions: accum.fullReadSessions.size,
    fullReadConversion: accum.fullReadConversionSessions.size,
    medianBytesDelivered: median(accum.bytesDelivered),
    lastDelivered: accum.lastDelivered,
    neverDelivered: accum.deliveredSessions.size === 0,
  }));

  rows.sort((a, b) => b.deliveredSessions - a.deliveredSessions);
  return rows;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function sortedCounts(counts: Map<string, number>): Array<{ name: string; count: number }> {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Shared event filtering (project / since query params)
// ---------------------------------------------------------------------------

export type TraceEventFilter = {
  project?: string;
  since?: string;
};

/** Filter events by exact project match and/or timestamp >= since (ISO). */
export function filterEvents(events: TraceEvent[], filter: TraceEventFilter): TraceEvent[] {
  return events.filter((event) => {
    if (filter.project && event.project !== filter.project) {
      return false;
    }
    if (filter.since && event.timestamp < filter.since) {
      return false;
    }
    return true;
  });
}

/**
 * Filter sessions to those containing at least one event matching the
 * filter, and restrict each session's own events to the matching subset so
 * downstream aggregation only sees in-scope events. Trimmed sessions get
 * their startedAt/endedAt/eventCount recomputed from the surviving events so
 * the metadata never disagrees with the event list.
 */
export function filterSessions(sessions: TraceSessionView[], filter: TraceEventFilter): TraceSessionView[] {
  const result: TraceSessionView[] = [];
  for (const session of sessions) {
    const events = filterEvents(session.events, filter);
    if (events.length === 0) {
      continue;
    }
    if (events.length === session.events.length) {
      result.push(session);
      continue;
    }
    // Recompute all session-level metadata from the surviving events so a
    // trimmed view never claims a task, project, or time range the filter
    // removed.
    const ordered = orderedEvents(events);
    const taskEvent = ordered.find((event) => event.task);
    result.push({
      ...session,
      events,
      eventCount: events.length,
      startedAt: ordered[0]!.timestamp,
      endedAt: ordered[ordered.length - 1]!.timestamp,
      taskSha256: taskEvent?.task?.sha256,
      taskText: taskEvent?.task?.text,
      project: ordered.find((event) => event.project)?.project,
    });
  }
  return result;
}
