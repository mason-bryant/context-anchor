---
project:
  - context-conductor
type: project-roadmap
tags:
  - anchor-mcp
  - roadmap
summary: >-
  Roadmap and acceptance criteria for the anchor-mcp / context-conductor
  project.
read_this_if:
  - Planning or prioritizing anchor-mcp work.
  - Checking definition of done for context-conductor milestones.
last_validated: '2026-06-16'
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
- Add typed front-matter overlay validation (`schema_version`, `theme`, `status`, `relations` shape validation with milestone `goal_ids` resolution against `<slug>-roadmap.md`.
- Ship `listMilestones`, `readMilestone`, and `getRelated` MCP tools; enrich `planContextBundle` with milestone-aware scoring and missing-context signals; keep `CONTEXT-ROOT.md` focused on project anchors and roadmaps.

#### Acceptance Criteria

#### Approved

- [x] AC-005: `classifyAnchorPath` accepts `projects/<slug>/milestones/<file>.md` and rejects unknown nested project directories. Evidence: `test/taxonomy.test.ts`.

- [x] AC-006: `project-milestone` writes validate typed overlay (`schema_version`, `theme`, `status`, `relations.goal_ids`) and `goal_ids` resolve to `### Goal G-<digits> --` headings in the sibling roadmap. Evidence: `npm test` milestone integration coverage.

- [x] AC-007: `planContextBundle` boosts canonical roadmaps and milestone anchors when the task matches active milestone goal ids or milestone theme tokens; emits milestone missing-AC signals. Evidence: `test/milestoneSteelThread.test.ts` or equivalent.

- [x] AC-008: `CONTEXT-ROOT.md` omits project milestone anchors and groups project context/roadmap links with summary, tags, and read-this-if text. Evidence: `test/milestoneSteelThread.test.ts` context root assertions.

#### Decisions (pre-ship)

- Goal 7 (typed anchor schemas): the registry + `project-milestone` overlay ships with this milestone; extending the registry to additional types remains open work.
- Goal 8 (temporal anchor graph): the `relations` mapping + validation ships here; additional relation kinds (`supersedes`, `valid_until`, …) remain open work.
- Goal 5 (`planContextBundle`): relation-aware ranking and milestone missing-context signals ship with Goal G-003.

#### Open Questions

- None yet.

### Goal G-004 -- Session-start and retrieval quality

#### Acceptance Criteria

#### Approved

- [x] AC-009: `startTask` MCP tool plans a task-aware bundle and loads suggested anchor excerpts in one call, with an MCP `start-task` prompt for session bootstrap. Evidence: `test/anchorService.test.ts` startTask integration test and `src/server.ts` tool registration.

- [x] AC-010: `planContextBundle` token estimates use measured anchor body sizes captured during BM25 indexing. Evidence: `test/contextPlanner.test.ts` and `test/anchorService.test.ts` budget packing tests.

- [x] AC-011: `loadContext` accepts optional `task` and returns task-aware section excerpts instead of prefix-only excerpts when sections match. Evidence: `test/loadContext.test.ts` and `test/anchorService.test.ts`.

- [x] AC-012: `planContextBundle` flags stale included anchors and emits missing-context guidance; threshold configurable via `--stale-after-days`. Evidence: `test/contextPlanner.test.ts`, `test/cliArgs.test.ts`, and `test/anchorService.test.ts`.

- [x] AC-013: `npm run eval` runs deterministic planner eval fixtures and exits non-zero below the configured recall floor. Evidence: `scripts/planner-eval.ts` and `test/fixtures/planner-eval/cases.json`.

#### Proposed

### Goal G-005 -- Retrieval quality hardening and operability

#### Acceptance Criteria

#### Approved

- [x] AC-014: CI runs `npm run eval` as a required gate so planner recall regressions fail the build. Evidence: `.github/workflows/ci.yml` eval step.

- [x] AC-015: UI query boolean parsing (`booleanQuery`) rejects non-boolean strings with HTTP 400, matching `booleanBody` strictness. Evidence: `test/uiHttp.test.ts` invalid `includeArchive` case.

#### Proposed

- [ ] AC-P001: Extend the typed-schema registry beyond `project-milestone` once a concrete second anchor type is needed. Evidence: registry additions and `src/schema/registry.ts` coverage when scheduled.

- [ ] AC-P002: Add relation kinds (`supersedes`, `valid_until`) to the relations overlay once a concrete need exists. Evidence: relations validation and `src/relations` coverage when scheduled.

## Current State

- Roadmap is maintained alongside shipped behavior in `context-conductor.md`.
- Goal G-003 steel-thread milestone tooling is shipped.
- Goal G-004 session-start and retrieval quality v1 is shipped and merged in PR #30 (2026-06-11).
- Goal G-005 retrieval quality hardening shipped in PR #34 (2026-06-15): CI `npm run eval` gate, strict UI boolean query parsing. Proposed AC-P001 and AC-P002 (registry and relation-kinds extensions) remain parked until a concrete need arises.
- Project priorities shipped in PR #36 (2026-06-16): numeric `priority` front matter on project anchors, `sort=priority` in anchor listing, `updateProjectPriority` MCP tool, priority display and editing in the UI.
- Task due dates shipped in PR #37 (2026-06-16): `updateTaskDue` and `listTasksDue` MCP tools, Tasks tab in the UI with overdue/due-soon/upcoming/no-due grouping and inline date editing.

## Decisions

- Acceptance criteria for planned work stay in this roadmap until shipped facts move to the context anchor.

## Constraints

- Roadmap body must satisfy `project-roadmap` shape rules enforced by anchor-mcp validators.

## PRs

- [PR Session-start and retrieval quality v1 - #30](https://github.com/mason-bryant/context-anchor/pull/30)
- [PR Retrieval quality hardening and operability (G-005) - #34](https://github.com/mason-bryant/context-anchor/pull/34)
- [PR Add project priorities - #36](https://github.com/mason-bryant/context-anchor/pull/36)
- [PR Add task due dates - #37](https://github.com/mason-bryant/context-anchor/pull/37)
