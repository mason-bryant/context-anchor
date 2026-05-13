# Milestones

A milestone groups a set of roadmap goals under a theme or steel-thread description. It lives in `projects/<slug>/milestones/` and uses `type: project-milestone` with a validated front-matter overlay.

Milestones integrate with `planContextBundle`: an `active` milestone's theme and goal IDs boost the milestone anchor and its sibling roadmap during context assembly, so agents loading context for a task automatically surface the right planning material.

## Upgrading a roadmap to use stable goal IDs

Milestone anchors reference goals by a stable `G-###` ID embedded in each goal's `###` heading. Before writing your first milestone, rename your roadmap's goal headings:

```md
<!-- Before -->
### Goal 1 -- Define next milestone

<!-- After -->
### Goal G-001 -- Define next milestone
```

Rules:

- Prefix is `G-` followed by one to six digits, zero-padded to at least three (`G-001`, `G-042`, `G-100`).
- IDs must be unique within a roadmap.
- The server only **enforces** this format when a milestone in the same project uses `relations.goal_ids`. You can rename incrementally and the validator will not block existing anchors without milestones.

## Creating a milestone anchor

Create a file at `projects/<slug>/milestones/<name>.md`:

```md
---
project:
  - your-slug
type: project-milestone
tags:
  - milestone
summary: "One sentence describing what this milestone delivers."
read_this_if:
  - "You are planning work in <theme area>."
last_validated: 2026-05-12
schema_version: 1
theme: "Short theme label"
steel_thread: "One sentence: the single outcome that makes this milestone coherent."
status: proposed
relations:
  goal_ids:
    - G-001
    - G-004
---

# Milestone -- <Name>

## Current State

- Not yet started.

## Decisions

- (Scope and sequencing decisions go here.)

## Constraints

- (Hard limits that shape this milestone.)

## PRs

None.
```

### Required front-matter fields

| Field | Type | Description |
|---|---|---|
| `schema_version` | `1` | Must be exactly `1` |
| `theme` | string (1–480 chars) | Short label; matched against task terms by the planner |
| `steel_thread` | string (1–480 chars) | Optional. The unifying outcome for this milestone |
| `status` | `proposed` \| `active` \| `shipped` \| `cancelled` | `active` gets the strongest planner boost |
| `relations.goal_ids` | array of `G-###` strings, min 1 | Must reference goals that exist in the sibling roadmap |

All standard anchor front-matter fields (`type`, `tags`, `summary`, `read_this_if`, `last_validated`) are also required.

### Status lifecycle

Update `status` as work progresses:

```
proposed → active → shipped
                 ↘ cancelled
```

When a milestone ships, set `status: shipped`, record the date in `## Current State`, and move the corresponding goal entries in the roadmap to `## Completed`.

## MCP tools

### `listMilestones`

Lists all milestone anchors for a project, with `status`, `theme`, and `goalIds` for each:

```json
{ "project": "your-slug" }
```

### `readMilestone`

Returns the full milestone anchor plus the resolved sibling roadmap and a `goals` array confirming each referenced `G-###` heading was found:

```json
{ "name": "projects/your-slug/milestones/your-milestone.md" }
```

Each entry in `goals` reports `hasAcceptanceCriteria: true/false`. Goals missing `#### Acceptance Criteria` sections produce a warning on write.

### `getRelated`

Traverses the `relations:` front matter of any anchor and returns the linked anchors. For a milestone, this resolves `goal_ids` to the sibling roadmap:

```json
{ "name": "projects/your-slug/milestones/your-milestone.md" }
```

You can also call `getRelated` on any other anchor that carries a `relations:` mapping.

### `planContextBundle` with milestones

Pass a task description that includes words from your milestone's `theme`. The milestone anchor ranks first and the sibling roadmap gets an `activeCanonicalRoadmapBoost`:

```json
{
  "task": "implement hybrid retrieval and evaluation harness",
  "project": "your-slug",
  "budgetTokens": 8000
}
```

The `reason` field for included anchors will include `"milestone theme matched task term"` when the boost fires.

## Validation rules

| Code | Trigger | Severity |
|---|---|---|
| `milestone_goal_id_not_found` | A `goal_ids` entry has no matching `### Goal G-###` heading in the sibling roadmap | BLOCK |
| `milestone_goal_missing_acceptance_criteria` | A referenced goal exists but has no `#### Acceptance Criteria` section | WARN |
| `milestone_roadmap_not_found` | No roadmap file found under `projects/<slug>/` | BLOCK |
| `roadmap_goal_stable_id_required` | A roadmap goal uses the old `### Goal N` format and the project has a milestone with `goal_ids` | BLOCK |
| `relations_shape` | `relations:` is not a mapping object, or a value is not an array of strings | BLOCK |
| `typed_overlay_*` | `schema_version`, `theme`, `status`, or `relations.goal_ids` fail the milestone Zod schema | BLOCK |

To unblock incremental migration while cleaning up goal headings, run the server with `--migration-warn-only`. This downgrades all new BLOCK codes to WARN until you remove the flag.

## Example

The `context-conductor` project itself uses this pattern. After upgrading:

- `projects/context-conductor/context-conductor-roadmap.md` — goals `G-001` through `G-014` with acceptance criteria; `G-015` (the milestone infrastructure steel thread) in `## Completed`
- `projects/context-conductor/milestones/retrieval-quality-v1.md` — groups `G-006` (hybrid retrieval) and `G-013` (evaluation harness) under the theme `"Retrieval quality and measurability"`, status `proposed`

Call `readMilestone` on that anchor to see a fully-resolved response with both goals confirmed.
