import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createAppLogger, createRequestLogger } from "../src/logger.js";

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

describe("file logger", () => {
  it("uses conservative defaults for omitted file logging options", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-logs-"));
    const logger = createAppLogger({
      file: {
        enabled: true,
        dirname: tmpDir,
      },
    });

    logger.info("defaulted log message");
    await logger.close();

    await expect(findLogFile(tmpDir, "anchor-mcp-")).resolves.toBeDefined();
  });

  it("writes JSON log events through the rotating file transport", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-logs-"));
    const logger = createAppLogger({
      file: {
        enabled: true,
        dirname: tmpDir,
        filename: "anchor-mcp-%DATE%.log",
        level: "info",
        datePattern: "YYYY-MM-DD-HH-mm",
        maxSize: "1m",
        maxFiles: "1d",
        zippedArchive: false,
      },
    });

    logger.info("test log message", { source: "logger.test" });
    await logger.close();

    const logFile = await findLogFile(tmpDir, "anchor-mcp-");
    expect(logFile).toBeDefined();

    const content = await readFile(path.join(tmpDir, logFile!), "utf8");
    expect(content).toContain('"message":"test log message"');
    expect(content).toContain('"source":"logger.test"');
  });

  it("writes MCP request events to a separate request log with redacted arguments by default", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-mcp-logs-"));
    const requestLogger = createRequestLogger({
      requests: {
        enabled: true,
        dirname: tmpDir,
        filename: "anchor-mcp-requests-%DATE%.log",
        level: "info",
        datePattern: "YYYY-MM-DD-HH-mm",
        maxSize: "1m",
        maxFiles: "1d",
        zippedArchive: false,
      },
    });

    requestLogger.logToolCall({
      toolName: "writeAnchor",
      arguments: {
        name: "shared/example.md",
        content: "private anchor body",
        authToken: "secret-token",
      },
      durationMs: 7,
      outcome: "success",
      isError: false,
    });
    await requestLogger.close();

    const requestLogFile = await findLogFile(tmpDir, "anchor-mcp-requests-");
    expect(requestLogFile).toBeDefined();

    const content = await readFile(path.join(tmpDir, requestLogFile!), "utf8");
    expect(content).toContain('"message":"mcp tool call"');
    expect(content).toContain('"toolName":"writeAnchor"');
    expect(content).toContain('"name":"shared/example.md"');
    expect(content).toContain('"argumentRedaction":"redacted"');
    expect(content).toContain('"reason":"content-field"');
    expect(content).toContain('"reason":"sensitive-field"');
    expect(content).not.toContain("private anchor body");
    expect(content).not.toContain("secret-token");
  });
});
