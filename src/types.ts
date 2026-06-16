import type { DiscoveryCategory } from "./taxonomy.js";

export type AnchorFrontmatter = Record<string, unknown>;

/** Derived roadmap signals for `type: project-roadmap` (discovery metadata). */
export type RoadmapAcceptanceCriteriaSummary = {
  activeGoals: number;
  goalsWithCriteria: number;
  goalsMissingCriteria: string[];
  /** Goal ids (`G-<digits>`) that are missing `#### Acceptance Criteria` (when headings use stable ids). */
  goalsMissingCriteriaIds?: string[];
  /** Goal titles whose `###` heading lacks `Goal G-<digits> --` stable id form. */
  goalsWithoutStableIds?: string[];
  /** Duplicate stable goal ids found in roadmap headings. */
  goalsDuplicateStableIds?: string[];
  hasProposedCriteria: boolean;
  criteriaViolations?: string[];
};

export type MilestonePlannerMeta = {
  status: "proposed" | "active" | "shipped" | "cancelled";
  theme: string;
  steelThread?: string;
  goalIds: string[];
  /** Stable milestone slug: `M` + digits, or `backlog`. */
  milestoneId?: string;
  /** Ordering within a project; display label is `M${sequence}` when set. */
  sequence?: number;
  schedule?: MilestoneScheduleMeta;
  tasks?: MilestoneTaskMeta[];
};

export type DateConfidence = "committed" | "internal_goal" | "estimated";

export type MilestoneTaskStatus = "todo" | "active" | "blocked" | "done" | "cancelled";

export type MilestoneScheduleMeta = {
  start?: string;
  target?: string;
  shipped?: string;
  dateConfidence?: DateConfidence;
};

export type MilestoneTaskMeta = {
  id: string;
  title: string;
  status: MilestoneTaskStatus;
  owner?: string;
  goalIds?: string[];
  due?: string;
  completedOn?: string;
  dateConfidence?: DateConfidence;
  notes?: string;
};

export type AnchorMeta = {
  name: string;
  path: string;
  /** Repo anchors use taxonomy dirs; built-in policy rows use `server-rules`. */
  category: DiscoveryCategory;
  title?: string;
  project?: unknown;
  projectSlug?: string;
  type?: unknown;
  tags?: unknown;
  summary: string;
  read_this_if: string[];
  last_validated?: unknown;
  version?: string;
  updatedAt?: string;
  createdAt?: string;
  /** Optional project ordering priority stored as a number; UI labels render values as P1, P1.1, or P2.045. */
  priority?: number;
  origin?: "repo" | "built-in";
  /** Package version when this built-in policy row was materialized. */
  policyVersion?: string;
  acceptanceCriteria?: RoadmapAcceptanceCriteriaSummary;
  /** Present for `type: project-milestone` anchors when front matter is parseable. */
  milestone?: MilestonePlannerMeta;
  /** Alternate project slugs declared on the project context anchor. */
  aliases?: string[];
};

export type AnchorRead = {
  name: string;
  path: string;
  content: string;
  frontmatter: AnchorFrontmatter;
  /** Repository HEAD when reading latest (unchanged). */
  version?: string;
  /** Latest commit that touched this anchor path (for optimistic concurrency). */
  fileCommit?: string;
};

export type SearchHit = {
  name: string;
  path: string;
  line: number;
  preview: string;
};

export type AnchorVersion = {
  version: string;
  author: string;
  date: string;
  message: string;
};

export type ConflictStatus = {
  state: "clean" | "conflicted";
  paths?: string[];
};

export type ValidationSeverity = "BLOCK" | "WARN";

export type ValidationViolation = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
};

export type WriteAnchorResult = {
  version?: string;
  warnings: ValidationViolation[];
  requiresApproval?: boolean;
};

export type WriteAnchorInput = {
  name: string;
  content: string;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  /** When set, must match `readAnchor(...).fileCommit` or the write is rejected with `stale_base`. */
  expectedFileCommit?: string;
};

export type UpdateProjectPriorityInput = {
  project?: string;
  name?: string;
  priority: number | null;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type UpdateTaskDueInput = {
  /** Milestone anchor name containing the task. */
  name: string;
  /** Task id to update. */
  taskId: string;
  /** ISO date (YYYY-MM-DD) to set, or null to clear the due date. */
  due: string | null;
  /** Required when due is set. */
  dateConfidence?: DateConfidence;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type ListTasksDueInput = {
  project?: string;
  /** Include only tasks with due date before this ISO date (exclusive). */
  dueBefore?: string;
  /** Include only tasks with due date on or after this ISO date. */
  dueAfter?: string;
  /** When true, include only tasks that have no due date set. */
  noDue?: boolean;
  /** Filter by task status. Defaults to active, todo, and blocked. */
  status?: MilestoneTaskStatus[];
};

export type TaskDueRow = {
  taskId: string;
  taskTitle: string;
  taskStatus: MilestoneTaskStatus;
  taskOwner?: string;
  due?: string;
  dateConfidence?: DateConfidence;
  notes?: string;
  milestoneName: string;
  milestoneDisplayId?: string;
  milestoneStatus: string;
  project?: string;
};

export type ProposedChangeStatus = "pending" | "applied" | "rejected" | "changes_requested" | "superseded";

export type ProposedChangeScope =
  | {
      kind: "project";
      project: string;
    }
  | {
      kind: "agent-rules";
    };

export type ProposedChangeOperation =
  | {
      type: "frontmatter.merge";
      updates: Record<string, unknown>;
    }
  | {
      type: "section.replace";
      heading: string;
      content: string;
      lastValidated?: string;
    }
  | {
      type: "section.append";
      heading: string;
      content: string;
      lastValidated?: string;
    }
  | {
      type: "section.delete";
      heading: string;
      lastValidated?: string;
    }
  | {
      type: "anchor.create";
      content: string;
    }
  | {
      type: "document.replace";
      content: string;
    };

export type ProposedChangeReview = {
  status: ProposedChangeStatus;
  reviewedAt: string;
  reviewedBy?: string;
  note?: string;
};

export type ProposedChangeRecord = {
  id: string;
  scope: ProposedChangeScope;
  status: ProposedChangeStatus;
  summary: string;
  target: string;
  baseFileCommit?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  rationale?: string;
  operations: ProposedChangeOperation[];
  reviews?: ProposedChangeReview[];
  appliedAt?: string;
  appliedBy?: string;
  appliedVersion?: string;
  applyWarnings?: ValidationViolation[];
};

export type ProposedChangeListInput = {
  project?: string;
  scope?: "agent-rules";
  status?: ProposedChangeStatus;
};

export type ProposedChangeListItem = ProposedChangeRecord & {
  ledgerName: string;
  ledgerPath: string;
  ledgerFileCommit?: string;
};

export type ProposeChangeInput = {
  scope: ProposedChangeScope;
  target: string;
  summary: string;
  operations: ProposedChangeOperation[];
  rationale?: string;
  createdBy?: string;
  message?: string;
};

export type ProposedChangeRead = {
  proposal: ProposedChangeListItem;
};

export type ProposeChangeResult = ProposedChangeRead & {
  version?: string;
  warnings: ValidationViolation[];
};

export type ProposedChangePreview = {
  proposal: ProposedChangeListItem;
  targetExists: boolean;
  targetFileCommit?: string;
  baseFileCommit?: string;
  stale: boolean;
  draftContent?: string;
  diff?: string;
  warnings: ValidationViolation[];
  requiresApproval?: boolean;
};

export type ReviewProposedChangeInput = {
  id: string;
  status: Extract<ProposedChangeStatus, "rejected" | "changes_requested" | "superseded" | "pending">;
  note?: string;
  reviewedBy?: string;
  message?: string;
  expectedLedgerFileCommit?: string;
};

export type ApplyProposedChangeInput = {
  id: string;
  approved?: boolean;
  appliedBy?: string;
  message?: string;
  coAuthor?: string;
  expectedLedgerFileCommit?: string;
};

export type ApplyProposedChangeResult = {
  proposal: ProposedChangeListItem;
  targetVersion?: string;
  ledgerVersion?: string;
  warnings: ValidationViolation[];
  requiresApproval?: boolean;
};

export type CompactionReport = {
  signals: ValidationViolation[];
  suggestedMoves: string[];
};

export type ContextRootFormat = "json" | "markdown" | "both";

export type ContextRootEntry = {
  name: string;
  path: string;
  category: DiscoveryCategory;
  title?: string;
  projectSlug?: string;
  summary: string;
  read_this_if: string[];
  type?: unknown;
  tags?: unknown;
  project?: unknown;
  last_validated?: unknown;
  origin?: "repo" | "built-in";
  policyVersion?: string;
  acceptanceCriteria?: RoadmapAcceptanceCriteriaSummary;
  milestoneStatus?: string;
  milestoneId?: string;
  milestoneSequence?: number;
  milestoneDisplayId?: string;
};

/** How a requested project filter was resolved against canonical slugs and aliases. */
export type ProjectFilterResolution = {
  requested: string;
  resolved: string;
  via: "canonical" | "alias" | "unresolved";
  matchedAlias?: string;
};

export type ContextRootResult = {
  generatedAt: string;
  entries: ContextRootEntry[];
  markdown?: string;
  projectFilter?: ProjectFilterResolution;
};

/** How much anchor body to include in `loadContext` results. */
export type AnchorContentMode = "full" | "excerpt" | "none";

/** Input for the combined discovery + multi-anchor read tool (`loadContext`). */
export type LoadContextInput = {
  project?: string;
  category?: DiscoveryCategory;
  tag?: string;
  runtime?: string;
  includeArchive?: boolean;
  /** When set, load these anchors in order instead of all anchors matching the filter. */
  names?: string[];
  limit?: number;
  maxBytes?: number;
  includeContent?: AnchorContentMode;
  /** Max characters per anchor body when `includeContent` is `excerpt`. */
  excerptChars?: number;
  /** Continuation token from a previous `loadContext` response. */
  cursor?: string;
  /** When set with `includeContent: excerpt`, prefer sections that match this task. */
  task?: string;
  /** Same as `contextRoot`: include markdown snapshot in the result. */
  format?: ContextRootFormat;
};

export type LoadContextSelectionReason = "explicit_names" | "filter";

/** One anchor row returned by `loadContext`. */
export type LoadContextAnchor = {
  name: string;
  path: string;
  title?: string;
  summary: string;
  read_this_if: string[];
  version?: string;
  /** Present when `includeContent` is `full`. */
  content?: string;
  /** Present when `includeContent` is `excerpt`. */
  excerpt?: string;
  frontmatter?: AnchorFrontmatter;
};

export type LoadContextResult = {
  generatedAt: string;
  entries: ContextRootEntry[];
  markdown?: string;
  anchors: LoadContextAnchor[];
  truncated: boolean;
  nextCursor?: string;
  selectionReason: LoadContextSelectionReason;
  /** Total anchors matching this query (before pagination). */
  totalMatching: number;
  /** How many anchors were returned in `anchors` this page. */
  returnedCount: number;
  projectFilter?: ProjectFilterResolution;
};

/** Input for a task-aware context bundle planning tool. */
export type PlanContextBundleInput = {
  task: string;
  project?: string;
  category?: DiscoveryCategory;
  tag?: string;
  runtime?: string;
  includeArchive?: boolean;
  /** Approximate context budget in tokens. */
  budgetTokens?: number;
  /** Maximum anchors to include even when budget remains. */
  maxAnchors?: number;
  /** Maximum excluded anchors to explain in the response. */
  maxExcluded?: number;
};

export type PlanContextBundleItem = {
  name: string;
  path: string;
  category: DiscoveryCategory;
  title?: string;
  projectSlug?: string;
  summary: string;
  score: number;
  estimatedTokens: number;
  matchedTerms: string[];
  reason: string;
  stale?: boolean;
  lastValidatedAgeDays?: number;
};

export type PlanContextBundleResult = {
  generatedAt: string;
  task: string;
  budgetTokens: number;
  estimatedTokens: number;
  totalCandidates: number;
  included: PlanContextBundleItem[];
  excluded: PlanContextBundleItem[];
  missingContext: string[];
  projectFilter?: ProjectFilterResolution;
  loadContext: {
    names: string[];
    includeContent: "excerpt";
    maxBytes: number;
    project?: string;
  };
};

/** Input for the combined session-start orchestration tool (`startTask`). */
export type StartTaskInput = {
  task: string;
  project?: string;
  budgetTokens?: number;
  maxAnchors?: number;
  includeArchive?: boolean;
};

export type StartTaskActiveMilestone = {
  name: string;
  theme: string;
  goalIds: string[];
  displayId?: string;
};

export type StartTaskResult = {
  task: string;
  plan: {
    budgetTokens: number;
    estimatedTokens: number;
    included: PlanContextBundleItem[];
    excluded: PlanContextBundleItem[];
    missingContext: string[];
    projectFilter?: ProjectFilterResolution;
  };
  anchors: LoadContextAnchor[];
  truncated: boolean;
  nextCursor?: string;
  staleness: {
    staleAfterDays: number;
    staleIncluded: Array<{ name: string; lastValidatedAgeDays?: number }>;
  };
  activeMilestones: StartTaskActiveMilestone[];
  suggestedFollowUp: {
    readAnchor: string[];
    note: string;
  };
};

export type ProjectUpdateFormat = "markdown" | "slack" | "email";

export type ProjectUpdateMilestoneStatus = MilestonePlannerMeta["status"];

export type ProjectUpdateSnapshotInput = {
  project: string;
  milestone?: string;
  statuses?: ProjectUpdateMilestoneStatus[];
  includeBacklog?: boolean;
  asOf?: string;
};

export type ProjectUpdateTask = {
  id: string;
  title: string;
  status: MilestoneTaskStatus;
  owner?: string;
  goalIds?: string[];
  due?: string;
  completedOn?: string;
  dateConfidence?: DateConfidence;
  notes?: string;
  source: "milestone";
  anchor: string;
};

export type ProjectUpdateGoal = {
  id: string;
  title: string;
  hasAcceptanceCriteria: boolean;
  tasks: ProjectUpdateTask[];
};

export type ProjectUpdateMilestone = {
  name: string;
  path: string;
  displayId?: string;
  milestoneId?: string;
  sequence?: number;
  status: ProjectUpdateMilestoneStatus;
  theme: string;
  steelThread?: string;
  goalIds: string[];
  schedule?: MilestoneScheduleMeta;
  goals: ProjectUpdateGoal[];
  tasks: ProjectUpdateTask[];
};

export type ProjectUpdateSnapshot = {
  generatedAt: string;
  asOf: string;
  project: string;
  projectFilter?: ProjectFilterResolution;
  roadmap?: { name: string; title?: string };
  projectAnchor?: { name: string; title?: string };
  progress: {
    milestones: { shipped: number; active: number; proposed: number; cancelled: number; backlog: number; total: number };
    tasks: { done: number; active: number; blocked: number; todo: number; cancelled: number; total: number };
  };
  milestones: ProjectUpdateMilestone[];
  backlog?: ProjectUpdateMilestone;
  warnings: string[];
};

export type RenderProjectUpdateInput = ProjectUpdateSnapshotInput & {
  format: ProjectUpdateFormat;
};

export type RenderedProjectUpdate = {
  format: ProjectUpdateFormat;
  generatedAt: string;
  asOf: string;
  project: string;
  subject?: string;
  body: string;
  snapshot: ProjectUpdateSnapshot;
};

export type ServerConfig = {
  repoPath: string;
  anchorRoot: string;
  autoSync: boolean;
  pushOnWrite: boolean;
  syncIntervalMs: number;
  migrationWarnOnly: boolean;
  /** Flag included planner anchors when last_validated is older than this many days. */
  staleAfterDays: number;
  logging?: LoggingConfig;
};

export type LoggingConfig = {
  file?: FileLoggingConfig;
  requests?: RequestLoggingConfig;
};

export type FileLoggingConfig = {
  enabled: boolean;
  dirname?: string;
  filename?: string;
  level?: string;
  datePattern?: string;
  maxSize?: string;
  maxFiles?: string;
  zippedArchive?: boolean;
};

export type RequestLoggingConfig = FileLoggingConfig & {
  /** Include MCP tool arguments in the request log. Defaults to true when request logging is enabled. */
  includeArguments?: boolean;
  /** Redact large/sensitive argument values. Defaults to true; disable only for local debugging. */
  redactArguments?: boolean;
};
