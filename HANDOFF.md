# Goal 0 Phase 2, WP-A — mint anchor_id + schema_version on create: handoff

Branch: `feat/goal0-mint-on-create` (off `main`, i.e. off the merged Phase 1
PR #88 / `afa16f2`). Authoritative plan: WP-A section of
`ai-output/markdowns/context-conductor/goal0_phase2_mint_on_create_and_coverage_ui_plan.md`
("the plan" below); background design in
`goal0_semantic_substrate_implementation_plan.md` and the Goal 0 section of
`knowledge_graph_visualization_design_and_roadmap.md`.

This is one of two independent Phase 2 work packages running in parallel
(WP-B owns the Schema Coverage UI, in a separate branch/worktree). Per the
plan's file ownership split, this work touched only `src/anchorService.ts`
(write paths), a new `src/validators/anchorIdIntegrity.ts`, `src/validators/pipeline.ts`
(registration), and tests. `src/ui/assets.ts`, `src/ui/viewModel.ts`, and
`src/graph/coverage.ts` were not touched.

## Final status

- `npm run typecheck`: clean.
- `npm test`: **949 tests passing, 45 files, 0 failures.**
- Commits (4, each typecheck+test green):
  1. Core mint-on-create + immutability/duplicate validator, with 3
     pre-existing tests updated for the new (intended) behavior.
  2. New `test/anchorIdMinting.test.ts` covering the plan's full WP-A test
     list (12 tests).
  3. A perf refinement: skip the validator's tree-wide duplicate scan when
     a write's `anchor_id` is unchanged from the committed value.

## What was delivered

### Mint-on-create (`AnchorService.writeAnchor`, `src/anchorService.ts`)

Right before `runValidators` (so the committed document is exactly what was
validated), on the **create path only** (`oldContent === undefined`) and only
when `classifyAnchorPath(resolved.name).kind === "anchor"` (excludes
generated docs like `CONTEXT-ROOT.md` and anything that fails taxonomy
classification, which `validateDirectoryTaxonomy` blocks anyway):

- If the author did not supply `anchor_id`, mint one via `mintAnchorId`
  (`src/graph/identity.ts`), collision-checked against every `anchor_id`
  already in the tree (new `collectTreeAnchorIds` helper, excluding the
  anchor being written, mirroring `collectTreeClaimIds`'s exact shape).
- If the author did not supply `schema_version`, set it to `1`.
- If the author already supplied a valid `anchor_id` and/or `schema_version`,
  both are kept as-is (no overwrite).

Front-matter injection reuses `mergeAnchorFrontmatter` (`src/anchorPatch.ts`,
itself a thin wrapper over `gray-matter`'s `matter`/`matter.stringify`) — no
hand-rolled YAML, and every other front-matter field plus the body is
preserved byte-for-byte except for the merged keys.

### `anchor_id` integrity validator (`src/validators/anchorIdIntegrity.ts`, new)

Registered in `src/validators/pipeline.ts` right after `validateFrontMatter`
(format validation happens first; this validator only reasons about presence/
change, not shape — `ANCHOR_ID_PATTERN` format-checking already lives in
`AnchorFrontmatterSchema` from WP2). Two BLOCK checks, unconditional (not
gated behind `migrationWarnOnly` — same posture as claim-id duplicate/
immutability checks already in `anchorService.ts`, since an id collision or a
mutated immutable id is a correctness break, not a legacy-shape migration
nicety):

1. **`anchor_id_immutable`**: an update (`oldContent` present) that changes or
   removes an anchor's existing `anchor_id` is blocked. Re-supplying the
   identical id, or adding an id where none existed, is allowed.
2. **`anchor_id_duplicate`**: whether the id arrived via create-mint,
   caller-supplied on create, or added to a previously id-less legacy anchor,
   it is blocked if it collides with another anchor's id anywhere in the
   tree. The scan is skipped when this write's `anchor_id` is unchanged from
   the already-committed value, so ordinary re-writes of an already-id-bearing
   anchor stay cheap.

### Tests

- `test/anchorIdMinting.test.ts` (new, 12 tests): every behavior in the
  plan's WP-A test list — mint on create + committed-file assertion,
  caller-supplied valid id/schema_version kept, duplicate supplied id on
  create blocks, update never mints (legacy anchor stays id-less), changing/
  removing an existing id blocks (`anchor_id_immutable`), identical id
  passes, adding an id to a legacy anchor works and duplicate-checks,
  `renameAnchor` preserves the id (no code needed — confirmed by test only,
  per the plan's instruction), generated documents are never minted, two
  concurrent creates mint distinct ids.
- Three pre-existing tests updated (see "Deviations" below).

## Deviations from the plan, and why

1. **Three pre-existing tests needed updating because they regenerated full
   anchor content from a pre-mint fixture template on an update write.** This
   isn't a plan deviation in behavior — it's the expected, correct consequence
   of mint-on-create actually taking effect: once a create write mints an
   `anchor_id`, any later `writeAnchor` call that reconstructs content from
   scratch (rather than reading-modifying-writing) will either shift hardcoded
   line numbers (front matter gained a line) or trip the new immutability
   BLOCK (the regenerated content has no `anchor_id`, which reads as removing
   it). Fixed by having each test read back the actually-committed content
   after create and derive the update from that, instead of from the static
   template:
   - `test/anchorService.test.ts` — "requires explicit approval for decisions
     changes".
   - `test/claims.test.ts` — "sets multiple sources by line and resolves
     source links" (hardcoded `line: 19`; now located dynamically by claim
     text).
   - `test/graphIndex.test.ts` — "invalidates the touched document's graph
     edges after revertAnchor".
   No other test in the 937-test pre-existing suite was affected — these were
   the only three that both (a) wrote-then-rewrote the same anchor and (b)
   reconstructed content from a static fixture rather than mutating the
   read-back content.
2. **`anchor_id_immutable`/`anchor_id_duplicate` are unconditional BLOCKs, not
   `maybeMigrationBlock`-gated (soft under `migrationWarnOnly`).** The plan
   states both as BLOCK without qualification. Some other validators in this
   codebase (`validateFrontMatter`, `validateMilestoneProjectUniqueness`) use
   `maybeMigrationBlock` to soften legacy-shape violations during a migration
   window. I judged `anchor_id` integrity to be closer in kind to the
   existing claim-id duplicate/immutability checks in `anchorService.ts`
   (also always-BLOCK, no migration softening) than to front-matter shape
   validation, since a broken identity guarantee (collision or mutation) is
   never something you'd want to warn-and-proceed on, even mid-migration. If
   this is wrong, swapping `violation("BLOCK", ...)` for
   `maybeMigrationBlock(context, ...)` in `src/validators/anchorIdIntegrity.ts`
   is a small, isolated change.
3. **Renaming required no code change**, confirmed by
   `test/anchorIdMinting.test.ts`'s rename test — `renameAnchor` moves the
   file via `git mv` (`AnchorRepository.renameAnchorFile`) and never touches
   content, so the `anchor_id` in front matter travels automatically. Exactly
   as the plan anticipated ("add a test proving it, don't add code unless the
   test fails").

## Notes for whoever picks up the next slice

- **`AnchorFrontmatterSchema`'s `anchor_id`/`schema_version` format
  validation (WP2, already shipped in Phase 1) still runs first** in the
  validator pipeline (`validateFrontMatter` before `validateAnchorIdIntegrity`
  in `pipeline.ts`), so a malformed id/version is caught as
  `front_matter_schema` before this validator ever inspects it.
- **No retroactive/bulk minting was implemented or attempted** — per the
  plan, legacy anchors stay id-less until an explicit migration write adds an
  id (which `writeAnchor`'s update path already supports today: adding an id
  to a previously id-less anchor is allowed and duplicate-checked, since that
  is exactly the mechanism a future migration operation would use).
- **`collectTreeAnchorIds` reads every anchor's raw content on any write that
  needs a duplicate check** (create without a supplied id, create with a
  supplied id, or an update that adds/changes an id). This mirrors
  `collectTreeClaimIds`'s existing cost profile exactly (same tree walk,
  same exclude-self shape) — no new performance envelope was introduced
  beyond what claim-id minting already pays on the same kinds of writes.
- **WP-B (Schema Coverage UI) is unaffected**: no changes were made to
  `src/ui/assets.ts`, `src/ui/viewModel.ts`, or `src/graph/coverage.ts`. The
  `GET /api/ui/graph-coverage` response shape WP-B consumes is untouched by
  this work.
