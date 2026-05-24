import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createAppLogger } from "../src/logger.js";

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

    const files = await readdir(tmpDir);
    expect(files.some((file) => file.startsWith("anchor-mcp-") && file.endsWith(".log"))).toBe(true);
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

    const files = await readdir(tmpDir);
    const logFile = files.find((file) => file.startsWith("anchor-mcp-") && file.endsWith(".log"));
    expect(logFile).toBeDefined();

    const content = await readFile(path.join(tmpDir, logFile!), "utf8");
    expect(content).toContain('"message":"test log message"');
    expect(content).toContain('"source":"logger.test"');
  });
});
