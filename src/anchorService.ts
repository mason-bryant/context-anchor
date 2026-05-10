import { readFile } from "node:fs/promises";

import { buildContextRoot } from "./contextRoot.js";
import type { AnchorRepository } from "./git/repo.js";
import { countCompletedRows, parseAnchor } from "./storage/markdown.js";
import type { AnchorCategory } from "./taxonomy.js";
import type {
  AnchorMeta,
  AnchorRead,
  AnchorVersion,
  CompactionReport,
  ContextRootFormat,
  ContextRootResult,
  ConflictStatus,
  SearchHit,
  ValidationViolation,
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

  async writeAnchor(input: {
    name: string;
    content: string;
    message?: string;
    approved?: boolean;
    coAuthor?: string;
  }): Promise<WriteAnchorResult> {
    const resolved = this.repo.resolveAnchor(input.name);
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
