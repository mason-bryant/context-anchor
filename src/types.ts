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
  version?: string;
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

export type ServerConfig = {
  repoPath: string;
  anchorRoot: string;
  autoSync: boolean;
  pushOnWrite: boolean;
  syncIntervalMs: number;
  migrationWarnOnly: boolean;
};
