import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AnchorService } from "./anchorService.js";
import { errorMetadata, noopRequestLogger, type RequestLogger } from "./logger.js";
import { isDiscoveryCategory, type DiscoveryCategory } from "./taxonomy.js";
import type {
  LoadContextInput,
  ProjectUpdateSnapshotInput,
  ProposeChangeInput,
  ProposedChangeOperation,
  RenderProjectUpdateInput,
} from "./types.js";

const CategorySchema = z
  .string()
  .refine((value): value is DiscoveryCategory => isDiscoveryCategory(value), { message: "Invalid anchor category" });
const ContextRootFormatSchema = z.enum(["json", "markdown", "both"]);
const AnchorContentModeSchema = z.enum(["full", "excerpt", "none"]);
const ProjectUpdateStatusSchema = z.enum(["proposed", "active", "shipped", "cancelled"]);
const ProjectUpdateFormatSchema = z.enum(["markdown", "slack", "email"]);
const ProposedChangeStatusSchema = z.enum(["pending", "applied", "rejected", "changes_requested", "superseded"]);
const JsonStringSchema = z.string();
const JsonRecordSchema = z.union([z.record(z.string(), z.unknown()), JsonStringSchema]);
const StringArraySchema = z.union([z.array(z.string()), JsonStringSchema]);
const NonEmptyStringArraySchema = z.union([z.array(z.string()).min(1), JsonStringSchema]);
const ProposedChangeScopeObjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    project: z.string().min(1),
  }),
  z.object({
    kind: z.literal("agent-rules"),
  }),
]);
const ProposedChangeScopeSchema = z.union([ProposedChangeScopeObjectSchema, JsonStringSchema]);
const ProposedChangeOperationObjectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("frontmatter.merge"),
    updates: JsonRecordSchema,
  }),
  z.object({
    type: z.literal("section.replace"),
    heading: z.string().min(1),
    content: z.string(),
    lastValidated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("section.append"),
    heading: z.string().min(1),
    content: z.string(),
    lastValidated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("section.delete"),
    heading: z.string().min(1),
    lastValidated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("anchor.create"),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal("document.replace"),
    content: z.string().min(1),
  }),
]);
const ProposedChangeOperationSchema = z.union([ProposedChangeOperationObjectSchema, JsonStringSchema]);
const ProposedChangeOperationsSchema = z.union([z.array(ProposedChangeOperationSchema).min(1), JsonStringSchema]);
const ProposedChangeOperationNormalizedSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("frontmatter.merge"),
    updates: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("section.replace"),
    heading: z.string().min(1),
    content: z.string(),
    lastValidated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("section.append"),
    heading: z.string().min(1),
    content: z.string(),
    lastValidated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("section.delete"),
    heading: z.string().min(1),
    lastValidated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    type: z.literal("anchor.create"),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal("document.replace"),
    content: z.string().min(1),
  }),
]);
const ProposeChangeInputSchema = z.object({
  scope: ProposedChangeScopeSchema,
  target: z.string().min(1),
  summary: z.string().min(1).max(240),
  operations: ProposedChangeOperationsSchema,
  rationale: z.string().optional(),
  createdBy: z.string().optional(),
  message: z.string().optional(),
});
const ProjectUpdateStatusesSchema = z.union([z.array(ProjectUpdateStatusSchema), JsonStringSchema]);
const LoadContextInputSchema = z.object({
  project: z.string().optional(),
  category: CategorySchema.optional(),
  tag: z.string().optional(),
  runtime: z.string().optional(),
  includeArchive: z.boolean().default(false),
  names: StringArraySchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
  maxBytes: z.number().int().positive().optional(),
  includeContent: AnchorContentModeSchema.optional(),
  excerptChars: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  format: ContextRootFormatSchema.optional(),
});
const ProjectUpdateSnapshotInputSchema = z.object({
  project: z.string().min(1),
  milestone: z.string().optional(),
  statuses: ProjectUpdateStatusesSchema.optional(),
  includeBacklog: z.boolean().default(false),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const RenderProjectUpdateInputSchema = ProjectUpdateSnapshotInputSchema.extend({
  format: ProjectUpdateFormatSchema,
});

const SharedWriteOptsSchema = z.object({
  message: z.string().optional(),
  approved: z.boolean().default(false),
  coAuthor: z.string().optional(),
  expectedFileCommit: z.string().optional(),
});

export function createAnchorMcpServer(
  service: AnchorService,
  options: { requestLogger?: RequestLogger } = {},
): McpServer {
  const server = new McpServer(
    {
      name: "anchor-mcp",
      version: "0.2.0",
    },
    {
      instructions: `\
## Before any work in a chat
Before your first non-trivial tool call (code read, search, edit, or shell), call planContextBundle() when you need a \
task-aware, budgeted anchor selection; otherwise call loadContext() — or contextRoot() if you only need the index without \
anchor bodies. Skip only for purely conversational replies.

loadContext returns the same discovery metadata as contextRoot (entries plus optional markdown) and loads multiple \
anchors in one response (excerpts by default). Filter by project/category/tag/runtime, pass explicit names, and paginate \
with nextCursor when truncated is true. If responses are too large, lower limit or maxBytes, set includeContent to \
excerpt or none, or continue with nextCursor.

planContextBundle scores anchors against a task and token budget, explains included and excluded anchors, and returns a \
suggested loadContext call using the selected names.

Do not browse the filesystem for anchors; always use these MCP tools.

Use readAnchor(...) after loadContext when you need the full body of a specific anchor.

Why this matters: project decisions, conflicts, and PR-history context intentionally live in anchors rather than code. \
Working without this context is the most common cause of contradictory output.

In your first assistant message for tool-using chats, state which anchors you loaded (or "no anchors matched"). If \
you skipped planContextBundle/loadContext/contextRoot, say so.

If you realize mid-task that you skipped loadContext or planContextBundle, stop and call one before producing the next assistant message, \
then re-evaluate in-flight work against the loaded anchors.

This rule is not overridden by skill workflows. Skills assume planContextBundle, loadContext, or contextRoot has already been called.

### Example
User: "Review the current branch."
Assistant: planContextBundle({ task: "Review the current branch" }) -> loadContext(...) with the suggested names -> \
readAnchor(...) only for deeper detail -> only then git diff and start review.

## When writing anchors
Do not edit anchor markdown in the server's \`--repo\` tree directly on disk (editor, patch tools, or shell). That \
bypasses validators and the server's git commits, so MCP reads and the working tree can disagree. Use the MCP write \
tools (writeAnchor, deleteAnchor, renameAnchor, and the partial-write tools) for every anchor change.

Writes may return BLOCK or WARN; do not ignore them. BLOCK rejects the write and must be fixed before retrying. WARN \
succeeds but flags a quality issue to address.

For small edits (one front-matter field, append a PR line, replace one section body), prefer updateAnchorFrontmatter, \
updateAnchorSection, appendToAnchorSection, or deleteAnchorSection so you do not round-trip entire large anchor bodies. \
They run the same validators and commits as writeAnchor. Pass expectedFileCommit from readAnchor.fileCommit when you need \
optimistic concurrency across sessions.

Use full writeAnchor when restructuring an entire anchor or when bulk-replacing the file is simpler.

\`deleteAnchor\` and \`renameAnchor\` remove or move entire anchor files as git commits; they always require \
\`approved: true\` after explicit user confirmation, independent of validator-driven approval on ordinary writes.

When autonomous or headless work should be reviewed later, use \`proposeChange\` instead of mutating the target anchor. \
Project proposals live in \`projects/<slug>/<slug>-proposed-changes.md\`; agent-rule proposals live in \
\`agent-rules/agent-rules-proposed-changes.md\`. Use \`previewProposedChange\` to inspect the exact diff and validation \
result, \`reviewProposedChange\` to record feedback, and \`applyProposedChange\` only after explicit human approval. \
Pending proposal ledgers are review artifacts, not durable truth for ordinary context loading.

## When you discover new facts
If work reveals durable truth (what shipped, decisions, limits), persist it with writeAnchor or the chunked write tools \
on the relevant anchor — not only in chat. Section mapping: observable reality → ## Current State; settled choices → \
## Decisions; hard limits → ## Constraints; pull requests → ## PRs (use the enforced PR link text shape).

Set last_validated (YYYY-MM-DD) to today's date whenever you materially edit Current State, Decisions, or Constraints; \
same-day substantive edits may reuse today's date.

Edits to Decisions or Constraints, or deleting existing bullets, need explicit human approval: retry the same write tool \
with approved: true after the user confirms.

## Before wrap-up (ask the human)
When work looks ready to commit, merge, ship, or otherwise complete, use judgment and **prompt the user** whether to \
update context anchors, milestones, roadmaps, or related docs with lessons from the session. Do not assume they noticed \
every durable insight that belongs in persisted context.

**Especially** offer that prompt when the chat produced lessons that could change future behavior, constraints, or \
decisions, or when the user gave **non-trivial redirection** (scope changes, reversals, new requirements, or \
corrections that would matter to the next person or agent). Skip the nudge for purely trivial or mechanical work unless \
they explicitly asked for context hygiene.

## Roadmaps and maintenance
Forward-looking work usually belongs in a companion roadmap anchor (same project slug) if your tree uses one: goals, \
requirements, acceptance criteria, and completed history — not a duplicate of Current State.

If writeAnchor warns about roadmap length or ## Completed table size, plan compaction (compactionReport helps review \
structure) rather than letting token-heavy roadmaps grow unbounded.

After large front-matter or taxonomy sweeps, writeContextRoot() keeps an on-disk CONTEXT-ROOT.md snapshot aligned with \
the index when your workflow checks in that file.`,
    },
  );
  attachRequestLogging(server, options.requestLogger ?? noopRequestLogger);

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
    async (input) => {
      const { anchors, projectFilter } = await service.listAnchorsDiscovery(input);
      return jsonResult({
        anchors,
        ...(projectFilter ? { projectFilter } : {}),
      });
    },
  );

  server.registerTool(
    "readAnchor",
    {
      title: "Read Anchor",
      description: "Read one context anchor, optionally at a git version. Latest reads include `fileCommit` (last git commit touching the file) for optional `expectedFileCommit` on writes.",
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
        names: NonEmptyStringArraySchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ names }) => jsonResult({ anchors: await service.readAnchorBatch(normalizeStringArray(names, "names", 1)) }),
  );

  server.registerTool(
    "loadContext",
    {
      title: "Load Context",
      description:
        "One-call context load: context-root style index (entries + optional markdown) plus multiple anchor bodies. " +
        "Supports filters, explicit names, excerpt/full/none content modes, byte and count limits, and nextCursor continuation.",
      inputSchema: LoadContextInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.loadContext(normalizeLoadContextInput(input))),
  );

  server.registerTool(
    "planContextBundle",
    {
      title: "Plan Context Bundle",
      description:
        "Plan a task-aware context bundle. Returns included anchors, excluded anchors, reasons, estimated token use, missing-context signals, and a suggested loadContext call.",
      inputSchema: z.object({
        task: z.string().min(1),
        project: z.string().optional(),
        category: CategorySchema.optional(),
        tag: z.string().optional(),
        runtime: z.string().optional(),
        includeArchive: z.boolean().default(false),
        budgetTokens: z.number().int().positive().max(200000).optional(),
        maxAnchors: z.number().int().positive().max(500).optional(),
        maxExcluded: z.number().int().min(0).max(500).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.planContextBundle(input)),
  );

  server.registerTool(
    "listMilestones",
    {
      title: "List Milestones",
      description:
        "List `type: project-milestone` anchors under `projects/<slug>/milestones/` with status, theme, referenced goal ids, optional `milestoneId` / `sequence`, derived `displayId` (`M<sequence>` or `backlog`), sorted by sequence (backlog and unsequenced last).",
      inputSchema: z.object({
        project: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult({ milestones: await service.listMilestones(input.project) }),
  );

  server.registerTool(
    "readMilestone",
    {
      title: "Read Milestone",
      description:
        "Read one milestone anchor plus resolved roadmap goals referenced by `relations.goal_ids` (from the sibling `<slug>-roadmap.md`).",
      inputSchema: z.object({
        name: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => jsonResult(await service.readMilestone(name)),
  );

  server.registerTool(
    "projectUpdateSnapshot",
    {
      title: "Project Update Snapshot",
      description:
        "Build a deterministic read-only project update snapshot from project context, roadmap goals, ordered milestones, structured milestone tasks, dates, and backlog items. Backlog items are returned separately and should render last.",
      inputSchema: ProjectUpdateSnapshotInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.projectUpdateSnapshot(normalizeProjectUpdateSnapshotInput(input))),
  );

  server.registerTool(
    "renderProjectUpdate",
    {
      title: "Render Project Update",
      description:
        "Render a deterministic project update document in markdown, Slack, or email format from the project update snapshot. The output is generated text only and does not write anchors.",
      inputSchema: RenderProjectUpdateInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.renderProjectUpdate(normalizeRenderProjectUpdateInput(input))),
  );

  server.registerTool(
    "getRelated",
    {
      title: "Get Related Anchors",
      description:
        "Follow `relations` front matter on an anchor. For `project-milestone` anchors, `goal_ids` resolves to the sibling project roadmap anchor.",
      inputSchema: z.object({
        name: z.string(),
        kind: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name, kind }) => jsonResult({ anchors: await service.getRelated(name, kind) }),
  );

  server.registerTool(
    "proposeChange",
    {
      title: "Propose Change",
      description:
        "Create a reviewable proposed change in the project or agent-rule proposal ledger without mutating the target anchor.",
      inputSchema: ProposeChangeInputSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const result = await service.proposeChange(normalizeProposeChangeInput(input));
      return jsonResult(result, result.version ? false : hasBlockingWarnings(result.warnings));
    },
  );

  server.registerTool(
    "listProposedChanges",
    {
      title: "List Proposed Changes",
      description:
        "List reviewable proposed changes from project proposal ledgers or the agent-rule proposal ledger.",
      inputSchema: z.object({
        project: z.string().optional(),
        scope: z.enum(["agent-rules"]).optional(),
        status: ProposedChangeStatusSchema.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.listProposedChanges(input)),
  );

  server.registerTool(
    "readProposedChange",
    {
      title: "Read Proposed Change",
      description: "Read one proposed change record by id, including its ledger metadata and operations.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => jsonResult(await service.readProposedChange(id)),
  );

  server.registerTool(
    "previewProposedChange",
    {
      title: "Preview Proposed Change",
      description:
        "Apply a proposed change to an in-memory draft, run validators, and return diff/stale-base/approval signals without writing.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => jsonResult(await service.previewProposedChange(id)),
  );

  server.registerTool(
    "reviewProposedChange",
    {
      title: "Review Proposed Change",
      description: "Record review feedback or status on a proposed change without mutating the target anchor.",
      inputSchema: z.object({
        id: z.string().min(1),
        status: z.enum(["pending", "rejected", "changes_requested", "superseded"]),
        note: z.string().optional(),
        reviewedBy: z.string().optional(),
        message: z.string().optional(),
        expectedLedgerFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const result = await service.reviewProposedChange(input);
      return jsonResult(result, result.version ? false : hasBlockingWarnings(result.warnings));
    },
  );

  server.registerTool(
    "applyProposedChange",
    {
      title: "Apply Proposed Change",
      description:
        "Apply an approved proposed change to its target anchor, re-running normal validators and marking the proposal applied.",
      inputSchema: z.object({
        id: z.string().min(1),
        approved: z.boolean().default(false),
        appliedBy: z.string().optional(),
        message: z.string().optional(),
        coAuthor: z.string().optional(),
        expectedLedgerFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const result = await service.applyProposedChange(input);
      return jsonResult(result, result.targetVersion ? false : hasBlockingWarnings(result.warnings));
    },
  );

  server.registerTool(
    "migrateRoadmapGoalIds",
    {
      title: "Migrate Roadmap Goal IDs",
      description:
        "Assign stable, conventionally three-digit `G-###` ids to any roadmap goal headings that are still in bare `### Goal N -- Title` form. " +
        "Required before writing a milestone that references those goals by id. " +
        "Reads `projects/<project>/<project>-roadmap.md`, renames bare headings in document order, and commits the result. " +
        "Returns the list of renamed headings and a `noChangesNeeded` flag when all goals already have stable ids.",
      inputSchema: z.object({
        project: z.string().min(1),
        startFrom: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Override the starting number for newly assigned ids. Defaults to max existing G-<digits> + 1 (or 1 if none exist).",
          ),
        message: z.string().optional(),
        approved: z
          .boolean()
          .optional()
          .describe("Pass true if the write triggers an approval gate (rare for heading-only changes)."),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) => jsonResult(await service.migrateRoadmapGoalIds(input)),
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
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, content, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.writeAnchor({ name, content, message, approved, coAuthor, expectedFileCommit });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "deleteAnchor",
    {
      title: "Delete Anchor",
      description:
        "Remove an anchor markdown file from the working tree and record a git commit. Always requires approved: true after explicit user confirmation. Supports expectedFileCommit like writeAnchor.",
      inputSchema: z.object({ name: z.string() }).extend(SharedWriteOptsSchema.shape),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ name, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.deleteAnchor({ name, message, approved, coAuthor, expectedFileCommit });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "renameAnchor",
    {
      title: "Rename Anchor",
      description:
        "Move an anchor to a new taxonomy-valid path using git mv. Always requires approved: true after explicit user confirmation. expectedFileCommit applies to the source anchor.",
      inputSchema: z
        .object({
          from: z.string(),
          to: z.string(),
        })
        .extend(SharedWriteOptsSchema.shape),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ from, to, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.renameAnchor({ from, to, message, approved, coAuthor, expectedFileCommit });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "updateAnchorFrontmatter",
    {
      title: "Update Anchor Front Matter",
      description:
        "Merge keys into YAML front matter without resending the anchor body. Use null in updates to remove a key. Same validation and commit rules as writeAnchor.",
      inputSchema: z
        .object({
          name: z.string(),
          updates: JsonRecordSchema,
        })
        .extend(SharedWriteOptsSchema.shape),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, updates, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateAnchorFrontmatter({
        name,
        updates: normalizeJsonRecord(updates, "updates"),
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "updateAnchorSection",
    {
      title: "Update Anchor Section",
      description:
        "Replace the body of one ## H2 section (heading may be passed as \"## PRs\" or \"PRs\"). Content must not include the heading line. Pass lastValidated (YYYY-MM-DD) to refresh a stale validation date atomically in the same commit when editing a substantive section.",
      inputSchema: z
        .object({
          name: z.string(),
          heading: z.string(),
          content: z.string(),
          lastValidated: z.string().optional(),
        })
        .extend(SharedWriteOptsSchema.shape),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, heading, content, lastValidated, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateAnchorSection({
        name,
        heading,
        content,
        lastValidated,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "appendToAnchorSection",
    {
      title: "Append To Anchor Section",
      description:
        "Append markdown to the end of one ## H2 section body. Pass lastValidated (YYYY-MM-DD) to refresh a stale validation date atomically in the same commit when editing a substantive section.",
      inputSchema: z
        .object({
          name: z.string(),
          heading: z.string(),
          content: z.string(),
          lastValidated: z.string().optional(),
        })
        .extend(SharedWriteOptsSchema.shape),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, heading, content, lastValidated, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.appendToAnchorSection({
        name,
        heading,
        content,
        lastValidated,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "deleteAnchorSection",
    {
      title: "Delete Anchor Section",
      description:
        "Remove an entire ## H2 section including its heading. Deleting required sections will fail validation. Pass lastValidated (YYYY-MM-DD) to refresh a stale validation date atomically in the same commit when removing a substantive section.",
      inputSchema: z
        .object({
          name: z.string(),
          heading: z.string(),
          lastValidated: z.string().optional(),
        })
        .extend(SharedWriteOptsSchema.shape),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, heading, lastValidated, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.deleteAnchorSection({
        name,
        heading,
        lastValidated,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
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

function hasBlockingWarnings(value: Array<{ severity?: string }> | { warnings?: Array<{ severity?: string }> }): boolean {
  const warnings = Array.isArray(value) ? value : value.warnings;
  return Boolean(warnings?.some((warning) => warning.severity === "BLOCK"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLoadContextInput(input: z.infer<typeof LoadContextInputSchema>): LoadContextInput {
  return {
    project: input.project,
    category: input.category,
    tag: input.tag,
    runtime: input.runtime,
    includeArchive: input.includeArchive,
    names: input.names === undefined ? undefined : normalizeStringArray(input.names, "names"),
    limit: input.limit,
    maxBytes: input.maxBytes,
    includeContent: input.includeContent,
    excerptChars: input.excerptChars,
    cursor: input.cursor,
    format: input.format,
  };
}

function normalizeProjectUpdateSnapshotInput(
  input: z.infer<typeof ProjectUpdateSnapshotInputSchema>,
): ProjectUpdateSnapshotInput {
  return {
    project: input.project,
    milestone: input.milestone,
    statuses: input.statuses === undefined ? undefined : normalizeProjectUpdateStatuses(input.statuses),
    includeBacklog: input.includeBacklog,
    asOf: input.asOf,
  };
}

function normalizeRenderProjectUpdateInput(input: z.infer<typeof RenderProjectUpdateInputSchema>): RenderProjectUpdateInput {
  return {
    ...normalizeProjectUpdateSnapshotInput(input),
    format: input.format,
  };
}

function normalizeProposeChangeInput(input: z.infer<typeof ProposeChangeInputSchema>): ProposeChangeInput {
  const scope = ProposedChangeScopeObjectSchema.parse(parseJsonStringValue(input.scope, "scope"));
  const rawOperations = parseJsonStringValue(input.operations, "operations");
  if (!Array.isArray(rawOperations)) {
    throw new Error("operations must be an array or a JSON string containing an array.");
  }
  const operations = rawOperations.map((operation, index) => normalizeProposedChangeOperation(operation, index));
  return {
    scope,
    target: input.target,
    summary: input.summary,
    operations,
    ...(input.rationale ? { rationale: input.rationale } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
}

function normalizeProposedChangeOperation(value: unknown, index: number): ProposedChangeOperation {
  const raw = parseJsonStringValue(value, `operations[${index}]`);
  const normalized =
    isRecord(raw) && raw.type === "frontmatter.merge"
      ? { ...raw, updates: normalizeJsonRecord(raw.updates, `operations[${index}].updates`) }
      : raw;
  return ProposedChangeOperationNormalizedSchema.parse(normalized);
}

function normalizeJsonRecord(value: unknown, label: string): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(parseJsonStringValue(value, label));
}

function normalizeStringArray(value: unknown, label: string, minLength = 0): string[] {
  return z.array(z.string()).min(minLength).parse(parseJsonStringValue(value, label));
}

function normalizeProjectUpdateStatuses(value: unknown): ProjectUpdateSnapshotInput["statuses"] {
  return z.array(ProjectUpdateStatusSchema).parse(parseJsonStringValue(value, "statuses"));
}

function parseJsonStringValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be valid JSON when provided as a string: ${message}`);
  }
}

function attachRequestLogging(server: McpServer, requestLogger: RequestLogger): void {
  if (!requestLogger.enabled) {
    return;
  }

  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    callback: ToolCallback,
  ) => unknown;
  server.registerTool = ((name: string, config: unknown, callback: ToolCallback) =>
    registerTool(name, config, async (input: unknown, context: unknown) => {
      const startedAt = Date.now();
      try {
        const result = await callback(input, context);
        requestLogger.logToolCall({
          toolName: name,
          arguments: input,
          durationMs: Date.now() - startedAt,
          outcome: result.isError ? "mcp-error" : "success",
          isError: result.isError,
        });
        return result;
      } catch (error) {
        requestLogger.logToolCall({
          toolName: name,
          arguments: input,
          durationMs: Date.now() - startedAt,
          outcome: "exception",
          error: errorMetadata(error),
        });
        throw error;
      }
    })) as unknown as McpServer["registerTool"];
}

type ToolCallback = (input: unknown, context: unknown) => CallToolResult | Promise<CallToolResult>;
