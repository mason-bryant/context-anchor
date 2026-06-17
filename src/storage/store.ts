import type { AnchorCategory } from "../taxonomy.js";
import type {
  AnchorMeta,
  AnchorRead,
  AnchorVersion,
  ConflictStatus,
  SearchHit,
} from "../types.js";

export type ResolvedAnchorPath = {
  name: string;
  absolutePath: string;
  repoRelativePath: string;
  anchorRelativePath: string;
};

export type AnchorListSort = "name" | "updated" | "created" | "priority";

export type AnchorListPage = {
  anchors: AnchorMeta[];
  offset: number;
  limit?: number;
  total?: number;
  nextOffset?: number;
};

export type AnchorListFilter = {
  project?: string;
  tag?: string;
  since?: string;
  category?: AnchorCategory;
  includeArchive?: boolean;
  runtime?: string;
};

export type CommitAnchorInput = {
  name: string;
  content: string;
  message?: string;
  action?: "write" | "revert";
  sectionsChanged?: string[];
  lastValidatedChanged?: boolean;
  coAuthor?: string;
  push?: boolean;
};

export type DeleteAnchorFileInput = {
  name: string;
  message?: string;
  coAuthor?: string;
  push?: boolean;
};

export type RenameAnchorFileInput = {
  from: string;
  to: string;
  message?: string;
  coAuthor?: string;
  push?: boolean;
};

export type WritePeopleRegistryOptions = {
  message?: string;
  coAuthor?: string;
  push?: boolean;
  expectedFileCommit?: string;
};

export interface AnchorStore {
  readonly repoPath: string;
  readonly anchorRoot: string;
  readonly anchorRootPath: string;

  ensureReady(): Promise<void>;
  resolveAnchor(name: string): ResolvedAnchorPath;

  listAnchors(filter?: AnchorListFilter): Promise<AnchorMeta[]>;
  listAnchorsPage(
    filter: AnchorListFilter | undefined,
    page: { sort: AnchorListSort; offset?: number; limit?: number },
  ): Promise<AnchorListPage>;
  readAnchor(name: string, version?: string): Promise<AnchorRead>;
  readAnchorBatch(names: string[]): Promise<AnchorRead[]>;
  searchAnchors(query: string, scope?: string): Promise<SearchHit[]>;

  commitAnchor(input: CommitAnchorInput): Promise<string | undefined>;
  commitGeneratedContextRoot(content: string, push?: boolean): Promise<string | undefined>;
  deleteAnchorFile(input: DeleteAnchorFileInput): Promise<string | undefined>;
  renameAnchorFile(input: RenameAnchorFileInput): Promise<string | undefined>;
  revertAnchor(name: string, toVersion: string, message?: string, push?: boolean): Promise<string | undefined>;

  listVersions(name: string, limit?: number): Promise<AnchorVersion[]>;
  diffAnchor(name: string, fromVersion: string, toVersion: string): Promise<string>;
  conflictStatus(): Promise<ConflictStatus>;
  currentVersion(): Promise<string>;
  lastRevisionForPath(repoRelativePath: string): Promise<string | undefined>;

  hasFile(anchorName: string): Promise<boolean>;
  readRaw(anchorName: string): Promise<string | undefined>;

  peopleRegistryCommit(): Promise<string | undefined>;
  readPeopleRegistryRaw(): Promise<unknown>;
  writePeopleRegistryRaw(registry: unknown, options?: WritePeopleRegistryOptions): Promise<void>;
}

export interface SyncableAnchorStore {
  readonly repoPath: string;
  conflictStatus(): Promise<ConflictStatus>;
  currentUpstream(): Promise<string | undefined>;
  pullRebase(): Promise<void>;
}
