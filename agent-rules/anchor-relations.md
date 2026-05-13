---
type: agent-roles
tags:
  - anchor-mcp
  - relations
summary: "Optional relations front matter for linking anchors or roadmap goals."
read_this_if:
  - "You are adding cross-anchor references beyond markdown links."
  - "You need how goal_ids on milestones resolve."
last_validated: 2026-05-12
---

# Anchor relations (`relations`)

## Current State

- Any anchor may declare optional YAML `relations: { <kind>: [<string>, ...] }` where each value is an array of strings.
- For `type: project-milestone`, `relations.goal_ids` lists roadmap goal ids (`G-###`) resolved against `projects/<slug>/<slug>-roadmap.md`.
- Other relation kinds are reserved for future graph features; values should be anchor names (with or without `.md` suffix) when pointing at files.

## Decisions

- Relation shape is validated on every write; milestone `goal_ids` targets are additionally checked against the sibling roadmap.

## Constraints

- `relations` must be a mapping object (not an array); each entry must be an array of non-empty strings.

## PRs

None.
