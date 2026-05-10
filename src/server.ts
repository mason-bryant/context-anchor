import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AnchorService } from "./anchorService.js";

export function createAnchorMcpServer(service: AnchorService): McpServer {
  const server = new McpServer(
    {
      name: "anchor-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Use anchor-mcp to read and update git-backed context anchors. Writes may return BLOCK or WARN validation results; do not ignore them.",
    },
  );

  server.registerTool(
    "listAnchors",
    {
      title: "List Anchors",
      description: "List context anchor markdown files and front matter metadata.",
      inputSchema: z.object({
        project: z.string().optional(),
        tag: z.string().optional(),
        since: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult({ anchors: await service.listAnchors(input) }),
  );

  server.registerTool(
    "readAnchor",
    {
      title: "Read Anchor",
      description: "Read one context anchor, optionally at a git version.",
      inputSchema: z.object({
        name: z.string(),
        version: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name, version }) => jsonResult(await service.readAnchor(name, version)),
  );

  server.registerTool(
    "readAnchorBatch",
    {
      title: "Read Anchor Batch",
      description: "Read multiple latest context anchors in one call.",
      inputSchema: z.object({
        names: z.array(z.string()).min(1),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ names }) => jsonResult({ anchors: await service.readAnchorBatch(names) }),
  );

  server.registerTool(
    "searchAnchors",
    {
      title: "Search Anchors",
      description: "Search context anchor contents for a case-insensitive text query.",
      inputSchema: z.object({
        query: z.string().min(1),
        scope: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, scope }) => jsonResult({ hits: await service.searchAnchors(query, scope) }),
  );

  server.registerTool(
    "writeAnchor",
    {
      title: "Write Anchor",
      description: "Validate, write, commit, and optionally push one context anchor.",
      inputSchema: z.object({
        name: z.string(),
        content: z.string(),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, content, message, approved, coAuthor }) => {
      const result = await service.writeAnchor({ name, content, message, approved, coAuthor });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "listVersions",
    {
      title: "List Anchor Versions",
      description: "List git commits that touched a context anchor.",
      inputSchema: z.object({
        name: z.string(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name, limit }) => jsonResult({ versions: await service.listVersions(name, limit) }),
  );

  server.registerTool(
    "diffAnchor",
    {
      title: "Diff Anchor",
      description: "Return a git patch for one anchor between two versions.",
      inputSchema: z.object({
        name: z.string(),
        fromVersion: z.string(),
        toVersion: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name, fromVersion, toVersion }) =>
      jsonResult({ patch: await service.diffAnchor(name, fromVersion, toVersion) }),
  );

  server.registerTool(
    "revertAnchor",
    {
      title: "Revert Anchor",
      description: "Restore an anchor to an older git version as a new commit.",
      inputSchema: z.object({
        name: z.string(),
        toVersion: z.string(),
        message: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, toVersion, message }) => jsonResult(await service.revertAnchor(name, toVersion, message)),
  );

  server.registerTool(
    "compactionReport",
    {
      title: "Compaction Report",
      description: "Report context anchors or roadmaps that are drifting past health thresholds.",
      inputSchema: z.object({
        scope: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ scope }) => jsonResult(await service.compactionReport(scope)),
  );

  server.registerTool(
    "conflictStatus",
    {
      title: "Conflict Status",
      description: "Return whether the backing git repository is clean or conflicted.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await service.conflictStatus()),
  );

  return server;
}

function jsonResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: isRecord(value) ? value : { value },
    isError,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

