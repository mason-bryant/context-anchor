# Migrating legacy anchors to the structured (Goal 0) substrate

This guide walks you through migrating an existing anchor repository so its
anchors carry stable identities and typed relationships.

Everything here is **preview-first, git-backed, and reversible**. Nothing
changes on disk until you approve a specific diff, and every change is an
ordinary anchor commit you can `git revert`.

---

## What this is

Newly created anchors are already "born structured" — the server mints an
immutable `anchor_id` and a `schema_version` on create. But anchors authored
*before* that shipped are still keyed by their file path and lack those
fields, so the derived knowledge graph can't give them a rename-safe identity
and reports them as **partial** or **prose_only** in the coverage view.

Migration brings those legacy anchors up to the structured contract by
applying small, surgical edits to their front matter and claims:

| Operation | What it does |
|---|---|
| `mint_anchor_id` | Adds an immutable server-minted `anchor_id` (the anchor's durable graph identity, independent of its path). |
| `add_schema_version` | Adds `schema_version: 1`. |
| `mint_claim_ids` | Adds a stable `{id: c-…}` to each **unannotated** claim that lacks one, so it becomes graph-addressable while staying visibly unverified. (Annotated claims already have ids and are left untouched.) |
| `convert_relation` | Rewrites a legacy bare-string `relations.*` target (e.g. `depends_on: [projects/x/y.md]`) to a canonical typed ref (`depends_on: [anchor:a-…]`) — **only when the target anchor already has an `anchor_id`**. |
| `scope_goal_reference` | Rewrites a bare goal id under a typed `implements` relation to `goal:<project>:<goal-id>` — only when exactly one project's roadmap defines that goal. |

Narrative prose, formatting, existing annotations, and headings are
**byte-identical** before and after. Only the targeted front-matter fields
and inserted annotation lines change.

---

## Safety guarantees

- **Preview before apply.** `previewAnchorMigration` returns the *exact bytes*
  an apply would commit, a unified diff, the per-operation outcomes, and any
  validation warnings — without touching anything.
- **Approval-gated apply.** `applyAnchorMigration` refuses to run without
  `approved: true` and an `expectedFileCommit` (the base revision you
  previewed against), so a stale base is rejected rather than silently
  re-planned.
- **Idempotent.** Re-running a migration is a no-op — a second apply reports
  `noChangesNeeded` and makes no commit.
- **Recoverable.** Every apply is one git commit touching one anchor. Undo is
  `git revert <commit>`; audit is `git log`.

---

## Before you begin

1. **Point the server at your repo.** Run the anchor-mcp server against the
   repository you want to migrate (via MCP, or the HTTP transport for the UI /
   routes). The migration tools and routes are only available on a build that
   includes them.
2. **Keep enforcement off during migration.** Leave `anchorSchema.mode` at its
   default (`legacy`) while migrating — you don't want the enforcement dial
   blocking writes mid-migration. Turn it up to `warn`/`enforce` *after* the
   repo is migrated, if you want it.
3. **Start from a clean-ish git state** so the migration commits stay cleanly
   separable from unrelated edits.
4. **Migrate one project first.** Scope the pilot to a single project
   (`project=<slug>`), review the results, then decide whether to roll out to
   the rest.

---

## The one ordering rule

`convert_relation` only rewrites a target once that target anchor **has an
`anchor_id`**. So on a repo where nothing has ids yet, relation conversion is
skipped on the first pass (reported as `target_missing_anchor_id`).

The practical consequence: **run the migration over the project twice.** The
first pass mints every anchor's id; the second pass converts the relations
that now resolve. (Everything else — schema versions, claim ids — completes in
the first pass.)

---

## Running it with an AI agent (copy-paste prompts)

These assume your agent has the anchor-mcp MCP tools (`graphCoverage`,
`previewAnchorMigration`, `applyAnchorMigration`). Replace `<PROJECT>` with
your project slug.

> **These are interactive loops, not a paste-and-forget script.** The
> migration is preview-first: the agent shows you a diff and then **waits for
> you to reply `approve` or `skip`** before it writes anything. If you paste
> the *next* step instead of approving, nothing gets applied — the agent is
> still holding at the approval gate, and your coverage will stay exactly at
> baseline. Reply to the approval prompt (or use the batch flow below) before
> moving on.
>
> **For more than a few anchors, use the batch flow.** Approving anchor-by-
> anchor means one round-trip per anchor. The first-pass edits are uniform,
> purely additive, and byte-preserving, so reviewing one summary and approving
> **once** for the whole batch is the practical default. The per-anchor
> variant is there if you'd rather eyeball every diff.

### Step 0 — Baseline (read-only survey)

```
Using the anchor-mcp graphCoverage tool, survey the structural coverage of
project <PROJECT>. Group anchors by coverage state (structured / partial /
prose_only / ambiguous / dangling / malformed). For every anchor that is not
already structured, list its name, its reasons, and its suggested operations.
Do not modify anything — this is a read-only baseline. Finish with a count of
how many anchors are already structured vs. need migration, and save the
summary so we can compare against it afterward.
```

### Step 1 — First pass, batch (mint ids, schema versions, claim ids) — recommended

Review one summary, approve once, apply the whole project:

```
Run the first migration pass over every non-structured anchor in project
<PROJECT>, in BATCH. First, call previewAnchorMigration on ALL of them (no
operations field) WITHOUT applying anything, and give me:
  - a compact table: anchor name | operations that would apply | # claim ids
    minted | any warnings
  - the full unified diff for 2-3 representative anchors so I can sanity-check
    the shape.
Then STOP and wait. When I reply "apply all", apply each anchor with
approved: true and that anchor's OWN preview fileCommit, committing one anchor
at a time, and show me a running progress count (n of N). Before applying,
flag and pause on any anchor whose preview changes something OUTSIDE
front-matter fields and inserted annotation lines, or that reports a
BLOCK-severity warning. This pass is mint-only — do not convert relations yet.
```

Each anchor's preview `fileCommit` stays valid even as other anchors get
committed (committing anchor A doesn't change anchor B's last revision), so
previewing all up front and applying in sequence is safe — no stale-base
errors.

<details>
<summary>Per-anchor variant (approve/skip each diff individually)</summary>

```
Run the first migration pass over every non-structured anchor in project
<PROJECT>. For each anchor, in order:
  1. Call previewAnchorMigration with just its name (no operations field, so
     every applicable operation is evaluated).
  2. Show me the unified diff and the per-operation outcomes.
  3. Wait for me to reply "approve" or "skip".
  4. On approve, call applyAnchorMigration for the same anchor with
     approved: true and expectedFileCommit set to the fileCommit from that
     preview. Then confirm the commit landed and that nothing outside the
     front-matter fields and inserted annotation lines changed.
Never apply without showing me the diff first. Do not move on until I reply
approve or skip for the current anchor. It is expected that convert_relation /
scope_goal_reference report "skipped: target_missing_anchor_id" or similar in
this pass — we handle relations in the second pass. Keep a running log of
migrated / skipped / warnings.
```

</details>

### Step 2 — Second pass (convert relations)

Same batch pattern — preview all, approve once. Often a no-op: if the Step 0
survey showed nothing suggesting `convert_relation` / `scope_goal_reference`,
your anchors have no legacy relation targets and you can skip straight to
Step 3.

```
Now run the second pass over project <PROJECT> to convert legacy relation
targets, now that every anchor has an anchor_id. First previewAnchorMigration
(WITHOUT applying) on every anchor that STILL suggests convert_relation or
scope_goal_reference, and show me a table of what would change plus the full
diffs. Then STOP. When I reply "apply all", apply each with approved: true and
its own preview fileCommit, one anchor at a time, with a progress count. If any
target reports target_missing_anchor_id, flag it — that target anchor wasn't
migrated in the first pass, and it must be migrated before its reference can be
converted. If no anchor suggests either operation, tell me there is nothing to
convert and stop.
```

### Step 3 — Verify

```
Re-run graphCoverage for project <PROJECT> and compare it to the Step 0
baseline. Report how many anchors moved from partial to structured, and list
any that are still not structured together with the reason. Confirm the
migration is complete (re-previewing a migrated anchor should report no
changes needed).
```

### One-shot variant (if you trust the flow and just want it done with gates)

```
Migrate project <PROJECT> to the structured substrate. Do it in two passes
because relation conversion needs its target anchors to already have ids:
pass one mints ids/schema/claim-ids on every non-structured anchor, pass two
converts the relations. For EACH pass, first previewAnchorMigration on all
applicable anchors WITHOUT applying, show me a summary table plus a couple of
representative diffs, then STOP and wait for me to reply "apply all" before
applying that pass (each anchor with approved:true and its own preview
fileCommit, one commit per anchor). Never apply a pass before I approve it.
Give me a final before/after coverage comparison.
```

---

## Running it in the browser (Coverage tab)

If you serve the first-party UI, open the **Coverage** tab, filter to your
project, and use the per-row **Migrate** button. It opens a review panel with
the diff, the per-operation outcomes, and any warnings; **Apply migration**
commits and refreshes the table. Because of the ordering rule, migrate to give
anchors their ids first, then revisit rows that still show a `convert_relation`
suggestion.

---

## Running it by script (HTTP)

The same operations are available as authenticated HTTP routes. Send the auth
token as `Authorization: Bearer <token>`.

```bash
# 0. Worklist: coverage for a project (read-only)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/ui/graph-coverage?project=<PROJECT>&states=partial,malformed&limit=500"

# 1. Preview one anchor (no mutation). Omit "operations" to evaluate all.
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE/api/ui/anchor-migration-preview" \
  -d '{"name":"<ANCHOR_NAME>"}'
#   -> returns { fileCommit, changed, diff, outcomes, warnings, newContent }

# 2. Apply it (requires approved + the preview's fileCommit)
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE/api/ui/anchor-migration-apply" \
  -d '{"name":"<ANCHOR_NAME>","approved":true,"expectedFileCommit":"<FILE_COMMIT_FROM_PREVIEW>"}'
```

To scope a call to specific operations, add e.g.
`"operations":["mint_anchor_id","add_schema_version","mint_claim_ids"]` (a
non-empty subset; omit the field to run every applicable operation). Loop
preview→apply per anchor, run the whole loop twice (mint pass, then convert
pass).

---

## Rollback

Each apply is a single commit. To undo one anchor's migration:

```bash
git revert <commit>          # inverse commit, preserves history
# or, before any push, to drop the last migration commit entirely:
git reset --hard HEAD~1
```

Because migration is idempotent, you can also simply re-run it later — a
migrated anchor previews as "no changes needed".

---

## Reference

**Coverage states:** `structured` (complete) · `partial` (graphable but
missing ids/schema/typed relations) · `prose_only` (no graph-participating
structure) · `ambiguous` / `dangling` / `malformed` (reference or shape
problems to fix by hand, not by migration).

**Common skip reasons on an outcome:**

| Reason | Meaning |
|---|---|
| `already_present` | The field/id is already there. |
| `no_unannotated_claims` | Every claim already has an id. |
| `no_relation_targets` | No matching relation arrays to inspect. |
| `target_not_legacy` | The relation target is already canonical (or a malformed typed ref to repair by hand). |
| `target_missing_anchor_id` | The target anchor has no id yet — migrate it first, then convert. |
| `target_duplicate_anchor_id` | The target's `anchor_id` is declared by more than one anchor — fix the duplicate first. |
| `goal_unknown` / `goal_ambiguous` | The goal id is defined by no project, or by more than one — not scoped. |

**Tools / routes:** `graphCoverage` · `previewAnchorMigration` ·
`applyAnchorMigration` (MCP), and `GET /api/ui/graph-coverage` ·
`POST /api/ui/anchor-migration-preview` · `POST /api/ui/anchor-migration-apply`
(HTTP).
