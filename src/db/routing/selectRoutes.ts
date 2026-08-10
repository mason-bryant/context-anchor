import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { resolveScopeAccess, type WorkspaceRole } from "../access.js";
import type { MatchSignal, RouteCandidate } from "./ranker.js";

/**
 * Route selection (T1). Three signals select routes and no others exist in this redesign:
 * lexical, path mapping, and one hop across `scope_relations`.
 *
 * Selection is deliberately exhaustive and deterministic, and produces *candidates* rather
 * than an order — ranking is a separate, replaceable stage (A3). Membership is resolved
 * after selection and never adds a route.
 */

export type ScopeRow = {
  scope_guid: string;
  scope_slug: string;
  scope_kind: string;
  title: string;
  aliases: string[];
};

export function routeKeyFor(scopeKind: string, scopeSlug: string): string {
  return `scope:${scopeKind}:${scopeSlug}`;
}

/**
 * Lowercased alphanumeric runs of two or more characters. Single characters and punctuation
 * carry no routing signal and would match nearly every scope, and a stopword list is
 * deliberately avoided: it is a tuning knob disguised as a constant, and the ordering
 * design rejects hidden tunables.
 */
export function taskTerms(task: string): string[] {
  return [...new Set(task.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])];
}

/**
 * A scope matches lexically when a task term equals one of its identifying words. Whole-word
 * equality rather than substring containment: "graph" must not match "telegraph", and a
 * substring rule makes short slugs match almost everything.
 */
export function lexicalMatch(scope: ScopeRow, terms: Set<string>): MatchSignal | undefined {
  const candidates: Array<{ source: string; text: string }> = [
    { source: "slug", text: scope.scope_slug },
    { source: "title", text: scope.title },
    ...scope.aliases.map((alias) => ({ source: "alias", text: alias })),
  ];

  for (const candidate of candidates) {
    const words = candidate.text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
    const hit = words.find((word) => terms.has(word));
    if (hit) {
      return {
        kind: "lexical",
        reason: `task term ${JSON.stringify(hit)} matched scope ${candidate.source}`,
      };
    }
  }
  return undefined;
}

/** Posix, no leading slash — the form document paths and path prefixes are both stored in. */
function normalizeReferencedPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Longest matching prefix wins, matching `repository_mappings`' own documented rule. A
 * prefix only matches on a path *segment* boundary, so `app` does not claim `application/`.
 */
export function pathMatch(
  referencedPaths: string[],
  mappings: Array<{ scope_guid: string; repository: string; path_prefix: string }>,
): Map<string, MatchSignal> {
  const byScope = new Map<string, { signal: MatchSignal; length: number }>();

  for (const raw of referencedPaths) {
    const referenced = normalizeReferencedPath(raw);
    let best: { scope_guid: string; prefix: string } | undefined;

    for (const mapping of mappings) {
      const prefix = mapping.path_prefix;
      const matches =
        prefix === "" || referenced === prefix || referenced.startsWith(`${prefix}/`);
      if (!matches) {
        continue;
      }
      if (!best || prefix.length > best.prefix.length) {
        best = { scope_guid: mapping.scope_guid, prefix };
      }
    }

    if (!best) {
      continue;
    }
    const existing = byScope.get(best.scope_guid);
    if (existing && existing.length >= best.prefix.length) {
      continue;
    }
    byScope.set(best.scope_guid, {
      length: best.prefix.length,
      signal: {
        kind: "path-mapping",
        reason:
          best.prefix === ""
            ? `path ${referenced} is in a repository mapped to this scope`
            : `path ${referenced} is under ${best.prefix}, mapped to this scope`,
      },
    });
  }

  return new Map([...byScope].map(([scopeGuid, entry]) => [scopeGuid, entry.signal]));
}

export type SelectionInput = {
  workspaceGuid: string;
  /**
   * Whose permissions apply. Routing reads records, so an unreadable scope must not become
   * a route.
   *
   * Supplied by the facade from the authenticated session, never by the caller: `PlanRequest`
   * omits this field precisely so no caller can name the principal whose permissions apply.
   */
  principalGuid: string;
  /** Resolved alongside principalGuid, not caller-supplied. An owner needs no grant row; a member needs a live one. */
  role: WorkspaceRole;
  task: string;
  referencedPaths?: string[];
};

export async function selectRouteCandidates(
  pool: Pool,
  schemaName: string,
  input: SelectionInput,
): Promise<RouteCandidate[]> {
  // Every live scope, matched in application code rather than SQL. A workspace holds tens
  // of scopes, not millions, and keeping the rule here makes it testable without a database
  // and explainable in `matchReasons` — which is what T8's reader disagrees with.
  const scopes = await pool.query<ScopeRow & { grant_permission: "read" | "write" | null; grant_retired_at: Date | null }>(
    // LEFT JOIN, not JOIN: an owner is entitled to every scope with no grant row at all, so
    // an inner join would silently return nothing for the role that should see everything.
    // Retired grants are excluded here rather than only in application code, so the query
    // scales with live grants instead of with every grant ever issued.
    `SELECT s.scope_guid, s.scope_slug, s.scope_kind, s.title, s.aliases,
            g.permission AS grant_permission, g.retired_at AS grant_retired_at
       FROM "${schemaName}".scopes s
       LEFT JOIN "${schemaName}".scope_grants g
         ON g.workspace_guid = s.workspace_guid
        AND g.scope_guid = s.scope_guid
        AND g.principal_guid = $2
        AND g.retired_at IS NULL
      WHERE s.workspace_guid = $1 AND s.retired_at IS NULL`,
    [input.workspaceGuid, input.principalGuid],
  );

  // Filtered once, here, so every later stage inherits it. The relation hop resolves its
  // target through this map and drops anything absent, which is what stops a hop from
  // offering a parent the caller may not read — a leak that filtering only the lexical and
  // path stages would leave open.
  const byGuid = new Map(
    scopes.rows
      .filter((row) =>
        resolveScopeAccess({
          role: input.role,
          grant: row.grant_permission ? { permission: row.grant_permission, retiredAt: row.grant_retired_at } : null,
          permission: "read",
        }),
      )
      .map((row) => [row.scope_guid, row]),
  );
  const readable = [...byGuid.values()];

  const signals = new Map<string, MatchSignal[]>();
  const add = (scopeGuid: string, signal: MatchSignal) => {
    const existing = signals.get(scopeGuid);
    if (existing) {
      existing.push(signal);
    } else {
      signals.set(scopeGuid, [signal]);
    }
  };

  const terms = new Set(taskTerms(input.task));
  for (const scope of readable) {
    const lexical = lexicalMatch(scope, terms);
    if (lexical) {
      add(scope.scope_guid, lexical);
    }
  }

  if (input.referencedPaths?.length) {
    const mappings = await pool.query<{ scope_guid: string; repository: string; path_prefix: string }>(
      `SELECT scope_guid, repository, path_prefix
         FROM "${schemaName}".repository_mappings
        WHERE workspace_guid = $1 AND retired_at IS NULL`,
      [input.workspaceGuid],
    );
    for (const [scopeGuid, signal] of pathMatch(input.referencedPaths, mappings.rows)) {
      // A mapping can point at a scope this caller cannot read; the path is evidence about
      // the caller's work, not an entitlement to the scope it maps to.
      if (byGuid.has(scopeGuid)) {
        add(scopeGuid, signal);
      }
    }
  }

  // One hop, from scopes matched directly. Computed from the directly matched set rather
  // than iteratively, so a parent's parent is never reached: this is the whole of
  // "proximity" in this redesign, and sibling scopes are deliberately not traversed.
  const directlyMatched = [...signals.keys()];
  if (directlyMatched.length > 0) {
    const parents = await pool.query<{ from_scope_guid: string; to_scope_guid: string }>(
      `SELECT from_scope_guid, to_scope_guid
         FROM "${schemaName}".scope_relations
        WHERE workspace_guid = $1 AND relation_type = 'part_of' AND retired_at IS NULL
          AND from_scope_guid = ANY($2::uuid[])`,
      [input.workspaceGuid, directlyMatched],
    );
    for (const row of parents.rows) {
      // A parent that already matched directly keeps its own stronger signals and gains
      // this one too; the ranker counts distinct kinds, so this cannot inflate a duplicate.
      const child = byGuid.get(row.from_scope_guid);
      add(row.to_scope_guid, {
        kind: "relation-hop",
        reason: `${child?.scope_slug ?? "a matched scope"} is part of this scope`,
      });
    }
  }

  if (signals.size === 0) {
    return [];
  }

  const counts = await recordCounts(pool, schemaName, input.workspaceGuid, [...signals.keys()]);

  return [...signals.entries()].flatMap(([scopeGuid, matched]) => {
    const scope = byGuid.get(scopeGuid);
    // A relation hop can name a retired or otherwise absent parent; a route that cannot be
    // described is not offered rather than offered empty.
    if (!scope) {
      return [];
    }
    return [
      {
        routeKey: routeKeyFor(scope.scope_kind, scope.scope_slug),
        scopeGuid,
        scopeSlug: scope.scope_slug,
        scopeKind: scope.scope_kind,
        title: scope.title,
        signals: matched,
        recordCount: counts.get(scopeGuid) ?? 0,
      },
    ];
  });
}

/** Membership: what a route contains, resolved after selection and never adding a route. */
async function recordCounts(
  pool: Pool,
  schemaName: string,
  workspaceGuid: string,
  scopeGuids: string[],
): Promise<Map<string, number>> {
  const result = await pool.query<{ scope_guid: string; count: string }>(
    `SELECT scope_guid, count(DISTINCT coalesce(stable_key, record_guid::text)) AS count
       FROM "${schemaName}".record_scopes
      WHERE workspace_guid = $1 AND retired_at IS NULL AND scope_guid = ANY($2::uuid[])
      GROUP BY scope_guid`,
    [workspaceGuid, scopeGuids],
  );
  return new Map(result.rows.map((row) => [row.scope_guid, Number(row.count)]));
}

export type RouteRecord = {
  ref:
    | { type: "assertion"; guid: string }
    | { type: "section"; guid: string; documentGuid: string; revisionGuid: string; stableKey: string };
  documentName?: string;
  heading?: string;
  headingLevel?: number;
  content: string;
};

/**
 * The records a route contains, at their current revision.
 *
 * Content is sliced in application code from the revision text rather than with SQL
 * `substring`: the importer recorded offsets as JavaScript string indices, and Postgres
 * counts characters differently for anything outside the BMP, so slicing server-side would
 * silently misalign on emoji or CJK text.
 */
export async function loadRouteRecords(
  pool: Pool,
  schemaName: string,
  workspaceGuid: string,
  scopeGuid: string,
): Promise<RouteRecord[]> {
  const sections = await pool.query<{
    section_guid: string;
    revision_guid: string;
    document_guid: string;
    document_name: string;
    stable_key: string;
    title: string;
    heading_level: number;
    start_offset: number;
    end_offset: number;
    ordinal: number;
  }>(
    // DISTINCT ON keeps one row per stable key, taken from the highest revision number, so a
    // reimported document contributes its current text rather than one row per revision.
    `SELECT DISTINCT ON (ss.stable_key)
            ss.section_guid, ss.revision_guid, dr.document_guid, sd.name AS document_name,
            ss.stable_key, ss.title, ss.heading_level, ss.start_offset, ss.end_offset, ss.ordinal
       FROM "${schemaName}".record_scopes rs
       JOIN "${schemaName}".source_sections ss
         ON ss.workspace_guid = rs.workspace_guid AND ss.stable_key = rs.stable_key
       JOIN "${schemaName}".document_revisions dr
         ON dr.workspace_guid = ss.workspace_guid AND dr.revision_guid = ss.revision_guid
       JOIN "${schemaName}".source_documents sd
         ON sd.workspace_guid = dr.workspace_guid AND sd.document_guid = dr.document_guid
      WHERE rs.workspace_guid = $1 AND rs.scope_guid = $2
        AND rs.retired_at IS NULL AND rs.record_type = 'section'
      ORDER BY ss.stable_key, dr.revision_number DESC`,
    [workspaceGuid, scopeGuid],
  );

  if (sections.rowCount === 0) {
    return [];
  }

  const revisionGuids = [...new Set(sections.rows.map((row) => row.revision_guid))];
  const revisions = await pool.query<{ revision_guid: string; content: string }>(
    `SELECT revision_guid, content FROM "${schemaName}".document_revisions
      WHERE workspace_guid = $1 AND revision_guid = ANY($2::uuid[])`,
    [workspaceGuid, revisionGuids],
  );
  const contentByRevision = new Map(revisions.rows.map((row) => [row.revision_guid, row.content]));

  return sections.rows
    .map((row) => ({
      ref: {
        type: "section" as const,
        guid: row.section_guid,
        documentGuid: row.document_guid,
        revisionGuid: row.revision_guid,
        stableKey: row.stable_key,
      },
      documentName: row.document_name,
      heading: row.title,
      headingLevel: row.heading_level,
      content: (contentByRevision.get(row.revision_guid) ?? "").slice(row.start_offset, row.end_offset),
    }))
    .sort((left, right) => left.ref.stableKey.localeCompare(right.ref.stableKey));
}

/**
 * A route's fingerprint, so a caller holding an earlier response can see exactly which
 * routes moved.
 *
 * Sections contribute `stableKey` plus a hash of their current text, deliberately not their
 * section GUID: that GUID is revision-scoped, so keying on it would report every route
 * containing a reimported document as changed even when its text is byte-identical.
 */
export function contentFingerprint(records: RouteRecord[]): string {
  const hash = createHash("sha256");
  for (const record of [...records].sort((left, right) =>
    fingerprintKey(left).localeCompare(fingerprintKey(right)),
  )) {
    hash.update(fingerprintKey(record));
    hash.update("\0");
    hash.update(createHash("sha256").update(record.content).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 32);
}

function fingerprintKey(record: RouteRecord): string {
  return record.ref.type === "assertion" ? `assertion:${record.ref.guid}` : `section:${record.ref.stableKey}`;
}
