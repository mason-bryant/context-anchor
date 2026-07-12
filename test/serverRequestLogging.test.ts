import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import type { AnchorService } from "../src/anchorService.js";
import type { RequestLogEvent, RequestLogger } from "../src/logger.js";
import { createAnchorMcpServer } from "../src/server.js";

type RegisteredToolForTest = {
  inputSchema?: {
    parse(input: unknown): unknown;
  };
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

function parseToolInput(tool: RegisteredToolForTest, input: unknown): unknown {
  return tool.inputSchema?.parse(input) ?? input;
}

describe("MCP request logging", () => {
  it("routes on-demand H2 section reads", async () => {
    const service = {
      readAnchorSection: vi.fn(async () => ({
        name: "projects/demo/demo.md",
        path: "projects/demo/demo.md",
        heading: "Current State",
        content: "## Current State\n\n- Demo exists.",
        availableSections: ["Current State", "Decisions"],
      })),
    } as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "readAnchorSection");

    await tool.handler(
      parseToolInput(tool, { name: "projects/demo/demo.md", heading: "Current State" }),
      {},
    );

    expect((service as unknown as { readAnchorSection: ReturnType<typeof vi.fn> }).readAnchorSection)
      .toHaveBeenCalledWith("projects/demo/demo.md", "Current State", undefined);
  });

  it("normalizes section headings and rejects blank headings at the tool boundary", async () => {
    const service = {
      readAnchorSection: vi.fn(async () => ({
        name: "projects/demo/demo.md",
        path: "projects/demo/demo.md",
        heading: "Current State",
        content: "## Current State\n\n- Demo exists.",
        availableSections: ["Current State"],
      })),
    } as unknown as AnchorService;
    const tool = toolForTest(createAnchorMcpServer(service), "readAnchorSection");

    await tool.handler(
      parseToolInput(tool, { name: "projects/demo/demo.md", heading: "  Current State  " }),
      {},
    );

    expect((service as unknown as { readAnchorSection: ReturnType<typeof vi.fn> }).readAnchorSection)
      .toHaveBeenCalledWith("projects/demo/demo.md", "Current State", undefined);
    expect(() => parseToolInput(tool, { name: "projects/demo/demo.md", heading: "   " })).toThrow();
  });

  it("normalizes JSON-stringified proposeChange nested parameters", async () => {
    const service = {
      proposeChange: vi.fn(async () => ({
        proposal: {
          id: "PC-20260525-test",
          scope: { kind: "project", project: "demo" },
          status: "pending",
          summary: "Test",
          target: "projects/demo/demo.md",
          createdAt: "2026-05-25T00:00:00.000Z",
          updatedAt: "2026-05-25T00:00:00.000Z",
          operations: [],
          ledgerName: "projects/demo/demo-proposed-changes.md",
          ledgerPath: "projects/demo/demo-proposed-changes.md",
        },
        warnings: [],
        version: "a".repeat(40),
      })),
    } as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "proposeChange");

    const result = await tool.handler(
      parseToolInput(tool, {
        scope: JSON.stringify({ kind: "project", project: "demo" }),
        target: "projects/demo/demo.md",
        summary: "Test",
        operations: JSON.stringify([
          {
            type: "frontmatter.merge",
            updates: JSON.stringify({ summary: "Updated summary." }),
          },
        ]),
      }),
      {},
    );

    expect((service as unknown as { proposeChange: ReturnType<typeof vi.fn> }).proposeChange).toHaveBeenCalledWith({
      scope: { kind: "project", project: "demo" },
      target: "projects/demo/demo.md",
      summary: "Test",
      operations: [
        {
          type: "frontmatter.merge",
          updates: { summary: "Updated summary." },
        },
      ],
    });
    expect(result.isError).toBe(false);
  });

  it("normalizes JSON-stringified array parameters for context tools", async () => {
    const service = {
      readAnchorBatch: vi.fn(async () => []),
      loadContext: vi.fn(async () => ({ anchors: [] })),
    } as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const batchTool = toolForTest(server, "readAnchorBatch");
    const loadTool = toolForTest(server, "loadContext");

    await batchTool.handler(parseToolInput(batchTool, { names: JSON.stringify(["shared/a.md", "shared/b.md"]) }), {});
    await loadTool.handler(parseToolInput(loadTool, { names: JSON.stringify(["shared/a.md"]) }), {});

    expect((service as unknown as { readAnchorBatch: ReturnType<typeof vi.fn> }).readAnchorBatch).toHaveBeenCalledWith([
      "shared/a.md",
      "shared/b.md",
    ]);
    expect((service as unknown as { loadContext: ReturnType<typeof vi.fn> }).loadContext).toHaveBeenCalledWith(
      expect.objectContaining({ names: ["shared/a.md"] }),
    );
  });

  it("normalizes JSON-stringified front matter updates", async () => {
    const service = {
      updateAnchorFrontmatter: vi.fn(async () => ({
        version: "a".repeat(40),
        warnings: [],
      })),
    } as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "updateAnchorFrontmatter");

    await tool.handler(
      parseToolInput(tool, {
        name: "projects/demo/demo.md",
        updates: JSON.stringify({
          summary: "Updated summary.",
          relations: { goal_ids: ["G-001"] },
        }),
      }),
      {},
    );

    expect(
      (service as unknown as { updateAnchorFrontmatter: ReturnType<typeof vi.fn> }).updateAnchorFrontmatter,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "projects/demo/demo.md",
        updates: {
          summary: "Updated summary.",
          relations: { goal_ids: ["G-001"] },
        },
      }),
    );
  });

  it("routes updateProjectPriority tool calls", async () => {
    const service = {
      updateProjectPriority: vi.fn(async () => ({
        version: "a".repeat(40),
        warnings: [],
      })),
    } as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const tool = toolForTest(server, "updateProjectPriority");

    await tool.handler(
      parseToolInput(tool, {
        project: "demo",
        name: "projects/demo/demo.md",
        priority: 2.045,
        approved: true,
        expectedFileCommit: "abc123",
      }),
      {},
    );

    expect((service as unknown as { updateProjectPriority: ReturnType<typeof vi.fn> }).updateProjectPriority)
      .toHaveBeenCalledWith({
        project: "demo",
        name: "projects/demo/demo.md",
        priority: 2.045,
        message: undefined,
        approved: true,
        coAuthor: undefined,
        expectedFileCommit: "abc123",
      });
  });

  it("normalizes JSON-stringified project update status arrays", async () => {
    const service = {
      projectUpdateSnapshot: vi.fn(async () => ({ milestones: [] })),
      renderProjectUpdate: vi.fn(async () => ({ body: "" })),
    } as unknown as AnchorService;
    const server = createAnchorMcpServer(service);
    const snapshotTool = toolForTest(server, "projectUpdateSnapshot");
    const renderTool = toolForTest(server, "renderProjectUpdate");

    await snapshotTool.handler(
      parseToolInput(snapshotTool, { project: "demo", statuses: JSON.stringify(["active", "proposed"]) }),
      {},
    );
    await renderTool.handler(
      parseToolInput(renderTool, { project: "demo", format: "markdown", statuses: JSON.stringify(["shipped"]) }),
      {},
    );

    expect((service as unknown as { projectUpdateSnapshot: ReturnType<typeof vi.fn> }).projectUpdateSnapshot)
      .toHaveBeenCalledWith(expect.objectContaining({ statuses: ["active", "proposed"] }));
    expect((service as unknown as { renderProjectUpdate: ReturnType<typeof vi.fn> }).renderProjectUpdate)
      .toHaveBeenCalledWith(expect.objectContaining({ statuses: ["shipped"] }));
  });

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
