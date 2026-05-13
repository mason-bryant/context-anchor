---
type: agent-roles
tags:
  - anchor-mcp
  - milestones
summary: "Authoring rules for project milestone anchors under projects/<slug>/milestones/."
read_this_if:
  - "You are creating or editing a type: project-milestone anchor."
  - "You need how goal_ids link milestones to roadmap goals."
last_validated: 2026-05-12
---

# Milestone anchor rules

## Current State

- Milestones live at `projects/<project-slug>/milestones/<file>.md` with `type: project-milestone` and `schema_version: 1`.
- Each milestone declares `theme`, optional `steel_thread`, `status`, and `relations.goal_ids` listing stable roadmap goal ids (`G-<digits>`, conventionally `G-###`).
- The sibling roadmap is always `projects/<slug>/<slug>-roadmap.md`; goal headings must use `### Goal G-<digits> -- Title`.

## Decisions

- Theme names the topical bucket; `steel_thread` names the end-to-end slice that proves the architecture when present.
- `goal_ids` reference roadmap goals by stable id only, not free text titles.

## Constraints

- Validators require milestone typed front matter and resolve `goal_ids` against the canonical roadmap path for that slug.
- Do not add organization-specific identifiers to anchors in this public repo (vendor neutrality).

## PRs

None.
