# Goal 0 Phase 2, slice 2 — Previewable migration write operations (server-side): handoff

Branch: `feat/goal0-migration-ops` (off `origin/main` at `57abd51`, the merged
PR #90 / `feat/goal0-coverage-ui`). Authoritative plan:
`goal0_phase2_migration_write_ops_plan.md`; background context: the Goal 0
section and "Migration strategy" of
`knowledge_graph_visualization_design_and_roadmap.md`, and
`goal0_semantic_substrate_implementation_plan.md`.

Scope, as specified: server-side only — pure planner module, `AnchorService`
preview/apply methods, MCP tools, thin HTTP routes, tests. `src/ui/assets.ts`
and `src/ui/viewModel.ts` were **not touched**. No feature flags, no
warn→block enforcement changes, no graph re-key.

## Final status

- `npm run typecheck`: clean.
- `npm test`: **1022 tests passing, 48 files, 0 failures.**
- Commits (5, each typecheck+test green):
  1. Pure planner (`src/migration/anchorMigration.ts`) + `GraphIndex.projectsForGoalId`/`goalIdOwnersSnapshot`, with 24 unit tests.
  2. `AnchorService.previewAnchorMigration`/`applyAnchorMigration`, with integration tests (byte parity, stale_base, approval gate, idempotence, coverage-loop-closing).
  3. MCP tools + HTTP routes, with route auth/behavior tests.
  4. A test hardening pass locking in the `owned_by` gap and a multi-relation-key merge case.
  5. A test hardening pass covering `mint_claim_ids`' trickiest byte-preservation edge cases (claim immediately before the next heading; claim as the last line of the file).

## What shipped

### `src/migration/anchorMigration.ts` — pure planner

`planAnchorMigration(content, ctx, operations?)` → `{ newContent, outcomes[] }`,
no I/O, mirroring `src/graph/extract.ts`/`src/graph/coverage.ts`'s purity
pattern. Implements the five operations exactly per the plan:

- `mint_anchor_id` — only when absent; mints via `mintAnchorId` against the
  tree-wide `anchor_id` set. Never replaces an existing valid id.
- `add_schema_version` — only when absent; sets `1`.
- `convert_relation` — legacy bare-string targets on **anchor-targeted**
  registered keys (`depends_on`, `supersedes`, `related_to`) → `anchor:<id>`,
  only when the target resolves to exactly one anchor that already has a
  valid `anchor_id`. Unregistered keys are never touched.
- `scope_goal_reference` — legacy bare goal ids on the **goal-targeted**
  registered key (`implements`) → `goal:<project-slug>:<goal-id>`, only when
  exactly one project's roadmap defines that goal id.
- `mint_claim_ids` — appends an id-only annotation line (`  {id: c-xxxxxx}`,
  two-space indent, standalone line directly under the bullet — the exact
  grammar `src/claims.ts` already establishes) to every top-level claim in a
  claim-bearing section that has no id yet, minted via `mintClaimId` against
  the tree-wide claim-id set.

Front-matter changes go through `mergeAnchorFrontmatter` (one merge call per
plan, since `mint_anchor_id`/`add_schema_version`/`convert_relation`/
`scope_goal_reference` all write into the same `frontmatterUpdates` object —
`convert_relation` and `scope_goal_reference` write disjoint `relations.<key>`
subkeys, since a key is never both anchor- and goal-targeted, so they merge
without clobbering each other regardless of order). Body changes are pure
line-insertions. Every operation is independently order-safe and idempotent:
planning the planner's own output again reports every operation
`not_applicable`/`skipped`-for-the-same-reason and zero `applied`.

**Skip-reason inventory** (`MigrationSkipReason`, stable codes):

| Code | Meaning |
|---|---|
| `already_present` | `mint_anchor_id`/`add_schema_version`: the field already has a valid value — not_applicable, never overwritten. |
| `target_missing_anchor_id` | `convert_relation`: the legacy target resolves to a known anchor, but that anchor has no `anchor_id` yet — migrate the target first. |
| `target_not_legacy` | `convert_relation`/`scope_goal_reference`: the target is already a canonical typed ref — not_applicable. |
| `key_not_registered` | `convert_relation`: the relation key is not in the typed vocabulary — never auto-converted (human decision). |
| `key_wrong_target_kind` | Reserved (not currently emitted — kind-mismatch is a coverage-time `malformed` finding, not a migration-time skip; see "Deviations" below). |
| `target_unparseable` | `convert_relation`: the legacy target string does not resolve to any known anchor. |
| `goal_unknown` | `scope_goal_reference`: no project's roadmap defines this goal id. |
| `goal_ambiguous` | `scope_goal_reference`: more than one project's roadmap defines this goal id — skipped, not guessed. |
| `no_relation_targets` | `convert_relation`/`scope_goal_reference`: requested, but the anchor has no matching (anchor- or goal-targeted) relation arrays to inspect — the at-least-one-outcome filler, so a requested operation never vanishes from the response. |
| `no_unannotated_claims` | `mint_claim_ids`: no unannotated claims lack an id — not_applicable. |
| `not_an_anchor` | Reserved for a future non-anchor-path guard; the service currently never calls the planner on a non-anchor path (see "Deviations"), so this code is defined but not yet emitted. |

### `AnchorService.previewAnchorMigration` / `applyAnchorMigration`

- `previewAnchorMigration({ name, operations? })`: reads the anchor, builds
  the planner's resolver context (`buildAnchorMigrationContext`, reusing
  `collectTreeAnchorIds`/`collectTreeClaimIds` and the graph index's
  `buildCoverageContext()` + new `goalIdOwnersSnapshot()`), plans, and returns
  `{ name, fileCommit?, outcomes, changed, newContent, diff, warnings }`.
  `diff` is a unified-diff-style summary via the existing
  `renderProposalDiff` (reused from `src/proposedChanges.ts`). `warnings` is
  the result of running the normal write pipeline's validators
  (`runValidators`) against `newContent`, read-only — never blocks or
  mutates. Never touches disk.
- `applyAnchorMigration({ name, operations?, approved, expectedFileCommit?, message?, coAuthor? })`:
  funnels through `writeAnchor` (write lock, validators, `stale_base`,
  revision/recovery guarantees inherited for free, per plan decision 6).
  Apply with nothing applicable is a no-op success (`noChangesNeeded: true`,
  no write, no validator run), never an error.
- **Byte-identity mechanism** (plan decision 2 — "apply must produce
  byte-identical content to the most recent preview for the same
  `fileCommit`"): `mint_anchor_id`/`mint_claim_ids` draw fresh
  cryptographically random ids on every independent `planAnchorMigration`
  call, so two separate plans over the same input are never guaranteed to
  agree byte-for-byte. `AnchorService` keeps a small in-memory
  `lastMigrationPreview` cache (per anchor name, keyed by base `fileCommit` +
  requested operation set) populated by `previewAnchorMigration` and consumed
  by `applyAnchorMigration`: a matching apply reuses the cached preview's
  exact `newContent`/`outcomes` instead of re-planning, so it commits
  byte-identical content to that preview. A cache miss (different base,
  different operations, server restart, or no prior preview) falls back to
  planning fresh — apply is always correct, just not guaranteed to match some
  *other* preview it was never shown.

### `GraphIndex.projectsForGoalId` / `goalIdOwnersSnapshot`

Two small additions to `src/graph/index.ts`, both reusing the already-built
`knownGoalIdsByProject` map (no extra tree scan): `projectsForGoalId(goalId)`
for a single lookup, and `goalIdOwnersSnapshot()` for a bulk inversion
(`goal id -> project slug[]`) so the migration context's `projectsForGoalId`
resolver can be a plain synchronous function (the pure planner has no async
surface).

### MCP tools (`src/server.ts`)

`previewAnchorMigration` (read-only) and `applyAnchorMigration` (destructive,
idempotent), registered following the exact `previewProposedChange`/
`applyProposedChange` read+write pair pattern already in the file.

### HTTP routes (`src/ui/routes.ts`)

`POST /api/ui/anchor-migration-preview` and `POST /api/ui/anchor-migration-apply`
(hyphenated, same auth middleware as every other `/api/ui/*` route), taking
`{ name, operations? }` and, for apply, `{ approved, message, coAuthor, expectedFileCommit }`.
A new `readMigrationOperationsBody`/`isMigrationOperationCode` pair validates
the optional `operations` array and 400s on an unknown code.

### Tests

- `test/anchorMigration.test.ts` (new): 35 tests — pure planner (every
  operation, every skip reason including the `owned_by` gap and a
  multi-relation-key merge case), byte-preservation (including the two
  trickiest `mint_claim_ids` edge cases: a claim immediately before the next
  H2 heading, and a claim as the file's last line), idempotence, plus a
  service-level integration `describe` block: preview non-mutation,
  preview/apply byte parity, `stale_base`, the approval gate, idempotent
  no-op apply, second-preview-reports-nothing, the coverage-state-improves
  loop-closing test (`partial` → `structured` through the real
  `graphCoverage` path), and a subset-of-operations request.
- `test/uiHttp.test.ts`: 3 new tests — auth on both new routes, a 400 on an
  invalid `operations` value, preview non-mutation, and apply committing
  content matching the preview.

## Deviations from the plan

1. **Operation scoping for `convert_relation` vs. `scope_goal_reference`**:
   the plan describes `convert_relation` as converting "a legacy bare-string
   target on a REGISTERED relation key... to exactly one anchor" and
   `scope_goal_reference` as scoping "a goal target". The registry
   (`src/relations/vocabulary.ts`) has exactly one goal-targeted key
   (`implements`) and three anchor-targeted keys (`depends_on`, `supersedes`,
   `related_to`); `owned_by` targets people/teams. I split the two
   operations strictly by `targetKinds` (`convert_relation` only touches keys
   whose `targetKinds` includes `"anchor"`; `scope_goal_reference` only
   touches keys whose `targetKinds` includes `"goal"`), and left `owned_by`
   (person/team legacy targets) untouched by either operation — the plan
   never describes a person/team conversion rule, and inventing one
   (`person:<id>` vs. `team:<id>` is not inferable from a bare legacy string)
   would have been a guess. This is covered by an explicit test
   documenting the gap rather than leaving it implicit; a future slice can
   add a `convert_relation` variant for `owned_by` once there's a rule for
   disambiguating person vs. team.
2. **`key_wrong_target_kind`/`not_an_anchor` skip reasons are defined but not
   emitted.** `key_wrong_target_kind` would apply to a registered key whose
   target parses as a *typed* ref of the wrong kind (e.g.
   `depends_on: [person:alice]`) — that is already a `malformed` coverage
   finding (`src/graph/coverage.ts`'s `relation_target_wrong_kind`), not a
   legacy string a migration operation would ever see (migration only acts
   on `legacy: true` parse results), so the code exists for completeness in
   `MigrationSkipReason`'s type but the planner has no code path that emits
   it. `not_an_anchor` is reserved for a future guard if the service ever
   calls the planner on a generated/non-anchor path; today
   `previewAnchorMigration`/`applyAnchorMigration` are only ever invoked
   against a resolved anchor name (the same precondition `writeAnchor`
   itself assumes), so this never fires. Both are harmless unused union
   members, kept rather than removed so the type signature won't need a
   breaking change if a later slice adds the corresponding check.
3. **Byte-identity via a preview cache, not pure re-planning determinism**
   (see "Byte-identity mechanism" above) — the plan states the requirement
   but doesn't prescribe the mechanism. Given `mintAnchorId`/`mintClaimId`
   are contractually "opaque, random, never content-derived"
   (`goal0_semantic_substrate_implementation_plan.md`, WP1 decision 1) and
   that contract is explicitly out of scope to change here, true
   determinism across two independent plans is impossible; an in-memory
   preview cache is the minimal mechanism that satisfies the stated
   guarantee without touching the mint contract. The cache is per-process
   and unbounded-lifetime-per-anchor-key (cleared only on a successful
   commit for that anchor); this is acceptable for a single-process MCP
   server matching every other in-memory cache already in
   `AnchorService` (`_peopleRegistry`, `_projectMappings`, `_graphIndex`),
   but the next slice should be aware it does not survive a server restart
   and is not shared across replicas if the server is ever run
   multi-process.
4. **`goalExistsInProject`/`anchorNamesForAnchorId` from `CoverageAnalysisContext`
   are consumed but a new bulk `goalIdOwnersSnapshot()` was added** to
   `GraphIndex` rather than reusing `graphCoverage`'s per-goal
   `goalExistsInProject` (which only answers "does this slug define this
   goal", not "which slugs define it") — needed because `scope_goal_reference`
   must enumerate ownership, not just test one candidate slug. This is an
   additive method on `GraphIndex`, not a change to any existing method's
   behavior.

Everything else was implementable exactly as specified. The plan's
flagged likely-impossible case — "inserting id-only annotation lines that
round-trip byte-identically" — turned out to be fully solvable by reusing
the exact standalone-annotation grammar `src/claims.ts` already established
for provenance rows (two-space indent, line spliced directly after the
bullet); no blocker was hit.

## Notes for the UI-wiring slice

- The two new endpoints return everything a preview/apply UI panel needs in
  one shape: `outcomes[]` (per-operation `code`/`status`/`reason?`/`detail`
  for a checklist-style preview), `diff` (ready to render as-is, same format
  the existing Proposed Changes UI already renders via `renderProposalDiff`),
  `warnings` (the same `ValidationViolation[]` shape every other write
  surface uses), and `changed`/`noChangesNeeded` booleans for empty-state
  handling.
- The natural entry point is the Coverage tab's `suggestedOperations` labels
  (currently rendered as inert `<span>`s per WP-B's handoff — see the prior
  `HANDOFF.md` content, now superseded, in this branch's git history at
  `0e3d8cf`): those labels can become buttons that call
  `POST /api/ui/anchor-migration-preview` for the anchor under the cursor,
  show the returned diff/outcomes in a confirmation panel, then call
  `POST /api/ui/anchor-migration-apply` with `approved: true` on confirm.
- `expectedFileCommit`: the UI should always pass the preview response's own
  `fileCommit` back into apply (not a separately re-read one), so the cache
  hit path in `AnchorService.lastMigrationPreview` actually engages and the
  user sees exactly what they previewed.
- `operations`: the UI can offer "apply all" (omit `operations`) or
  "apply just this one" (pass a single-element array) — both are already
  supported by the service/route/tool layer; no further server changes
  needed for a granular per-operation apply button.
- Tree-wide batching (applying migration across every eligible anchor in one
  call) is explicitly out of scope for this slice (plan decision 1) — the
  UI-wiring slice should drive per-anchor apply calls itself, e.g. iterating
  the Coverage tab's already-paginated record list, rather than expecting a
  new bulk endpoint.
