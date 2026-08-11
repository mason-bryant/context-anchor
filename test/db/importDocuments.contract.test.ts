import { randomUUID } from "node:crypto";
import path from "node:path";

import type { Pool } from "pg";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureBootstrap, type BootstrapResult } from "../../src/db/bootstrap.js";
import { CommandHandler } from "../../src/db/commandHandler.js";
import { importDocuments, type ImportFile } from "../../src/db/importDocuments.js";
import { runMigrations } from "../../src/db/migrate.js";
import { isTestDatabaseReachable, TEST_DATABASE_URL } from "./testDatabase.js";

const REAL_MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations/knowledge");

const ROADMAP = `---
project: anchor-mcp
type: project-roadmap
---

# Anchor MCP -- Roadmap

## Goals

### Goal G-041 -- Structured substrate

Substrate text.

### Goal G-042 -- Database-backed redesign

Redesign text.
`;

const MILESTONE = `---
project: anchor-mcp
type: project-milestone
relations:
  goal_ids:
    - G-042
---

# Milestone -- DB Backed

## Current State

Not started.
`;

const PRACTICE = `# PR Review Workflow

## Workflow

Reply inline.
`;

function files(): ImportFile[] {
  return [
    { path: "projects/anchor-mcp/anchor-mcp-roadmap.md", content: ROADMAP },
    { path: "projects/anchor-mcp/milestones/db-backed.md", content: MILESTONE },
    { path: "agent-rules/pr-review-comment-workflow.md", content: PRACTICE },
  ];
}

describe.runIf(await isTestDatabaseReachable())("importDocuments (real Postgres)", () => {
  let pool: Pool;
  let schemaName: string;
  let bootstrap: BootstrapResult;
  let handler: CommandHandler;

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    schemaName = `knowledge_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await runMigrations(pool, { schemaName, migrationsDir: REAL_MIGRATIONS_DIR });
    bootstrap = await ensureBootstrap(pool, { schemaName });
    handler = new CommandHandler(pool, schemaName);
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await pool.end();
  });

  async function goalAssociationCount(stableKeyFragment: string, scopeSlug: string): Promise<number> {
    const result = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM "${schemaName}".record_scopes a
       JOIN "${schemaName}".scopes s ON s.scope_guid = a.scope_guid
       WHERE a.workspace_guid = $1
         AND a.association_type = 'referenced-goal'
         AND a.stable_key LIKE '%' || $2 || '%'
         AND s.scope_slug = $3`,
      [bootstrap.workspaceGuid, stableKeyFragment, scopeSlug],
    );
    return result.rows[0]!.n;
  }

  function runImport(input: { files?: ImportFile[]; commit?: string; retireAbsentUnder?: string[] } = {}) {
    return importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "context-anchor",
      commitSha: input.commit ?? "a".repeat(40),
      files: input.files ?? files(),
      ...(input.retireAbsentUnder ? { retireAbsentUnder: input.retireAbsentUnder } : {}),
    });
  }

  it("imports each file as a document with a revision, sections, and blocks", async () => {
    const report = await runImport();

    expect(report.documentsImported).toBe(3);
    expect(report.revisionsCreated).toBe(3);
    expect(report.sectionsCreated).toBeGreaterThan(0);
    expect(report.blocksCreated).toBeGreaterThan(0);

    const revision = await pool.query<{ content: string; repository: string; commit_sha: string; source_path: string }>(
      `SELECT r.content, r.repository, r.commit_sha, r.source_path
       FROM "${schemaName}".document_revisions r
       JOIN "${schemaName}".source_documents d ON d.document_guid = r.document_guid
       WHERE d.name = $1`,
      ["projects/anchor-mcp/anchor-mcp-roadmap.md"],
    );
    // Byte-complete: the stored content is the file, not a normalization of it.
    expect(revision.rows[0]!.content).toBe(ROADMAP);
    expect(revision.rows[0]!.repository).toBe("context-anchor");
    expect(revision.rows[0]!.commit_sha).toBe("a".repeat(40));
    expect(revision.rows[0]!.source_path).toBe("projects/anchor-mcp/anchor-mcp-roadmap.md");
  });

  it("derives scopes on the fixed mapping and relates them part_of their domain", async () => {
    await runImport();

    const scopes = await pool.query<{ scope_slug: string; scope_kind: string }>(
      `SELECT scope_slug, scope_kind FROM "${schemaName}".scopes WHERE workspace_guid = $1 ORDER BY scope_slug`,
      [bootstrap.workspaceGuid],
    );
    const bySlug = new Map(scopes.rows.map((r) => [r.scope_slug, r.scope_kind]));

    expect(bySlug.get("anchor-mcp")).toBe("domain");
    expect(bySlug.get("anchor-mcp-db-backed")).toBe("initiative");
    expect(bySlug.get("agent-rules")).toBe("practice");

    const relations = await pool.query<{ from_slug: string; to_slug: string; relation_type: string }>(
      `SELECT f.scope_slug AS from_slug, t.scope_slug AS to_slug, r.relation_type
       FROM "${schemaName}".scope_relations r
       JOIN "${schemaName}".scopes f ON f.scope_guid = r.from_scope_guid
       JOIN "${schemaName}".scopes t ON t.scope_guid = r.to_scope_guid
       WHERE r.workspace_guid = $1`,
      [bootstrap.workspaceGuid],
    );
    expect(relations.rows).toContainEqual({
      from_slug: "anchor-mcp-db-backed",
      to_slug: "anchor-mcp",
      relation_type: "part_of",
    });
  });

  /** T2 done-when #1. */
  it("re-running the import with the same commit creates no duplicate revisions", async () => {
    const first = await runImport();
    const second = await runImport();

    expect(first.revisionsCreated).toBe(3);
    expect(second.revisionsCreated).toBe(0);
    expect(second.documentsImported).toBe(0);

    const revisions = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schemaName}".document_revisions WHERE workspace_guid = $1`,
      [bootstrap.workspaceGuid],
    );
    expect(revisions.rows[0]!.n).toBe(3);
  });

  /** T2 done-when #2 — dedupe is against the LATEST revision only, so history is a log. */
  it("a document reverted to earlier content still produces a new revision", async () => {
    await runImport();

    const changed = files().map((file) =>
      file.path.endsWith("anchor-mcp-roadmap.md") ? { ...file, content: `${ROADMAP}\n## Added\n\nNew.\n` } : file,
    );
    await runImport({ files: changed, commit: "b".repeat(40) });

    // Back to the original bytes: a content-set check would call this a no-op.
    const reverted = await runImport({ files: files(), commit: "c".repeat(40) });
    expect(reverted.revisionsCreated).toBe(1);

    const revisions = await pool.query<{ revision_number: number; content: string }>(
      `SELECT r.revision_number, r.content FROM "${schemaName}".document_revisions r
       JOIN "${schemaName}".source_documents d ON d.document_guid = r.document_guid
       WHERE d.name = $1 ORDER BY r.revision_number`,
      ["projects/anchor-mcp/anchor-mcp-roadmap.md"],
    );
    expect(revisions.rows.map((r) => r.revision_number)).toEqual([1, 2, 3]);
    expect(revisions.rows[2]!.content).toBe(ROADMAP);
  });

  /** T2 done-when #4 — the roadmap-goal association that record_scopes exists for. */
  it("makes a roadmap goal section reachable through the initiative scope referencing it", async () => {
    await runImport();

    const associated = await pool.query<{ stable_key: string; scope_slug: string; derived_from_signal: string }>(
      `SELECT a.stable_key, s.scope_slug, a.derived_from_signal
       FROM "${schemaName}".record_scopes a
       JOIN "${schemaName}".scopes s ON s.scope_guid = a.scope_guid
       WHERE a.workspace_guid = $1 AND a.record_type = 'section' AND a.retired_at IS NULL`,
      [bootstrap.workspaceGuid],
    );

    const g042 = associated.rows.filter((row) => row.stable_key.includes("goal-g-042"));
    // Reachable through the milestone's initiative scope, not only its own document's domain.
    expect(g042.map((row) => row.scope_slug)).toContain("anchor-mcp-db-backed");
    expect(g042.map((row) => row.scope_slug)).toContain("anchor-mcp");
    for (const row of g042) {
      expect(row.derived_from_signal, "a derived association must say what derived it").toBeTruthy();
    }

    // G-041 is referenced by no milestone, so it gets no initiative association.
    const g041 = associated.rows.filter((row) => row.stable_key.includes("goal-g-041"));
    expect(g041.map((row) => row.scope_slug)).not.toContain("anchor-mcp-db-backed");
  });

  it("records each association against the real section row it was made from", async () => {
    await runImport();

    const orphaned = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM "${schemaName}".record_scopes a
       WHERE a.workspace_guid = $1
         AND a.record_type = 'section'
         AND NOT EXISTS (
           SELECT 1 FROM "${schemaName}".source_sections s
           WHERE s.workspace_guid = a.workspace_guid AND s.section_guid = a.record_guid
         )`,
      [bootstrap.workspaceGuid],
    );
    // record_guid is provenance, not a live pointer — but it must still name a row that
    // existed, or the audit trail is fiction.
    expect(orphaned.rows[0]!.n, "every association's record_guid must be a real section").toBe(0);

    const matched = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM "${schemaName}".record_scopes a
       JOIN "${schemaName}".source_sections s
         ON s.workspace_guid = a.workspace_guid AND s.section_guid = a.record_guid
       WHERE a.workspace_guid = $1 AND s.stable_key <> a.stable_key`,
      [bootstrap.workspaceGuid],
    );
    expect(matched.rows[0]!.n, "the referenced section must be the one the key names").toBe(0);
  });

  it("does not derive goal associations from goal_ids appearing in body prose", async () => {
    // docs/milestones.md documents the field by showing it, so a whole-file regex would
    // attach that milestone's initiative to goals the document merely talks about.
    const decoy: ImportFile = {
      path: "projects/anchor-mcp/milestones/decoy.md",
      content: [
        "---",
        "project: anchor-mcp",
        "---",
        "",
        "# Milestone -- Decoy",
        "",
        "Example front matter looks like:",
        "",
        "```yaml",
        "relations:",
        "  goal_ids:",
        "    - G-042",
        "```",
        "",
      ].join("\n"),
    };

    await runImport({ files: [...files(), decoy] });

    const decoyAssociations = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schemaName}".record_scopes a
       JOIN "${schemaName}".scopes s ON s.scope_guid = a.scope_guid
       WHERE a.workspace_guid = $1 AND s.scope_slug = 'anchor-mcp-decoy' AND a.association_type = 'referenced-goal'`,
      [bootstrap.workspaceGuid],
    );
    expect(decoyAssociations.rows[0]!.n).toBe(0);
  });

  it("counts only the mappings it actually wrote", async () => {
    const duplicated = {
      repository: "context-anchor",
      pathPrefix: "src/http",
      project: "anchor-mcp",
      name: "http-transport",
    };

    const report = await importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "context-anchor",
      commitSha: "f".repeat(40),
      files: files(),
      projectMappings: [duplicated, duplicated],
    });

    // The report is what an operator reads to decide whether the import did what they meant.
    expect(report.mappingsImported).toBe(1);
  });

  it("records the import as one reversible batch of commands", async () => {
    const report = await runImport();

    expect(report.batchGuid).toBeTruthy();
    const commands = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schemaName}".commands WHERE workspace_guid = $1 AND batch_guid = $2`,
      [bootstrap.workspaceGuid, report.batchGuid],
    );
    expect(commands.rows[0]!.n).toBeGreaterThan(0);
  });

  it("imports project-mappings into repository_mappings with component scopes", async () => {
    await importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "context-anchor",
      commitSha: "d".repeat(40),
      files: files(),
      projectMappings: [
        { repository: "context-anchor", pathPrefix: "src/http", project: "anchor-mcp", name: "http-transport" },
      ],
    });

    const mapping = await pool.query<{ path_prefix: string; scope_slug: string; scope_kind: string }>(
      `SELECT m.path_prefix, s.scope_slug, s.scope_kind
       FROM "${schemaName}".repository_mappings m
       JOIN "${schemaName}".scopes s ON s.scope_guid = m.scope_guid
       WHERE m.workspace_guid = $1`,
      [bootstrap.workspaceGuid],
    );
    expect(mapping.rows[0]).toMatchObject({ path_prefix: "src/http", scope_kind: "component" });

    const relation = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schemaName}".scope_relations r
       JOIN "${schemaName}".scopes f ON f.scope_guid = r.from_scope_guid
       JOIN "${schemaName}".scopes t ON t.scope_guid = r.to_scope_guid
       WHERE f.scope_slug = $1 AND t.scope_slug = $2 AND r.relation_type = 'part_of'`,
      [mapping.rows[0]!.scope_slug, "anchor-mcp"],
    );
    expect(relation.rows[0]!.n, "a component is part_of its project's domain").toBe(1);
  });

  it("imports the people registry into users and user_identities", async () => {
    await importDocuments({
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "context-anchor",
      commitSha: "e".repeat(40),
      files: files(),
      people: [
        { id: "mason", displayName: "Mason Bryant", identities: [{ kind: "email", value: "Mason@Example.com" }, { kind: "slack", value: "@mason" }] },
      ],
    });

    const identities = await pool.query<{ identity_kind: string; value: string; normalized_value: string }>(
      `SELECT identity_kind, value, normalized_value FROM "${schemaName}".user_identities ORDER BY identity_kind`,
    );
    expect(identities.rows.map((r) => r.identity_kind)).toEqual(["email", "slack"]);
    // Normalized for matching, original preserved for display.
    expect(identities.rows[0]!.value).toBe("Mason@Example.com");
    expect(identities.rows[0]!.normalized_value).toBe("mason@example.com");
  });

  it("imports the same person into two workspaces without silently dropping identities", async () => {
    const second = await ensureBootstrap(pool, { schemaName, workspaceSlug: "second-workspace" });
    const people = [
      { id: "mason", displayName: "Mason Bryant", identities: [{ kind: "email", value: "mason@example.com" }] },
    ];

    const common = {
      pool,
      schemaName,
      handler,
      repository: "context-anchor",
      commitSha: "1".repeat(40),
      files: files(),
      people,
    };

    await importDocuments({
      ...common,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
    });
    await importDocuments({
      ...common,
      commitSha: "2".repeat(40),
      workspaceGuid: second.workspaceGuid,
      actorPrincipalGuid: second.ownerPrincipalGuid,
    });

    // A global unique index would have let ON CONFLICT DO NOTHING swallow the second one.
    const identities = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${schemaName}".user_identities
       WHERE identity_kind = 'email' AND normalized_value = 'mason@example.com'`,
    );
    expect(identities.rows[0]!.n).toBe(2);
  });

  it("still rejects a duplicate addressable identity within one workspace", async () => {
    const workspaceGuid = bootstrap.workspaceGuid;
    const userGuid = randomUUID();
    await pool.query(
      `INSERT INTO "${schemaName}".users (user_guid, identity_issuer, identity_subject, display_name)
       VALUES ($1, 'test', $2, 'Dup')`,
      [userGuid, `dup-${userGuid}`],
    );

    const insert = () =>
      pool.query(
        `INSERT INTO "${schemaName}".user_identities
           (identity_guid, user_guid, workspace_guid, identity_kind, value, normalized_value)
         VALUES ($1, $2, $3, 'email', 'dup@example.com', 'dup@example.com')`,
        [randomUUID(), userGuid, workspaceGuid],
      );

    await expect(insert()).resolves.toBeDefined();
    await expect(insert()).rejects.toThrow(/user_identities_workspace_addressable_unique_idx/);
  });

  it("still derives goal associations when the scope-derivation command replays", async () => {
    // Same commit twice: the scopes.derive command hits its idempotency key and returns
    // without running apply, so the in-memory scope cache is never populated. A cache miss
    // must fall back to the database, not be read as "this scope does not exist".
    await runImport();

    const extraRoadmap: ImportFile = {
      path: "projects/anchor-mcp/second-roadmap.md",
      content: ["---", "project: anchor-mcp", "---", "", "# Second", "", "### Goal G-042 -- Also this", "", "Text.", ""].join(
        "\n",
      ),
    };

    await runImport({ files: [...files(), extraRoadmap] });

    const associated = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM "${schemaName}".record_scopes a
       JOIN "${schemaName}".scopes s ON s.scope_guid = a.scope_guid
       WHERE a.workspace_guid = $1
         AND a.association_type = 'referenced-goal'
         AND s.scope_slug = 'anchor-mcp-db-backed'
         AND a.stable_key LIKE 'projects/anchor-mcp/second-roadmap.md#%'`,
      [bootstrap.workspaceGuid],
    );
    expect(associated.rows[0]!.n, "a replayed scope pass must not silently drop associations").toBeGreaterThan(0);
  });

  it("refuses to merge two scope kinds that collide on one slug", async () => {
    await runImport();

    // A component from project-mappings.json colliding with an existing initiative slug
    // would otherwise be silently absorbed into it and mis-route everything hanging off it.
    await expect(
      importDocuments({
        pool,
        schemaName,
        handler,
        workspaceGuid: bootstrap.workspaceGuid,
        actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
        repository: "context-anchor",
        commitSha: "9".repeat(40),
        files: files(),
        projectMappings: [
          { repository: "context-anchor", pathPrefix: "src/x", project: "anchor", name: "mcp-db-backed" },
        ],
      }),
    ).rejects.toThrow(/scope_kind|collide|kind/i);
  });

  it("derives new goal associations for an unchanged document when another file starts referencing it", async () => {
    // Associations come from OTHER files' front matter, so a roadmap's bytes staying
    // identical does not mean its associations are still correct. A later commit adding a
    // milestone that references G-041 must reach the untouched roadmap's goal section.
    const milestoneWithoutG041: ImportFile = {
      path: "projects/anchor-mcp/milestones/db-backed.md",
      content: MILESTONE,
    };
    await runImport({ files: [files()[0]!, milestoneWithoutG041, files()[2]!] });

    const before = await goalAssociationCount("goal-g-041", "anchor-mcp-later");
    expect(before).toBe(0);

    const laterMilestone: ImportFile = {
      path: "projects/anchor-mcp/milestones/later.md",
      content: [
        "---",
        "project: anchor-mcp",
        "relations:",
        "  goal_ids:",
        "    - G-041",
        "---",
        "",
        "# Milestone -- Later",
        "",
      ].join("\n"),
    };

    // The roadmap's bytes are byte-identical to the first import; only the milestone is new.
    await runImport({ files: [...files(), laterMilestone], commit: "7".repeat(40) });

    const after = await goalAssociationCount("goal-g-041", "anchor-mcp-later");
    expect(after, "an unchanged document must still pick up newly-referenced goals").toBeGreaterThan(0);
  });

  it("repoints an existing mapping when a later commit changes it, and reports it as updated", async () => {
    const base = {
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "context-anchor",
      files: files(),
    };

    const first = await importDocuments({
      ...base,
      commitSha: "3".repeat(40),
      projectMappings: [
        { repository: "context-anchor", pathPrefix: "src/http", project: "anchor-mcp", name: "http-transport" },
      ],
    });
    expect(first.mappingsImported).toBe(1);
    expect(first.mappingsUpdated).toBe(0);

    // Same path prefix, different component: the database must describe the commit being
    // imported, not the one that happened to get there first.
    const second = await importDocuments({
      ...base,
      commitSha: "4".repeat(40),
      projectMappings: [
        { repository: "context-anchor", pathPrefix: "src/http", project: "anchor-mcp", name: "http-server" },
      ],
    });
    expect(second.mappingsImported).toBe(0);
    expect(second.mappingsUpdated).toBe(1);

    const mapping = await pool.query<{ scope_slug: string }>(
      `SELECT s.scope_slug FROM "${schemaName}".repository_mappings m
       JOIN "${schemaName}".scopes s ON s.scope_guid = m.scope_guid
       WHERE m.workspace_guid = $1 AND m.path_prefix = 'src/http'`,
      [bootstrap.workspaceGuid],
    );
    expect(mapping.rows).toHaveLength(1);
    expect(mapping.rows[0]!.scope_slug).toBe("anchor-mcp-http-server");
  });

  it("does not report an unchanged mapping as updated", async () => {
    const mappings = [
      { repository: "context-anchor", pathPrefix: "src/http", project: "anchor-mcp", name: "http-transport" },
    ];
    const base = {
      pool,
      schemaName,
      handler,
      workspaceGuid: bootstrap.workspaceGuid,
      actorPrincipalGuid: bootstrap.ownerPrincipalGuid,
      repository: "context-anchor",
      files: files(),
      projectMappings: mappings,
    };

    await importDocuments({ ...base, commitSha: "5".repeat(40) });
    const again = await importDocuments({ ...base, commitSha: "6".repeat(40) });

    expect(again.mappingsImported).toBe(0);
    expect(again.mappingsUpdated, "an identical mapping is neither inserted nor updated").toBe(0);
  });

  it("reads goal ids from relations only, not from per-task ids elsewhere in front matter", async () => {
    // A task's goal_ids say what that task advances; relations.goal_ids say what the
    // milestone covers. Matching the former would attach the initiative to goals the
    // milestone never claimed — and which goals, depending on front-matter key order.
    const taskMilestone: ImportFile = {
      path: "projects/anchor-mcp/milestones/tasky.md",
      content: [
        "---",
        "project: anchor-mcp",
        "relations:",
        "  goal_ids:",
        "    - G-042",
        "tasks:",
        "  - id: T-1",
        "    title: Something",
        "    goal_ids:",
        "      - G-041",
        "---",
        "",
        "# Milestone -- Tasky",
        "",
      ].join("\n"),
    };

    await runImport({ files: [...files(), taskMilestone] });

    // Claimed via relations: associated.
    expect(await goalAssociationCount("goal-g-042", "anchor-mcp-tasky")).toBeGreaterThan(0);
    // Referenced only by a task: not associated.
    expect(await goalAssociationCount("goal-g-041", "anchor-mcp-tasky")).toBe(0);
  });

  // Originally asserted that the assertions table did not exist, which was true until T3
  // created it. That was a proxy for the real invariant, and the proxy expired while the
  // invariant did not: extraction is authoring's job, and an import that quietly minted
  // claims would be inventing knowledge nobody wrote.
  // Import was additive only, so a document deleted from the repository kept routing and
  // the workspace became the union of every commit ever imported rather than the pinned one.
  describe("retiring documents the commit no longer contains", () => {
    const doomed = {
      path: "projects/anchor-mcp/doomed.md",
      content: "---\nproject: anchor-mcp\ntype: context-anchor\n---\n\n# Doomed\n\n## Current State\n\n- Content later deleted.\n",
    };

    const liveDocuments = async () =>
      (
        await pool.query<{ name: string }>(
          `SELECT name FROM "${schemaName}".source_documents WHERE workspace_guid = $1 AND retired_at IS NULL ORDER BY name`,
          [bootstrap.workspaceGuid],
        )
      ).rows.map((row) => row.name);

    it("retires an absent document when the import claims to cover it", async () => {
      await runImport({ files: [...files(), doomed] });
      expect(await liveDocuments()).toContain(doomed.path);

      const report = await runImport({ commit: "b".repeat(40), retireAbsentUnder: [""] });

      expect(report.documentsRetired).toBe(1);
      expect(await liveDocuments()).not.toContain(doomed.path);

      // Attributable on its own terms: the tombstone names the command that made it, not
      // only the batch it happened to share with the rest of the import.
      const tombstone = await pool.query<{ retirement_command_guid: string | null; retirement_reason: string }>(
        `SELECT retirement_command_guid, retirement_reason FROM "${schemaName}".source_documents
          WHERE workspace_guid = $1 AND name = $2`,
        [bootstrap.workspaceGuid, doomed.path],
      );
      expect(tombstone.rows[0]?.retirement_command_guid).not.toBeNull();
      expect(tombstone.rows[0]?.retirement_reason).toContain("b".repeat(40));

      const command = await pool.query(
        `SELECT 1 FROM "${schemaName}".commands
          WHERE workspace_guid = $1 AND command_guid = $2 AND command_type = 'documents.retire_absent'`,
        [bootstrap.workspaceGuid, tombstone.rows[0]!.retirement_command_guid],
      );
      expect(command.rowCount).toBe(1);
    });

    // The safe default: a caller assembling a subset of files must not retire everything
    // else merely by not mentioning it.
    it("retires nothing when the import claims no coverage", async () => {
      await runImport({ files: [...files(), doomed] });

      const report = await runImport({ commit: "b".repeat(40) });

      expect(report.documentsRetired).toBe(0);
      expect(await liveDocuments()).toContain(doomed.path);
    });

    // A claimed prefix is data, not a pattern. "projects%" must retire nothing under
    // projects/, or a stray wildcard silently widens a destructive operation.
    it("treats a claimed prefix as a literal, not a LIKE pattern", async () => {
      await runImport({ files: [...files(), doomed] });

      const report = await runImport({ commit: "b".repeat(40), retireAbsentUnder: ["projects%"] });

      expect(report.documentsRetired).toBe(0);
    });

    // Re-running the same commit with wider coverage must actually widen it, rather than
    // replaying the narrower run and reporting success while retiring nothing.
    it("does not replay a narrower run when coverage is expanded", async () => {
      await runImport({ files: [...files(), doomed] });

      const narrow = await runImport({ commit: "b".repeat(40), retireAbsentUnder: ["agent-rules"] });
      expect(narrow.documentsRetired).toBe(0);

      const wide = await runImport({ commit: "b".repeat(40), retireAbsentUnder: [""] });
      expect(wide.documentsRetired).toBe(1);
    });

    // "projects/" means the same coverage as "projects"; the prefix test appends its own
    // separator, so the trailing form would otherwise match nothing and silently retire
    // nothing.
    it("treats a trailing slash on a claimed prefix as the same coverage", async () => {
      await runImport({ files: [...files(), doomed] });

      const report = await runImport({ commit: "b".repeat(40), retireAbsentUnder: ["projects/"] });

      expect(report.documentsRetired).toBe(1);
    });

    // The worst thing normalization could do: silently promote a narrowing claim into
    // "retire everything". "/" and whitespace all reduce to the empty string, which is the
    // whole-repository claim, so they are refused rather than interpreted.
    it.each(["/", " ", "  ", "///", " projects"])(
      "refuses the claimed prefix %j rather than widening it",
      async (prefix) => {
        await runImport({ files: [...files(), doomed] });

        await expect(runImport({ commit: "b".repeat(40), retireAbsentUnder: [prefix] })).rejects.toThrow(
          /whole repository|whitespace/,
        );
        expect(await liveDocuments()).toContain(doomed.path);
      },
    );

    it("still accepts an explicit empty string as the whole repository", async () => {
      await runImport({ files: [...files(), doomed] });

      const report = await runImport({ commit: "b".repeat(40), retireAbsentUnder: [""] });

      expect(report.documentsRetired).toBe(1);
    });

    it("retires only within the prefixes the import claims", async () => {
      await runImport({ files: [...files(), doomed] });

      const report = await runImport({ commit: "b".repeat(40), retireAbsentUnder: ["agent-rules"] });

      expect(report.documentsRetired).toBe(0);
      expect(await liveDocuments()).toContain(doomed.path);
    });

    // A live association pointing at a retired document would keep the content routing,
    // which is the whole behaviour being fixed.
    it("retires the associations of a retired document", async () => {
      await runImport({ files: [...files(), doomed] });
      await runImport({ commit: "b".repeat(40), retireAbsentUnder: [""] });

      // strpos rather than LIKE: a path containing % or _ would otherwise be treated as a
      // pattern and match unrelated rows.
      const live = await pool.query(
        `SELECT 1 FROM "${schemaName}".record_scopes
          WHERE workspace_guid = $1 AND retired_at IS NULL AND strpos(stable_key, $2) = 1`,
        [bootstrap.workspaceGuid, doomed.path],
      );
      expect(live.rowCount).toBe(0);
    });
  });

  it("extracts nothing into assertions", async () => {
    await runImport();

    // Scoped to this workspace: the schema can hold several, so an unscoped count could
    // fail on unrelated rows or pass while this workspace has some.
    const assertions = await pool.query(`SELECT 1 FROM "${schemaName}".assertions WHERE workspace_guid = $1`, [
      bootstrap.workspaceGuid,
    ]);
    const citations = await pool.query(
      `SELECT 1 FROM "${schemaName}".source_citations WHERE workspace_guid = $1`,
      [bootstrap.workspaceGuid],
    );
    expect(assertions.rowCount).toBe(0);
    expect(citations.rowCount).toBe(0);

    // Every association an import produces is section-level, for the same reason.
    const assertionAssociations = await pool.query(
      `SELECT 1 FROM "${schemaName}".record_scopes WHERE workspace_guid = $1 AND record_type = 'assertion'`,
      [bootstrap.workspaceGuid],
    );
    expect(assertionAssociations.rowCount).toBe(0);
  });
});
