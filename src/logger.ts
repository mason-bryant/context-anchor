import path from "node:path";

import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

import type { FileLoggingConfig, LoggingConfig } from "./types.js";
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

type ResolvedFileLoggingConfig = Required<FileLoggingConfig>;

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

export const noopLogger: AppLogger = {
  enabled: false,
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

export function createAppLogger(config: LoggingConfig | undefined): AppLogger {
  const fileConfig = resolveFileLoggingConfig(config?.file);
  if (!fileConfig) {
    return noopLogger;
  }

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
    defaultMeta: { service: "anchor-mcp" },
    exitOnError: false,
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    transports: [transport],
  });

  return new WinstonAppLogger(logger);
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

function resolveFileLoggingConfig(config: FileLoggingConfig | undefined): ResolvedFileLoggingConfig | undefined {
  if (!config?.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    dirname: config.dirname ?? DEFAULT_FILE_LOGGING.dirname,
    filename: config.filename ?? DEFAULT_FILE_LOGGING.filename,
    level: config.level ?? DEFAULT_FILE_LOGGING.level,
    datePattern: config.datePattern ?? DEFAULT_FILE_LOGGING.datePattern,
    maxSize: config.maxSize ?? DEFAULT_FILE_LOGGING.maxSize,
    maxFiles: config.maxFiles ?? DEFAULT_FILE_LOGGING.maxFiles,
    zippedArchive: config.zippedArchive ?? DEFAULT_FILE_LOGGING.zippedArchive,
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
