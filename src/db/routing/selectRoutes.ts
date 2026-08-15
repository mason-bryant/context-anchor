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
 * Words that carry no topical meaning in a heading.
 *
 * `taskTerms` deliberately applies no stopword list — for scope-name matching it does not need
 * one, because a scope is not called "and" and whole-word equality against a slug makes a
 * function word harmless. Matching against every heading in the workspace is a different
 * problem: a corpus run found **50 of 118 added routes came from a single stopword**, with "and"
 * alone reaching 15 of 23 scopes. Filtering here rather than in `taskTerms` keeps the baseline
 * this signal is measured against unchanged.
 *
 * Function words only. An earlier version also listed the verbs that scaffold task phrasing
 * ("add X", "run Y", "get Z") and the question words, and measured better for it — 53 added
 * routes across the corpus against 74 here. It was cut anyway, because those words demonstrably
 * head real content: this very workspace holds "Why", "When to fall back to `cde local test`",
 * "New Markdown Notes" and "MANDATORY: Use the Hot Test Daemon MCP". Filtering them silently
 * removes a route nobody can see was removed, while leaving them in produces noise a reader can
 * see and discount — the per-term counts in the reason make a stopword hit obvious. Between a
 * quiet loss and a visible cost, take the visible one.
 *
 * A word that is common in *this corpus* but topical anywhere — "milestone", which heads every
 * milestone document — is not a stopword and is not handled here. That needs a frequency rule
 * measured over the workspace, which is deliberately not in this change.
 */
const RECORD_LEXICAL_STOPWORDS = new Set([
  "the", "and", "or", "not", "but", "for", "of", "to", "in", "on", "at", "by", "with", "from",
  "as", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these",
  // No single-letter entries: both the task and the heading tokenize on [a-z0-9]{2,}, so "a"
  // could never arrive here and listing it would imply single letters are part of the model.
  "those", "an", "we", "our", "you", "your", "they", "their", "into", "about", "after",
  "before", "then", "than", "so", "if", "all", "any", "some", "more", "most",
]);

/** How many matched titles a record-lexical reason quotes before summarising the remainder. */
export const RECORD_LEXICAL_EXAMPLES = 3;

/**
 * The sentence a person reads to decide whether a record-lexical route belongs.
 *
 * Most offered routes are listed rather than expanded and carry no records at all, so this is
 * the entire evidence for them. Each term therefore carries its own count.
 *
 * Stopwords no longer reach here, but ubiquitous topical words still do — a bare union of terms
 * lets a scope that matched one relevant heading and four on a common word render as five-term
 * evidence. The per-term breakdown is what makes that visible, and it is what exposed the
 * stopword problem in the first place: before it, `task term "the" matched section title in this
 * scope` and a genuine match were indistinguishable in the pane.
 *
 * And the examples are drawn from the titles reached by the *rarest* term first, not
 * alphabetically. Alphabetical order filled the quoted examples with stopword matches, so the
 * three titles offered to check the count against were the three least likely to justify it.
 * A term matching one title discriminates; a term matching every title does not.
 *
 * Titles and terms are otherwise sorted so the same workspace and task always produce the same
 * sentence: the reason is stored in telemetry and compared across runs.
 *
 * The article is omitted rather than chosen, because `source` is either "assertion" or
 * "section" and a fixed article is wrong for one of them.
 */
export function recordLexicalReason(group: {
  termTitles: Map<string, Set<string>>;
  source: string;
  titles: string[];
}): string {
  const distinct = [...new Set(group.titles)];
  const occurrences = group.titles.length;

  // Rarest first, so the most discriminating evidence leads; ties broken alphabetically to keep
  // the sentence stable.
  const terms = [...group.termTitles.entries()].sort(
    (a, b) => a[1].size - b[1].size || a[0].localeCompare(b[0]),
  );
  // Per-term counts only when there is more than one term. With a single term the count merely
  // restates the title count already in the sentence, and the point of the breakdown is to show
  // how the total divides -- there is nothing to divide.
  const termList =
    terms.length === 1
      ? JSON.stringify(terms[0]![0])
      : terms.map(([term, titles]) => `${JSON.stringify(term)} (${String(titles.size)})`).join(", ");
  const label = terms.length === 1 ? "task term" : "task terms";

  // A title's rank is the smallest number of titles any of its matching terms reached: a title
  // found via a rare term is better evidence than one found only via a common one.
  const rank = (title: string) => {
    let best = Number.MAX_SAFE_INTEGER;
    for (const [, titles] of terms) {
      if (titles.has(title)) {
        best = Math.min(best, titles.size);
      }
    }
    return best;
  };
  const ordered = [...distinct].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const shown = ordered.slice(0, RECORD_LEXICAL_EXAMPLES).map((title) => JSON.stringify(title)).join(", ");

  if (distinct.length === 1) {
    // Said outright, because a heading repeated across a scope's documents is the signature of a
    // template rather than of a topic, and that is what the reader most needs to notice.
    return occurrences === 1
      ? `${label} ${termList} matched ${group.source} title ${shown} in this scope`
      : `${label} ${termList} matched the same ${group.source} title ${shown} in ${String(occurrences)} ${group.source}s of this scope`;
  }

  const remainder = distinct.length - Math.min(RECORD_LEXICAL_EXAMPLES, distinct.length);
  return (
    `${label} ${termList} matched ${String(distinct.length)} distinct ${group.source} titles` +
    (occurrences > distinct.length ? ` across ${String(occurrences)} ${group.source}s` : "") +
    `: ${shown}` +
    (remainder > 0 ? ` (+${String(remainder)} more)` : "")
  );
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
  /**
   * Off by default (T-46). Matches task terms against assertion titles and section headings so
   * ordinary phrasing can reach a scope at all; flagged because it adds a signal kind, and tier
   * 1 of the ranking rule counts distinct kinds, so enabling it changes existing orderings.
   */
  recordLexical?: boolean;
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
  // `grant_retired_at` is always null here, because the join already excluded retired
  // grants — and it is passed anyway, deliberately. resolveScopeAccess is the single tested
  // source of truth for deny-by-default and "write implies read", and it stays complete on
  // its own rather than depending on its caller's WHERE clause: a future caller that forgets
  // the predicate must still be denied. listGrantedScopes made the same choice for the same
  // reason. The SQL predicate is a performance narrowing, not the policy.
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

  // Nothing below can produce a candidate when no scope is readable: every producer routes
  // through add(), which drops any scope absent from byGuid. Returning here skips whichever
  // producers would otherwise query to populate a map guaranteed to stay empty -- at most the
  // path mapping read, the relation hop, and the record-lexical scan over every assertion title
  // and current section heading in the workspace. A caller with no grants is a valid state, not
  // an error, and it should cost nothing.
  if (readable.length === 0) {
    return [];
  }

  const signals = new Map<string, MatchSignal[]>();
  // Readability is enforced here, once, rather than at each producer. An unreadable scope
  // reaching this map would otherwise survive as far as record loading — a database read for
  // a scope that can never be returned — and would make the work done depend on scopes the
  // caller cannot see. The relation hop is the producer that makes this reachable, since it
  // adds scopes by traversal rather than by matching.
  const add = (scopeGuid: string, signal: MatchSignal) => {
    if (!byGuid.has(scopeGuid)) {
      return;
    }
    const existing = signals.get(scopeGuid);
    if (existing) {
      // Identical signals are dropped rather than accumulated. One scope can reach the same
      // record through more than one association row -- live uniqueness is per association_type
      // -- so the same title would otherwise repeat its reason verbatim.
      //
      // This does not change ranking under the default ranker: its first tier counts distinct
      // signal *kinds*, so same-kind repeats were already collapsed there. The reason to drop
      // them is that matchReasons is read by people and doubles as the explanation of why a
      // route ranked where it did, and a list that says the same thing four times explains
      // less than one that says it once. A replaceable ranker (A3) may also count raw signals,
      // and should not inherit a duplicate that means nothing.
      if (existing.some((held) => held.kind === signal.kind && held.reason === signal.reason)) {
        return;
      }
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

  // Records, not just scope names (T-46). A scope's slug, title, and aliases are the only text
  // the lexical signal could see, so a task phrased in ordinary words — "logging retention" —
  // reached nothing, even with a claim by that name in the workspace. Titles and headings only,
  // never body text: body matching would put most scopes in most answers, which reads like
  // working and is harder to notice than returning nothing.
  //
  // Weakest kind by position in SIGNAL_KINDS, but tier 1 counts distinct kinds, so this can
  // still promote a scope. That is why it ships behind a flag and is measured as a shadow
  // ranker before it decides anything.
  if (input.recordLexical) {
    // Restricted to scopes the caller can read, rather than filtering after the fact in add().
    // Every other producer here matches against something already narrowed; this one would
    // otherwise read every active assertion title and current section heading in the workspace
    // on each call, then discard the ones belonging to scopes the caller cannot see. The work
    // done would scale with the workspace instead of with what the caller is permitted to
    // receive, which is both wasteful and the wrong thing for a per-request path.
    const readableGuids = readable.map((scope) => scope.scope_guid);
    const rows = await pool.query<{ scope_guid: string; text: string; source: string }>(
      // DISTINCT for the same reason the section branch below carries it: live uniqueness on
      // record_scopes is per association_type, so one assertion can hold several live rows for
      // one scope. Harmless while the reason ignored counts; now it would inflate "the same
      // title in N assertions", which is the phrase whose whole job is to warn a reader that a
      // match is template repetition rather than evidence.
      `SELECT DISTINCT rs.scope_guid, a.title AS text, 'assertion' AS source
         FROM "${schemaName}".assertions a
         JOIN "${schemaName}".record_scopes rs
           ON rs.workspace_guid = a.workspace_guid AND rs.record_type = 'assertion'
          AND rs.record_guid = a.assertion_guid AND rs.retired_at IS NULL
        WHERE a.workspace_guid = $1 AND a.retired_at IS NULL AND a.status = 'active'
          AND rs.scope_guid = ANY($2::uuid[])
       UNION ALL
       -- Wrapped in a subquery because DISTINCT ON needs its own ORDER BY, and a bare ORDER BY
       -- in a UNION branch binds to the whole union instead.
       --
       -- DISTINCT ON matching loadRouteRecords: stable_key is revision-stable, so without it
       -- every revision of a document contributes its headings. A heading a later commit deleted
       -- would keep routing forever — the workspace could never be corrected by editing it — and
       -- each stable key would also emit one row per revision.
       SELECT scope_guid, text, source FROM (
         SELECT DISTINCT ON (rs.scope_guid, ss.stable_key)
                rs.scope_guid, ss.title AS text, 'section' AS source
           FROM "${schemaName}".source_sections ss
           JOIN "${schemaName}".document_revisions dr
             ON dr.workspace_guid = ss.workspace_guid AND dr.revision_guid = ss.revision_guid
           JOIN "${schemaName}".source_documents d
             ON d.workspace_guid = dr.workspace_guid AND d.document_guid = dr.document_guid
            AND d.retired_at IS NULL
           JOIN "${schemaName}".record_scopes rs
             ON rs.workspace_guid = ss.workspace_guid AND rs.record_type = 'section'
            AND rs.stable_key = ss.stable_key AND rs.retired_at IS NULL
          WHERE ss.workspace_guid = $1
            AND rs.scope_guid = ANY($2::uuid[])
            -- Current revision only. Taking the highest revision per stable_key is not enough:
            -- a heading a later commit deleted leaves a section whose stable_key exists in no
            -- newer revision, so it is the only row for that key and survives any per-key
            -- dedupe. Restricting to the document's latest revision drops it, which is what
            -- "reflects the current workspace" has to mean.
            AND dr.revision_number = (
              SELECT max(dr2.revision_number)
                FROM "${schemaName}".document_revisions dr2
               WHERE dr2.workspace_guid = dr.workspace_guid AND dr2.document_guid = dr.document_guid
            )
          -- Still deduped: one scope can associate the same section more than once, by different
          -- association types, and each would otherwise repeat the same match reason.
          ORDER BY rs.scope_guid, ss.stable_key, dr.revision_number DESC
       ) current_sections`,
      [input.workspaceGuid, readableGuids],
    );
    // Matched in application code, like every other signal here, so the reason a route was
    // offered stays explainable to the person reading it.
    //
    // Grouped before emitting — one signal per scope and source, rather than one per matched
    // title.
    //
    // This is what makes it safe for the reason to quote the titles at all. `add` deduplicates
    // on the reason string, so a reason naming its own title is unique by construction and slips
    // past it; quoting without grouping would emit one signal per heading. A reason that named
    // no title, as this one used to, deduplicates on its own — so grouping is the price of
    // saying more, not a repair of something that was broken.
    //
    // Saying more is worth the price because the count is the judgement being asked for. A scope
    // that matched one heading is a plausible route; one that matched thirty means the term is a
    // common word and the scope is noise. A bare list of examples hides that difference; a bare
    // count cannot be checked against anything.
    const groups = new Map<
      string,
      { scopeGuid: string; termTitles: Map<string, Set<string>>; source: string; titles: string[] }
    >();
    for (const row of rows.rows) {
      const words = row.text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
      // Every matching term, not the first one found. Keying on a single term split one scope's
      // evidence across several reasons by which task word happened to appear earliest in each
      // heading — a property with no bearing on relevance. A scope matching six of six headings
      // on a two-word task read as two unremarkable threes.
      const hits = words.filter((word) => terms.has(word) && !RECORD_LEXICAL_STOPWORDS.has(word));
      if (hits.length === 0) {
        continue;
      }
      // NUL-joined because neither a guid nor a source can contain it, so no two distinct pairs
      // can collide on one key.
      const key = `${row.scope_guid}\u0000${row.source}`;
      let held = groups.get(key);
      if (!held) {
        held = { scopeGuid: row.scope_guid, termTitles: new Map(), source: row.source, titles: [] };
        groups.set(key, held);
      }
      held.titles.push(row.text);
      // Which titles each term reached, not merely which terms appeared somewhere in the scope.
      // Per-term attribution, because a scope that matched one relevant heading and four on a
      // common word otherwise reads exactly like one that matched five relevant headings.
      // Stopwords are filtered above, but ubiquitous topical words are not — that is what the
      // scope-frequency rule handles, and it needs the per-term counts to do it.
      for (const hit of hits) {
        const seen = held.termTitles.get(hit);
        if (seen) {
          seen.add(row.text);
        } else {
          held.termTitles.set(hit, new Set([row.text]));
        }
      }
    }

    for (const group of groups.values()) {
      add(group.scopeGuid, { kind: "record-lexical", reason: recordLexicalReason(group) });
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
      // the caller's work, not an entitlement to the scope it maps to. `add` enforces that.
      add(scopeGuid, signal);
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
      },
    ];
  });
}

export type RouteRecord = {
  ref:
    | { type: "assertion"; guid: string }
    | { type: "section"; guid: string; documentGuid: string; revisionGuid: string; stableKey: string };
  documentName?: string;
  heading?: string;
  headingLevel?: number;
  content: string;
  /** Assertions only: what sort of claim it is and what standing it has, both of which travel into every response. */
  kind?: string;
  status?: string;
  /** Assertions only: the exact source text the claim was drawn from. */
  citations?: Array<{ quote: string; blockGuid: string; relation: string }>;
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
    // DISTINCT ON collapses a stable key that appears in several revisions of one document.
    // It is NOT what keeps deleted content out — see the revision predicate below. That
    // distinction is written twice because the belief that DISTINCT ON alone was sufficient is
    // what produced the defect this query was fixed for.
    `SELECT DISTINCT ON (ss.stable_key)
            ss.section_guid, ss.revision_guid, dr.document_guid, sd.name AS document_name,
            ss.stable_key, ss.title, ss.heading_level, ss.start_offset, ss.end_offset, ss.ordinal
       FROM "${schemaName}".record_scopes rs
       JOIN "${schemaName}".source_sections ss
         ON ss.workspace_guid = rs.workspace_guid AND ss.stable_key = rs.stable_key
       JOIN "${schemaName}".document_revisions dr
         ON dr.workspace_guid = ss.workspace_guid AND dr.revision_guid = ss.revision_guid
       JOIN "${schemaName}".source_documents sd
         ON sd.workspace_guid = dr.workspace_guid AND dr.document_guid = sd.document_guid
        -- Defence in depth: retirement also retires the associations, but a section whose
        -- document is retired must not route even if an association survives by some other
        -- path. Serving content from a document the commit no longer contains is the bug.
        AND sd.retired_at IS NULL
      WHERE rs.workspace_guid = $1 AND rs.scope_guid = $2
        AND rs.retired_at IS NULL AND rs.record_type = 'section'
        -- Current revision only. DISTINCT ON takes the newest row per stable_key, which is not
        -- the same thing: a heading a later commit deleted leaves a section whose stable_key
        -- appears in no newer revision, so it is the only row for that key and survives the
        -- dedupe untouched. Expansion would then serve a caller content the pinned commit does
        -- not contain -- the same defect that had to be fixed in the record-lexical signal,
        -- where taking the highest revision per key was demonstrably insufficient.
        AND dr.revision_number = (
          SELECT max(dr2.revision_number)
            FROM "${schemaName}".document_revisions dr2
           WHERE dr2.workspace_guid = dr.workspace_guid AND dr2.document_guid = dr.document_guid
        )
      -- document_guid breaks the tie, because revision_number alone does not. A stable key is
      -- derived from the document path, while document identity includes the repository, so two
      -- live documents can share a key and reach the same revision number -- and DISTINCT ON
      -- would then pick either arbitrarily, making expansion output and contentFingerprint
      -- differ between runs on unchanged data. Unreachable in this workspace today (no shared
      -- keys exist); a fingerprint that moves without the content moving is worth foreclosing
      -- rather than waiting to observe.
      ORDER BY ss.stable_key, dr.revision_number DESC, dr.document_guid`,
    [workspaceGuid, scopeGuid],
  );

  const assertionRecords = await loadAssertionRecords(pool, schemaName, workspaceGuid, scopeGuid);

  // Not an early return on sections alone: a scope may hold only assertions, and returning
  // nothing there would hide every authored claim in a scope that has no documents.
  if (sections.rowCount === 0) {
    return assertionRecords;
  }

  const revisionGuids = [...new Set(sections.rows.map((row) => row.revision_guid))];
  const revisions = await pool.query<{ revision_guid: string; content: string }>(
    `SELECT revision_guid, content FROM "${schemaName}".document_revisions
      WHERE workspace_guid = $1 AND revision_guid = ANY($2::uuid[])`,
    [workspaceGuid, revisionGuids],
  );
  const contentByRevision = new Map(revisions.rows.map((row) => [row.revision_guid, row.content]));

  // Where each section's own prose ends: at its first descendant, or at its own end when it has
  // none. See ownProseEnd for why records carry only their own prose.
  const ownEnd = ownProseEnd(sections.rows);

  return [
    ...assertionRecords,
    ...sections.rows
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
      content: (contentByRevision.get(row.revision_guid) ?? "").slice(
        row.start_offset,
        ownEnd.get(row.section_guid) ?? row.end_offset,
      ),
    }))
    // A heading with no prose of its own is dropped. Its span starts at its own heading line, so
    // once descendants are excluded its content is that line and nothing else -- the title
    // repeated, which `heading` already carries -- and it would occupy a slot in recordsPerRoute
    // that a record with something to say could have. Its children are in the route beside it.
    //
    // Judged by removing the heading line rather than by a length threshold: "### Closed\n\nNone."
    // is three words of real content, and any cutoff big enough to drop bare headings would take
    // it too.
    .filter((record) => hasProseOfItsOwn(record.content))
    .sort((left, right) => left.ref.stableKey.localeCompare(right.ref.stableKey)),
  ];
}

/**
 * Whether a section's content is more than the heading line it begins with.
 *
 * Only the first line, and only when it is a heading: a record whose prose happens to open with a
 * markdown heading of its own is not empty, and stripping every leading heading would eat it.
 */
function hasProseOfItsOwn(content: string): boolean {
  return content.replace(/^#{1,6} [^\n]*\n?/, "").trim().length > 0;
}

type SectionSpan = {
  section_guid: string;
  revision_guid: string;
  start_offset: number;
  end_offset: number;
};

/**
 * Where each section's own prose ends, so that no record contains another (T-57).
 *
 * Sections are nested, and a route offered them all as peers: on the real workspace,
 * `scope:domain:anchor-mcp` held 270 sections whose spans summed to 486,680 characters over about
 * 150,000 characters of actual text, and 241 of the roadmap's 242 sections were wholly inside
 * another. A default expansion returned 104,521 characters of which only 46,875 was text not
 * already present elsewhere in the same response — the document, then one of its chapters again,
 * then that chapter's sections again. The 25-record cap could not help, because it was slicing a
 * list whose entries overlapped.
 *
 * A section's content is therefore its span up to its first descendant. Every character of the
 * document still appears exactly once across the route, and no record is a sub-range of another.
 *
 * Trimming rather than dropping the containers, which is the tempting simpler rule: prose can sit
 * directly under a parent heading before its first subheading, and dropping such a section would
 * discard it silently. On this workspace exactly one section of 270 had both children and prose
 * of its own, so the two rules very nearly coincide here -- trimming is preferred because it does
 * not depend on that staying true.
 *
 * Assumes a section's span begins at its own heading line, so a parent never shares a start
 * offset with its first child. That is what markdown produces and what the importer records. A
 * parent that did share one would not be trimmed, because a descendant is identified by starting
 * strictly later -- and it would then contain its child. Stated rather than guarded, since the
 * guard would be unreachable code asserting a shape the importer cannot emit.
 */
export function ownProseEnd(rows: SectionSpan[]): Map<string, number> {
  const byRevision = new Map<string, SectionSpan[]>();
  for (const row of rows) {
    // Grouped by revision, not by document: offsets index one revision's text, and comparing
    // them across revisions would nest a section inside a span from a different string.
    const group = byRevision.get(row.revision_guid);
    if (group) {
      group.push(row);
    } else {
      byRevision.set(row.revision_guid, [row]);
    }
  }

  const ends = new Map<string, number>();
  for (const group of byRevision.values()) {
    const ordered = [...group].sort((a, b) => a.start_offset - b.start_offset);
    for (let index = 0; index < ordered.length; index += 1) {
      const section = ordered[index]!;
      let end = section.end_offset;
      // The first section that starts after this one and ends within it is its first descendant.
      // Scanning forward only is enough because the list is sorted by start offset.
      //
      // The two bounds are belt and braces. Sections nest and never partially overlap, so given
      // the early exit below, "starts after this one" would already imply "ends within it" -- a
      // mutation dropping the end bound passes every test here. Kept because the cost is one
      // comparison and the failure it forecloses is a record silently extending past its own
      // section, which no assertion downstream would notice.
      for (let next = index + 1; next < ordered.length; next += 1) {
        const candidate = ordered[next]!;
        if (candidate.start_offset >= section.end_offset) {
          break;
        }
        if (candidate.end_offset <= section.end_offset && candidate.start_offset > section.start_offset) {
          end = candidate.start_offset;
          break;
        }
      }
      ends.set(section.section_guid, end);
    }
  }
  return ends;
}

/**
 * Assertions a route contains, with their citations.
 *
 * Non-active claims are excluded: serving a retracted claim as though it were live is the
 * failure the standing model exists to prevent, and a disputed or superseded one reaching a
 * default route unmarked would be the same mistake in a quieter form. They remain
 * addressable by direct reference — excluded from routes is not deleted.
 */
async function loadAssertionRecords(
  pool: Pool,
  schemaName: string,
  workspaceGuid: string,
  scopeGuid: string,
): Promise<RouteRecord[]> {
  const rows = await pool.query<{
    assertion_guid: string;
    kind: string;
    status: string;
    title: string;
    content: string;
    citations: Array<{ quote: string; blockGuid: string; relation: string }> | null;
  }>(
    // Associations are deduped before the citation join. record_scopes permits several live
    // rows for one assertion in one scope — one per association_type — and joining citations
    // through them would repeat every citation once per association. Only `owning-scope` is
    // created today, so this is latent; setRecordScopes is what makes it reachable.
    `WITH scoped AS (
       SELECT DISTINCT rs.record_guid
         FROM "${schemaName}".record_scopes rs
        WHERE rs.workspace_guid = $1 AND rs.scope_guid = $2
          AND rs.retired_at IS NULL AND rs.record_type = 'assertion'
     )
     SELECT a.assertion_guid, a.kind, a.status, a.title, a.content,
            coalesce(
              jsonb_agg(
                jsonb_build_object('quote', c.exact_quote, 'blockGuid', c.block_guid, 'relation', c.relation)
                -- created_at alone is not a total order: now() is constant within a
                -- transaction, so citations written together share a timestamp and their
                -- aggregate order could vary between reads. The guid breaks the tie.
                ORDER BY c.created_at, c.citation_guid
              ) FILTER (WHERE c.citation_guid IS NOT NULL),
              '[]'::jsonb
            ) AS citations
       FROM scoped
       JOIN "${schemaName}".assertions a
         ON a.workspace_guid = $1 AND a.assertion_guid = scoped.record_guid
       LEFT JOIN "${schemaName}".source_citations c
         ON c.workspace_guid = a.workspace_guid AND c.assertion_guid = a.assertion_guid
      WHERE a.retired_at IS NULL AND a.status = 'active'
      GROUP BY a.assertion_guid, a.kind, a.status, a.title, a.content
      -- Title is not unique, so it is not a total order either. Same defect as the citation
      -- aggregate above, one line apart: two claims sharing a title would come back in a
      -- different order between reads.
      ORDER BY a.title, a.assertion_guid`,
    [workspaceGuid, scopeGuid],
  );

  return rows.rows.map((row) => ({
    ref: { type: "assertion" as const, guid: row.assertion_guid },
    heading: row.title,
    content: row.content,
    kind: row.kind,
    status: row.status,
    citations: row.citations ?? [],
  }));
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
  // An assertion is keyed by GUID because that identity is durable, unlike a section GUID,
  // which is revision-scoped. Authoring a claim therefore moves its route's fingerprint,
  // which is what tells a caller holding an earlier response that the route changed.
  return record.ref.type === "assertion" ? `assertion:${record.ref.guid}` : `section:${record.ref.stableKey}`;
}
