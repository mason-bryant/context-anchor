import { createHash, randomBytes } from "node:crypto";

/** Trace event schema version, bumped only on breaking shape changes. */
export const TRACE_EVENT_VERSION = 1;

/** How this event was tied to a session. */
export type TraceCorrelation = "exact" | "transport" | "process";

/** Content mode actually delivered (or requested) for one item. */
export type TraceContentMode = "full" | "excerpt" | "metadata" | "structured" | "none";

export type TraceDegradationCause = "row-byte-limit" | "budget-displacement";

/** One anchor (or section read) whose content was delivered by the response. */
export type TraceDeliveredItem = {
  name: string;
  mode: TraceContentMode;
  bytes?: number;
  /** Section names included, when the response exposes them (section reads). */
  sections?: string[];
  /** Present only when the delivered mode differs from what was requested. */
  requestedMode?: TraceContentMode;
  degradation?: TraceDegradationCause;
  warningCount?: number;
};

/** One planner-scored anchor (included or excluded). */
export type TracePlanItem = {
  name: string;
  score?: number;
  estimatedTokens?: number;
  reason?: string;
};

export type TraceTaskIdentity = {
  sha256: string;
  length: number;
  /** Raw task text, present only when tracing is configured with includeTaskText. */
  text?: string;
};

export type TraceEvent = {
  v: typeof TRACE_EVENT_VERSION;
  /** Unique event id for deduplication between live and file-loaded events. */
  id: string;
  timestamp: string;
  tool: string;
  /** Per-connection sequence number. */
  ordinal: number;
  outcome: "success" | "mcp-error" | "exception";
  durationMs: number;
  correlation: TraceCorrelation;
  traceId?: string;
  /** True when this startTask call minted the trace id rather than receiving it. */
  mintedTraceId?: boolean;
  /** Transport session id (HTTP mcp-session-id) when available. */
  sessionId?: string;
  processId: string;
  transport: "http" | "stdio" | "process";
  task?: TraceTaskIdentity;
  project?: string;
  repo?: string;
  budgetTokens?: number;
  estimatedTokens?: number;
  /** Total candidates the planner scored, when the response reports it. */
  considered?: number;
  included?: TracePlanItem[];
  excluded?: TracePlanItem[];
  missingContext?: string[];
  /** Names exposed as metadata only (index, discovery, or search results). */
  listed?: string[];
  delivered?: TraceDeliveredItem[];
  /** Structured projections (roadmap goals, milestone rows) returned without documents. */
  structured?: { kind: string; ids: string[] };
  truncated?: boolean;
  cursor?: "initial" | "continuation";
  /** True when a discovery or search call matched nothing. */
  zeroHit?: boolean;
  error?: { message: string };
};

/** Tools whose calls count as context queries and are traced. */
export const CONTEXT_TOOLS = new Set([
  "startTask",
  "planContextBundle",
  "loadContext",
  "contextRoot",
  "searchAnchors",
  "listAnchors",
  "readAnchor",
  "readAnchorBatch",
  "readAnchorSection",
  "listRoadmapGoals",
  "readMilestone",
  "listMilestones",
]);

const MAX_ITEMS = 50;
const MAX_REASON_LENGTH = 200;

export function newTraceId(): string {
  return `t-${randomBytes(8).toString("hex")}`;
}

export function newEventId(): string {
  return randomBytes(6).toString("hex");
}

export function taskIdentity(task: string, includeTaskText: boolean): TraceTaskIdentity {
  return {
    sha256: createHash("sha256").update(task).digest("hex"),
    length: task.length,
    ...(includeTaskText ? { text: task } : {}),
  };
}

/**
 * Project one context-tool response into the trace-event body. The event is a
 * projection of the response the server already computed — never a copy of
 * content bodies.
 */
export function projectToolResult(
  tool: string,
  input: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
): Partial<TraceEvent> {
  if (!result) {
    return {};
  }

  switch (tool) {
    case "startTask":
      return projectStartTask(result);
    case "planContextBundle":
      return projectPlanContextBundle(result);
    case "loadContext":
      return projectLoadContext(input, result);
    case "contextRoot":
      return projectContextRoot(result);
    case "searchAnchors":
      return projectSearchAnchors(result);
    case "listAnchors":
      return projectListAnchors(result);
    case "readAnchor":
      return projectAnchorRead(result);
    case "readAnchorBatch":
      return projectAnchorBatch(result);
    case "readAnchorSection":
      return projectAnchorSection(result);
    case "listRoadmapGoals":
      return projectRoadmapGoals(result);
    case "readMilestone":
      return projectMilestoneRead(result);
    case "listMilestones":
      return projectMilestones(result);
    default:
      return {};
  }
}

function projectStartTask(result: Record<string, unknown>): Partial<TraceEvent> {
  const plan = asRecord(result.plan);
  const anchors = asArray(result.anchors);
  const milestones = asArray(result.activeMilestones);
  return {
    budgetTokens: asNumber(plan?.budgetTokens),
    estimatedTokens: asNumber(plan?.estimatedTokens),
    included: planItems(plan?.included),
    excluded: planItems(plan?.excluded),
    missingContext: stringList(plan?.missingContext),
    delivered: anchors.map((anchor) => deliveredFromLoadContextRow(asRecord(anchor) ?? {}, "excerpt")),
    structured: milestones.length
      ? {
          kind: "milestone",
          ids: milestones.map((m) => asString(asRecord(m)?.name) ?? "").filter(Boolean).slice(0, MAX_ITEMS),
        }
      : undefined,
    truncated: asBoolean(result.truncated),
    cursor: "initial",
  };
}

function projectPlanContextBundle(result: Record<string, unknown>): Partial<TraceEvent> {
  return {
    budgetTokens: asNumber(result.budgetTokens),
    estimatedTokens: asNumber(result.estimatedTokens),
    considered: asNumber(result.totalCandidates),
    included: planItems(result.included),
    excluded: planItems(result.excluded),
    missingContext: stringList(result.missingContext),
  };
}

function projectLoadContext(input: Record<string, unknown>, result: Record<string, unknown>): Partial<TraceEvent> {
  const requested = normalizeMode(asString(input.includeContent)) ?? "excerpt";
  const anchors = asArray(result.anchors);
  const returnedCount = asNumber(result.returnedCount) ?? anchors.length;
  return {
    listed: nameList(result.entries),
    delivered: anchors.map((anchor) => deliveredFromLoadContextRow(asRecord(anchor) ?? {}, requested)),
    truncated: asBoolean(result.truncated),
    cursor: input.cursor ? "continuation" : "initial",
    zeroHit: returnedCount === 0 || undefined,
  };
}

function projectContextRoot(result: Record<string, unknown>): Partial<TraceEvent> {
  const listed = nameList(result.entries);
  return { listed, zeroHit: listed?.length === 0 || undefined };
}

function projectSearchAnchors(result: Record<string, unknown>): Partial<TraceEvent> {
  const hits = asArray(result.hits);
  const names = [...new Set(hits.map((hit) => asString(asRecord(hit)?.name) ?? "").filter(Boolean))];
  return { listed: names.slice(0, MAX_ITEMS), zeroHit: hits.length === 0 || undefined };
}

function projectListAnchors(result: Record<string, unknown>): Partial<TraceEvent> {
  const listed = nameList(result.anchors);
  return { listed, zeroHit: listed?.length === 0 || undefined };
}

function projectAnchorRead(result: Record<string, unknown>): Partial<TraceEvent> {
  return { delivered: [deliveredFull(result)] };
}

function projectAnchorBatch(result: Record<string, unknown>): Partial<TraceEvent> {
  const anchors = asArray(result.anchors);
  return { delivered: anchors.slice(0, MAX_ITEMS).map((anchor) => deliveredFull(asRecord(anchor) ?? {})) };
}

function projectAnchorSection(result: Record<string, unknown>): Partial<TraceEvent> {
  const heading = asString(result.heading);
  return {
    delivered: [
      {
        name: asString(result.name) ?? "unknown",
        mode: "excerpt",
        bytes: asString(result.content)?.length,
        ...(heading ? { sections: [heading] } : {}),
      },
    ],
  };
}

function projectRoadmapGoals(result: Record<string, unknown>): Partial<TraceEvent> {
  const goals = asArray(result.goals);
  const ids = goals.map((goal) => asString(asRecord(goal)?.id) ?? "").filter(Boolean);
  return {
    structured: { kind: "roadmap-goal", ids: ids.slice(0, MAX_ITEMS) },
    zeroHit: goals.length === 0 || undefined,
  };
}

function projectMilestoneRead(result: Record<string, unknown>): Partial<TraceEvent> {
  const milestone = asRecord(result.milestone) ?? result;
  const goals = asArray(result.goals);
  const ids = goals.map((goal) => asString(asRecord(goal)?.id) ?? "").filter(Boolean);
  return {
    delivered: [deliveredFull(milestone)],
    ...(ids.length ? { structured: { kind: "roadmap-goal", ids: ids.slice(0, MAX_ITEMS) } } : {}),
  };
}

function projectMilestones(result: Record<string, unknown>): Partial<TraceEvent> {
  const milestones = asArray(result.milestones);
  const ids = milestones.map((m) => asString(asRecord(m)?.name) ?? "").filter(Boolean);
  return {
    structured: { kind: "milestone", ids: ids.slice(0, MAX_ITEMS) },
    zeroHit: milestones.length === 0 || undefined,
  };
}

/**
 * Classify one loadContext/startTask anchor row. Delivered mode is inferred from
 * which content field the row carries; a `full` request answered with an excerpt
 * or metadata row was downgraded by the per-row byte limit.
 */
function deliveredFromLoadContextRow(row: Record<string, unknown>, requested: TraceContentMode): TraceDeliveredItem {
  const content = asString(row.content);
  const excerpt = asString(row.excerpt);
  const mode: TraceContentMode = content !== undefined ? "full" : excerpt !== undefined ? "excerpt" : "metadata";
  const warnings = asArray(row.warnings);
  const downgraded = requested === "full" && mode !== "full";
  return {
    name: asString(row.name) ?? "unknown",
    mode,
    bytes: (content ?? excerpt)?.length,
    ...(downgraded ? { requestedMode: requested, degradation: "row-byte-limit" as const } : {}),
    ...(warnings.length ? { warningCount: warnings.length } : {}),
  };
}

function deliveredFull(row: Record<string, unknown>): TraceDeliveredItem {
  const warnings = asArray(row.warnings);
  return {
    name: asString(row.name) ?? "unknown",
    mode: "full",
    bytes: asString(row.content)?.length,
    ...(warnings.length ? { warningCount: warnings.length } : {}),
  };
}

function planItems(value: unknown): TracePlanItem[] | undefined {
  const items = asArray(value);
  if (!items.length) {
    return undefined;
  }
  return items.slice(0, MAX_ITEMS).map((item) => {
    const record = asRecord(item) ?? {};
    const reason = asString(record.reason);
    return {
      name: asString(record.name) ?? "unknown",
      score: asNumber(record.score),
      estimatedTokens: asNumber(record.estimatedTokens),
      ...(reason ? { reason: reason.slice(0, MAX_REASON_LENGTH) } : {}),
    };
  });
}

function nameList(value: unknown): string[] | undefined {
  const items = asArray(value);
  if (!items.length) {
    return items.length === 0 && Array.isArray(value) ? [] : undefined;
  }
  return items
    .map((item) => asString(asRecord(item)?.name) ?? "")
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

function stringList(value: unknown): string[] | undefined {
  const items = asArray(value).filter((item): item is string => typeof item === "string");
  return items.length ? items.slice(0, MAX_ITEMS) : undefined;
}

function normalizeMode(value: string | undefined): TraceContentMode | undefined {
  return value === "full" || value === "excerpt" || value === "none" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
