import { readFile } from "node:fs/promises";

import {
  appendToAnchorSection,
  deleteAnchorSection,
  mergeAnchorFrontmatter,
  replaceAnchorSection,
} from "./anchorPatch.js";
import { buildContextRoot } from "./contextRoot.js";
import {
  buildLoadContextAnchor,
  decodeLoadContextCursor,
  encodeLoadContextCursor,
  jsonByteLength,
  LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS,
  LOAD_CONTEXT_DEFAULT_LIMIT,
  LOAD_CONTEXT_DEFAULT_MAX_BYTES,
  shrinkLoadContextAnchorToFit,
  toNextCursorPayload,
} from "./loadContext.js";
import type { AnchorRepository } from "./git/repo.js";
import { countCompletedRows, parseAnchor } from "./storage/markdown.js";
import type { AnchorCategory } from "./taxonomy.js";
import type {
  AnchorContentMode,
  AnchorMeta,
  AnchorRead,
  AnchorVersion,
  CompactionReport,
  ContextRootFormat,
  ContextRootResult,
  ConflictStatus,
  LoadContextAnchor,
  LoadContextInput,
  LoadContextResult,
  LoadContextSelectionReason,
  SearchHit,
  ValidationViolation,
  WriteAnchorInput,
  WriteAnchorResult,
} from "./types.js";
import { runValidators } from "./validators/pipeline.js";

export class AnchorService {
  constructor(
    private readonly repo: AnchorRepository,
    private readonly options: {
      pushOnWrite: boolean;
      migrationWarnOnly: boolean;
    },
  ) {}

  listAnchors(filter?: {
    project?: string;
    tag?: string;
    since?: string;
    category?: AnchorCategory;
    includeArchive?: boolean;
    runtime?: string;
  }): Promise<AnchorMeta[]> {
    return this.repo.listAnchors(filter);
  }

  readAnchor(name: string, version?: string): Promise<AnchorRead> {
    return this.repo.readAnchor(name, version);
  }

  readAnchorBatch(names: string[]): Promise<AnchorRead[]> {
    return this.repo.readAnchorBatch(names);
  }

  searchAnchors(query: string, scope?: string): Promise<SearchHit[]> {
    return this.repo.searchAnchors(query, scope);
  }

  listVersions(name: string, limit?: number): Promise<AnchorVersion[]> {
    return this.repo.listVersions(name, limit);
  }

  diffAnchor(name: string, fromVersion: string, toVersion: string): Promise<string> {
    return this.repo.diffAnchor(name, fromVersion, toVersion);
  }

  async writeAnchor(input: WriteAnchorInput): Promise<WriteAnchorResult> {
    const resolved = this.repo.resolveAnchor(input.name);
    if (input.expectedFileCommit) {
      const current = await this.repo.lastCommitForFile(resolved.repoRelativePath);
      if (current !== input.expectedFileCommit) {
        return {
          warnings: [
            {
              severity: "BLOCK",
              code: "stale_base",
              message: `Anchor file commit mismatch: expected ${input.expectedFileCommit}, found ${current ?? "none"}. Re-read the anchor and retry.`,
            },
          ],
          requiresApproval: false,
        };
      }
    }
    const oldContent = await this.repo.readRaw(input.name);
    const violations = await runValidators({
      name: resolved.name,
      repoRelativePath: resolved.repoRelativePath,
      oldContent,
      newContent: input.content,
      repo: this.repo,
      migrationWarnOnly: this.options.migrationWarnOnly,
      approved: input.approved ?? false,
    });
    const blocks = violations.filter((violation) => violation.severity === "BLOCK");
    const warnings = violations.filter((violation) => violation.severity === "WARN");

    if (blocks.length > 0) {
      const approvalBlock = blocks.some((violation) => violation.code === "requires_approval");
      return {
        warnings: [...blocks, ...warnings],
        requiresApproval: approvalBlock,
      };
    }

    const version = await this.repo.commitAnchor({
      name: input.name,
      content: input.content,
      message: input.message,
      sectionsChanged: oldContent ? changedSections(oldContent, input.content) : undefined,
      lastValidatedChanged: oldContent ? lastValidatedChanged(oldContent, input.content) : undefined,
      coAuthor: input.coAuthor,
      push: this.options.pushOnWrite,
    });

    return { version, warnings };
  }

  async updateAnchorFrontmatter(input: {
    name: string;
    updates: Record<string, unknown>;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    const oldContent = await this.repo.readRaw(input.name);
    if (oldContent === undefined) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Anchor not found: ${input.name}`,
          },
        ],
      };
    }
    const newContent = mergeAnchorFrontmatter(oldContent, input.updates);
    return this.writeAnchor({
      name: input.name,
      content: newContent,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async updateAnchorSection(input: {
    name: string;
    heading: string;
    content: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => replaceAnchorSection(old, input.heading, input.content),
    });
  }

  async appendToAnchorSection(input: {
    name: string;
    heading: string;
    content: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => appendToAnchorSection(old, input.heading, input.content),
    });
  }

  async deleteAnchorSection(input: {
    name: string;
    heading: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
  }): Promise<WriteAnchorResult> {
    return this.applyAnchorContentPatch({
      name: input.name,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
      mutate: (old) => deleteAnchorSection(old, input.heading),
    });
  }

  private async applyAnchorContentPatch(input: {
    name: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
    expectedFileCommit?: string;
    mutate: (oldContent: string) => string;
  }): Promise<WriteAnchorResult> {
    const oldContent = await this.repo.readRaw(input.name);
    if (oldContent === undefined) {
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "missing_anchor",
            message: `Anchor not found: ${input.name}`,
          },
        ],
      };
    }
    let newContent: string;
    try {
      newContent = input.mutate(oldContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        warnings: [
          {
            severity: "BLOCK",
            code: "section_not_found",
            message,
          },
        ],
      };
    }

    return this.writeAnchor({
      name: input.name,
      content: newContent,
      message: input.message,
      approved: input.approved,
      coAuthor: input.coAuthor,
      expectedFileCommit: input.expectedFileCommit,
    });
  }

  async revertAnchor(name: string, toVersion: string, message?: string): Promise<{ newVersion?: string }> {
    const newVersion = await this.repo.revertAnchor(name, toVersion, message, this.options.pushOnWrite);
    return { newVersion };
  }

  async contextRoot(input: {
    project?: string;
    category?: AnchorCategory;
    tag?: string;
    runtime?: string;
    includeArchive?: boolean;
    format?: ContextRootFormat;
  } = {}): Promise<ContextRootResult> {
    const anchors = await this.repo.listAnchors({
      project: input.project,
      category: input.category,
      tag: input.tag,
      runtime: input.runtime,
      includeArchive: input.includeArchive,
    });

    return buildContextRoot(anchors, { format: input.format });
  }

  /**
   * One-call discovery + multi-anchor read: same index metadata as `contextRoot`, plus anchor bodies
   * (full, excerpt, or none) with byte/limit caps and cursor continuation.
   */
  async loadContext(input: LoadContextInput = {}): Promise<LoadContextResult> {
    const decoded = input.cursor ? decodeLoadContextCursor(input.cursor) : undefined;

    const limit = Math.min(500, Math.max(1, decoded?.limit ?? input.limit ?? LOAD_CONTEXT_DEFAULT_LIMIT));
    const maxBytes = Math.max(1024, decoded?.maxBytes ?? input.maxBytes ?? LOAD_CONTEXT_DEFAULT_MAX_BYTES);
    const includeContent: AnchorContentMode = decoded?.includeContent ?? input.includeContent ?? "excerpt";
    const excerptChars = Math.max(100, decoded?.excerptChars ?? input.excerptChars ?? LOAD_CONTEXT_DEFAULT_EXCERPT_CHARS);
    const format = decoded?.format ?? input.format ?? "both";

    const filter = {
      project: decoded?.filter.project ?? input.project,
      category: decoded?.filter.category ?? input.category,
      tag: decoded?.filter.tag ?? input.tag,
      runtime: decoded?.filter.runtime ?? input.runtime,
      includeArchive: decoded?.filter.includeArchive ?? input.includeArchive ?? false,
    };

    const offset = decoded?.offset ?? 0;

    let selectionReason: LoadContextSelectionReason;
    let orderedNames: string[];

    if (decoded) {
      selectionReason = decoded.selectionReason;
      if (selectionReason === "explicit_names") {
        orderedNames = decoded.explicitNames ?? [];
      } else {
        const metas = await this.repo.listAnchors(filter);
        const ordered = buildContextRoot(metas, { format: "json" });
        orderedNames = ordered.entries.map((entry) => entry.name);
      }
    } else if (input.names && input.names.length > 0) {
      selectionReason = "explicit_names";
      orderedNames = dedupePreserveOrder(input.names.map((name) => this.repo.resolveAnchor(name).name));
    } else {
      selectionReason = "filter";
      const metas = await this.repo.listAnchors(filter);
      const ordered = buildContextRoot(metas, { format: "json" });
      orderedNames = ordered.entries.map((entry) => entry.name);
    }

    const totalMatching = orderedNames.length;

    let entriesMetas: AnchorMeta[];
    if (selectionReason === "explicit_names") {
      const all = await this.repo.listAnchors({});
      const byName = new Map(all.map((meta) => [meta.name, meta]));
      entriesMetas = orderedNames.map((name) => byName.get(name)).filter((meta): meta is AnchorMeta => Boolean(meta));
    } else {
      entriesMetas = await this.repo.listAnchors(filter);
    }

    const root = buildContextRoot(entriesMetas, { format });

    const anchors: LoadContextAnchor[] = [];
    let index = offset;
    let stoppedForBytes = false;

    while (index < orderedNames.length) {
      if (anchors.length >= limit) {
        break;
      }

      const read = await this.readAnchor(orderedNames[index]);
      let row = buildLoadContextAnchor(read, includeContent, excerptChars);
      const trial = [...anchors, row];
      const bytes = jsonByteLength(trial);

      if (bytes > maxBytes && anchors.length > 0) {
        stoppedForBytes = true;
        break;
      }

      if (bytes > maxBytes && anchors.length === 0) {
        row = shrinkLoadContextAnchorToFit(read, includeContent, excerptChars, maxBytes);
      }

      anchors.push(row);
      index += 1;
    }

    const returnedCount = anchors.length;
    const nextOffset = offset + returnedCount;
    const truncated = nextOffset < totalMatching || stoppedForBytes;

    const nextCursor = truncated
      ? encodeLoadContextCursor(
          toNextCursorPayload({
            selectionReason,
            filter,
            explicitNames: selectionReason === "explicit_names" ? orderedNames : undefined,
            offset: nextOffset,
            limit,
            maxBytes,
            includeContent,
            excerptChars,
            format,
          }),
        )
      : undefined;

    return {
      generatedAt: root.generatedAt,
      entries: root.entries,
      markdown: root.markdown,
      anchors,
      truncated,
      nextCursor,
      selectionReason,
      totalMatching,
      returnedCount,
    };
  }

  async writeContextRoot(input: {
    project?: string;
    category?: AnchorCategory;
    tag?: string;
    runtime?: string;
    includeArchive?: boolean;
  } = {}): Promise<{ version?: string; generatedAt: string; path: string }> {
    const root = await this.contextRoot({ ...input, format: "markdown" });
    const markdown = root.markdown ?? "";
    const version = await this.repo.commitGeneratedContextRoot(markdown, this.options.pushOnWrite);

    return {
      version,
      generatedAt: root.generatedAt,
      path: "CONTEXT-ROOT.md",
    };
  }

  conflictStatus(): Promise<ConflictStatus> {
    return this.repo.conflictStatus();
  }

  async compactionReport(scope?: string): Promise<CompactionReport> {
    const anchors = await this.repo.listAnchors();
    const signals: ValidationViolation[] = [];
    const suggestedMoves: string[] = [];

    for (const anchor of anchors) {
      if (scope && !anchor.name.startsWith(scope)) {
        continue;
      }

      const resolved = this.repo.resolveAnchor(anchor.name);
      const content = await readFile(resolved.absolutePath, "utf8");
      const lineCount = content.split(/\r?\n/).length;
      const completedRows = countCompletedRows(content);

      if (anchor.name.toLowerCase().includes("roadmap") && lineCount > 400) {
        signals.push({
          severity: "WARN",
          code: "roadmap_line_count",
          message: `Roadmap ${anchor.name} has ${lineCount} lines.`,
          path: anchor.path,
        });
        suggestedMoves.push(`Compact completed or stale entries in ${anchor.name}.`);
      }

      if (completedRows > 10) {
        signals.push({
          severity: "WARN",
          code: "completed_row_count",
          message: `${anchor.name} has ${completedRows} rows in ## Completed.`,
          path: anchor.path,
        });
        suggestedMoves.push(`Move older completed rows from ${anchor.name} into history or a shipped log.`);
      }
    }

    return { signals, suggestedMoves };
  }
}

function changedSections(oldContent: string, newContent: string): string[] {
  const oldSections = parseAnchor(oldContent).sections;
  const newSections = parseAnchor(newContent).sections;
  const names = new Set([...oldSections.keys(), ...newSections.keys()]);
  return [...names].filter((name) => oldSections.get(name) !== newSections.get(name)).sort();
}

function lastValidatedChanged(oldContent: string, newContent: string): boolean {
  return dateKey(parseAnchor(oldContent).frontmatter.last_validated) !== dateKey(parseAnchor(newContent).frontmatter.last_validated);
}

function dateKey(value: unknown): unknown {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function dedupePreserveOrder(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}
