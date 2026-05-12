import type { AnchorCategory } from "./taxonomy.js";

export type AnchorFrontmatter = Record<string, unknown>;

export type AnchorMeta = {
  name: string;
  path: string;
  category: AnchorCategory;
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

export type CompactionReport = {
  signals: ValidationViolation[];
  suggestedMoves: string[];
};

export type ContextRootFormat = "json" | "markdown" | "both";

export type ContextRootEntry = {
  name: string;
  path: string;
  category: AnchorCategory;
  title?: string;
  projectSlug?: string;
  summary: string;
  read_this_if: string[];
  type?: unknown;
  tags?: unknown;
  project?: unknown;
  last_validated?: unknown;
};

export type ContextRootResult = {
  generatedAt: string;
  entries: ContextRootEntry[];
  markdown?: string;
};

/** How much anchor body to include in `loadContext` results. */
export type AnchorContentMode = "full" | "excerpt" | "none";

/** Input for the combined discovery + multi-anchor read tool (`loadContext`). */
export type LoadContextInput = {
  project?: string;
  category?: AnchorCategory;
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
};

/** Input for a task-aware context bundle planning tool. */
export type PlanContextBundleInput = {
  task: string;
  project?: string;
  category?: AnchorCategory;
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
  category: AnchorCategory;
  title?: string;
  projectSlug?: string;
  summary: string;
  score: number;
  estimatedTokens: number;
  matchedTerms: string[];
  reason: string;
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
  loadContext: {
    names: string[];
    includeContent: "excerpt";
    maxBytes: number;
  };
};

export type ServerConfig = {
  repoPath: string;
  anchorRoot: string;
  autoSync: boolean;
  pushOnWrite: boolean;
  syncIntervalMs: number;
  migrationWarnOnly: boolean;
};
