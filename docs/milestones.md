# Milestones

A milestone groups a set of roadmap goals under a theme or steel-thread description.
It lives in `projects/<slug>/milestones/` and uses `type: project-milestone` with a
validated front-matter overlay.

Milestones integrate with `planContextBundle`: an `active` milestone's theme and goal
IDs boost the milestone anchor and its sibling roadmap during context assembly, so
agents loading context for a task automatically surface the right planning material.

## Upgrading a roadmap to use stable goal IDs

Milestone anchors reference goals by a stable `G-<digits>` ID embedded in each goal's
`###` heading. Before writing your first milestone, call `migrateRoadmapGoalIds` to
assign them automatically:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="migrateRoadmapGoalIds",
  arguments={ "project": "your-slug" }
)
```

The tool reads `projects/<slug>/<slug>-roadmap.md`, renames every bare goal heading in
document order, commits the result, and returns the list of renamed headings. If all
goals already have stable IDs it returns `noChangesNeeded: true` without writing.

Rules:

- Prefix is `G-` followed by one to six digits (`G-1`, `G-42`, `G-100`, `G-001`). For
  consistency, prefer zero-padded three-digit IDs such as `G-001`.
- IDs must be unique within a roadmap.
- Goals with no title (e.g. `### Goal 3`) become `### Goal G-003` with no separator.
- The server only **enforces** this format when a milestone in the same project uses
  `relations.goal_ids`. You can migrate incrementally; existing anchors without
  milestones are not affected.

## Creating a milestone anchor

Call `writeAnchor` with the milestone path and content:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="writeAnchor",
  arguments={
    "name": "projects/your-slug/milestones/your-milestone.md",
    "content": "---\nproject:\n  - your-slug\ntype: project-milestone\ntags:\n  - milestone\nsummary: \"One sentence describing what this milestone delivers.\"\nread_this_if:\n  - \"You are planning work in <theme area>.\"\nlast_validated: 2026-05-12\nschema_version: 1\ntheme: \"Short theme label\"\nsteel_thread: \"One sentence: the single outcome that makes this milestone coherent.\"\nstatus: proposed\nrelations:\n  goal_ids:\n    - G-001\n    - G-004\n---\n\n# Milestone -- <Name>\n\n## Current State\n\n- Not yet started.\n\n## Decisions\n\n- (Scope and sequencing decisions go here.)\n\n## Constraints\n\n- (Hard limits that shape this milestone.)\n\n## PRs\n\nNone.\n"
  }
)
```

### Required front-matter fields

| Field | Type | Description |
|---|---|---|
| `schema_version` | `1` | Must be exactly `1` |
| `theme` | string (1–480 chars) | Short label; matched against task terms by the planner |
| `steel_thread` | string (1–480 chars) | Optional. The unifying outcome for this milestone |
| `status` | `proposed` \| `active` \| `shipped` \| `cancelled` | `active` gets the strongest planner boost |
| `relations.goal_ids` | array of `G-<digits>` strings, min 1 | Must reference goals that exist in the sibling roadmap |

All standard anchor front-matter fields (`type`, `tags`, `summary`, `read_this_if`,
`last_validated`) are also required.

### Status lifecycle

Update `status` as work progresses using `updateAnchorFrontmatter`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="updateAnchorFrontmatter",
  arguments={
    "name": "projects/your-slug/milestones/your-milestone.md",
    "updates": { "status": "active", "last_validated": "2026-05-12" }
  }
)
```

```
proposed → active → shipped
                 ↘ cancelled
```

When a milestone ships, set `status: shipped` and record the date in `## Current State`
using `updateAnchorSection`. Then move the corresponding goal entries in the roadmap's
`## Completed` table using `updateAnchorSection` on the roadmap anchor.

## MCP tools

### `migrateRoadmapGoalIds`

Assigns stable, conventionally three-digit `G-###` ids to bare goal headings in a
project roadmap:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="migrateRoadmapGoalIds",
  arguments={ "project": "your-slug" }
)
```

`startFrom` is optional. By default numbering continues from the highest existing
`G-<digits>` in the roadmap (or starts at `G-001` if none exist). Returns:

```json
{
  "roadmap": "projects/your-slug/your-slug-roadmap.md",
  "assigned": [
    { "from": "### Goal 1 -- Alpha", "to": "### Goal G-001 -- Alpha" },
    { "from": "### Goal 2 -- Beta",  "to": "### Goal G-002 -- Beta"  }
  ],
  "version": "<commit sha>",
  "warnings": [],
  "noChangesNeeded": false
}
```

### `listMilestones`

Lists all milestone anchors for a project, with `status`, `theme`, and `goalIds` for
each:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="listMilestones",
  arguments={ "project": "your-slug" }
)
```

### `readMilestone`

Returns the full milestone anchor plus the resolved sibling roadmap and a `goals` array
confirming each referenced `G-<digits>` heading was found:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="readMilestone",
  arguments={ "name": "projects/your-slug/milestones/your-milestone.md" }
)
```

Each entry in `goals` reports `hasAcceptanceCriteria: true/false`. Goals missing
`#### Acceptance Criteria` sections produce a warning on write.

### `getRelated`

Traverses the `relations:` front matter of any anchor and returns the linked anchors.
For a milestone, this resolves `goal_ids` to the sibling roadmap:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="getRelated",
  arguments={ "name": "projects/your-slug/milestones/your-milestone.md" }
)
```

You can also call `getRelated` on any other anchor that carries a `relations:` mapping.

### `planContextBundle` with milestones

Pass a task description that includes words from your milestone's `theme`. The milestone
anchor ranks first and the sibling roadmap gets an `activeCanonicalRoadmapBoost`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="planContextBundle",
  arguments={
    "task": "implement hybrid retrieval and evaluation harness",
    "project": "your-slug",
    "budgetTokens": 8000
  }
)
```

The `reason` field for included anchors will include `"milestone theme matched task
term"` when the boost fires.

## Validation rules

| Code | Trigger | Severity |
|---|---|---|
| `front_matter_typed_schema` | `schema_version`, `theme`, `status`, or `relations.goal_ids` fail the milestone Zod schema | BLOCK |
| `milestone_goal_unknown` | A `goal_ids` entry has no matching `### Goal G-<digits>` heading in the sibling roadmap | BLOCK |
| `milestone_goal_missing_ac` | A referenced goal exists but has no `#### Acceptance Criteria` section | WARN |
| `milestone_roadmap_missing` | No roadmap file found under `projects/<slug>/` | BLOCK |
| `roadmap_goal_duplicate_id` | The sibling roadmap uses the same stable goal ID on more than one heading | BLOCK |
| `roadmap_goal_stable_id_required` | A roadmap goal uses the old `### Goal N` format and the project has a milestone with `goal_ids` | BLOCK |
| `relations_shape` | `relations:` is not a mapping object, or a value is not an array of strings | BLOCK |

To unblock incremental migration while cleaning up goal headings, run the server with
`--migration-warn-only`. This downgrades all new BLOCK codes to WARN until you remove
the flag.

## Example

The `context-conductor` project itself uses this pattern. After upgrading:

- `projects/context-conductor/context-conductor-roadmap.md` — goals `G-001` through
  `G-003` with acceptance criteria
- `projects/context-conductor/milestones/steel-thread-v1.md` — groups `G-003`
  (milestones typed schemas and anchor relations) under the theme
  `"Milestones typed schemas relations planner CONTEXT-ROOT"`, status `active`

Call `readMilestone` to see a fully-resolved response with both goals confirmed:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="readMilestone",
  arguments={ "name": "projects/context-conductor/milestones/steel-thread-v1.md" }
)
```
