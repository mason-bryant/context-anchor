import { createHash } from "node:crypto";
import path from "node:path";

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

import type { FileLoggingConfig, LoggingConfig, RequestLoggingConfig } from "./types.js";
import { expandHome } from "./utils/path.js";

type LogMeta = Record<string, unknown>;

export type AppLogger = {
  readonly enabled: boolean;
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  close(): Promise<void>;
};

export type RequestLogEvent = {
  toolName: string;
  arguments?: unknown;
  durationMs: number;
  outcome: "success" | "mcp-error" | "exception";
  isError?: boolean;
  error?: LogMeta;
};

export type RequestLogger = {
  readonly enabled: boolean;
  logToolCall(event: RequestLogEvent): void;
  close(): Promise<void>;
};

type ResolvedFileLoggingConfig = Required<FileLoggingConfig>;
type ResolvedRequestLoggingConfig = Required<RequestLoggingConfig>;

const DEFAULT_FILE_LOGGING: ResolvedFileLoggingConfig = {
  enabled: true,
  dirname: "~/.anchor-mcp/logs",
  filename: "anchor-mcp-%DATE%.log",
  level: "info",
  datePattern: "YYYY-MM-DD",
  maxSize: "10m",
  maxFiles: "14d",
  zippedArchive: true,
};

const DEFAULT_REQUEST_LOGGING: ResolvedRequestLoggingConfig = {
  ...DEFAULT_FILE_LOGGING,
  filename: "anchor-mcp-requests-%DATE%.log",
  includeArguments: true,
  redactArguments: true,
};

export const noopLogger: AppLogger = {
  enabled: false,
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

export const noopRequestLogger: RequestLogger = {
  enabled: false,
  logToolCall() {},
  async close() {},
};

export function createAppLogger(config: LoggingConfig | undefined): AppLogger {
  const fileConfig = resolveFileLoggingConfig(config?.file, DEFAULT_FILE_LOGGING);
  if (!fileConfig) {
    return noopLogger;
  }

  return new WinstonAppLogger(createWinstonLogger(fileConfig, { service: "anchor-mcp" }));
}

export function createRequestLogger(config: LoggingConfig | undefined): RequestLogger {
  const requestConfig = resolveRequestLoggingConfig(config?.requests);
  if (!requestConfig) {
    return noopRequestLogger;
  }

  return new WinstonRequestLogger(
    createWinstonLogger(requestConfig, { service: "anchor-mcp", log: "requests" }),
    requestConfig,
  );
}

export function createWinstonLogger(fileConfig: Required<FileLoggingConfig>, defaultMeta: LogMeta): winston.Logger {
  const transport = new DailyRotateFile({
    dirname: path.resolve(expandHome(fileConfig.dirname)),
    filename: fileConfig.filename,
    datePattern: fileConfig.datePattern,
    maxSize: fileConfig.maxSize,
    maxFiles: fileConfig.maxFiles,
    zippedArchive: fileConfig.zippedArchive,
    level: fileConfig.level,
  });
  transport.on("error", (error) => {
    console.error(`anchor-mcp logger error: ${error instanceof Error ? error.message : String(error)}`);
  });

  const logger = winston.createLogger({
    level: fileConfig.level,
    defaultMeta,
    exitOnError: false,
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    transports: [transport],
  });

  return logger;
}

export function errorMetadata(error: unknown): LogMeta {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

export function resolveFileLoggingConfig(
  config: FileLoggingConfig | undefined,
  defaults: Required<FileLoggingConfig>,
): Required<FileLoggingConfig> | undefined {
  if (!config?.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    dirname: config.dirname ?? defaults.dirname,
    filename: config.filename ?? defaults.filename,
    level: config.level ?? defaults.level,
    datePattern: config.datePattern ?? defaults.datePattern,
    maxSize: config.maxSize ?? defaults.maxSize,
    maxFiles: config.maxFiles ?? defaults.maxFiles,
    zippedArchive: config.zippedArchive ?? defaults.zippedArchive,
  };
}

function resolveRequestLoggingConfig(
  config: RequestLoggingConfig | undefined,
): ResolvedRequestLoggingConfig | undefined {
  const fileConfig = resolveFileLoggingConfig(config, DEFAULT_REQUEST_LOGGING);
  if (!fileConfig || !config) {
    return undefined;
  }

  return {
    ...fileConfig,
    includeArguments: config.includeArguments ?? DEFAULT_REQUEST_LOGGING.includeArguments,
    redactArguments: config.redactArguments ?? DEFAULT_REQUEST_LOGGING.redactArguments,
  };
}

class WinstonAppLogger implements AppLogger {
  readonly enabled = true;
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly logger: winston.Logger) {}

  debug(message: string, meta?: LogMeta): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: LogMeta): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.log("error", message, meta);
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closed = true;
    this.closePromise = new Promise((resolve) => {
      const timeout = setTimeout(resolve, 500);
      timeout.unref();
      this.logger.once("finish", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.logger.end();
    });

    return this.closePromise;
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, meta?: LogMeta): void {
    if (this.closed) {
      return;
    }

    if (meta) {
      this.logger.log(level, message, meta);
    } else {
      this.logger.log(level, message);
    }
  }
}

class WinstonRequestLogger implements RequestLogger {
  readonly enabled = true;
  private closePromise: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly logger: winston.Logger,
    private readonly config: ResolvedRequestLoggingConfig,
  ) {}

  logToolCall(event: RequestLogEvent): void {
    if (this.closed) {
      return;
    }

    const meta: LogMeta = {
      toolName: event.toolName,
      durationMs: event.durationMs,
      outcome: event.outcome,
      ...(event.isError !== undefined ? { isError: event.isError } : {}),
      ...(event.error ? { error: event.error } : {}),
    };

    if (this.config.includeArguments) {
      meta.arguments = this.config.redactArguments ? redactRequestArguments(event.arguments) : event.arguments;
      meta.argumentRedaction = this.config.redactArguments ? "redacted" : "none";
    }

    this.logger.info("mcp tool call", meta);
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

function redactRequestArguments(value: unknown): unknown {
  return redactValue(value, undefined, 0);
}

const REDACTED_FIELD_NAMES = new Set(["authorization", "authtoken", "password", "secret", "token", "x-anchor-mcp-token"]);
const CONTENT_FIELD_NAMES = new Set(["content"]);
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;

function redactValue(value: unknown, key: string | undefined, depth: number): unknown {
  const normalizedKey = key?.toLowerCase();
  if (normalizedKey && REDACTED_FIELD_NAMES.has(normalizedKey)) {
    return redactedValue(value, "sensitive-field");
  }

  if (typeof value === "string") {
    if (normalizedKey && CONTENT_FIELD_NAMES.has(normalizedKey)) {
      return redactedString(value, "content-field");
    }
    if (value.length > MAX_STRING_LENGTH) {
      return redactedString(value, "long-string");
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return redactedValue(value, "max-depth");
    }
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, undefined, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, { redacted: true, reason: "array-truncated", omittedItems: value.length - MAX_ARRAY_ITEMS }]
      : items;
  }

  if (isPlainRecord(value)) {
    if (depth >= MAX_DEPTH) {
      return redactedValue(value, "max-depth");
    }
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey, depth + 1)]),
    );
  }

  return value;
}

function redactedString(value: string, reason: string): Record<string, unknown> {
  return {
    redacted: true,
    reason,
    length: value.length,
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

function redactedValue(value: unknown, reason: string): Record<string, unknown> {
  return {
    redacted: true,
    reason,
    type: Array.isArray(value) ? "array" : typeof value,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function closeWinstonLogger(logger: winston.Logger): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 500);
    timeout.unref();
    logger.once("finish", () => {
      clearTimeout(timeout);
      resolve();
    });
    logger.end();
  });
}
