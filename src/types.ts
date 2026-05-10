export type AnchorFrontmatter = Record<string, unknown>;

export type AnchorMeta = {
  name: string;
  path: string;
  title?: string;
  project?: unknown;
  type?: unknown;
  tags?: unknown;
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

export type ServerConfig = {
  repoPath: string;
  anchorRoot: string;
  autoSync: boolean;
  pushOnWrite: boolean;
  syncIntervalMs: number;
  migrationWarnOnly: boolean;
};

