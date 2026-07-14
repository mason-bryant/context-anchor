# Goal 0 Phase 2, WP-B — Schema Coverage UI (cards + synchronized table): handoff

Branch: `feat/goal0-coverage-ui` (off `main`, i.e. off the merged Phase 1 PR
#88 / `afa16f2`). Authoritative plan: WP-B section of
`ai-output/markdowns/context-conductor/goal0_phase2_mint_on_create_and_coverage_ui_plan.md`
("the plan" below); background design in
`goal0_semantic_substrate_implementation_plan.md` and the Goal 0 section of
`knowledge_graph_visualization_design_and_roadmap.md` (that doc's original
canvas-based "Visualization deliverable" text is explicitly superseded by
the plan's WP-B section, which is the no-canvas cards+table revision).

This is one of two independent Phase 2 work packages running in parallel
(WP-A owns mint-on-create, in `feat/goal0-mint-on-create`, a separate
branch/worktree). Per the plan's file-ownership split, this work touched
only `src/ui/assets.ts`, `src/ui/viewModel.ts`, and tests.
`src/anchorService.ts` write paths, `src/validators/*`, and `src/graph/*`
were not touched (only type-only imports of `CoverageRecordKind`/
`CoverageState` from `src/graph/coverage.ts` into `src/ui/viewModel.ts`,
matching the existing precedent in `src/ui/routes.ts`). `src/ui/routes.ts`
itself needed no changes — every field the UI needed (`records`,
`nextCursor`, `totalMatching`, `limit`, `summary`, `duplicateAnchorIds`)
was already present on `GET /api/ui/graph-coverage`.

## Final status

- `npm run typecheck`: clean.
- `npm test`: **953 tests passing, 44 files, 0 failures.**
- Commits (2, each typecheck+test green):
  1. Pure Schema Coverage view-model helpers in `src/ui/viewModel.ts`
     (state/kind labeling, project derivation, filtering, URL round-trip,
     cursor-append de-duplication) with 23 new unit tests in
     `test/uiViewModel.test.ts`.
  2. The browser Coverage tab itself in `src/ui/assets.ts` (plain ES5,
     matching every other tab), plus 2 new HTTP smoke tests in
     `test/uiHttp.test.ts` asserting the tab shell and JS bundle contents.

## What was delivered

### Pure view-model helpers (`src/ui/viewModel.ts`)

Exported, unit-tested pure functions over the `graphCoverage` response
shape: `coverageStateLabel`/`coverageKindLabel` (badge/label text — never a
bare code), `deriveCoverageProjects` (anchor-scoped project derivation,
since claim records have no `projectSlug` of their own), `filterCoverageRecords`
(state/project/anchor-text AND filtering), `coverageQueryParams` (server
query-string shape), `coverageFiltersFromUrlParams`/`coverageUrlParamsFromFilters`
(URL round-trip, dropping unknown state tokens instead of throwing), and
`coverageRecordKey`/`appendCoverageRecords` (stable per-record identity and
de-duplicated cursor-page append). `COVERAGE_STATE_ORDER` fixes card/badge
display order to the plan's precedence (`malformed > dangling > ambiguous >
partial`, then the two mutually-exclusive ends `structured`/`prose_only`).

These functions are **not called from the browser bundle** — `UI_JS` is a
raw template-string const served as-is with no bundler/transpile step, so
it cannot `import` from a TS module (same reason Tasks' `validTasksGroupBy`/
`taskGroupsForDisplay` have no server-side counterpart anywhere in the
codebase today). They exist as the pure, tested specification of the
filtering/URL/cursor semantics; the browser code below is an independent
plain-ES5 mirror of the same behavior.

### Coverage tab (`src/ui/assets.ts`)

- New `data-tab="coverage"` nav button (reuses the existing `icon-object-graph`
  SVG symbol) and `#coverage-view` section, following the exact structure of
  the Tasks/Traces tabs: `view-header` → filter/summary controls → empty
  state → content → footer count.
- **Summary/state cards** (`#coverage-cards`): a total-anchors+claims card,
  one card per coverage state with its count (in precedence order), and a
  duplicate-`anchor_id` card only when `duplicateAnchorIds.length > 0`. Per-
  state cards are real `<button type="button">` elements with
  `aria-pressed` reflecting whether that state is in the active filter;
  clicking toggles it in/out of `state.coverageStates` and reloads from the
  server. The total/duplicate cards are non-interactive `<div>`s (nothing in
  the plan asks them to filter anything, and there's no "duplicate" coverage
  state to filter by).
- **Filter rail**: project `<select>` (server-side scoped — see below),
  free-text anchor-name `<input type="search">` (client-side only, debounced
  150ms), and a "Clear filters" button. All three persist through
  `coverageProject`/`coverageStates`/`coverageSearch` URL query params,
  added to `KNOWN_URL_PARAMS` and round-tripped through
  `applyUrlStateToControls`/`paramsForState`, mirroring exactly how the Tasks
  tab's filters persist (studied that tab's pattern per the plan's
  instruction).
- **Records table** (`#coverage-table`): a real `<table>` with
  `<th scope="col">` headers (Kind, Anchor, State, Reasons, Suggested
  operations), a visually-hidden (`.sr-only`) `<caption>` for screen
  readers, one row per record. Anchor name is a deep link
  (`anchorHref(anchorName)` + `data-anchor-name`, reusing the existing
  global `#content-area` click-delegation that already handles anchor
  navigation everywhere else in the UI — no new link-handling code needed).
  State is a `<span class="badge">` with the human label as text (never
  color-only). Reasons render as `code: message (line N)`. Suggested
  operations render as plain inert `<span>` labels — never buttons, since
  there is no write/migration tooling yet.
- **Pagination**: `loadCoverage()` always sends `limit=100`; `Load more`
  calls `loadMoreCoverage()` with the last response's `nextCursor`,
  appending (de-duplicated by kind+anchorName+line) rather than replacing,
  and is hidden/disabled appropriately. The endpoint's unbounded record set
  is never fetched.
- **Accessibility**: real focusable `<button>`s for every interactive
  control (state cards, refresh, clear filters, load more); `role="group"`
  + `aria-label` on the cards container; `aria-live="polite"` on the
  screen-reader-visible count paragraph; state badges are text, not color
  alone.

### Design decision: project filter is server-side, text filter is client-side

The plan calls out three filter-rail dimensions (project, state, text) but
doesn't specify which round-trip to the server. I chose:

- **State and project both query the server** (`states=`/`project=` on
  `GET /api/ui/graph-coverage`), because `ClaimCoverageRecord` has **no
  `projectSlug` field** — only anchor records carry one. A client-side-only
  project filter would have to silently drop every claim row (or invent an
  anchor-name-based heuristic the endpoint doesn't guarantee), whereas
  server-side `project` scoping filters claims correctly by scoping the
  whole tree read to that project's anchors before analysis even runs. This
  also keeps `Load more` correctly scoped to the active project instead of
  paging through irrelevant records.
- **Free-text anchor-name search stays client-only**, since the endpoint has
  no text-search parameter (confirmed via `graphCoverage`'s input type in
  `src/anchorService.ts` and `test/uiHttp.test.ts` — not modified).
- Because project scoping shrinks `state.coverageRecords` server-side, the
  project `<select>`'s own option list is **not** re-derived from the
  current (possibly project-scoped) record set on every render — that would
  make it impossible to switch back to a different project once one filter
  was applied. Instead `state.coverageKnownProjects` is a running union
  across every load (mirrors how the Tasks tab's own project dropdown is
  populated from `state.anchors`, the global anchor list, never from
  `state.tasks`, the currently-filtered task set).

### Tests

- `test/uiViewModel.test.ts`: 23 new tests under a new "Schema Coverage view
  model" describe block — state/kind labeling, project derivation
  (anchor-scoped, claims excluded), single and combined AND-filtering,
  server query-param construction (project/states only, text omitted),
  URL round-trip (including dropping unknown state tokens instead of
  throwing), stable record keys, and cursor-append de-duplication
  (including an empty-page no-op).
- `test/uiHttp.test.ts`: 2 new tests — one asserting the served `/ui` HTML
  contains the Coverage tab button, view shell, cards container, filter
  controls, an accessible `<table>` with `scope="col"` headers, and the
  Load more button; one asserting the served `/ui/app.js` bundle contains
  the Coverage tab's load/filter/show functions and the
  `/api/ui/graph-coverage` fetch path. No existing test was changed.
- Manually verified the embedded `UI_JS` template string is syntactically
  valid JavaScript by compiling the branch with `tsc`, importing the
  compiled `UI_JS` export, and running `node --check` against it (the
  string can't be executed against a real DOM without a browser/jsdom
  harness, which the existing test suite doesn't use for this file either —
  it only smoke-tests HTML/JS *content* via `fetch`, which this handoff's
  new tests follow).

## Deviations from the plan

None. Every WP-B bullet (tab, summary/state cards with click-to-filter,
filter rail with URL persistence, table with deep links/badges/reasons/
inert suggested-operation labels, cursor-based Load more, accessibility)
was implementable exactly as specified against the existing
`GET /api/ui/graph-coverage` endpoint — no response field was missing, so
`src/ui/routes.ts` did not need to change.

## Notes for whoever reconciles WP-A and WP-B at merge time

- The two branches touch disjoint files by design
  (`src/anchorService.ts`/`src/validators/*` vs. `src/ui/assets.ts`/
  `src/ui/viewModel.ts`) and should merge cleanly aside from this
  `HANDOFF.md` itself, which both branches independently overwrite — whoever
  merges second should fold both summaries together (or keep them as
  sequential sections) rather than silently dropping one.
- Once WP-A's mint-on-create ships, newly-created anchors will start
  carrying `anchor_id`/`schema_version` immediately, which should visibly
  shift the Coverage tab's state distribution over time (more `structured`,
  fewer `partial`/`prose_only`) with no UI changes required — the UI only
  ever reads `graphCoverage`'s output, it doesn't assume anything about how
  ids got minted.
- The Coverage tab has no write/migration actions yet (by design — "inert
  labels... no buttons that pretend to migrate"). The design doc's original
  canvas vision describes "a previewable guided migration action" and
  before/after previews as a later step; this slice intentionally stops at
  read-only cards + table per the Phase 2 plan's explicit WP-B scope.
- `src/ui/viewModel.ts`'s new Coverage functions are unused by
  `src/ui/routes.ts` today (unlike `toAnchorUiMeta`/`toAnchorUiDetail`,
  which shape JSON responses). If a future change wants the server to do
  any Coverage-specific response shaping, these functions already exist and
  are tested; if that need never materializes, they still stand alone as
  the tested spec the browser mirror is built against.
