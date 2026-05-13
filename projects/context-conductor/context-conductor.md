---
project:
  - context-conductor
type: context-anchor
tags:
  - anchor-mcp
summary: "Context anchor for the context-conductor (anchor-mcp) repository."
read_this_if:
  - "You are changing anchor-mcp server behavior, validators, or MCP tools."
  - "You need the current shipped state of this repository as a product."
last_validated: 2026-05-12
---

# Context conductor

## Current State

- This repository implements `anchor-mcp`: git-backed MCP tools, validators, and built-in server policy for context repos.
- Forward-looking acceptance criteria and goals for this codebase live in the sibling roadmap `projects/context-conductor/context-conductor-roadmap.md`.

## Decisions

- Built-in policy rows (`server-rules/*`) are synthetic discovery entries, not files under the anchor root.

## Constraints

- On-disk taxonomy stays limited to the six anchor directories plus generated `CONTEXT-ROOT.md`.

## PRs

- [PR Acceptance criteria and built-in server policy - #0](https://github.com/mason-bryant/context-conductor/pull/0)
