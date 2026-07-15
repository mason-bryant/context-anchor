# Goal 0 Phase 2, slice 3b — warn→block enforcement mode (`anchorSchema.mode`): handoff

Branch: `feat/goal0-enforcement-mode` (off `origin/main` at the PR #92 merge).
Plan: `ai-output/markdowns/context-conductor/goal0_phase2_enforcement_mode_plan.md`.

Scope, as specified: config + validator only. No `src/ui/*` and no
`src/migration/*` changes (the parallel slice 3a owns the UI).

## Final status

- `npm run typecheck`: clean.
- `npm test`: full suite green. Default `legacy` mode leaves the pre-existing
  suite green with **no fixture edits** (the two new test files add the
  enforcement and config-parse coverage).

## What shipped

- **Config**: `anchorSchema.mode` tri-state (`legacy | warn | enforce`),
  default `legacy`. Parsed from `--anchor-schema-mode` /
  `ANCHOR_MCP_ANCHOR_SCHEMA_MODE` in `src/cli/args.ts` (fail-fast on an
  unknown value); typed as `AnchorSchemaConfig`/`AnchorSchemaMode` on
  `ServerConfig` in `src/types.ts` (the field is **optional** — absent =
  `legacy` — so every existing `ServerConfig` literal, including test
  fixtures that build one for `startHttpServer`, stays valid without edits).
  Threaded `runtime.ts → AnchorService options (anchorSchemaMode?) →
  ValidationContext.anchorSchemaMode` mirroring `migrationWarnOnly`.
- **Validator** `src/validators/anchorSchemaEnforcement.ts` (registered right
  after `validateAnchorIdIntegrity` in `pipeline.ts`): reuses the exported
  `analyzeAnchorCoverage` (`src/graph/coverage.ts`) against a **permissive**
  context so the only structural-gap outcome is `partial`, and enforces that
  record's `suggestedOperations` (`mint_anchor_id` / `add_schema_version` /
  `convert_relation`) as WARN or BLOCK. This guarantees the gate and the
  Coverage view can never disagree about "structured".
- **Docs**: an operator-reference section documenting the dial. The example
  config JSON was intentionally not touched — like `graphScoring` and
  `staleAfterDays`, this key is flag/env-driven, not a config-file key.

## Enforce-scoping rule chosen (plan decision 5)

Gaps are computed from the anchor's own coverage record (permissive context,
no tree scan). On a **create** (`oldContent === undefined`) every gap is
enforced. On an **update**, only gaps whose `code` is NOT already present in
`oldContent`'s gaps are enforced — so:

- an unrelated prose edit to a legacy anchor (gap set unchanged) never starts
  blocking it;
- adding a fresh legacy relation target (a new `convert_relation` gap) blocks;
- fixing the last gap (record becomes `structured`) passes.

`malformed`/`prose_only`/`structured` states are never enforced (malformed is
owned by the front-matter and relations-shape validators; the other two have
nothing to enforce). Built-in and non-anchor paths are skipped.

## Notes for the coverage-threshold follow-up

This slice ships the **manual** dial only. The design's auto-graduation
(a per-repo coverage threshold that flips `warn`→`enforce` once structured
coverage crosses it) is not implemented; when it lands it should compute the
threshold from the same `graphCoverage` summary the Coverage tab shows and
set the effective mode, leaving this validator's per-write logic unchanged.
