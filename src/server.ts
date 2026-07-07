import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AnchorService } from "./anchorService.js";
import { PeopleRegistryConflictError, ProjectMappingsConflictError } from "./git/repo.js";
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
const ProjectPrioritySchema = z.union([z.number().finite(), z.null()]);
const TaskPrioritySchema = z.union([z.number().finite(), z.null()]);
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
  task: z.string().optional(),
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
      version: "2.1.0",
    },
    {
      instructions: `\
## Before any work in a chat
Before your first non-trivial tool call (code read, search, edit, or shell), call startTask({ task, project }) when you \
know the project and task — it plans a budgeted anchor bundle and loads task-aware excerpts in one response. Otherwise call \
planContextBundle() when you need a task-aware, budgeted anchor selection; loadContext() for broader discovery; or \
contextRoot() if you only need the index without anchor bodies. Skip only for purely conversational replies.

startTask combines planContextBundle + loadContext: included/excluded rationale, missingContext signals, staleness flags, \
active milestones, anchor excerpts, and suggested readAnchor follow-ups.

loadContext returns the same discovery metadata as contextRoot (entries plus optional markdown) and loads multiple \
anchors in one response (excerpts by default). Pass task with includeContent excerpt for task-aware section excerpts. \
Filter by project/category/tag/runtime, pass explicit names, and paginate with nextCursor when truncated is true. If \
responses are too large, lower limit or maxBytes, set includeContent to excerpt or none, or continue with nextCursor.

planContextBundle scores anchors against a task and token budget, explains included and excluded anchors, and returns a \
suggested loadContext call using the selected names.

Do not browse the filesystem for anchors; always use these MCP tools.

Use readAnchor(...) after startTask or loadContext when you need the full body of a specific anchor.

Why this matters: project decisions, conflicts, and PR-history context intentionally live in anchors rather than code. \
Working without this context is the most common cause of contradictory output.

In your first assistant message for tool-using chats, state which anchors you loaded (or "no anchors matched"). If \
you skipped startTask/planContextBundle/loadContext/contextRoot, say so.

If you realize mid-task that you skipped startTask, loadContext, or planContextBundle, stop and call one before producing the next assistant message, \
then re-evaluate in-flight work against the loaded anchors.

This rule is not overridden by skill workflows. Skills assume startTask, planContextBundle, loadContext, or contextRoot has already been called.

### Example
User: "Review the current branch for context-conductor."
Assistant: startTask({ task: "Review the current branch", project: "context-conductor" }) -> readAnchor(...) only for deeper detail -> only then git diff and start review.

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
    "startTask",
    {
      title: "Start Task",
      description:
        "Session-start orchestration: plan a task-aware context bundle and load suggested anchor excerpts in one call. " +
        "Returns plan rationale, anchor excerpts, staleness flags, active milestones, and suggested readAnchor follow-ups. " +
        "Pass repo and/or filePaths to resolve candidate projects when the project is not named directly.",
      inputSchema: z.object({
        task: z.string().min(1),
        project: z.string().optional(),
        repo: z.string().optional(),
        filePaths: z.array(z.string()).optional(),
        budgetTokens: z.number().int().positive().optional(),
        maxAnchors: z.number().int().positive().optional(),
        includeArchive: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input) => jsonResult(await service.startTask(input)),
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
        "Plan a task-aware context bundle. Returns included anchors, excluded anchors, reasons, estimated token use, missing-context signals, and a suggested loadContext call. " +
        "Pass repo and/or filePaths to resolve candidate projects when the project is not named directly.",
      inputSchema: z.object({
        task: z.string().min(1),
        project: z.string().optional(),
        repo: z.string().optional(),
        filePaths: z.array(z.string()).optional(),
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
    "updateProjectPriority",
    {
      title: "Update Project Priority",
      description:
        "Set or clear a project's numeric front matter priority (for example 1, 1.1, or 2.045). Requires approved: true after an explicit human request.",
      inputSchema: z.object({
        project: z.string().optional(),
        name: z.string().optional(),
        priority: ProjectPrioritySchema,
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ project, name, priority, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateProjectPriority({
        project,
        name,
        priority,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  const DateConfidenceSchema = z.enum(["committed", "internal_goal", "estimated"]);
  const TaskStatusSchema = z.enum(["todo", "active", "blocked", "done", "cancelled"]);

  server.registerTool(
    "updateTaskDue",
    {
      title: "Update Task Due Date",
      description:
        "Set or clear the due date for a specific task in a milestone anchor. Pass due as a YYYY-MM-DD date with dateConfidence (committed, internal_goal, or estimated), or pass due as null to clear the due date.",
      inputSchema: z.object({
        name: z.string().describe("Milestone anchor name containing the task."),
        taskId: z.string().describe("Task id to update."),
        due: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).describe("ISO date (YYYY-MM-DD) or null to clear."),
        dateConfidence: DateConfidenceSchema.optional().describe("Required when due is set: committed, internal_goal, or estimated."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, taskId, due, dateConfidence, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateTaskDue({
        name,
        taskId,
        due,
        dateConfidence,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "updateTaskOwner",
    {
      title: "Update Task Owner",
      description:
        "Set or clear the owner assignment for a specific task in a milestone anchor. Pass owner as a person/team identifier or null to clear assignment.",
      inputSchema: z.object({
        name: z.string().describe("Milestone anchor name containing the task."),
        taskId: z.string().describe("Task id to update."),
        owner: z.union([z.string(), z.null()]).describe("Owner string to set, or null to clear assignment."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, taskId, owner, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateTaskOwner({
        name,
        taskId,
        owner,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "updateTaskPriority",
    {
      title: "Update Task Priority",
      description:
        "Set or clear the numeric priority for a specific task in a milestone anchor. Project priority remains separate and is stored on project anchors.",
      inputSchema: z.object({
        name: z.string().describe("Milestone anchor name containing the task."),
        taskId: z.string().describe("Task id to update."),
        priority: TaskPrioritySchema.describe("Numeric task priority to set, or null to clear it."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, taskId, priority, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateTaskPriority({
        name,
        taskId,
        priority,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "updateTaskNotes",
    {
      title: "Update Task Notes",
      description:
        "Set or clear notes for a specific task in a milestone anchor. Pass notes as text to set it, or null to clear it.",
      inputSchema: z.object({
        name: z.string().describe("Milestone anchor name containing the task."),
        taskId: z.string().describe("Task id to update."),
        notes: z.union([z.string(), z.null()]).describe("Notes text to set, or null to clear notes."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, taskId, notes, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.updateTaskNotes({
        name,
        taskId,
        notes,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "listTasksDue",
    {
      title: "List Tasks by Due Date",
      description:
        "List tasks across all milestones (or one project) sorted by due date. Defaults to active, todo, and blocked tasks, plus done when a completed window is set. Use dueBefore/dueAfter and completedBefore/completedAfter to build task reports, noDue:true to find tasks without a due date, owner to filter by person or team, and priority or modified-date filters for task-list views.",
      inputSchema: z.object({
        project: z.string().optional().describe("Filter by project slug."),
        dueBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Include only tasks with due date before this date (exclusive)."),
        dueAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Include only tasks with due date on or after this date."),
        completedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Include done tasks completed before this date (exclusive)."),
        completedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Include done tasks completed on or after this date."),
        modifiedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Include only tasks whose containing milestone anchor was modified on or after this date."),
        noDue: z.boolean().optional().describe("When true, return only tasks with no due date."),
        status: z.union([z.array(TaskStatusSchema), JsonStringSchema]).optional().describe("Filter by task status. Defaults to active, todo, blocked (plus done when a completed window is set)."),
        owner: z.string().optional().describe("Filter by person or team: id, display name, email, slack id, or team synonym."),
        unassigned: z.boolean().optional().describe("When true, return only tasks with no owner assigned."),
        maxProjectPriority: z.number().finite().optional().describe("Include only tasks from projects with priority P less than or equal to this value."),
        maxTaskPriority: z.number().finite().optional().describe("Include only tasks with task priority P less than or equal to this value."),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ project, dueBefore, dueAfter, completedBefore, completedAfter, modifiedAfter, noDue, status, owner, unassigned, maxProjectPriority, maxTaskPriority }) => {
      const parsedStatus = typeof status === "string" ? (JSON.parse(status) as string[]) : status;
      const result = await service.listTasksDue({
        project,
        dueBefore,
        dueAfter,
        completedBefore,
        completedAfter,
        modifiedAfter,
        noDue,
        status: parsedStatus as ("todo" | "active" | "blocked" | "done" | "cancelled")[] | undefined,
        owner,
        unassigned,
        maxProjectPriority,
        maxTaskPriority,
      });
      return jsonResult(result, false);
    },
  );

  const ClaimConfidenceSchema = z.enum(["high", "medium", "low"]);

  server.registerTool(
    "listClaims",
    {
      title: "List Claim Provenance",
      description:
        "List claims (top-level bullets in Current State, Decisions, and Constraints sections) with their provenance annotations across one anchor or a project. Use status: unannotated to find legacy claims with no provenance, or status: malformed to find broken annotations. Returns per-claim src/observed/conf plus a coverage summary.",
      inputSchema: z.object({
        name: z.string().optional().describe("Limit to one anchor by name."),
        project: z.string().optional().describe("Limit to a project slug (alias-aware)."),
        status: z.enum(["annotated", "unannotated", "malformed"]).optional().describe("Filter by provenance status."),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ name, project, status }) => {
      const result = await service.listClaims({ name, project, status });
      return jsonResult(result, false);
    },
  );

  server.registerTool(
    "annotateClaim",
    {
      title: "Annotate Claim Provenance",
      description:
        "Set or clear the provenance annotation ({src; observed; conf[; id]}) on one claim without rewriting the anchor. Locate the claim with a unique substring of its bullet text. src may be a PR reference, repo file path, anchor name, URL, or person:<id> (person-sourced claims cap at conf: medium). Pass clear: true to remove an annotation.",
      inputSchema: z.object({
        name: z.string().describe("Anchor containing the claim."),
        claim: z.string().min(1).describe("Unique substring of the claim's bullet text."),
        src: z.string().optional().describe("Provenance source: PR #N, file path, anchor name, URL, or person:<id>."),
        observed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Date the fact was observed/verified (YYYY-MM-DD)."),
        conf: ClaimConfidenceSchema.optional().describe("Stated confidence: high (observed directly), medium (read in doc/PR), low (inferred)."),
        id: z.string().optional().describe("Optional stable kebab-case id for cross-references."),
        clear: z.boolean().optional().describe("When true, remove the claim's annotation."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ name, claim, src, observed, conf, id, clear, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.annotateClaim({
        name,
        claim,
        src,
        observed,
        conf,
        id,
        clear,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "createTask",
    {
      title: "Create Task",
      description:
        "Create a structured task in a milestone anchor so it appears in the Tasks view. Defaults to the project's backlog milestone (auto-created when missing). Provide owner to assign it (person or team) or omit to leave it unassigned. due requires dateConfidence.",
      inputSchema: z.object({
        project: z.string().describe("Project slug the task belongs to."),
        title: z.string().min(1).describe("Task title."),
        milestone: z.string().optional().describe("Milestone anchor name. Defaults to the project's backlog milestone."),
        status: TaskStatusSchema.optional().describe("Initial status. Defaults to todo."),
        owner: z.string().optional().describe("Owner: person or team (id, name, email, slack, synonym). Omit to leave unassigned."),
        priority: z.number().finite().optional().describe("Optional task-level priority. Project priority is edited separately."),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date (YYYY-MM-DD). Requires dateConfidence."),
        dateConfidence: DateConfidenceSchema.optional().describe("Required when due is set: committed, internal_goal, or estimated."),
        goalIds: z.array(z.string().regex(/^G-\d{1,6}$/)).optional().describe("Roadmap goal ids this task advances."),
        notes: z.string().optional(),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ project, title, milestone, status, owner, priority, due, dateConfidence, goalIds, notes, message, approved, coAuthor }) => {
      const result = await service.createTask({
        project,
        title,
        milestone,
        status,
        owner,
        priority,
        due,
        dateConfidence,
        goalIds,
        notes,
        message,
        approved,
        coAuthor,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "completeTask",
    {
      title: "Complete Task",
      description:
        "Mark a task done and set its completion date (defaults to today). Locate the task by id within a milestone anchor (name) or across a project's milestones (project).",
      inputSchema: z.object({
        taskId: z.string().describe("Task id to complete."),
        name: z.string().optional().describe("Milestone anchor containing the task."),
        project: z.string().optional().describe("Project slug to locate the task when name is omitted."),
        completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Completion date (YYYY-MM-DD). Defaults to today."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ taskId, name, project, completedOn, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.completeTask({
        taskId,
        name,
        project,
        completedOn,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "reopenTask",
    {
      title: "Reopen Task",
      description:
        "Reopen a completed task by setting its status to todo and clearing completed_on. Locate the task by id within a milestone anchor (name) or across a project's milestones (project).",
      inputSchema: z.object({
        taskId: z.string().describe("Task id to reopen."),
        name: z.string().optional().describe("Milestone anchor containing the task."),
        project: z.string().optional().describe("Project slug to locate the task when name is omitted."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ taskId, name, project, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.reopenTask({
        taskId,
        name,
        project,
        message,
        approved,
        coAuthor,
        expectedFileCommit,
      });
      return jsonResult(result, result.version ? false : true);
    },
  );

  server.registerTool(
    "deleteTask",
    {
      title: "Delete Task",
      description:
        "Remove a task from its milestone anchor. Locate the task by id within a milestone anchor (name) or across a project's milestones (project).",
      inputSchema: z.object({
        taskId: z.string().describe("Task id to delete."),
        name: z.string().optional().describe("Milestone anchor containing the task."),
        project: z.string().optional().describe("Project slug to locate the task when name is omitted."),
        message: z.string().optional(),
        approved: z.boolean().default(false),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ taskId, name, project, message, approved, coAuthor, expectedFileCommit }) => {
      const result = await service.deleteTask({
        taskId,
        name,
        project,
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

  server.registerTool(
    "listPeople",
    {
      title: "List People",
      description: "List all people in the people registry. Optionally filter by team id or synonym.",
      inputSchema: z.object({
        team: z.string().optional().describe("Filter by team id, display name, or synonym."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ team }) => jsonResult(await service.listPeople(team)),
  );

  server.registerTool(
    "readPerson",
    {
      title: "Read Person",
      description: "Get a person by id, display name, email, slack id, confluence id, or any registered name.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Person id, display name, email, slack id, or any registered identity."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => jsonResult(await service.readPerson(id)),
  );

  server.registerTool(
    "listTeams",
    {
      title: "List Teams",
      description: "List all teams in the people registry.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await service.listTeams()),
  );

  server.registerTool(
    "readTeam",
    {
      title: "Read Team",
      description: "Get a team by id, display name, or synonym. Returns team details and current members.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Team id, display name, or synonym."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => jsonResult(await service.readTeam(id)),
  );

  server.registerTool(
    "writePeopleRegistry",
    {
      title: "Write People Registry",
      description: "Replace the full people and teams registry. Commits the change to git.",
      inputSchema: z.object({
        registry: z.object({
          people: z.array(
            z.object({
              id: z.string().min(1),
              displayName: z.string().min(1),
              identities: z
                .object({
                  slack: z.string().optional(),
                  confluence: z.string().optional(),
                  emails: z.array(z.string()).optional(),
                  names: z.array(z.string()).optional(),
                })
                .optional(),
              teams: z.array(z.string()).optional(),
              projects: z
                .array(z.object({ project: z.string().min(1), role: z.string().min(1) }))
                .optional(),
            }),
          ),
          teams: z.array(
            z.object({
              id: z.string().min(1),
              displayName: z.string().min(1),
              synonyms: z.array(z.string()).optional(),
              slackHandles: z.array(z.string()).optional(),
              projects: z
                .array(z.object({ project: z.string().min(1), role: z.string().min(1) }))
                .optional(),
            }),
          ),
        }),
        message: z.string().optional(),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ registry, message, coAuthor, expectedFileCommit }) => {
      try {
        await service.writePeopleRegistry({ registry, message, coAuthor, expectedFileCommit });
      } catch (error) {
        if (error instanceof PeopleRegistryConflictError) {
          return jsonResult({ error: error.message, code: error.code }, true);
        }
        throw error;
      }
      return jsonResult({ ok: true });
    },
  );

  server.registerTool(
    "getPeopleRegistry",
    {
      title: "Get People Registry",
      description: "Return the full people and teams registry.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await service.getPeopleRegistry()),
  );

  server.registerTool(
    "getProjectMappings",
    {
      title: "Get Project Mappings",
      description:
        "Return the project-to-repository/path mappings used to resolve a repo name or file paths to candidate projects.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await service.getProjectMappings()),
  );

  server.registerTool(
    "writeProjectMappings",
    {
      title: "Write Project Mappings",
      description:
        "Replace the full project-to-repository/path mapping registry. Each project lists the repos it lives in; each repo may be narrowed to directory path prefixes (empty means the whole repo). Commits the change to git.",
      inputSchema: z.object({
        mappings: z.object({
          projects: z.array(
            z.object({
              project: z.string().min(1),
              repos: z.array(
                z.object({
                  repo: z.string().min(1),
                  paths: z.array(z.string()).optional(),
                  web: z
                    .object({
                      url: z.string().min(1),
                      branch: z.string().optional(),
                      fileTemplate: z.string().optional(),
                    })
                    .optional(),
                }),
              ),
            }),
          ),
        }),
        message: z.string().optional(),
        coAuthor: z.string().optional(),
        expectedFileCommit: z.string().optional(),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ mappings, message, coAuthor, expectedFileCommit }) => {
      try {
        await service.writeProjectMappings({ mappings, message, coAuthor, expectedFileCommit });
      } catch (error) {
        if (error instanceof ProjectMappingsConflictError) {
          return jsonResult({ error: error.message, code: error.code }, true);
        }
        throw error;
      }
      return jsonResult({ ok: true });
    },
  );

  server.registerPrompt(
    "start-task",
    {
      title: "Start Task",
      description: "Begin a tool-using session by loading task-aware project context via startTask.",
      argsSchema: z.object({
        project: z.string().optional(),
        task: z.string().min(1),
      }),
    },
    ({ project, task }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Start this session by calling startTask with task ${JSON.stringify(task)}` +
              (project ? ` and project ${JSON.stringify(project)}` : "") +
              ". In your first assistant message, state which anchors were loaded and any stale or missing-context signals before other tool use.",
          },
        },
      ],
    }),
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
    task: input.task,
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
