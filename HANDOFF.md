# Goal 0 Phase 2, slice 4 — re-key the derived graph to v2 identities: handoff

Branch: `feat/goal0-graph-rekey` (off `origin/main` at the PR #93 merge,
`4dfee23`). Plan: `ai-output/markdowns/context-conductor/goal0_phase2_graph_rekey_plan.md`
(the final Goal 0 substrate step / migration-strategy step 7).

Scope, as specified: `src/graph/*`, `src/ui/routes.ts` + the graph service
(`AnchorService.graphNeighbors`), and tests. No graph canvas, no migration
ops, no Coverage UI, no enforcement validator.

## Final status

- `npm run typecheck`: clean.
- `npm test`: full suite green (1060 tests). Fixtures **without** `anchor_id`
  are unchanged; only the WP3 typed-relation fixtures that **do** set
  `anchor_id` (and the scoped-goal cases) were updated to expect v2 endpoints —
  the expected, correct churn. A few pre-existing tests that write anchors via
  the mint-on-create write path (`claims.test.ts`, `uiHttp.test.ts`,
  `graphIndex.test.ts` revert) now derive the minted `anchor_id` and assert the
  v2 node id instead of the old path-based id.

## The core rule (as shipped)

A node is keyed **v2** when its owning anchor has a valid `anchor_id`
(`anchor:<anchor-id>`, `milestone:<anchor-id>`, `task:<anchor-id>#<id>`,
`section:<anchor-id>#<heading>`, `claim:<anchor-id>#<id>`), and a goal node is
keyed v2 (`goal:<project-slug>:<goal-id>`) when its scoping project is
**unambiguously** known. Otherwise the node keeps its path-based / unscoped
**v1** id. Gradual by construction — no flag, no forced tree-wide re-key.

## What shipped

- **`src/graph/canonicalIds.ts`** (new): pure `canonical*NodeId` resolvers,
  each taking the tree-wide `anchorName -> anchorId` map (+ a
  `goalId -> projectSlug` resolver for goals) and falling back to the v1
  constructor in `model.ts`. Plus query-time normalizers
  (`canonicalizeNodeId` for anchor/goal ids via the compat map, and structural
  re-keying of the anchor-path-embedding kinds milestone/task/section/claim;
  `canonicalizeAnchorSourceNodeId` / `canonicalizeSectionNodeId` for
  `parseClaimSource`-derived source nodes).
- **`src/graph/extract.ts`**: every raw v1 emission site now routes through the
  canonical resolvers, sourced from a new `canonicalIds` field on the extract
  context (defaults to `ALL_V1_CANONICAL_RESOLVERS` when a caller supplies no
  ids, so an id-less tree emits exactly the pre-slice-4 shapes). A typed goal
  ref (`goal:<project>:<goal-id>`) scopes directly to its **named** project
  (already gated to that project's roadmap), correct even when the same goal id
  is globally ambiguous. Claim-source `anchor:`/`section:` nodes are re-keyed to
  the same canonical node the owning anchor uses.
- **`src/graph/index.ts`**: builds the canonical resolvers into the extract
  context (`anchorIdByName` + a single-owner `goalId -> project` inversion of
  the existing `knownGoalIdsByProject`, reusing pass-1 data — no re-scan).
  Exposes `identityCompatibilityMap()` (built via the existing
  `buildIdentityCompatibilityMap`, HEAD-keyed) and `canonicalizeNodeId()`.
- **`src/anchorService.ts`**: `graphNeighbors` canonicalizes the resolved node
  id through the compat map **before** traversal, so an old v1/path deep link
  (or a plain anchor-name / `G-###` input) resolves to the current v2 node.
- **`src/graph/proximity.ts`**: canonicalizes each planner signal node id and
  resolves discovered v2 anchor nodes **back to their anchor name** (the boost
  map is anchor-name-keyed, looked up by `anchor.name` in `contextPlanner.ts`),
  so proximity boosts still land on migrated anchors when graph scoring is on.

## Incremental-parity approach: conservative full-invalidation on id change

The incremental path (`GraphIndex.invalidateDocument`) reuses `anchorIdByName`
from the **last full rebuild** (it is not recomputed per document — see the
field docstring). Re-keying one document precisely on an id change is
intricate: a changed `anchor_id` must also re-key every **other** document's
edges that target this anchor, and the reused map is stale for resolving the
anchor's own new id. Since the existing incremental contract explicitly permits
full invalidation for id-affecting changes, `invalidateDocument` now compares
the freshly-read `anchor_id` (format-gated) to the cached one and, on any
change (gained / lost / replaced), falls back to `this.invalidate()` — the next
query does a clean rebuild. This makes **incremental == clean rebuild** hold by
construction. A write that does **not** touch `anchor_id` (the overwhelmingly
common case, incl. a revert that keeps the immutable id) still takes the cheap
per-document path. Covered by the parity test in `test/graphRekey.test.ts`.

## Node kinds intentionally left v1 (and why)

- **A node whose owning anchor has no `anchor_id` yet** — the entire point of
  the gradual contract. It re-keys automatically once the anchor gains an id.
- **A goal with zero or ≥2 owning projects** — unknown or ambiguous scope; the
  compat map reports it `unmapped` and it stays `goal:<goal-id>` (v1). Scoping
  it to an arbitrary project would be wrong. A goal owned by exactly one
  project scopes to v2. (A typed `goal:<project>:<id>` **ref** still scopes to
  its explicitly-named project even under global ambiguity, since the ref
  itself disambiguates.)
- **`project` / `person` / `team` / `repo` / `path` / `pr` / `file` / `url`
  nodes** — out of scope: these are not anchor-owned and have no v2 identity in
  the Phase-1 contract; their ids are unchanged.

## Notes for the pilot migration

- Which anchors re-key once they gain ids: any anchor that gains a valid
  `anchor_id` re-keys its own `anchor:` node **and** its `milestone:` / `task:`
  / `section:` / `claim:` nodes, and every edge (typed relations, body links,
  claim edges, milestone/roadmap containment) whose endpoint is that anchor.
  Goals re-key to `goal:<project>:<id>` as soon as exactly one project's roadmap
  owns them — which is already the common case, so goal nodes may re-key ahead
  of any anchor `anchor_id` mint.
- Old deep links stay resolvable: the graph-neighbors route normalizes an
  incoming path / v1 id / v2 id to canonical before traversal, so bookmarked
  `anchor:<path>` / `G-###` links keep working. If the pilot exposes other
  entry points that accept a raw node id, route them through
  `GraphIndex.canonicalizeNodeId` too.
- The migration op that mints ids (Goal 0 Phase 2 WP-A, out of scope here)
  drives re-key purely by writing `anchor_id`; because each id-affecting write
  triggers a full graph invalidation, a batch mint over many anchors will
  rebuild the graph rather than fold in per-document — acceptable for a one-off
  migration, but worth a single `invalidate()` + one rebuild if minting the
  whole tree at once.
