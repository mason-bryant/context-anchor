---
project:
  - context-conductor
type: project-roadmap
tags:
  - anchor-mcp
  - roadmap
summary: "Roadmap and acceptance criteria for the anchor-mcp / context-conductor project."
read_this_if:
  - "Planning or prioritizing anchor-mcp work."
  - "Checking definition of done for context-conductor milestones."
last_validated: 2026-05-12
---

# Context conductor roadmap

## Goals

### MCP acceptance criteria and discovery

#### Acceptance Criteria

#### Approved

- [x] AC-001: `contextRoot` / `listAnchors` discovery prepends built-in `server-rules` entries before repo anchors when no category filter is applied. Evidence: `npm test` and `test/anchorService.test.ts` context root assertions.

- [x] AC-002: `type: project-roadmap` anchors expose `acceptanceCriteria` metadata (goals counts, `goalsMissingCriteria`, `hasProposedCriteria`). Evidence: `src/git/repo.ts` enrichment and discovery row fields in tests.

- [ ] AC-003: This repository keeps a checked-in roadmap at `projects/context-conductor/context-conductor-roadmap.md` with at least one open criterion tracked under **Goals** so releases can be validated against the same rules shipped to users. Evidence: file exists in git; `analyzeRoadmapFromContent` produces non-zero `activeGoals` and includes this criterion id in **Approved**.

#### Proposed

### Documentation and operator experience

#### Acceptance Criteria

#### Approved

- [x] AC-004: `README.md` documents `server-rules`, acceptance-criteria write gates, and weakening semantics. Evidence: README Write Validation and Dynamic Context Root sections.

## Current State

- Roadmap is maintained alongside shipped behavior in `context-conductor.md`.

## Decisions

- Acceptance criteria for planned work stay in this roadmap until shipped facts move to the context anchor.

## Constraints

- Roadmap body must satisfy `project-roadmap` shape rules enforced by anchor-mcp validators.

## PRs

- [PR Acceptance criteria and built-in server policy - #0](https://github.com/mason-bryant/context-conductor/pull/0)
