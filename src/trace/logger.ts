import path from "node:path";

import type winston from "winston";

import { closeWinstonLogger, createWinstonLogger, resolveFileLoggingConfig } from "../logger.js";
import type { LoggingConfig, TraceLoggingConfig } from "../types.js";
import { expandHome } from "../utils/path.js";
import type { TraceEvent } from "./events.js";

/**
 * Writes context-trace events as JSON lines. Reuses the request-log rotation
 * mechanism, but with an independent retention default of one year — aggregate
 * views lose their history if traces rotate on the request-log schedule.
 */
export type TraceLogger = {
  readonly enabled: boolean;
  /** Raw task text is only persisted when explicitly configured. */
  readonly includeTaskText: boolean;
  /** Directory trace files are written to (absolute), when enabled. */
  readonly dirname?: string;
  log(event: TraceEvent): void;
  /** Subscribe to live events (used by the in-memory trace index). */
  onEvent(listener: (event: TraceEvent) => void): void;
  close(): Promise<void>;
};

export const TRACE_FILENAME_PREFIX = "anchor-mcp-traces";

const DEFAULT_TRACE_LOGGING: Required<Omit<TraceLoggingConfig, "includeTaskText">> = {
  enabled: true,
  dirname: "~/.anchor-mcp/logs",
  filename: `${TRACE_FILENAME_PREFIX}-%DATE%.log`,
  level: "info",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "365d",
  zippedArchive: true,
};

export const noopTraceLogger: TraceLogger = {
  enabled: false,
  includeTaskText: false,
  log() {},
  onEvent() {},
  async close() {},
};

export function createTraceLogger(config: LoggingConfig | undefined): TraceLogger {
  const traceConfig = resolveFileLoggingConfig(config?.traces, DEFAULT_TRACE_LOGGING);
  if (!traceConfig) {
    return noopTraceLogger;
  }

  return new WinstonTraceLogger(
    createWinstonLogger(traceConfig, { service: "anchor-mcp", log: "traces" }),
    path.resolve(expandHome(traceConfig.dirname)),
    config?.traces?.includeTaskText ?? false,
  );
}

class WinstonTraceLogger implements TraceLogger {
  readonly enabled = true;
  private readonly listeners: Array<(event: TraceEvent) => void> = [];
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly logger: winston.Logger,
    readonly dirname: string,
    readonly includeTaskText: boolean,
  ) {}

  log(event: TraceEvent): void {
    if (this.closed) {
      return;
    }
    this.logger.info("context trace", event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  onEvent(listener: (event: TraceEvent) => void): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = closeWinstonLogger(this.logger);
    return this.closePromise;
  }
}
