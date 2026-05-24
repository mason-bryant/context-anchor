import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import type { AnchorService } from "../src/anchorService.js";
import type { RequestLogEvent, RequestLogger } from "../src/logger.js";
import { createAnchorMcpServer } from "../src/server.js";

type RegisteredToolForTest = {
  handler(input: unknown, context: unknown): Promise<CallToolResult>;
};

function requestLoggerForTest(): { logger: RequestLogger; events: RequestLogEvent[] } {
  const events: RequestLogEvent[] = [];
  return {
    events,
    logger: {
      enabled: true,
      logToolCall: (event) => events.push(event),
      async close() {},
    },
  };
}

function toolForTest(server: unknown, name: string): RegisteredToolForTest {
  return (server as { _registeredTools: Record<string, RegisteredToolForTest> })._registeredTools[name]!;
}

describe("MCP request logging", () => {
  it("logs tool name, arguments, duration, and outcome for successful tool calls", async () => {
    const service = {
      readAnchor: vi.fn(async () => ({
        name: "shared/example.md",
        path: "shared/example.md",
        content: "# Example\n",
        frontmatter: {},
      })),
    } as unknown as AnchorService;
    const { logger, events } = requestLoggerForTest();
    const server = createAnchorMcpServer(service, { requestLogger: logger });

    await toolForTest(server, "readAnchor").handler({ name: "shared/example.md" }, {});

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      toolName: "readAnchor",
      arguments: { name: "shared/example.md" },
      outcome: "success",
      isError: false,
    });
    expect(events[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs exceptions from tool handlers before rethrowing", async () => {
    const service = {
      readAnchor: vi.fn(async () => {
        throw new Error("read failed");
      }),
    } as unknown as AnchorService;
    const { logger, events } = requestLoggerForTest();
    const server = createAnchorMcpServer(service, { requestLogger: logger });

    await expect(toolForTest(server, "readAnchor").handler({ name: "shared/example.md" }, {})).rejects.toThrow(
      "read failed",
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      toolName: "readAnchor",
      arguments: { name: "shared/example.md" },
      outcome: "exception",
      error: {
        name: "Error",
        message: "read failed",
      },
    });
  });
});
