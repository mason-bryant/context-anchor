---
type: agent-roles
tags:
  - anchor-mcp
  - roadmap
summary: "Stable goal id headings for project roadmaps when milestones reference goal_ids."
read_this_if:
  - "You are editing a project-roadmap under projects/<slug>/<slug>-roadmap.md."
  - "A milestone anchor lists goal_ids for this project."
last_validated: 2026-05-12
---

# Roadmap stable goal ids

## Current State

- Under `## Goals`, each goal heading should use `### Goal G-### -- <short name>` so milestones can reference `G-###` in `relations.goal_ids`.
- When any milestone for the project has a non-empty `goal_ids` list, the server requires every goal in the roadmap to use that heading form.

## Decisions

- Stable ids stay in the heading (not only in body text) so `analyzeRoadmapFromContent` can index goals without parsing free-form prose.

## Constraints

- Goal ids must match `G-` followed by digits (enforced on milestone `goal_ids` and parsed from headings).

## PRs

None.
