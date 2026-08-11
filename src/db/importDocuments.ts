import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { CommandHandler, CommandTransaction } from "./commandHandler.js";
import { assertValidSchemaName } from "./config.js";
import { parseMarkdownStructure } from "./markdownStructure.js";
import { deriveScopeForPath, type DerivedScope } from "./scopeDerivation.js";
import type { ScopeDeclaration } from "./scopeRegistry.js";

export type ImportFile = {
  /** Repo-relative path; also the document's name within its scope. */
  path: string;
  content: string;
};

export type ProjectMapping = {
  repository: string;
  pathPrefix: string;
  /** Project slug whose domain scope this component belongs to. */
  project: string;
  name: string;
  webConfig?: Record<string, unknown>;
};

export type PersonIdentity = { kind: string; value: string };
export type Person = { id: string; displayName: string; identities: PersonIdentity[] };

export type ImportReport = {
  batchGuid: string;
  documentsImported: number;
  revisionsCreated: number;
  sectionsCreated: number;
  blocksCreated: number;
  scopesCreated: number;
  relationsCreated: number;
  associationsDerived: number;
  mappingsImported: number;
  /** Existing mappings repointed because the imported commit changed them. */
  mappingsUpdated: number;
  peopleImported: number;
  /** Documents retired because the pinned commit no longer contains them. */
  documentsRetired: number;
  /** Documents a later commit brought back, which retirement would otherwise have made permanent. */
  documentsReinstated: number;
  /** Files whose content matched the latest revision, so nothing was written. */
  unchanged: string[];
};

/** Slug -> resolved scope. Kind is carried so a cache hit is validated like a database hit. */
type ScopeCache = Map<string, { scopeGuid: string; scopeKind: string }>;

export type ImportInput = {
  pool: Pool;
  schemaName: string;
  handler: CommandHandler;
  workspaceGuid: string;
  actorPrincipalGuid: string;
  repository: string;
  commitSha: string;
  files: ImportFile[];
  projectMappings?: ProjectMapping[];
  /** Scope-first declarations (A1). When present these replace deriving scopes from projectMappings. */
  scopes?: ScopeDeclaration[];
  /**
   * Path prefixes this import claims to cover completely. Documents under them that are
   * absent from `files` are retired, because the import is of a pinned commit and a
   * document the commit no longer contains is not part of the workspace it describes.
   *
   * Omitted means the import claims nothing and retires nothing — the safe default, since
   * a caller assembling a subset of files must not be able to retire everything else by
   * saying nothing. `[""]` claims the whole repository, which is what `db import` sends.
   */
  retireAbsentUnder?: string[];
  people?: Person[];
};

const GOAL_HEADING = /\bG-(\d{1,6})\b/;

/**
 * Only `relations.goal_ids` declares which goals a milestone covers. Milestone front matter
 * can carry `goal_ids` in other places too — notably per-task under `tasks:` — and matching
 * those would attribute a milestone's initiative to goals its individual tasks reference
 * rather than the ones the milestone itself claims.
 */
/** The indented lines under `relations:` — YAML block scoping, so sibling keys are excluded. */
const RELATIONS_BLOCK = /^relations:[ \t]*\r?\n((?:[ \t]+.*\r?\n?)*)/m;
const GOAL_IDS_IN_RELATIONS = /goal_ids:\s*((?:\s*-\s*G-\d+\s*)+)/;

/**
 * One-pass bootstrap import of a pinned repository commit (T2).
 *
 * Every write goes through the command handler under a single `batchGuid`, so the whole
 * import is one reversible unit (T6) and each document's revision carries its own audit
 * trail. Nothing is extracted into assertions — that is authoring's job (PR6) — so in the
 * workspace this produces, every routing association is section-level.
 */
export async function importDocuments(input: ImportInput): Promise<ImportReport> {
  assertValidSchemaName(input.schemaName);

  const batchGuid = randomUUID();
  const report: ImportReport = {
    batchGuid,
    documentsImported: 0,
    revisionsCreated: 0,
    sectionsCreated: 0,
    blocksCreated: 0,
    scopesCreated: 0,
    relationsCreated: 0,
    associationsDerived: 0,
    mappingsImported: 0,
    mappingsUpdated: 0,
    peopleImported: 0,
    documentsRetired: 0,
    documentsReinstated: 0,
    unchanged: [],
  };

  const scopeCache: ScopeCache = new Map();
  const ensureScope = (tx: CommandTransaction, derived: DerivedScope) =>
    upsertScope(tx, input, derived, scopeCache, report);

  // Goal id -> initiative slugs referencing it, so a roadmap goal section can associate to
  // the milestone's initiative and not only to its own document's domain.
  const goalReferences = collectGoalReferences(input.files);

  // Every scope is created before any document is imported. Association derivation looks up
  // scopes by slug, and a roadmap listed before the milestone referencing it would otherwise
  // find no initiative to associate to — making the result depend on file order.
  await deriveAllScopes({ input, batchGuid, report, ensureScope });

  for (const file of input.files) {
    await importOneFile({ input, file, batchGuid, report, ensureScope, goalReferences, scopeCache });
  }

  // Scope-first declarations replace deriving scopes from project mappings (A1). Both
  // shapes are accepted while the Git-backed server still reads the same file (T-36), and
  // the declared shape wins when a file carries both.
  if (input.scopes !== undefined) {
    // Presence, not length. An empty array means "the scope model is nothing", which is
    // almost certainly a mistake — and falling back to legacy derivation would hide it,
    // exactly the silent fallback parseScopeDeclarations refuses for an empty `scopes` key.
    if (input.scopes.length === 0) {
      throw new Error("scopes was provided but empty; omit it to derive scopes, or declare at least one.");
    }
    await importScopeDeclarations({ input, batchGuid, report, ensureScope });
  } else if (input.projectMappings?.length) {
    await importProjectMappings({ input, batchGuid, report, ensureScope });
  }

  if (input.retireAbsentUnder?.length) {
    await retireAbsentDocuments({ input, batchGuid, report });
  }

  if (input.people?.length) {
    await importPeople({ input, batchGuid, report });
  }

  return report;
}

/**
 * First pass: create every scope the import will need, so association derivation never
 * depends on the order files happen to arrive in. Domains are created before initiatives so
 * the `part_of` lookup has a parent to find.
 */
async function deriveAllScopes(args: {
  input: ImportInput;
  batchGuid: string;
  report: ImportReport;
  ensureScope: (tx: CommandTransaction, derived: DerivedScope) => Promise<string>;
}): Promise<void> {
  const { input, batchGuid, report, ensureScope } = args;
  const derivations = input.files.map((file) => deriveScopeForPath(file.path));
  const byKind = [
    ...derivations.filter((d) => d.scopeKind === "domain"),
    ...derivations.filter((d) => d.scopeKind !== "domain"),
  ];

  await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "scopes.derive",
    origin: "mcp",
    idempotencyKey: `import:scopes:${input.repository}:${input.commitSha}`,
    batchGuid,
    reason: `derive scopes for ${input.repository} at ${input.commitSha.slice(0, 7)}`,
    entity: { entityType: "scopes", entityGuid: randomUUID() },
    apply: async (tx) => {
      for (const derived of byKind) {
        await ensureScope(tx, derived);
      }
      return {
        resultingValue: { scopesCreated: report.scopesCreated },
        entryType: "scopes.derived",
        ownerScopeGuid: await defaultWorkspaceScopeGuid(tx, input),
      };
    },
  });
}

async function importOneFile(args: {
  input: ImportInput;
  file: ImportFile;
  batchGuid: string;
  report: ImportReport;
  ensureScope: (tx: CommandTransaction, derived: DerivedScope) => Promise<string>;
  goalReferences: Map<string, Set<string>>;
  scopeCache: ScopeCache;
}): Promise<void> {
  const { input, file, batchGuid, report, ensureScope, goalReferences, scopeCache } = args;
  const schema = input.schemaName;
  const derived = deriveScopeForPath(file.path);
  const contentHash = sha256(file.content);

  await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "document.import",
    origin: "mcp",
    // Keyed on (repository, commit, path) rather than on content. Re-importing the same
    // commit replays and writes nothing; a different commit is a new command even when its
    // bytes match an OLDER revision, which is what lets a revert record a new revision
    // instead of being swallowed as a duplicate of the import it reverts to.
    idempotencyKey: `import:${input.repository}:${input.commitSha}:${file.path}`,
    batchGuid,
    reason: `import ${file.path} at ${input.commitSha.slice(0, 7)}`,
    entity: { entityType: "document", entityGuid: documentGuidFor(input, file.path) },
    apply: async (tx) => {
      const scopeGuid = await ensureScope(tx, derived);
      const documentGuid = await upsertDocument(tx, input, file, scopeGuid, report);

      const latest = await tx.query<{ revision_number: number; content_hash: string; revision_guid: string }>(
        `SELECT revision_number, content_hash, revision_guid FROM "${schema}".document_revisions
         WHERE workspace_guid = $1 AND document_guid = $2
         ORDER BY revision_number DESC LIMIT 1`,
        [input.workspaceGuid, documentGuid],
      );

      // Dedupe against the LATEST revision only. A document reverted to earlier content is a
      // real event and gets a new revision; history is a log, not a set of distinct states.
      if (latest.rows[0]?.content_hash === contentHash) {
        report.unchanged.push(file.path);

        // Unchanged bytes do NOT mean unchanged associations: goal associations come from
        // OTHER files' front matter, so a later commit adding a milestone that references a
        // goal must still reach this untouched roadmap's section. Derive against the rows
        // the existing revision already has; ON CONFLICT keeps it idempotent.
        await deriveAssociationsForExistingRevision({
          tx,
          input,
          revisionGuid: latest.rows[0].revision_guid,
          scopeGuid,
          goalReferences,
          scopeCache,
          report,
        });

        return {
          resultingValue: { path: file.path, unchanged: true },
          entryType: "document.unchanged",
          ownerScopeGuid: scopeGuid,
        };
      }

      const revisionNumber = (latest.rows[0]?.revision_number ?? 0) + 1;
      const revisionGuid = randomUUID();

      await tx.query(
        `INSERT INTO "${schema}".document_revisions
           (workspace_guid, revision_guid, document_guid, revision_number, content, content_hash,
            repository, commit_sha, source_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.workspaceGuid,
          revisionGuid,
          documentGuid,
          revisionNumber,
          file.content,
          contentHash,
          input.repository,
          input.commitSha,
          file.path,
        ],
      );
      report.revisionsCreated += 1;

      const structure = parseMarkdownStructure(file.content, { documentName: file.path });
      const sectionGuids = await insertSections(tx, input, revisionGuid, structure.sections, report);
      await insertBlocks(tx, input, revisionGuid, structure.blocks, sectionGuids, report);

      await deriveSectionAssociations({
        tx,
        input,
        file,
        scopeGuid,
        sections: structure.sections,
        sectionGuids,
        goalReferences,
        scopeCache,
        report,
      });

      return {
        resultingValue: { path: file.path, revisionNumber, contentHash, sections: structure.sections.length },
        entryType: "document.imported",
        ownerScopeGuid: scopeGuid,
      };
    },
  });
}

async function upsertScope(
  tx: CommandTransaction,
  input: ImportInput,
  derived: DerivedScope,
  cache: ScopeCache,
  report: ImportReport,
): Promise<string> {
  const cached = cache.get(derived.scopeSlug);
  if (cached) {
    assertScopeKindMatches(derived, cached.scopeKind);
    return cached.scopeGuid;
  }

  const schema = input.schemaName;
  const existing = await tx.query<{ scope_guid: string; scope_kind: string }>(
    `SELECT scope_guid, scope_kind FROM "${schema}".scopes WHERE workspace_guid = $1 AND scope_slug = $2`,
    [input.workspaceGuid, derived.scopeSlug],
  );
  if (existing.rows[0]) {
    // scope_slug is unique per workspace, so two kinds sharing one slug would silently
    // become a single scope and mis-route everything associated with either. Fail loudly:
    // the derivation rules are the thing to fix, not the row.
    assertScopeKindMatches(derived, existing.rows[0].scope_kind);
    cache.set(derived.scopeSlug, { scopeGuid: existing.rows[0].scope_guid, scopeKind: existing.rows[0].scope_kind });
    return existing.rows[0].scope_guid;
  }

  const scopeGuid = randomUUID();
  await tx.query(
    `INSERT INTO "${schema}".scopes (workspace_guid, scope_guid, scope_slug, scope_kind, title)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.workspaceGuid, scopeGuid, derived.scopeSlug, derived.scopeKind, derived.title],
  );
  report.scopesCreated += 1;
  cache.set(derived.scopeSlug, { scopeGuid, scopeKind: derived.scopeKind });

  // An initiative belongs to the domain of its project; the derivation encodes the project
  // as the slug prefix, so the parent is recoverable without re-parsing the path.
  if (derived.scopeKind === "initiative") {
    // relateToDomain finds the parent by longest matching domain slug, so no project slug
    // needs computing here. A split on "-" would be wrong anyway for a dashed project like
    // "anchor-mcp", and was only ever a truthiness check.
    await relateToDomain(tx, input, scopeGuid, derived.scopeSlug, report);
  }

  return scopeGuid;
}

async function relateToDomain(
  tx: CommandTransaction,
  input: ImportInput,
  fromScopeGuid: string,
  fromSlug: string,
  report: ImportReport,
): Promise<void> {
  const schema = input.schemaName;
  // The domain is the longest existing domain slug this scope's slug starts with, so
  // "anchor-mcp-db-backed" finds "anchor-mcp" rather than a hypothetical "anchor".
  const domain = await tx.query<{ scope_guid: string }>(
    // strpos rather than LIKE: scope_slug is unconstrained text, and a component slug comes
    // from project-mappings.json, so a '%' or '_' in one would silently become a wildcard
    // and select the wrong parent.
    `SELECT scope_guid FROM "${schema}".scopes
     WHERE workspace_guid = $1 AND scope_kind = 'domain' AND strpos($2, scope_slug || '-') = 1
     ORDER BY length(scope_slug) DESC LIMIT 1`,
    [input.workspaceGuid, fromSlug],
  );
  const target = domain.rows[0];
  if (!target || target.scope_guid === fromScopeGuid) {
    return;
  }

  const inserted = await tx.query(
    `INSERT INTO "${schema}".scope_relations
       (workspace_guid, relation_guid, from_scope_guid, to_scope_guid, relation_type, derived_from_signal)
     VALUES ($1, $2, $3, $4, 'part_of', 'derived:slug-prefix')
     ON CONFLICT DO NOTHING`,
    [input.workspaceGuid, randomUUID(), fromScopeGuid, target.scope_guid],
  );
  // Count what was written, not what was attempted — a re-import would otherwise report
  // relations it did not create. Same rule as mappingsImported and associationsDerived.
  if (inserted.rowCount && inserted.rowCount > 0) {
    report.relationsCreated += 1;
  }
}

async function upsertDocument(
  tx: CommandTransaction,
  input: ImportInput,
  file: ImportFile,
  scopeGuid: string,
  report: ImportReport,
): Promise<string> {
  const schema = input.schemaName;
  const existing = await tx.query<{ document_guid: string; retired_at: Date | null }>(
    `SELECT document_guid, retired_at FROM "${schema}".source_documents
     WHERE workspace_guid = $1 AND owner_scope_guid = $2 AND name = $3`,
    [input.workspaceGuid, scopeGuid, file.path],
  );

  // A document the commit contains again is not retired, whatever a previous commit said.
  // Retirement made deletion mean something; without this it made it permanent, so a file
  // deleted once could never be restored and would stay unroutable while visibly present in
  // the repository. Its associations are reinstated with it, since they were retired
  // together.
  const reinstated = existing.rows[0];
  if (reinstated?.retired_at) {
    await tx.query(
      `UPDATE "${schema}".source_documents SET
         retired_at = NULL, retired_by_principal_guid = NULL, retirement_reason = NULL,
         retirement_command_guid = NULL, retirement_batch_guid = NULL
       WHERE workspace_guid = $1 AND document_guid = $2`,
      [input.workspaceGuid, reinstated.document_guid],
    );
    await tx.query(
      `UPDATE "${schema}".record_scopes rs SET retired_at = NULL
        WHERE rs.workspace_guid = $1 AND rs.retired_at IS NOT NULL AND rs.record_type = 'section'
          AND EXISTS (
            SELECT 1
              FROM "${schema}".source_sections ss
              JOIN "${schema}".document_revisions dr
                ON dr.workspace_guid = ss.workspace_guid AND dr.revision_guid = ss.revision_guid
             WHERE ss.workspace_guid = rs.workspace_guid
               AND ss.stable_key = rs.stable_key
               AND dr.document_guid = $2
          )`,
      [input.workspaceGuid, reinstated.document_guid],
    );
    report.documentsReinstated += 1;
  }
  if (existing.rows[0]) {
    return existing.rows[0].document_guid;
  }

  const documentGuid = documentGuidFor(input, file.path);
  await tx.query(
    `INSERT INTO "${schema}".source_documents
       (workspace_guid, document_guid, owner_scope_guid, document_type, name, title, locator)
     VALUES ($1, $2, $3, 'markdown', $4, $5, $6)`,
    [input.workspaceGuid, documentGuid, scopeGuid, file.path, file.path, `${input.repository}:${file.path}`],
  );
  report.documentsImported += 1;
  return documentGuid;
}

async function insertSections(
  tx: CommandTransaction,
  input: ImportInput,
  revisionGuid: string,
  sections: ReturnType<typeof parseMarkdownStructure>["sections"],
  report: ImportReport,
): Promise<string[]> {
  const schema = input.schemaName;
  const guids: string[] = sections.map(() => randomUUID());

  for (const section of sections) {
    await tx.query(
      `INSERT INTO "${schema}".source_sections
         (workspace_guid, section_guid, revision_guid, parent_section_guid, heading_level, title, stable_key,
          ordinal, start_offset, end_offset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.workspaceGuid,
        guids[section.ordinal],
        revisionGuid,
        section.parentOrdinal === undefined ? null : guids[section.parentOrdinal],
        section.headingLevel,
        section.title,
        section.stableKey,
        section.ordinal,
        section.startOffset,
        section.endOffset,
      ],
    );
    report.sectionsCreated += 1;
  }

  return guids;
}

async function insertBlocks(
  tx: CommandTransaction,
  input: ImportInput,
  revisionGuid: string,
  blocks: ReturnType<typeof parseMarkdownStructure>["blocks"],
  sectionGuids: string[],
  report: ImportReport,
): Promise<void> {
  const schema = input.schemaName;
  for (const block of blocks) {
    await tx.query(
      `INSERT INTO "${schema}".content_blocks
         (workspace_guid, block_guid, revision_guid, section_guid, block_type, ordinal, raw_content,
          start_offset, end_offset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.workspaceGuid,
        randomUUID(),
        revisionGuid,
        block.sectionOrdinal === undefined ? null : sectionGuids[block.sectionOrdinal],
        block.blockType,
        block.ordinal,
        block.rawContent,
        block.startOffset,
        block.endOffset,
      ],
    );
    report.blocksCreated += 1;
  }
}

/**
 * Every section associates to its document's own scope, and a roadmap goal section
 * additionally associates to the initiative scope of any milestone referencing that goal id.
 * That second association is the whole reason `record_scopes` is typed rather than
 * assertion-only: it routes a section under a scope its document does not belong to.
 */
async function deriveSectionAssociations(args: {
  tx: CommandTransaction;
  input: ImportInput;
  file: ImportFile;
  scopeGuid: string;
  sections: ReturnType<typeof parseMarkdownStructure>["sections"];
  sectionGuids: string[];
  goalReferences: Map<string, Set<string>>;
  scopeCache: ScopeCache;
  report: ImportReport;
}): Promise<void> {
  const { tx, input, scopeGuid, sections, sectionGuids, goalReferences, scopeCache, report } = args;

  for (const section of sections) {
    const sectionGuid = sectionGuids[section.ordinal]!;
    await associate(tx, input, sectionGuid, section.stableKey, scopeGuid, "owning-scope", "derived:document-scope", report);

    const goalId = GOAL_HEADING.exec(section.title);
    if (!goalId) {
      continue;
    }
    const initiatives = goalReferences.get(`G-${goalId[1]}`);
    if (!initiatives) {
      continue;
    }

    for (const initiativeSlug of initiatives) {
      // Normally served from the cache the first pass filled, which is what keeps this from
      // being an N+1. But a miss does NOT mean the scope is absent: when scopes.derive hits
      // its idempotency key and replays, apply never runs and the cache stays empty even
      // though every scope exists. Falling back to the database (memoized) is what stops a
      // replayed import from silently dropping goal associations.
      const initiativeScopeGuid = await resolveScopeGuid(tx, input, scopeCache, initiativeSlug);
      if (initiativeScopeGuid) {
        await associate(
          tx,
          input,
          sectionGuid,
          section.stableKey,
          initiativeScopeGuid,
          "referenced-goal",
          "derived:milestone-goal-ids",
          report,
        );
      }
    }
  }
}

/**
 * Re-derive associations for a document whose bytes did not change, using the sections its
 * existing latest revision already holds. Association inputs are cross-file, so "this file is
 * unchanged" is not the same claim as "this file's associations are unchanged".
 */
async function deriveAssociationsForExistingRevision(args: {
  tx: CommandTransaction;
  input: ImportInput;
  revisionGuid: string;
  scopeGuid: string;
  goalReferences: Map<string, Set<string>>;
  scopeCache: ScopeCache;
  report: ImportReport;
}): Promise<void> {
  const { tx, input, revisionGuid, scopeGuid, goalReferences, scopeCache, report } = args;

  const existing = await tx.query<{ section_guid: string; stable_key: string; title: string }>(
    `SELECT section_guid, stable_key, title FROM "${input.schemaName}".source_sections
     WHERE workspace_guid = $1 AND revision_guid = $2 ORDER BY ordinal`,
    [input.workspaceGuid, revisionGuid],
  );

  for (const row of existing.rows) {
    await associate(tx, input, row.section_guid, row.stable_key, scopeGuid, "owning-scope", "derived:document-scope", report);

    const goalId = GOAL_HEADING.exec(row.title);
    if (!goalId) {
      continue;
    }
    const initiatives = goalReferences.get(`G-${goalId[1]}`);
    if (!initiatives) {
      continue;
    }
    for (const initiativeSlug of initiatives) {
      const initiativeScopeGuid = await resolveScopeGuid(tx, input, scopeCache, initiativeSlug);
      if (initiativeScopeGuid) {
        await associate(
          tx,
          input,
          row.section_guid,
          row.stable_key,
          initiativeScopeGuid,
          "referenced-goal",
          "derived:milestone-goal-ids",
          report,
        );
      }
    }
  }
}

/**
 * Cache-first scope lookup that treats a miss as "not yet loaded" rather than "absent", and
 * memoizes both outcomes so a genuinely missing slug is still only queried once.
 */
async function resolveScopeGuid(
  tx: CommandTransaction,
  input: ImportInput,
  cache: ScopeCache,
  scopeSlug: string,
): Promise<string | undefined> {
  const cached = cache.get(scopeSlug);
  if (cached) {
    return cached.scopeGuid;
  }

  const result = await tx.query<{ scope_guid: string; scope_kind: string }>(
    `SELECT scope_guid, scope_kind FROM "${input.schemaName}".scopes WHERE workspace_guid = $1 AND scope_slug = $2`,
    [input.workspaceGuid, scopeSlug],
  );
  const row = result.rows[0];
  if (row) {
    cache.set(scopeSlug, { scopeGuid: row.scope_guid, scopeKind: row.scope_kind });
  }
  return row?.scope_guid;
}

/** One slug can only ever mean one kind; merging two would mis-route everything under both. */
function assertScopeKindMatches(derived: DerivedScope, existingKind: string): void {
  if (existingKind !== derived.scopeKind) {
    throw new Error(
      `Scope slug ${JSON.stringify(derived.scopeSlug)} already exists as kind ${existingKind}, ` +
        `but was derived as ${derived.scopeKind}. Refusing to merge two scope kinds under one slug.`,
    );
  }
}

async function associate(
  tx: CommandTransaction,
  input: ImportInput,
  sectionGuid: string,
  stableKey: string,
  scopeGuid: string,
  associationType: string,
  signal: string,
  report: ImportReport,
): Promise<void> {
  const result = await tx.query(
    `INSERT INTO "${input.schemaName}".record_scopes
       (workspace_guid, association_guid, record_type, record_guid, stable_key, scope_guid, association_type,
        derived_from_signal)
     VALUES ($1, $2, 'section', $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    // record_guid is the section row this association was made against — provenance, not a
    // live pointer. Resolution goes through stable_key, since section guids are
    // revision-scoped, but recording a fresh uuid here would make the audit trail a lie.
    [input.workspaceGuid, randomUUID(), sectionGuid, stableKey, scopeGuid, associationType, signal],
  );
  if (result.rowCount && result.rowCount > 0) {
    report.associationsDerived += 1;
  }
}

/** The leading `---` delimited block, or undefined when a document has no front matter. */
function extractFrontMatter(content: string): string | undefined {
  if (!content.startsWith("---")) {
    return undefined;
  }
  const closing = content.indexOf("\n---", 3);
  return closing === -1 ? undefined : content.slice(0, closing);
}

/** Milestone front matter is the only place goal ids are declared (verified in PR1 review). */
function collectGoalReferences(files: ImportFile[]): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();

  for (const file of files) {
    const derived = deriveScopeForPath(file.path);
    if (derived.scopeKind !== "initiative") {
      continue;
    }
    // Two levels of scoping, both load-bearing. Front matter only, because `goal_ids:` also
    // appears in body prose and fenced examples (docs/milestones.md documents the field by
    // showing it). Then the `relations:` block only, because other front-matter keys carry
    // goal ids meaning something different — notably per-task ids under `tasks:`, which say
    // what an individual task advances, not what the milestone itself covers.
    const frontMatter = extractFrontMatter(file.content);
    if (!frontMatter) {
      continue;
    }
    const relations = RELATIONS_BLOCK.exec(frontMatter);
    if (!relations) {
      continue;
    }
    const block = GOAL_IDS_IN_RELATIONS.exec(relations[1]!);
    if (!block) {
      continue;
    }
    for (const match of block[1]!.matchAll(/G-\d+/g)) {
      const goalId = match[0];
      const set = references.get(goalId) ?? new Set<string>();
      set.add(derived.scopeSlug);
      references.set(goalId, set);
    }
  }

  return references;
}

/**
 * Imports scope-first declarations: the scope name is the identity, and repositories and
 * path prefixes are locators pointing at it, many-to-one. Runs in two passes so a `partOf`
 * can name a scope declared later in the file.
 */
async function importScopeDeclarations(args: {
  input: ImportInput;
  batchGuid: string;
  report: ImportReport;
  ensureScope: (tx: CommandTransaction, derived: DerivedScope) => Promise<string>;
}): Promise<void> {
  const { input, batchGuid, report, ensureScope } = args;
  const schema = input.schemaName;
  const declarations = input.scopes ?? [];

  await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "scopes.import",
    origin: "mcp",
    // Distinct from `scopes.derive`, which already uses `import:scopes:...`. Two command
    // types sharing an idempotency key is indistinguishable from a duplicate submission, so
    // the second one silently no-ops — which is exactly what happened here first time.
    idempotencyKey: `import:scope-declarations:${input.repository}:${input.commitSha}`,
    batchGuid,
    reason: "import project-mappings.json scopes",
    entity: { entityType: "scopes", entityGuid: randomUUID() },
    apply: async (tx) => {
      const guidBySlug = new Map<string, string>();

      // Pass one: every scope exists before any relation names one.
      for (const declaration of declarations) {
        const scopeGuid = await ensureScope(tx, {
          scopeKind: declaration.kind,
          scopeSlug: declaration.scope,
          title: declaration.title,
          derivedFromSignal: "project-mappings.json:scopes",
        });
        guidBySlug.set(declaration.scope, scopeGuid);

        // ensureScope only writes title on insert and returns early for a slug that already
        // exists — including one deriveAllScopes created moments ago in this same import,
        // which runs first. Without this, a declared title is silently discarded for every
        // scope derivation also produces, and the derived slug-ish title wins.
        //
        // Aliases are set here for the same reason and unconditionally: the declaration is
        // authoritative, so an alias removed from the registry has to disappear, which a
        // `length` guard would prevent. IS DISTINCT FROM keeps an unchanged declaration
        // from rewriting the row, so re-import stays a genuine no-op.
        await tx.query(
          `UPDATE "${schema}".scopes SET title = $3, aliases = $4
           WHERE workspace_guid = $1 AND scope_guid = $2
             AND (title IS DISTINCT FROM $3 OR aliases IS DISTINCT FROM $4)`,
          [input.workspaceGuid, scopeGuid, declaration.title, declaration.aliases ?? []],
        );
      }

      // Pass two: relations and locators.
      for (const declaration of declarations) {
        const scopeGuid = guidBySlug.get(declaration.scope);
        if (scopeGuid === undefined) {
          continue;
        }

        const parentGuid =
          declaration.partOf === undefined ? undefined : guidBySlug.get(declaration.partOf);

        // The declaration is authoritative and allows exactly one parent, so a `partOf`
        // that changed or was removed must retire the edge it replaced. Without this the
        // old edge stays live and the scope ends up with two parents — a state the
        // declaration model cannot express but the table can hold.
        //
        // Scoped to relations this code owns: a `derived:slug-prefix` edge comes from a
        // different mechanism and is not ours to retire.
        await tx.query(
          `UPDATE "${schema}".scope_relations SET retired_at = now()
           WHERE workspace_guid = $1 AND from_scope_guid = $2 AND relation_type = 'part_of'
             AND derived_from_signal = 'declared:project-mappings.json' AND retired_at IS NULL
             AND ($3::uuid IS NULL OR to_scope_guid <> $3)`,
          [input.workspaceGuid, scopeGuid, parentGuid ?? null],
        );

        // The registry parser already proved this resolves, so a miss here means the
        // parent exists only in the database — not something to invent a relation for.
        if (parentGuid !== undefined && parentGuid !== scopeGuid) {
          const related = await tx.query(
            `INSERT INTO "${schema}".scope_relations
               (workspace_guid, relation_guid, from_scope_guid, to_scope_guid, relation_type, derived_from_signal)
             VALUES ($1, $2, $3, $4, 'part_of', 'declared:project-mappings.json')
             ON CONFLICT DO NOTHING`,
            [input.workspaceGuid, randomUUID(), scopeGuid, parentGuid],
          );
          if (related.rowCount && related.rowCount > 0) {
            report.relationsCreated += 1;
          }
        }

        for (const locator of declaration.locators) {
          const inserted = await tx.query<{ inserted: boolean }>(
            `INSERT INTO "${schema}".repository_mappings
               (workspace_guid, mapping_guid, scope_guid, repository, path_prefix, web_config)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (workspace_guid, repository, path_prefix) WHERE retired_at IS NULL
             DO UPDATE SET scope_guid = EXCLUDED.scope_guid, web_config = EXCLUDED.web_config
             WHERE repository_mappings.scope_guid IS DISTINCT FROM EXCLUDED.scope_guid
                OR repository_mappings.web_config IS DISTINCT FROM EXCLUDED.web_config
             RETURNING (xmax = 0) AS inserted`,
            [
              input.workspaceGuid,
              randomUUID(),
              scopeGuid,
              locator.repository,
              locator.pathPrefix,
              locator.webConfig ? JSON.stringify(locator.webConfig) : null,
            ],
          );
          const row = inserted.rows[0];
          if (row?.inserted === true) {
            report.mappingsImported += 1;
          } else if (row?.inserted === false) {
            report.mappingsUpdated += 1;
          }
        }
      }

      return {
        resultingValue: { scopes: declarations.length },
        entryType: "scopes.imported",
        ownerScopeGuid: await defaultWorkspaceScopeGuid(tx, input),
      };
    },
  });
}

async function importProjectMappings(args: {
  input: ImportInput;
  batchGuid: string;
  report: ImportReport;
  ensureScope: (tx: CommandTransaction, derived: DerivedScope) => Promise<string>;
}): Promise<void> {
  const { input, batchGuid, report, ensureScope } = args;
  const schema = input.schemaName;

  await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "repository_mappings.import",
    origin: "mcp",
    idempotencyKey: `import:mappings:${input.repository}:${input.commitSha}`,
    batchGuid,
    reason: "import project-mappings.json",
    entity: { entityType: "repository_mappings", entityGuid: randomUUID() },
    apply: async (tx) => {
      for (const mapping of input.projectMappings ?? []) {
        const scopeGuid = await ensureScope(tx, {
          scopeKind: "component",
          scopeSlug: `${mapping.project}-${mapping.name}`,
          title: mapping.name,
          derivedFromSignal: "project-mappings.json",
        });

        // Upsert rather than DO NOTHING: a later commit can legitimately repoint a path
        // prefix at a different component or change its web_config, and ignoring that would
        // leave the database describing a commit that is no longer the one imported. The
        // DO UPDATE is guarded so an unchanged mapping is not rewritten, and `xmax = 0`
        // distinguishes a genuine insert from an update for the report.
        const inserted = await tx.query<{ inserted: boolean }>(
          `INSERT INTO "${schema}".repository_mappings
             (workspace_guid, mapping_guid, scope_guid, repository, path_prefix, web_config)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_guid, repository, path_prefix) WHERE retired_at IS NULL
           DO UPDATE SET scope_guid = EXCLUDED.scope_guid, web_config = EXCLUDED.web_config
           WHERE repository_mappings.scope_guid IS DISTINCT FROM EXCLUDED.scope_guid
              OR repository_mappings.web_config IS DISTINCT FROM EXCLUDED.web_config
           RETURNING (xmax = 0) AS inserted`,
          [
            input.workspaceGuid,
            randomUUID(),
            scopeGuid,
            mapping.repository,
            mapping.pathPrefix,
            mapping.webConfig ? JSON.stringify(mapping.webConfig) : null,
          ],
        );
        // Count what was actually written, not what was offered: a duplicate mapping in the
        // input would otherwise inflate the report the operator reads. Inserts and updates
        // are reported separately, since "3 mappings imported" reads very differently from
        // "3 mappings repointed".
        const row = inserted.rows[0];
        if (row?.inserted === true) {
          report.mappingsImported += 1;
        } else if (row?.inserted === false) {
          report.mappingsUpdated += 1;
        }

        await relateToDomain(tx, input, scopeGuid, `${mapping.project}-${mapping.name}`, report);
      }

      return {
        resultingValue: { mappings: input.projectMappings?.length ?? 0 },
        entryType: "repository_mappings.imported",
        ownerScopeGuid: await defaultWorkspaceScopeGuid(tx, input),
      };
    },
  });
}

/**
 * Normalizes claimed coverage, and refuses anything that only accidentally means
 * "everything".
 *
 * A trailing slash is the same claim without one, but the prefix test appends its own
 * separator, so "agent-rules/" would match nothing and retire nothing while reporting
 * success. Distinct spellings would also hash to distinct idempotency keys for identical
 * coverage.
 *
 * The whole-repository claim is spelled `""` and nothing else. "/", " ", and "///" all
 * reduce to the empty string, and silently promoting any of them to "retire everything
 * absent" is the worst thing this function could do — a caller narrowing a destructive
 * operation would instead widen it to the entire workspace. Those are rejected rather
 * than interpreted.
 */
export function normalizeClaimedPrefixes(claimed: string[]): string[] {
  const normalized = claimed.map((raw) => {
    if (raw === "") {
      return "";
    }
    if (raw !== raw.trim()) {
      throw new Error(
        `Claimed prefix ${JSON.stringify(raw)} has surrounding whitespace. Retirement is destructive, ` +
          `so a prefix is taken literally rather than repaired.`,
      );
    }
    const stripped = raw.replace(/\/+$/, "");
    if (stripped === "") {
      throw new Error(
        `Claimed prefix ${JSON.stringify(raw)} reduces to the whole repository. If that is intended, ` +
          `pass "" explicitly; it is not inferred from a value that merely collapses to it.`,
      );
    }
    return stripped;
  });

  return [...new Set(normalized)];
}

/**
 * Retires documents the pinned commit no longer contains.
 *
 * Import was additive only, so a document deleted from the repository kept routing forever
 * and the workspace became the union of every commit ever imported rather than the one it
 * names. Retirement is scoped to the prefixes the caller claims to cover, so a partial
 * import cannot retire what it never looked at.
 */
async function retireAbsentDocuments(args: {
  input: ImportInput;
  batchGuid: string;
  report: ImportReport;
}): Promise<void> {
  const { input, batchGuid, report } = args;
  const schema = input.schemaName;
  const prefixes = normalizeClaimedPrefixes(input.retireAbsentUnder ?? []);
  const present = input.files.map((file) => file.path);

  await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "documents.retire_absent",
    origin: "mcp",
    // The claimed coverage is part of what this command does, so it belongs in the key.
    // Without it, re-running the same commit with wider coverage replays the narrower run
    // and silently retires nothing — the same silent no-op an idempotency-key collision
    // produced once already in this importer.
    idempotencyKey: `import:retire:${input.repository}:${input.commitSha}:${createHash("sha256")
      .update([...prefixes].sort().join("\u0000"))
      .digest("hex")
      .slice(0, 16)}`,
    batchGuid,
    reason: `retire documents absent from ${input.commitSha}`,
    entity: { entityType: "source_documents", entityGuid: randomUUID() },
    apply: async (tx, commandGuid) => {
      // Retired in the same batch as the rest of the import, so a mistaken import is undone
      // as one unit rather than leaving retirements behind.
      const retired = await tx.query<{ document_guid: string; name: string }>(
        `UPDATE "${schema}".source_documents SET
           retired_at = now(),
           retired_by_principal_guid = $2,
           retirement_reason = $5,
           retirement_batch_guid = $6,
           -- Names the command that retired it, so a tombstone is traceable without
           -- joining through the batch it happened to share.
           retirement_command_guid = $7
         WHERE workspace_guid = $1
           AND retired_at IS NULL
           AND NOT (name = ANY($3::text[]))
           AND EXISTS (
             -- strpos, not LIKE: % and _ are wildcards there, and a claimed prefix
             -- containing either would retire documents outside the directory it named.
             -- Deciding what to retire is the last place to accept pattern semantics by
             -- accident.
             SELECT 1 FROM unnest($4::text[]) AS prefix
              WHERE prefix = '' OR name = prefix OR strpos(name, prefix || '/') = 1
           )
         RETURNING document_guid, name`,
        [
          input.workspaceGuid,
          input.actorPrincipalGuid,
          present,
          prefixes,
          `absent from ${input.repository}@${input.commitSha}`,
          batchGuid,
          commandGuid,
        ],
      );
      report.documentsRetired += retired.rowCount ?? 0;

      // Associations go with them: a live association pointing at a retired document would
      // keep the content routing, which is the behaviour being fixed.
      if (retired.rowCount && retired.rowCount > 0) {
        await tx.query(
          `UPDATE "${schema}".record_scopes rs SET retired_at = now()
            WHERE rs.workspace_guid = $1 AND rs.retired_at IS NULL AND rs.record_type = 'section'
              AND EXISTS (
                SELECT 1
                  FROM "${schema}".source_sections ss
                  JOIN "${schema}".document_revisions dr
                    ON dr.workspace_guid = ss.workspace_guid AND dr.revision_guid = ss.revision_guid
                 WHERE ss.workspace_guid = rs.workspace_guid
                   AND ss.stable_key = rs.stable_key
                   AND dr.document_guid = ANY($2::uuid[])
              )`,
          [input.workspaceGuid, retired.rows.map((row) => row.document_guid)],
        );
      }

      return {
        resultingValue: { retired: retired.rows.map((row) => row.name) },
        entryType: "documents.retired",
        ownerScopeGuid: await defaultWorkspaceScopeGuid(tx, input),
      };
    },
  });
}

async function importPeople(args: { input: ImportInput; batchGuid: string; report: ImportReport }): Promise<void> {
  const { input, batchGuid, report } = args;
  const schema = input.schemaName;

  await input.handler.execute({
    workspaceGuid: input.workspaceGuid,
    actorPrincipalGuid: input.actorPrincipalGuid,
    commandType: "people.import",
    origin: "mcp",
    idempotencyKey: `import:people:${input.repository}:${input.commitSha}`,
    batchGuid,
    reason: "import people registry",
    entity: { entityType: "people", entityGuid: randomUUID() },
    apply: async (tx) => {
      for (const person of input.people ?? []) {
        const existing = await tx.query<{ user_guid: string }>(
          `SELECT user_guid FROM "${schema}".users WHERE identity_issuer = 'people-registry' AND identity_subject = $1`,
          [person.id],
        );

        const userGuid = existing.rows[0]?.user_guid ?? randomUUID();
        if (!existing.rows[0]) {
          await tx.query(
            `INSERT INTO "${schema}".users (user_guid, identity_issuer, identity_subject, display_name)
             VALUES ($1, 'people-registry', $2, $3)`,
            [userGuid, person.id, person.displayName],
          );
          report.peopleImported += 1;
        }

        for (const identity of person.identities) {
          await tx.query(
            `INSERT INTO "${schema}".user_identities
               (identity_guid, user_guid, workspace_guid, identity_kind, value, normalized_value)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              userGuid,
              input.workspaceGuid,
              identity.kind,
              identity.value,
              // Normalized for matching; the original is kept for display.
              identity.value.trim().toLowerCase(),
            ],
          );
        }
      }

      return {
        resultingValue: { people: input.people?.length ?? 0 },
        entryType: "people.imported",
        ownerScopeGuid: await defaultWorkspaceScopeGuid(tx, input),
      };
    },
  });
}

/**
 * Workspace-level imports (mappings, people) have no document scope of their own, so their
 * history lands on the default workspace scope rather than being orphaned out of T4's view.
 */
async function defaultWorkspaceScopeGuid(tx: CommandTransaction, input: ImportInput): Promise<string> {
  const result = await tx.query<{ scope_guid: string }>(
    `SELECT scope_guid FROM "${input.schemaName}".scopes
     WHERE workspace_guid = $1 AND scope_kind = 'workspace'
     ORDER BY scope_slug LIMIT 1`,
    [input.workspaceGuid],
  );
  const scopeGuid = result.rows[0]?.scope_guid;
  if (!scopeGuid) {
    throw new Error("No workspace scope exists; bootstrap must run before import.");
  }
  return scopeGuid;
}

/** Deterministic per (workspace, repository, path), so a re-import addresses the same row. */
function documentGuidFor(input: ImportInput, filePath: string): string {
  const digest = createHash("sha256")
    .update(`${input.workspaceGuid}:${input.repository}:${filePath}`)
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    // Version 4 nibble and RFC-4122 variant bits, so the value is a well-formed uuid.
    `4${digest.slice(13, 16)}`,
    `${((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
