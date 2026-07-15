# Goal 0 Phase 2, slice 3a — wire the Coverage UI to preview/apply migration: handoff

Branch: `feat/goal0-coverage-ui-migrate` (off `origin/main` at the PR #92 merge).
Plan: `ai-output/markdowns/context-conductor/goal0_phase2_coverage_ui_wiring_plan.md`.

Scope, as specified: UI only — `src/ui/assets.ts`, `src/ui/viewModel.ts`,
and their tests. No `src/anchorService.ts`, `src/migration/*`, `src/server.ts`,
`src/validators/*`, or `src/graph/*` changes (the API consumed here shipped in
#92; the parallel slice 3b owns the enforcement validator).

## Final status

- `npm run typecheck`: clean.
- `npm test`: full suite green. The served browser bundle (`UI_JS`) was
  additionally validated with `node --check` against its real evaluated value.

## What shipped

- **Per-anchor Migrate action**: the Coverage table gains a "Migrate" column;
  `coverageRowHtml` renders a real `<button data-migrate-anchor>` for ANY row
  with suggested operations (mirrors `isMigratableCoverageRecord`). Migration
  is always anchor-scoped — the button targets `record.anchorName`, which for
  a claim row is its owning anchor — so claim rows are migratable too (coverage
  emits `mint_claim_id` on the claim record, not the anchor, so restricting to
  anchor rows would leave a claim-id-only gap with no reachable button).
- **Preview-first review modal** (`#migration-modal`, mirroring the existing
  claim-source modal shell): clicking Migrate calls
  `POST /api/ui/anchor-migration-preview` and renders the per-operation
  outcomes (grouped/labelled), the unified diff in a `<details>`, and any
  validation warnings. Apply is disabled unless the preview `changed`, has a
  base `fileCommit` to migrate against, and no other apply is in flight.
- **Explicit approved apply**: "Apply migration" calls
  `POST /api/ui/anchor-migration-apply` with `approved: true` and the preview
  response's `fileCommit` value sent under the request's `expectedFileCommit`
  key. It is never reachable without a preceding
  preview in the same panel session, and is guarded by `state.migrationApplying`
  against double-clicks. On a committed result it refreshes coverage
  (`loadCoverage`) so the row reflects its new state; a `noChangesNeeded`
  apply is a benign success message; a gated/stale/blocked apply surfaces the
  reason (via `migrationApplyResultSummary`) without discarding the panel.
- **Accessibility**: Migrate/Apply/Close are real focusable `<button>`s; the
  modal is `role="dialog" aria-modal`, closes on backdrop click, the ×/Close
  buttons, and Escape (added to the shared keydown handler); all interpolated
  preview text is `escapeHtml`'d.
- **Pure helpers** in `src/ui/viewModel.ts` (unit-tested): the migratable
  predicate, operation/status labels, outcome grouping, an
  applicable-outcome test, and the apply-result summary. The ES5 mirrors in
  `assets.ts` are annotated at their definition sites.

## Deviations

- None from the plan. The review panel renders outcomes as a single flat,
  status-annotated list rather than three columns; `groupMigrationOutcomes`
  is still provided and unit-tested for any caller that wants the grouped
  shape.

## Notes for a future SERVER slice

The preview response is sufficient for this UI. Two additions would enable a
richer panel later, if wanted: (1) a machine-readable per-operation "would
change these front-matter keys / insert N lines" summary so the diff can be
rendered structurally rather than as raw unified-diff text; (2) a
tree-wide/batch preview+apply endpoint so a "migrate all partial anchors in
this project" action becomes possible without N round-trips. Neither is
needed for the per-anchor flow shipped here.
