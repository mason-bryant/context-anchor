import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import type { TraceEvent } from "./events.js";
import { TRACE_FILENAME_PREFIX, type TraceLogger } from "./logger.js";
import type { TraceRating } from "./ratings.js";

/**
 * Session-level measures computed once per session per the design's
 * "Recommended session measures" table. All measures are derived server-side;
 * the browser never aggregates raw events.
 */
export type TraceSessionMeasures = {
  /** Context queries after the session's initial retrieval query. */
  followUpCount: number;
  /** Follow-ups excluding cursor-only pagination continuations. */
  semanticFollowUpCount: number;
  /** Follow-up events that were pagination continuations. */
  paginationCount: number;
  /**
   * Events the server flagged zero-hit: searches, discovery, and loadContext
   * calls that matched nothing. startTask bundles never carry the flag; empty
   * bundles surface through the dry-queries view instead.
   */
  zeroHitCount: number;
  /** Total delivered items across every event in the session. */
  deliveredItemCount: number;
  /**
   * Same-item full-read conversions: an anchor delivered as an excerpt earlier
   * in the session and later delivered as a full document. Matched by name.
   */
  fullReadConversions: number;
};

/** One correlated session, grouped by trace id or subdivided transport identity. */
export type TraceSessionView = {
  id: string;
  correlation: "exact" | "transport" | "process";
  transport: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  /** Task identity from the session's first task-bearing event. */
  taskSha256?: string;
  taskText?: string;
  project?: string;
  events: TraceEvent[];
  measures: TraceSessionMeasures;
  /** Manual session rating, when one has been recorded. */
  rating?: TraceRating;
};

/** A single unambiguously dry context query, surfaced across sessions. */
export type TraceDryQuery = {
  sessionId: string;
  timestamp: string;
  tool: string;
  taskSha256?: string;
  taskText?: string;
  project?: string;
  /** Why this event counts as dry: zero hits, nothing delivered, or metadata only. */
  reason: "zero-hit" | "nothing-delivered" | "metadata-only";
  /** Top considered-but-excluded item, if the event reported one. */
  nearestMiss?: { name: string; reason?: string };
};

const MAX_EVENTS_IN_MEMORY = 100_000;
const MAX_EVENTS_PER_SESSION = 500;
const WINSTON_KEYS = ["level", "message", "service", "log"] as const;

/**
 * Lazily built in-memory index over trace events: existing trace files are read
 * once on first query, and live events append via the trace logger's listener.
 * UI requests never read trace files directly.
 */
export class TraceIndex {
  private readonly eventsById = new Map<string, TraceEvent>();
  private loadPromise: Promise<void> | undefined;
  /** Memoized session grouping, invalidated whenever a new event appends. */
  private sessionsCache: TraceSessionView[] | undefined;

  constructor(
    private readonly logger: TraceLogger,
    private readonly ratings?: { getAll(): Promise<Record<string, TraceRating>> },
  ) {
    logger.onEvent((event) => this.append(event));
  }

  get enabled(): boolean {
    return this.logger.enabled;
  }

  async getSessions(options: { limit?: number; sessionId?: string } = {}): Promise<TraceSessionView[]> {
    if (!this.logger.enabled) {
      return [];
    }
    const [sessions, ratings] = await Promise.all([
      this.buildAllSessions(),
      this.ratings?.getAll() ?? Promise.resolve<Record<string, TraceRating>>({}),
    ]);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    return sessions
      // sessionId lookup happens before the recency limit so any session the
      // dry-queries view references stays reachable, however old.
      .filter((session) => !options.sessionId || session.id === options.sessionId)
      .map((session) => (ratings[session.id] ? { ...session, rating: ratings[session.id] } : session))
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
      .slice(0, limit);
  }

  /**
   * Every unambiguously dry context query across all in-memory sessions, per
   * the design's Dry Queries view. Not limited like `getSessions`, since dry
   * queries are the operator's highest-value signal and the underlying event
   * volume is already bounded by `MAX_EVENTS_IN_MEMORY`.
   */
  async getDryQueries(options: { thinNoFollowUp?: boolean; limit?: number } = {}): Promise<TraceDryQuery[]> {
    if (!this.logger.enabled) {
      return [];
    }
    const sessions = await this.buildAllSessions();
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    return findDryQueries(sessions, options)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  private async buildAllSessions(): Promise<TraceSessionView[]> {
    await this.ensureLoaded();
    this.sessionsCache ??= buildSessions([...this.eventsById.values()]);
    return this.sessionsCache;
  }

  private append(event: TraceEvent): void {
    if (this.eventsById.size >= MAX_EVENTS_IN_MEMORY) {
      return;
    }
    if (!this.eventsById.has(event.id)) {
      this.eventsById.set(event.id, event);
      this.sessionsCache = undefined;
    }
  }

  private ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.loadFiles().catch(() => {});
    return this.loadPromise;
  }

  private async loadFiles(): Promise<void> {
    const dirname = this.logger.dirname;
    if (!dirname) {
      return;
    }
    let names: string[];
    try {
      names = await fs.readdir(dirname);
    } catch {
      return;
    }
    const traceFiles = names.filter((name) => name.startsWith(TRACE_FILENAME_PREFIX)).sort();
    for (const name of traceFiles) {
      if (this.eventsById.size >= MAX_EVENTS_IN_MEMORY) {
        return;
      }
      try {
        const raw = await fs.readFile(path.join(dirname, name));
        const text = name.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
        for (const line of text.split("\n")) {
          if (this.eventsById.size >= MAX_EVENTS_IN_MEMORY) {
            return;
          }
          const event = parseTraceLine(line);
          if (event) {
            this.append(event);
          }
        }
      } catch {
        // Skip unreadable or partially written files; live events still index.
      }
    }
  }
}

function parseTraceLine(line: string): TraceEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    typeof (parsed as { tool?: unknown }).tool !== "string"
  ) {
    return undefined;
  }
  const event = { ...(parsed as Record<string, unknown>) };
  for (const key of WINSTON_KEYS) {
    delete event[key];
  }
  return event as unknown as TraceEvent;
}

/**
 * Group events into sessions. Events carrying a trace id join that trace's
 * session. Traceless events group by transport identity, subdivided at
 * `startTask` boundaries; traceless events after a trace-minting `startTask`
 * on the same transport join that trace's session, since transport calls are
 * assumed serial (interleaved concurrent tasks are a documented limitation).
 */
export function buildSessions(events: TraceEvent[]): TraceSessionView[] {
  const sorted = [...events].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.ordinal - b.ordinal,
  );

  const sessions = new Map<string, TraceSessionView>();
  const currentByTransport = new Map<string, string>();
  const subdivisionCounters = new Map<string, number>();

  for (const event of sorted) {
    const transportKey = event.sessionId ? `http:${event.sessionId}` : `${event.transport}:${event.processId}`;

    let sessionId: string;
    if (event.tool === "startTask") {
      sessionId = event.traceId ?? nextSubdivisionId(subdivisionCounters, transportKey);
      currentByTransport.set(transportKey, sessionId);
    } else if (event.traceId) {
      sessionId = event.traceId;
    } else {
      sessionId =
        currentByTransport.get(transportKey) ?? nextSubdivisionId(subdivisionCounters, transportKey);
      currentByTransport.set(transportKey, sessionId);
    }

    const session = sessions.get(sessionId) ?? {
      id: sessionId,
      correlation: event.traceId ? ("exact" as const) : event.sessionId ? ("transport" as const) : ("process" as const),
      transport: event.transport,
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      eventCount: 0,
      events: [],
      measures: EMPTY_MEASURES,
    };
    session.endedAt = event.timestamp > session.endedAt ? event.timestamp : session.endedAt;
    session.eventCount += 1;
    if (session.events.length < MAX_EVENTS_PER_SESSION) {
      session.events.push(event);
    }
    if (!session.taskSha256 && event.task) {
      session.taskSha256 = event.task.sha256;
      session.taskText = event.task.text;
    }
    session.project ??= event.project;
    sessions.set(sessionId, session);
  }

  for (const session of sessions.values()) {
    session.measures = computeSessionMeasures(session.events);
  }

  return [...sessions.values()];
}

const EMPTY_MEASURES: TraceSessionMeasures = {
  followUpCount: 0,
  semanticFollowUpCount: 0,
  paginationCount: 0,
  zeroHitCount: 0,
  deliveredItemCount: 0,
  fullReadConversions: 0,
};

/**
 * Compute the design's "Recommended session measures" for one session's events
 * (already ordered by timestamp/ordinal by `buildSessions`). Every context tool
 * call is a context query per the design, so follow-ups are simply every event
 * after the first.
 */
function computeSessionMeasures(events: TraceEvent[]): TraceSessionMeasures {
  const followUps = events.slice(1);
  const paginationCount = followUps.filter((event) => event.cursor === "continuation").length;
  const semanticFollowUpCount = followUps.length - paginationCount;
  const zeroHitCount = events.filter((event) => event.zeroHit).length;

  let deliveredItemCount = 0;
  const deliveredModesByName = new Map<string, Set<string>>();
  // A conversion counts once per anchor: the first excerpt→full transition.
  const convertedNames = new Set<string>();
  let fullReadConversions = 0;
  for (const event of events) {
    for (const item of event.delivered ?? []) {
      deliveredItemCount += 1;
      const seenModes = deliveredModesByName.get(item.name);
      if (item.mode === "full" && seenModes?.has("excerpt") && !convertedNames.has(item.name)) {
        convertedNames.add(item.name);
        fullReadConversions += 1;
      }
      if (!seenModes) {
        deliveredModesByName.set(item.name, new Set([item.mode]));
      } else {
        seenModes.add(item.mode);
      }
    }
  }

  return {
    followUpCount: followUps.length,
    semanticFollowUpCount,
    paginationCount,
    zeroHitCount,
    deliveredItemCount,
    fullReadConversions,
  };
}

function nextSubdivisionId(counters: Map<string, number>, transportKey: string): string {
  const next = (counters.get(transportKey) ?? 0) + 1;
  counters.set(transportKey, next);
  return `${transportKey}#${next}`;
}

/**
 * Extract every unambiguously dry context query across sessions per the
 * design's Dry Queries view. Zero-hit searches and calls that delivered
 * nothing are query-intrinsic failures and always listed, regardless of
 * session shape. Metadata-only delivery in a single-query session is the
 * ambiguous "thin delivery, no follow-up" case (the bundle may simply have
 * been sufficient), so it appears only behind the `thinNoFollowUp` filter —
 * being single-query is never a dry criterion by itself.
 */
export function findDryQueries(sessions: TraceSessionView[], options: { thinNoFollowUp?: boolean } = {}): TraceDryQuery[] {
  const results: TraceDryQuery[] = [];

  for (const session of sessions) {
    const isSingleQuery = session.events.length <= 1;
    for (const event of session.events) {
      const reason = classifyDryEvent(event);
      if (!reason) {
        continue;
      }
      if (isSingleQuery && reason === "metadata-only" && !options.thinNoFollowUp) {
        continue;
      }
      results.push({
        sessionId: session.id,
        timestamp: event.timestamp,
        tool: event.tool,
        taskSha256: session.taskSha256,
        taskText: session.taskText,
        project: session.project,
        reason,
        nearestMiss: nearestMiss(event),
      });
    }
  }

  return results;
}

/**
 * Classify one event as dry, or undefined when it delivered substantive
 * content. Search and discovery calls are dry on a zero-hit result.
 * `planContextBundle` never delivers bodies, so it is dry when it selected
 * nothing (an empty `included` list) rather than delivered nothing. `startTask`
 * and `loadContext` bundle calls are dry when nothing was delivered at all, or
 * when every delivered item was metadata only (no excerpt, full body, or
 * structured projection).
 */
function classifyDryEvent(event: TraceEvent): TraceDryQuery["reason"] | undefined {
  if (event.zeroHit) {
    return "zero-hit";
  }
  if (event.tool === "planContextBundle") {
    return !event.included?.length ? "nothing-delivered" : undefined;
  }
  const isBundleCall = event.tool === "startTask" || event.tool === "loadContext";
  if (!isBundleCall) {
    return undefined;
  }
  const delivered = event.delivered ?? [];
  const structuredCount = event.structured?.ids.length ?? 0;
  const listedCount = event.listed?.length ?? 0;
  if (delivered.length === 0 && structuredCount === 0) {
    // A bundle that exposed index metadata (listed entries) delivered thin
    // content rather than nothing; classify it with the ambiguous
    // metadata-only case so the single-query gate applies.
    return listedCount > 0 ? "metadata-only" : "nothing-delivered";
  }
  // Structured projections (roadmap goals, milestone rows) are substantive
  // content, so their presence keeps a metadata-only anchor list from being dry.
  if (structuredCount === 0 && delivered.length > 0 && delivered.every((item) => item.mode === "metadata" || item.mode === "none")) {
    return "metadata-only";
  }
  return undefined;
}

function nearestMiss(event: TraceEvent): TraceDryQuery["nearestMiss"] {
  const excluded = event.excluded;
  if (!excluded?.length) {
    return undefined;
  }
  const top = [...excluded].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))[0];
  return top ? { name: top.name, reason: top.reason } : undefined;
}
