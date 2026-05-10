import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AnchorService } from "./anchorService.js";
import { ANCHOR_CATEGORIES } from "./taxonomy.js";

const CategorySchema = z.enum(ANCHOR_CATEGORIES);
const ContextRootFormatSchema = z.enum(["json", "markdown", "both"]);
const AnchorContentModeSchema = z.enum(["full", "excerpt", "none"]);

export function createAnchorMcpServer(service: AnchorService): McpServer {
  const server = new McpServer(
    {
      name: "anchor-mcp",
      version: "0.1.0",
    },
    {
      instructions: `\
## Before any work in a chat
Before your first non-trivial tool call (code read, search, edit, or shell), call loadContext() — or contextRoot() if \
you only need the index without anchor bodies. Skip only for purely conversational replies.

loadContext returns the same discovery metadata as contextRoot (entries plus optional markdown) and loads multiple \
anchors in one response (excerpts by default). Filter by project/category/tag/runtime, pass explicit names, and paginate \
with nextCursor when truncated is true. If responses are too large, lower limit or maxBytes, set includeContent to \
excerpt or none, or continue with nextCursor.

Do not browse the filesystem for anchors; always use these MCP tools.

Use readAnchor(...) after loadContext when you need the full body of a specific anchor.

Why this matters: project decisions, conflicts, and PR-history context intentionally live in anchors rather than code. \
Working without this context is the most common cause of contradictory output.

In your first assistant message for tool-using chats, state which anchors you loaded (or "no anchors matched"). If \
you skipped loadContext/contextRoot, say so.

If you realize mid-task that you skipped loadContext, stop and call it before producing the next assistant message, \
then re-evaluate in-flight work against the loaded anchors.

This rule is not overridden by skill workflows. Skills assume loadContext (or contextRoot) has already been called.

### Example
User: "Review the current branch."
Assistant: loadContext({ includeContent: "excerpt" }) -> scan entries and excerpts -> readAnchor(...) only for deeper \
detail -> only then git diff and start review.

## When writing anchors
Writes may return BLOCK or WARN; do not ignore them. BLOCK rejects the write and must be fixed before retrying. WARN \
succeeds but flags a quality issue to address.`,
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
        category: CategorySchema.optional(),
        includeArchive: z.boolean().default(false),
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
    "loadContext",
    {
      title: "Load Context",
      description:
        "One-call context load: context-root style index (entries + optional markdown) plus multiple anchor bodies. " +
        "Supports filters, explicit names, excerpt/full/none content modes, byte and count limits, and nextCursor continuation.",
      inputSchema: z.object({
        project: z.string().optional(),
        category: CategorySchema.optional(),
        tag: z.string().optional(),
        runtime: z.string().optional(),
        includeArchive: z.boolean().default(false),
        names: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(500).optional(),
        maxBytes: z.number().int().positive().optional(),
        includeContent: AnchorContentModeSchema.optional(),
        excerptChars: z.number().int().positive().optional(),
        cursor: z.string().optional(),
        format: ContextRootFormatSchema.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.loadContext(input)),
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
    "contextRoot",
    {
      title: "Context Root",
      description: "Build a dynamic context root from anchor front matter.",
      inputSchema: z.object({
        project: z.string().optional(),
        category: CategorySchema.optional(),
        tag: z.string().optional(),
        runtime: z.string().optional(),
        includeArchive: z.boolean().default(false),
        format: ContextRootFormatSchema.default("both"),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.contextRoot(input)),
  );

  server.registerTool(
    "writeContextRoot",
    {
      title: "Write Context Root",
      description: "Generate and commit CONTEXT-ROOT.md from anchor front matter.",
      inputSchema: z.object({
        project: z.string().optional(),
        category: CategorySchema.optional(),
        tag: z.string().optional(),
        runtime: z.string().optional(),
        includeArchive: z.boolean().default(false),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => jsonResult(await service.writeContextRoot(input)),
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
