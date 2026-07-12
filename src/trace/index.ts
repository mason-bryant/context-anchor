import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import type { TraceEvent } from "./events.js";
import { TRACE_FILENAME_PREFIX, type TraceLogger } from "./logger.js";

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

  constructor(private readonly logger: TraceLogger) {
    logger.onEvent((event) => this.append(event));
  }

  get enabled(): boolean {
    return this.logger.enabled;
  }

  async getSessions(options: { limit?: number } = {}): Promise<TraceSessionView[]> {
    if (!this.logger.enabled) {
      return [];
    }
    await this.ensureLoaded();
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    return buildSessions([...this.eventsById.values()])
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
      .slice(0, limit);
  }

  /**
   * All indexed events, unsorted-by-recency (callers that need sessions should
   * prefer getSessions; this exists for aggregate view models that filter and
   * regroup events themselves).
   */
  async getEvents(): Promise<TraceEvent[]> {
    if (!this.logger.enabled) {
      return [];
    }
    await this.ensureLoaded();
    return [...this.eventsById.values()];
  }

  private append(event: TraceEvent): void {
    if (this.eventsById.size >= MAX_EVENTS_IN_MEMORY) {
      return;
    }
    if (!this.eventsById.has(event.id)) {
      this.eventsById.set(event.id, event);
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

  return [...sessions.values()];
}

function nextSubdivisionId(counters: Map<string, number>, transportKey: string): string {
  const next = (counters.get(transportKey) ?? 0) + 1;
  counters.set(transportKey, next);
  return `${transportKey}#${next}`;
}
