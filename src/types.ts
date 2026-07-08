import type { AnchorClaim, ClaimProvenanceSummary } from "./claims.js";
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
  /** Optional task-level priority. Project priority stays on project anchors. */
  priority?: number;
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
  /** Optional parsed claim provenance sidecar, returned only when requested. */
  claimProvenance?: AnchorClaimProvenance;
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
  /**
   * Internal: when false, skip claim-annotation carry-over and loss guarding
   * for this write. Set by annotateClaim, which is the sanctioned path for
   * explicitly changing or clearing a single annotation.
   */
  carryClaimAnnotations?: boolean;
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

export type UpdateTaskOwnerInput = {
  /** Milestone anchor name containing the task. */
  name: string;
  /** Task id to update. */
  taskId: string;
  /** Owner string to set, or null/empty to clear the assignment. */
  owner: string | null;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type UpdateTaskPriorityInput = {
  /** Milestone anchor name containing the task. */
  name: string;
  /** Task id to update. */
  taskId: string;
  /** Numeric task priority to set, or null to clear it. */
  priority: number | null;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type UpdateTaskNotesInput = {
  /** Milestone anchor name containing the task. */
  name: string;
  /** Task id to update. */
  taskId: string;
  /** Notes text to set, or null/empty to clear notes. */
  notes: string | null;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type PersonSearchMatch = {
  id: string;
  displayName: string;
  aliases: string[];
  matched: string;
  value: string;
};

export type ListTasksDueInput = {
  project?: string;
  /** Include only tasks with due date before this ISO date (exclusive). */
  dueBefore?: string;
  /** Include only tasks with due date on or after this ISO date. */
  dueAfter?: string;
  /** Include done tasks completed before this ISO date (exclusive). */
  completedBefore?: string;
  /** Include done tasks completed on or after this ISO date. */
  completedAfter?: string;
  /** When true, include only tasks that have no due date set. */
  noDue?: boolean;
  /** Filter by task status. Defaults to active/todo/blocked, plus done when a completed window is set. */
  status?: MilestoneTaskStatus[];
  /** Filter by owner: person id, display name, email, slack id, team id, or team synonym. */
  owner?: string;
  /** When true, include only tasks that have no owner assigned. */
  unassigned?: boolean;
  /** Include only tasks from projects whose numeric priority is at or below this value (e.g. 2 keeps P1/P2; lower numbers are higher priority). */
  maxProjectPriority?: number;
  /** Include only tasks whose task-level priority is at or below this value. Tasks without a priority are excluded. */
  maxTaskPriority?: number;
  /** Include only tasks whose containing milestone anchor was modified on or after this ISO date (YYYY-MM-DD). The milestone's modified timestamp is compared by date. */
  modifiedAfter?: string;
};

export type CreateTaskInput = {
  /** Project slug (alias-resolved) the task belongs to. */
  project: string;
  /** Task title. */
  title: string;
  /** Optional milestone anchor name; defaults to the project's backlog milestone (auto-created when missing). */
  milestone?: string;
  /** Initial status; defaults to `todo`. */
  status?: MilestoneTaskStatus;
  /** Owner: person id/name/email/slack or team id/synonym. Omit to leave unassigned. */
  owner?: string;
  /** Optional task-level priority. */
  priority?: number;
  /** ISO date (YYYY-MM-DD). Requires dateConfidence when set. */
  due?: string;
  /** Required when due is set. */
  dateConfidence?: DateConfidence;
  goalIds?: string[];
  notes?: string;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
};

export type CreateTaskResult = WriteAnchorResult & {
  /** Generated task id (e.g. `T-7`) when the write succeeded. */
  taskId?: string;
  /** Milestone anchor the task was written to. */
  milestoneName?: string;
};

export type CompleteTaskInput = {
  /** Task id to complete. */
  taskId: string;
  /** Milestone anchor containing the task. When omitted, the task is located by id within `project`. */
  name?: string;
  /** Project slug used to locate the task when `name` is omitted. */
  project?: string;
  /** Completion date (YYYY-MM-DD); defaults to today. */
  completedOn?: string;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type ReopenTaskInput = {
  /** Task id to reopen. */
  taskId: string;
  /** Milestone anchor containing the task. When omitted, the task is located by id within `project`. */
  name?: string;
  /** Project slug used to locate the task when `name` is omitted. */
  project?: string;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type DeleteTaskInput = {
  /** Task id to delete. */
  taskId: string;
  /** Milestone anchor containing the task. When omitted, the task is located by id within `project`. */
  name?: string;
  /** Project slug used to locate the task when `name` is omitted. */
  project?: string;
  message?: string;
  approved?: boolean;
  coAuthor?: string;
  expectedFileCommit?: string;
};

export type TaskDueRow = {
  taskId: string;
  taskTitle: string;
  taskStatus: MilestoneTaskStatus;
  taskOwner?: string;
  /** Task-level priority stored on the task itself, when set. */
  taskPriority?: number;
  due?: string;
  completedOn?: string;
  dateConfidence?: DateConfidence;
  notes?: string;
  milestoneName: string;
  milestoneDisplayId?: string;
  milestoneStatus: string;
  /** Last modified time for the milestone anchor that stores this task, as an ISO 8601 timestamp (from git metadata). */
  milestoneUpdatedAt?: string;
  /** Created time for the milestone anchor that stores this task, as an ISO 8601 timestamp (from git metadata). */
  milestoneCreatedAt?: string;
  project?: string;
  /** Project-level priority inherited from the task's project anchor, when set. */
  projectPriority?: number;
  /** Resolved person from the people registry, when the task owner matches a known person. */
  resolvedPerson?: { id: string; displayName: string };
  /** Resolved team from the people registry, when the task owner matches a known team. */
  resolvedTeam?: { id: string; displayName: string };
};

export type PersonIdentities = {
  slack?: string;
  confluence?: string;
  emails?: string[];
  names?: string[];
};

// Canonical association role list. KEEP IN SYNC with VALID_ROLES in
// src/peopleRegistry.ts (write validation) and ASSOCIATION_ROLES in
// src/ui/assets.ts (UI dropdown — a static JS string that cannot import this).
export type AssociationRole =
  | "responsible"
  | "accountable"
  | "informed"
  | "consulted"
  | "executive_sponsor"
  | "stakeholder"
  | "lead";

export type ProjectAssociation = {
  project: string;
  role: AssociationRole;
};

export type Person = {
  id: string;
  displayName: string;
  identities?: PersonIdentities;
  teams?: string[];
  projects?: ProjectAssociation[];
};

export type Team = {
  id: string;
  displayName: string;
  synonyms?: string[];
  slackHandles?: string[];
  projects?: ProjectAssociation[];
};

export type TeamWithMembers = Team & {
  members: Person[];
};

export type PeopleRegistry = {
  people: Person[];
  teams: Team[];
};

export type WritePeopleRegistryInput = {
  // Accepts a raw registry shape; the service normalizes and validates it
  // through parsePeopleRegistry before persisting.
  registry: unknown;
  message?: string;
  coAuthor?: string;
  // Optional optimistic-concurrency guard: the git commit the caller last read.
  // The write is rejected if the on-disk registry has advanced past it.
  expectedFileCommit?: string;
};

export type PeopleRegistryWithCommit = PeopleRegistry & { fileCommit?: string };

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

/**
 * Project-first mapping from a project to the repositories (and optional path
 * prefixes within them) where it lives. Stored in `project-mappings.json` at the
 * anchor root; empty by default so no real-world repo or project names ship with
 * the tool.
 */
export type ProjectMappings = {
  projects: ProjectMapping[];
  /** Configurable provenance source types shown in claim-source editors. */
  claimSourceTypes: ClaimSourceType[];
};

export type ClaimSourceType = {
  /** Stable source-kind id stored in claim annotations, e.g. `url`, `misc`, `design-doc`, or `adr`. */
  id: string;
  /** Human-facing label for UI controls. */
  label: string;
  /** When true, the source row stores a person id/name in addition to src. */
  requiresPerson?: boolean;
  /** Optional confidence value forced by this source type. */
  lockedConfidence?: "high" | "medium" | "low";
};

export type ProjectMapping = {
  /** Project slug this mapping applies to. */
  project: string;
  /** Repositories (optionally narrowed to directory prefixes) this project lives in. */
  repos: ProjectRepoMapping[];
};

export type ProjectRepoMapping = {
  /** Repository name this project lives in. */
  repo: string;
  /** Directory prefixes within the repo that belong to this project; empty means the whole repo. */
  paths: string[];
  /** Optional remote/web info used to build links to specific files in the repo. */
  web?: ProjectRepoWeb;
};

export type ProjectRepoWeb = {
  /** Repo web home, e.g. `https://github.com/owner/repo`. */
  url: string;
  /** Default branch/ref used in file links; defaults to `main` when omitted. */
  branch?: string;
  /**
   * Optional file-URL template with `{url}`, `{branch}`, and `{path}` placeholders.
   * Defaults to the common `{url}/blob/{branch}/{path}` (GitHub-style); override for
   * hosts that differ (e.g. GitLab `{url}/-/blob/{branch}/{path}`).
   */
  fileTemplate?: string;
  /**
   * Optional pull-request URL template with `{url}` and `{number}` placeholders.
   * Defaults to the common `{url}/pull/{number}` (GitHub-style); override for
   * hosts that differ (e.g. GitLab `{url}/-/merge_requests/{number}`).
   */
  pullRequestTemplate?: string;
};

export type ProjectMappingsWithCommit = ProjectMappings & { fileCommit?: string };

export type WriteProjectMappingsInput = {
  // Accepts a raw mappings shape; the service normalizes and validates it
  // through parseProjectMappings before persisting.
  mappings: unknown;
  message?: string;
  coAuthor?: string;
  // Optional optimistic-concurrency guard: the git commit the caller last read.
  expectedFileCommit?: string;
};

/** One candidate project derived from a repo name and/or file paths, with its boost. */
export type ProjectResolutionCandidate = {
  project: string;
  boost: number;
  reasons: string[];
};

/** Result of resolving a repo name and file paths to ranked candidate projects. */
export type ProjectResolution = {
  candidates: ProjectResolutionCandidate[];
  /** Repo name supplied but absent from the configured map; degrades gracefully. */
  unknownRepo?: string;
  /** Human-readable explanation of why each candidate project was included. */
  explanations: string[];
};

export type ContextRootResult = {
  generatedAt: string;
  entries: ContextRootEntry[];
  markdown?: string;
  projectFilter?: ProjectFilterResolution;
};

/** How much anchor body to include in `loadContext` results. */
export type AnchorContentMode = "full" | "excerpt" | "none";

/** How much structured claim provenance to include alongside anchor reads. */
export type ClaimProvenanceMode = "none" | "summary" | "relevant" | "full";

export type AnchorClaimProvenance = {
  mode: Exclude<ClaimProvenanceMode, "none">;
  summary: ClaimProvenanceSummary;
  /** Present for `relevant` and `full`; `relevant` may be truncated. */
  claims?: AnchorClaim[];
  claimsTruncated?: boolean;
};

export type ContextProvenanceSummary = {
  mode: "summary";
  summary: ClaimProvenanceSummary;
  anchors: Array<{
    name: string;
    summary: ClaimProvenanceSummary;
  }>;
};

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
  /** Optional structured claim provenance sidecar. Defaults to `relevant` when task is set, otherwise `none`. */
  includeProvenance?: ClaimProvenanceMode;
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
  /** Optional parsed claim provenance sidecar. */
  claimProvenance?: AnchorClaimProvenance;
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
  provenance?: ContextProvenanceSummary;
};

/** Input for a task-aware context bundle planning tool. */
export type PlanContextBundleInput = {
  task: string;
  project?: string;
  /** Repository name; resolved to candidate projects via the configured repo map. */
  repo?: string;
  /** File paths touched by the task; resolved to candidate projects via path-prefix rules. */
  filePaths?: string[];
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
  /** Compact claim-provenance health to include with the plan. Defaults to `summary`; pass `none` to omit. */
  includeProvenance?: "none" | "summary";
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
  /** Candidate projects derived from a repo name and/or file paths, with explanations. */
  projectResolution?: ProjectResolution;
  provenance?: ContextProvenanceSummary;
  loadContext: {
    names: string[];
    includeContent: "excerpt";
    maxBytes: number;
    project?: string;
    includeProvenance?: ClaimProvenanceMode;
  };
};

/** Input for the combined session-start orchestration tool (`startTask`). */
export type StartTaskInput = {
  task: string;
  project?: string;
  /** Repository name; resolved to candidate projects via the configured repo map. */
  repo?: string;
  /** File paths touched by the task; resolved to candidate projects via path-prefix rules. */
  filePaths?: string[];
  budgetTokens?: number;
  maxAnchors?: number;
  includeArchive?: boolean;
  /** Compact claim-provenance health to include with the plan and loaded anchors. Defaults to `summary`; pass `none` to omit. */
  includeProvenance?: "none" | "summary";
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
    projectResolution?: ProjectResolution;
    provenance?: ContextProvenanceSummary;
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
