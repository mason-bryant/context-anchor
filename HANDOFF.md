# Goal 0 Phase 1 — Semantic substrate: handoff

Branch: `feat/goal0-substrate-phase1` (off `main`). All six work packages
complete, each as a separate commit. Authoritative plan:
`ai-output/markdowns/context-conductor/goal0_semantic_substrate_implementation_plan.md`
(referenced below as "the plan"); background design:
`knowledge_graph_visualization_design_and_roadmap.md`, "Goal 0 -- Structured
anchor substrate and graph contract".

## Final status

- `npm run typecheck`: clean.
- `npm test`: **924 tests passing, 44 files, 0 failures.**
- No changes to `src/ui/assets.ts`, planner behavior, existing write paths,
  or existing v1 canonical node IDs/constructors (verified via `git diff
  main...HEAD -- src/graph/model.ts`: the only change is five new
  `GraphEdgeType` union members, additive).

## What each work package delivered

### WP1 — Identity contract module and fixtures (`8d13e65`)

- `src/ids.ts` (new): extracted `randomBase36`/`mintPrefixedId` out of
  `src/claims.ts` so `mintClaimId` (`c-` prefix) and the new `mintAnchorId`
  (`a-` prefix) share one byte-identical collision-growth algorithm.
- `src/graph/identity.ts` (new): `GRAPH_IDENTITY_VERSION = 2`,
  `ANCHOR_ID_PATTERN`/`isValidAnchorId`, `mintAnchorId`, v2 canonical
  constructors (`anchorNodeIdV2`, `goalNodeIdV2`, `milestoneNodeIdV2`,
  `taskNodeIdV2`, `sectionNodeIdV2`, `claimNodeIdV2`) living alongside (never
  replacing) the v1 constructors in `src/graph/model.ts`, plus
  `anchorIdFromFrontmatter` and `buildIdentityCompatibilityMap`.
- Tests: `test/graphIdentity.test.ts` (24 tests) — format validation, mint
  uniqueness/collision growth, v2 constructor shapes, the "G-001 in two
  projects produces two distinct v2 goal ids" acceptance case, and
  compatibility-map round-trips including `unmapped` reporting.
- `mintClaimId`'s own tests (in `test/claims.test.ts`) pass unmodified,
  confirming byte-identical behavior after the refactor.

### WP2 — `anchor_id`/`schema_version` front-matter support (`d8735e6`)

- `src/validators/frontMatter.ts`: `AnchorFrontmatterSchema` (now exported,
  see WP5 below) gains optional `anchor_id` (validated against
  `ANCHOR_ID_PATTERN` only when present) and optional `schema_version`
  (positive int or numeric string, mirroring the milestone typed overlay's
  shape). Presence stays optional in both cases.
- Tests: `test/frontMatterValidator.test.ts` (14 tests) — valid/invalid
  shapes for both fields, absence is not a violation, existing fixtures
  still validate.

### WP3 — Typed relation vocabulary (`649e985`)

- `src/relations/vocabulary.ts` (new): the locked five-key registry
  (`depends_on`, `implements`, `supersedes`, `related_to`, `owned_by`) with
  direction/source-kind/target-kind/symmetric metadata, and
  `parseRelationTarget` for canonical typed refs (`anchor:a-xxxxxx`,
  `goal:<project-slug>:G-123`, `person:<id>`, `team:<id>`) vs. legacy bare
  strings. `derived_from`/`contradicts` deliberately NOT duplicated here —
  they stay claim-annotation grammar in `src/claims.ts`.
- `src/graph/extract.ts`'s `extractRelationsEdges`: a registered key's target
  is tried as a typed ref first; only a parsed, kind-valid, resolved target
  emits the new typed edge (`related_to` emits both directions). Every other
  case (unregistered key, legacy bare string, malformed typed ref,
  wrong-kind target, unresolved typed ref) falls through to the exact
  pre-WP3 `anchor_anchor` edge — nothing the graph tracked before this phase
  can disappear.
- `src/graph/index.ts`: `GraphIndex` now builds an `anchor_id -> name`
  reverse map and a tree-wide known-goal-ids set during full rebuilds
  (reused as-is by `invalidateDocument`, not recomputed, to keep that
  incremental path cheap — see "Deviations" below), threaded into
  `ExtractDocumentEdgesContext` as `resolveAnchorId`/`knownGoalIds`.
- `src/graph/model.ts` / `src/server.ts`: five new `GraphEdgeType` union
  members; the `graphNeighbors` MCP tool's `GraphEdgeTypeSchema` enum
  extended to match (the only place edge types are exhaustively enumerated).
- Tests: `test/relationsVocabulary.test.ts` (25), plus new blocks in
  `test/graphExtract.test.ts` and `test/graphIndex.test.ts` (direction,
  symmetric handling, wrong-kind/malformed fallback, unknown-key parity, and
  a real end-to-end `GraphIndex` build).

### WP4 — Claim identity independent of provenance (`7ab74c3`)

- `src/claims.ts`: a claim can now carry a stable `id` via an id-only
  annotation block (`{id: c-xxxxxx}`, no `src`/`observed`/`conf`/etc). New
  `parseIdOnlyAnnotationBody` is tried before `parseAnnotationBody` so an
  id-only block is never rejected for "missing src/observed/conf." Id-only
  rows are tracked separately (`AnchorClaim.idOnlyRows`, not
  `ClaimSource`s) so they never contribute to strength or push `status`
  past `"unannotated"` — an id-only claim keeps `status: "unannotated"` but
  now carries `claim.id` (and `claim.idProvenanceless: true`).
  `looksLikeAnnotationBody` now recognizes bare `id:` as an annotation
  attempt (previously excluded on purpose, since it could never parse).
- `src/graph/extract.ts`'s `extractClaimEdges`: any claim with an id
  (annotated or id-only) gets a `claim:` node. An id-only claim has no
  sources to derive a cited-section edge from, so it is anchored via a new
  containment edge to its OWN home section (`sourceOfTruth: "containment"`,
  distinguishable from a claim-authored citation). An already-annotated
  claim's edges are completely unchanged.
- Tests: 16 new cases in `test/claims.test.ts` (id-only parsing, round-trip,
  conflict detection both ways, same-id redundancy), plus
  `test/graphExtract.test.ts`/`test/graphIndex.test.ts` cases proving the
  `claim:` node materializes end-to-end and annotated-claim edges are
  unchanged.

### WP5 — Structural coverage analysis (`9a08bf0`)

- `src/graph/coverage.ts` (new): `analyzeCoverage(docs, ctx)`, pure, follows
  `extract.ts`'s purity pattern. Computes per-anchor and per-claim
  `structured | partial | prose_only | ambiguous | dangling | malformed`
  with `reasons[]` (stable codes, message, anchor name, line/heading where
  available) and descriptive-only `suggestedOperations[]`. Precedence is
  exactly `malformed > dangling > ambiguous > partial` per the plan.
  `ambiguous` is reachable via a duplicated `anchor_id` *referenced* from
  elsewhere (the anchors that declared the duplicate are themselves
  `malformed` — a distinct, deliberate design choice; see "Deviations"
  below). Reuses the now-exported `AnchorFrontmatterSchema` and
  `relationVocabularyEntry`/`parseRelationTarget` rather than duplicating
  either.
- Tests: `test/graphCoverage.test.ts`, one fixture per state, all three
  precedence-collision cases, duplicate-id detection, and summary-count-vs-
  record consistency (24 tests in the WP5 commit).

### WP6 — Read-only coverage endpoints (`c25d308`)

- `src/graph/coverage.ts` gains bounded pagination:
  `clampCoverageLimit`/`GRAPH_COVERAGE_DEFAULT_LIMIT` (100)/
  `GRAPH_COVERAGE_MAX_LIMIT` (500), and `pageCoverageRecords` (deterministic
  anchor-name/claim-line ordering, cursor-based).
- `src/graph/index.ts`: `GraphIndex.graphVersion()` (HEAD + generation) and
  `GraphIndex.buildCoverageContext()` (builds `CoverageAnalysisContext`
  reusing already-built resolvers, no second tree scan).
- `src/anchorService.ts`: new `graphCoverage(input)` — bounded worker-pool
  tree read (mirrors `buildBM25SearchIndex`), `analyzeCoverage`, paginate.
  Single response shape for both callers below.
- `src/server.ts`: `graphCoverage` MCP tool registered, mirroring
  `graphNeighbors`'s pattern.
- `src/ui/routes.ts`: `GET /api/ui/graph-coverage`, same auth middleware and
  `jsonRoute` pattern as `/api/ui/graph-neighbors`.
- Tests: pure pagination tests (10 new in `test/graphCoverage.test.ts`),
  `AnchorService.graphCoverage` against a real seeded tree (5 new in
  `test/graphIndex.test.ts`), and HTTP route tests — auth, state/project
  filtering, cursor paging, 400 on out-of-range limit, MCP-vs-HTTP agreement
  (6 new in `test/uiHttp.test.ts`).

## Deviations from the plan, and why

1. **`GraphIndex.invalidateDocument` reuses (not recomputes) the anchor_id
   reverse map and known-goal-ids set built during the last full
   `rebuild`.** The plan doesn't call this out explicitly, but building
   these correctly requires every anchor's front matter/content, which
   `invalidateDocument`'s incremental path deliberately does NOT re-read (it
   only re-reads the touched document, per its existing design). Recomputing
   tree-wide state on every single-document invalidation would defeat the
   whole point of incremental invalidation. Consequence: a brand-new
   `anchor_id` or roadmap goal heading introduced purely via
   `invalidateDocument` calls (no intervening full rebuild) is not yet
   resolvable for typed-relation targets until the next full rebuild. This
   is safe by construction — an unresolved typed target simply falls back to
   the pre-WP3 `anchor_anchor` legacy edge, never drops — but Phase 2 should
   know this lag exists if it starts relying on typed-relation resolution
   being instantaneous after every single write.

2. **WP4's write path (`upsertClaimSources`/`upsertClaimAnnotation`) does
   NOT clean up a stray id-only annotation line when new sources are
   written over it.** Before this phase, a claim could never have an
   id-only row, so `upsertClaimSources`'s standalone-line removal logic
   (keyed off `claim.sources`/`sourceErrors`) never needed to know about
   `idOnlyRows`. I left this untouched per the plan's explicit "do NOT...
   change existing write paths" instruction and because minting/rewriting
   claim ids on write is explicitly deferred to the Phase 2 migration
   operations. Concretely: if a caller calls the `annotateClaim` tool (or
   `upsertClaimSources` directly) against a claim that currently has ONLY an
   id-only row, the old `{id: ...}` line will not be stripped and a stray
   duplicate line can remain alongside the newly-written source row. Phase 2
   (which owns migration writes) should fix `upsertClaimSources` to also
   splice out `idOnlyRows` lines when replacing a claim's sources.

3. **WP5's `ambiguous` state is reachable only through duplicated
   `anchor_id` references, not through person/team/goal targets.** The
   plan says "a target resolves to more than one candidate" without
   specifying which target kinds can produce that. Every other resolver
   (`resolveProjectSlug`, `personExists`, `teamExists`, `knownGoalIds`) is a
   deterministic 1:1 lookup with no plausible multi-match in this phase's
   design (canonical typed refs are kind-prefixed, so no cross-kind
   ambiguity either). Anchor-id ambiguity is the one case that's genuinely
   reachable today: two anchors can legitimately declare the same
   `anchor_id` (a write-time validation gap this phase doesn't close, since
   duplicate-detection is explicitly a WP5 coverage concern per the plan,
   not a validator concern), and a third anchor referencing that id via
   `anchor:<id>` can't tell which one was meant. I designed
   `anchorNamesForAnchorId` to return every matching candidate (not just
   one) specifically so this case is real, tested, and distinguishable from
   the `malformed` state of the anchors that caused the duplicate in the
   first place (a reference to a duplicated id is `ambiguous`; the anchors
   declaring the duplicate are themselves `malformed`).

4. **`WP5`'s `anchor_id_invalid` reason code is currently unreachable
   dead-ish code.** Since WP2 wired `ANCHOR_ID_PATTERN` directly into
   `AnchorFrontmatterSchema`, an invalid `anchor_id` is always caught by the
   schema check (producing `front_matter_schema`) before
   `analyzeAnchorCoverage` ever reaches its own separate `anchor_id_invalid`
   check. I kept the separate check as defense-in-depth (documented inline)
   rather than removing it, in case a future caller ever supplies frontmatter
   that bypassed schema validation. No test exercises this path directly
   (the schema-level test exercises the same fixture and gets
   `front_matter_schema` instead, which is the correct/actual behavior).

No work package was skipped or left undone; there is no blocker requiring
the branch to stop early.

## Notes for Phase 2 (migration writes + coverage UI)

- **Write-path gap to close first:** `upsertClaimSources` needs to also
  remove `idOnlyRows` lines when a claim's sources are replaced (see
  deviation #2). This will matter as soon as Phase 2's migration operations
  start minting ids for previously-id-only claims or otherwise rewriting
  their annotation rows.
- **Re-key phase inputs are already in place:** `IdentityCompatibilityMap`
  (WP1) and the v2 constructors exist and are tested, but nothing calls them
  yet — Phase 2's re-key phase can build the anchor_id/goal-project maps from
  a real tree scan (the shape `GraphIndex.buildCoverageContext()` already
  assembles internally, e.g. `anchorIdByName`, is a good starting point) and
  feed `buildIdentityCompatibilityMap`.
- **`invalidateDocument`'s WP3 lag (deviation #1):** if Phase 2's migration
  writes rely on typed-relation resolution being correct immediately after a
  single-document write (rather than after a full rebuild), either force a
  full `invalidate()` after a migration write that mints an `anchor_id`, or
  extend `invalidateDocument` to also refresh `anchorIdByName`/
  `knownGoalIds` for the touched document (it already reads that document's
  front matter/content — the missing piece is a tree-wide check for whether
  another anchor already claims a would-be-duplicate id, which does need a
  wider read).
- **`convert_relation` suggested operations are currently coarse:** WP5
  reports one `convert_relation` suggestion per unregistered-vocabulary-key
  relation, but does not yet suggest a specific canonical-ref string to
  convert TO (that requires knowing the target's `anchor_id`/project scope,
  which the previewable migration operation itself should compute, not
  coverage analysis).
- **Coverage UI (Schema Coverage cards / synchronized table) has no
  representation yet** beyond the raw MCP/HTTP JSON shape from WP6. The
  `CoverageRecordKind` union (`{kind: "anchor", ...} | {kind: "claim", ...}`)
  and `CoverageSummary` shape were designed to be renderable directly, but
  no UI code was touched in this phase (per scope: `src/ui/assets.ts`
  untouched).
- **`byProject`/`byAnchorType` summary buckets use `Partial<Record<...>>`**
  (only states that actually occurred appear as keys) rather than always
  including all six states at zero — worth confirming this is the shape the
  Schema Coverage cards want before building against it.
