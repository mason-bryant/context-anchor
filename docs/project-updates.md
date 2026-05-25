# Project Updates

Project updates summarize a project's roadmap and milestone state for humans. They are
derived from project anchors, the project roadmap, project milestone anchors, and
structured milestone task metadata.

Use this guide when preparing status updates or when a user asks to place work on a
project backlog.

## Inputs

Project update generation should read:

- The project context anchor for durable current state, decisions, and constraints.
- The sibling project roadmap for goals and acceptance criteria.
- Project milestones under `projects/<slug>/milestones/`.
- Structured `tasks` metadata on milestone anchors when present.

Backlog items are stored on the reserved backlog milestone:

```yaml
milestone_id: backlog
# no sequence
tasks:
  - id: T-001
    title: Triage import errors from customer CSV uploads
    status: todo
```

Task fields are intentionally sparse. Use only values that are provided by the user or
already present in trusted project context:

| Field | Required | Notes |
|---|---:|---|
| `id` | yes | Stable task id used for future updates. |
| `title` | yes | User-facing task title. |
| `status` | yes | One of `todo`, `active`, `blocked`, `done`, `cancelled`. |
| `owner` | no | Do not infer. |
| `goal_ids` | no | Must reference real roadmap `G-<digits>` ids; do not invent. |
| `due` | no | Do not infer. |
| `completed_on` | no | Only for completed work with a known date. |
| `date_confidence` | no | Use only with an explicit date: `committed`, `internal_goal`, or `estimated`. |
| `notes` | no | Short context from the user or existing anchors. |

When a task date is needed for status reporting and no trusted value exists, ask the
user for both the date and the confidence class before recording it. The confidence
class must be one of `committed`, `internal_goal`, or `estimated`.

## Rendering Order

Rendered project updates should show scheduled work first and backlog work last.

1. Render sequenced milestones in ascending `sequence` order.
2. Render unsequenced, non-backlog milestones after sequenced milestones when they are
   included in the update.
3. End with backlog items when a backlog milestone has tasks.

Backlog items intentionally appear at the end because backlog grooming is always in
progress. Do not hide backlog items just because they are unscheduled.

## Backlog Task Workflow

When a user asks to put a task on a project backlog:

1. Resolve the project slug from the request or loaded context.
2. Call `listMilestones` for that project.
3. If a milestone with `milestoneId: backlog` or `displayId: backlog` exists, update that
   milestone.
4. If no backlog milestone exists, create the reserved backlog milestone under
   `projects/<slug>/milestones/` with `milestone_id: backlog` and no `sequence`.
5. Add the task to the milestone's structured `tasks` list.
6. Use `status: todo` unless the user explicitly supplied another valid status.
7. If the task needs a date and none is already trusted, ask for the date and whether
   it is `committed`, an `internal_goal`, or `estimated`.
8. Do not assign `sequence`, and do not invent dates, date confidence, owners, or goal
   ids.

If current validation requires extra milestone metadata while creating the reserved
backlog milestone, use only real values from existing project context or ask the user
for the missing value. Do not fabricate goal links or planning dates to make the write
pass.

## Built-in Policy

The server exposes this behavior as a built-in policy anchor:
`server-rules/project-updates.md`.

Load it with other `server-rules/*` entries when rendering project updates, updating
milestone tasks, or handling backlog requests. Built-in policy anchors are discovery
entries only; they are not files in the context repository and cannot be edited through
write tools.
