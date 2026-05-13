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

### Goal G-001 -- MCP acceptance criteria and discovery

#### Acceptance Criteria

#### Approved

- [x] AC-001: `contextRoot` / `listAnchors` discovery prepends built-in `server-rules` entries before repo anchors when no category filter is applied. Evidence: `npm test` and `test/anchorService.test.ts` context root assertions.

- [x] AC-002: `type: project-roadmap` anchors expose `acceptanceCriteria` metadata (goals counts, `goalsMissingCriteria`, `hasProposedCriteria`). Evidence: `src/git/repo.ts` enrichment and discovery row fields in tests.

- [ ] AC-003: This repository keeps a checked-in roadmap at `projects/context-conductor/context-conductor-roadmap.md` with at least one open criterion tracked under **Goals** so releases can be validated against the same rules shipped to users. Evidence: file exists in git; `analyzeRoadmapFromContent` produces non-zero `activeGoals` and includes this criterion id in **Approved**.

#### Proposed

### Goal G-002 -- Documentation and operator experience

#### Acceptance Criteria

#### Approved

- [x] AC-004: `README.md` documents `server-rules`, acceptance-criteria write gates, and weakening semantics. Evidence: README Write Validation and Dynamic Context Root sections.

### Goal G-003 -- Milestones typed schemas and anchor relations (steel thread)

#### Requirements

- Extend `projects/<slug>/` taxonomy with reserved `milestones/` subdirectory and ship `type: project-milestone` anchors.
- Add typed front-matter overlay validation (`schema_version`, milestone fields) and `relations` shape validation with milestone `goal_ids` resolution against `<slug>-roadmap.md`.
- Ship `listMilestones`, `readMilestone`, and `getRelated` MCP tools; enrich `planContextBundle` with milestone-aware scoring and missing-context signals; render optional milestone subsection in `CONTEXT-ROOT.md`.

#### Acceptance Criteria

#### Approved

- [ ] AC-005: `classifyAnchorPath` accepts `projects/<slug>/milestones/<file>.md` and rejects unknown nested project directories. Evidence: `test/taxonomy.test.ts`.

- [ ] AC-006: `project-milestone` writes validate typed overlay (`schema_version`, `theme`, `status`, `relations.goal_ids`) and `goal_ids` resolve to `### Goal G-### --` headings in the sibling roadmap. Evidence: `npm test` milestone integration coverage.

- [ ] AC-007: `planContextBundle` boosts canonical roadmaps and milestone anchors when the task matches active milestone goal ids or milestone theme tokens; emits milestone missing-AC signals. Evidence: `test/milestoneSteelThread.test.ts` or equivalent.

- [ ] AC-008: `CONTEXT-ROOT.md` markdown groups `## Projects` with `#### Milestones` per slug when milestone anchors exist. Evidence: `npm test` context root assertions.

#### Decisions (pre-ship)

- Goal 7 (typed anchor schemas): the registry + `project-milestone` overlay ships with this milestone; extending the registry to additional types remains open work.
- Goal 8 (temporal anchor graph): the `relations` mapping + validation ships here; additional relation kinds (`supersedes`, `valid_until`, …) remain open work.
- Goal 5 (`planContextBundle`): relation-aware ranking and milestone missing-context signals ship with Goal G-003.

#### Open Questions

- None yet.

## Current State

- Roadmap is maintained alongside shipped behavior in `context-conductor.md`.

## Decisions

- Acceptance criteria for planned work stay in this roadmap until shipped facts move to the context anchor.

## Constraints

- Roadmap body must satisfy `project-roadmap` shape rules enforced by anchor-mcp validators.

## PRs

- [PR Acceptance criteria and built-in server policy - #0](https://github.com/mason-bryant/context-conductor/pull/0)
