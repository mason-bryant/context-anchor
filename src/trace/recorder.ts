import { randomBytes } from "node:crypto";

import {
  CONTEXT_TOOLS,
  newEventId,
  projectToolResult,
  taskIdentity,
  TRACE_EVENT_VERSION,
  type TraceEvent,
} from "./events.js";
import type { TraceLogger } from "./logger.js";

/** Stable identity for this server process, shared by every connection in it. */
export const PROCESS_ID = randomBytes(6).toString("hex");

/**
 * How the MCP server instance is connected. Stateful HTTP creates one server per
 * transport session, so `getSessionId` resolves that session's id once the
 * transport has initialized; stdio and stateless HTTP fall back to the process id.
 */
export type TraceConnection = {
  transport: "http" | "stdio" | "process";
  getSessionId(): string | undefined;
};

const PROCESS_CONNECTION: TraceConnection = { transport: "process", getSessionId: () => undefined };

/**
 * Builds one trace event per context-tool call by projecting the tool's response.
 * One recorder exists per McpServer instance, so ordinals order events within a
 * connection.
 */
export class TraceRecorder {
  private ordinal = 0;

  constructor(
    private readonly logger: TraceLogger,
    private readonly connection: TraceConnection = PROCESS_CONNECTION,
  ) {}

  get enabled(): boolean {
    return this.logger.enabled;
  }

  isContextTool(toolName: string): boolean {
    return CONTEXT_TOOLS.has(toolName);
  }

  record(options: {
    toolName: string;
    input: unknown;
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
    error?: unknown;
    durationMs: number;
  }): void {
    if (!this.logger.enabled) {
      return;
    }

    const input = isRecord(options.input) ? options.input : {};
    const structured = options.result?.structuredContent;
    const inputTraceId = typeof input.traceId === "string" ? input.traceId : undefined;
    const resultTraceId =
      options.toolName === "startTask" && typeof structured?.traceId === "string" ? structured.traceId : undefined;
    const traceId = inputTraceId ?? resultTraceId;
    const sessionId = this.connection.getSessionId();
    const task = typeof input.task === "string" ? input.task : undefined;

    const event: TraceEvent = {
      v: TRACE_EVENT_VERSION,
      id: newEventId(),
      timestamp: new Date().toISOString(),
      tool: options.toolName,
      ordinal: this.ordinal++,
      outcome: options.error ? "exception" : options.result?.isError ? "mcp-error" : "success",
      durationMs: options.durationMs,
      correlation: traceId ? "exact" : sessionId ? "transport" : "process",
      ...(traceId ? { traceId } : {}),
      ...(resultTraceId && !inputTraceId ? { mintedTraceId: true } : {}),
      ...(sessionId ? { sessionId } : {}),
      processId: PROCESS_ID,
      transport: this.connection.transport,
      ...(task ? { task: taskIdentity(task, this.logger.includeTaskText) } : {}),
      ...(typeof input.project === "string" ? { project: input.project } : {}),
      ...(typeof input.repo === "string" ? { repo: input.repo } : {}),
      ...(options.error ? { error: { message: errorMessage(options.error) } } : {}),
      ...(!options.error ? projectToolResult(options.toolName, input, structured) : {}),
    };

    this.logger.log(event);
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
