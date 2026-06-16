---
project:
  - context-conductor
type: context-anchor
tags:
  - anchor-mcp
summary: Context anchor for the context-conductor (anchor-mcp) repository.
read_this_if:
  - 'You are changing anchor-mcp server behavior, validators, or MCP tools.'
  - You need the current shipped state of this repository as a product.
last_validated: '2026-06-16'
---

# Context conductor

## Current State

- This repository implements `anchor-mcp`: git-backed MCP tools, validators, and built-in server policy for context repos.
- Milestone steel-thread v1 (Goal G-003) is shipped: milestones taxonomy, typed milestone overlay, relations validation, milestone MCP tools, and planner milestone boosts.
- Session-start and retrieval quality v1 (Goal G-004) is shipped in PR #30: `startTask` (+ `start-task` MCP prompt), body-size token estimates, task-aware excerpts, staleness signals (`--stale-after-days`), and `npm run eval`.
- Retrieval quality hardening (Goal G-005) is shipped in PR #34: CI `npm run eval` gate and strict UI boolean query parsing.
- Project priorities shipped in PR #36: numeric `priority` front matter on project anchors, `sort=priority` in anchor listing, `updateProjectPriority` MCP tool, priority display and editing in the UI.
- Task due dates shipped in PR #37: `updateTaskDue` and `listTasksDue` MCP tools, Tasks tab in the UI with overdue/due-soon/upcoming/no-due grouping and inline date editing.
- Forward-looking acceptance criteria and goals for this codebase live in the sibling roadmap `projects/context-conductor/context-conductor-roadmap.md`.

## Decisions

- Built-in policy rows (`server-rules/*`) are synthetic discovery entries, not files under the anchor root.
- `startTask` is the preferred first MCP call when the user supplies a project and task at session start.
- Planner retrieval quality is gated in CI via `npm run eval`; UI query boolean parsing rejects invalid values with HTTP 400 rather than silently defaulting.
- Project priority is stored as a finite YAML number on the project context anchor; the UI renders the `P` prefix. Priority changes require `approved: true`.
- Task due dates use ISO YYYY-MM-DD strings in milestone task front matter; `date_confidence` is required when `due` is set.

## Constraints

- On-disk taxonomy stays limited to the six anchor directories plus generated `CONTEXT-ROOT.md`.

## PRs

- [PR Session-start and retrieval quality v1 - #30](https://github.com/mason-bryant/context-anchor/pull/30)
- [PR Retrieval quality hardening and operability (G-005) - #34](https://github.com/mason-bryant/context-anchor/pull/34)
- [PR Add project priorities - #36](https://github.com/mason-bryant/context-anchor/pull/36)
- [PR Add task due dates - #37](https://github.com/mason-bryant/context-anchor/pull/37)
