# anchor-mcp

Persistent project memory for AI coding agents.

`anchor-mcp` helps Cursor, Codex, Claude, and other codegen tools start work with the
right project context already in view. It serves curated Markdown anchors from a
private git repo, plans task-specific context bundles, tracks cross-project task state
through both MCP tools and a browser UI, and validates every write so decisions,
constraints, roadmaps, PR history, tasks, open questions, and agent rules stay
durable instead of disappearing into chat.

Use it when you want agents to:

- load current decisions and constraints before touching code
- pull only relevant context instead of dumping an entire docs tree
- write durable discoveries back through validated, committed MCP tools
- keep roadmaps, milestones, proposed changes, and stale-context warnings auditable
- manage backlog and milestone tasks across projects from MCP or the HTTP UI
- track open, resolved, deferred, and won't-answer questions from anchor question sections
- share the same context across multiple agent runtimes without copying files around

## Quick Start

Run the server against a separate git repository that contains your anchor Markdown:

```sh
npx -y @mason/anchor-mcp@latest --repo ~/agent-context
```

For reproducible installs, pin the current release:

```sh
npx -y @mason/anchor-mcp@2.1.0 --repo ~/agent-context
```

For setup walkthroughs, see [QUICKSTART.md](QUICKSTART.md).

## Key Benefits

- **Right-sized context for the current job.** Agents can call `startTask` or
  `planContextBundle` with a task description and token budget, then load only the
  selected anchors or task-aware excerpts. That keeps long-lived context out of the
  prompt until it is relevant.
- **Learning that survives the chat window.** Durable facts, decisions, constraints,
  PR history, roadmaps, and agent rules live in validated Markdown anchors. Write
  tools commit updates to git, so discoveries from one session are available to the
  next agent instead of being trapped in a transcript.
- **Fast project orientation with an authoritative design header.** Project context
  anchors begin with purpose, goals, users, non-goals, and architectural invariants.
  Missing fields produce agent warnings; opening a legacy project anchor in the UI
  persists the blank sections as a migration so Raw, Rendered, and editors stay aligned.
- **Structured work tracking across projects.** Backlog and milestone tasks are
  first-class data with status, owner, priority, notes, due dates, completion dates,
  and roadmap goal links. Agents can manage them through MCP, while the `/ui` Tasks
  view supports cross-project filtering, grouping, assignment, and lifecycle edits.
- **Structured question tracking in anchors.** Top-level bullets in `## Open Questions`,
  `## Questions`, and `## Resolved Questions` are parsed as first-class questions with
  status, owner, resolution, and resolution date. Agents can list, resolve, defer,
  close, and reopen them without losing the readable Markdown trail.
- **People and teams as coordination data.** The people registry stores teammates,
  teams, identities, aliases, and project roles. Task owners can resolve to people or
  teams, and project associations can feed owner filters, coordination views, and
  deterministic project updates.

## Core Model

An anchor repo is a small Markdown knowledge base with a strict taxonomy:

```txt
~/agent-context/
  CONTEXT-ROOT.md
  agent-rules/
  projects/
  invariants/
  conflicts/
  shared/
  archive/
```

`CONTEXT-ROOT.md` is generated from anchor front matter. The source of truth is the
anchor files under the taxonomy directories.

At session start, agents call `startTask` when they know the project and task. That
one call plans a budgeted context bundle, loads task-aware excerpts, flags stale
anchors, and suggests follow-up reads when excerpts are not enough. Project context
anchors use a compact overview: front matter plus the complete Introduction and
Invariants design header, followed by `availableSections` and nested
`availableSectionPaths` for details that can be loaded individually with
`readAnchorSection`. A caller can request an H2 such as `Current State` or a nested
topic such as `Current State > Capabilities`. Broader discovery is available through
`loadContext` and `contextRoot`.

The anchor detail UI shows a Current State Organization card for project context
anchors. It reports claim, ungrouped, and release-history counts; lists existing
nested retrieval paths; and suggests topic paths when a substantial Current State is
still flat.

When facts change, agents write through MCP tools such as `updateAnchorSection`,
`updateAnchorFrontmatter`, or `writeAnchor`. Successful writes are validated,
committed to git, and optionally pushed, which keeps context changes reviewable and
recoverable.

Structured tasks live on project milestone anchors, including a reserved backlog
milestone for unscheduled work. Agents can list, create, complete, reopen, delete, and
update tasks through MCP tools such as `listTasksDue`, `createTask`, `updateTaskOwner`,
`updateTaskDue`, and `completeTask`.

Structured questions live as top-level bullets in anchor `## Open Questions`,
`## Questions`, or `## Resolved Questions` sections. Agents can use `listQuestions`,
`resolveQuestion`, and `reopenQuestion` to keep unresolved questions queryable while
retaining resolved questions as historical context.

## What It Keeps Organized

- Project state: current facts, decisions, constraints, PR history, and roadmaps.
- Agent rules: behavior, coding standards, review habits, and workflow conventions.
- Invariants and conflicts: hard constraints and resolved contradictions.
- Milestones: roadmap goal groupings with stable goal IDs and task-aware retrieval.
- Tasks: cross-project backlog and milestone work with status, owner, priority, notes,
  due dates, and completion dates.
- Questions: open, resolved, deferred, and won't-answer follow-ups with optional
  resolution metadata.
- Proposed changes: reviewable draft edits before they become durable context.

The HTTP server also serves a browser UI at `/ui` for browsing the generated root,
anchors, roadmap metadata, validation health, and planner output. Its Tasks view
surfaces work across projects with filters, grouping, due and completed windows,
assignment, priority edits, lifecycle actions, and links back to the milestone anchors
that store the task metadata.

## Documentation

- [Quick Start](QUICKSTART.md) - migrate context, start the server, and connect clients.
- [Migration Guide](AGENTS.md) - convert existing Markdown context into anchor-mcp shape.
- [Operator Reference](docs/operator-reference.md) - auth, HTTP, validation, context-loading, and sync details.
- [Milestones](docs/milestones.md) - project milestone anchors and roadmap goal IDs.
- [Project Updates](docs/project-updates.md) - status update and backlog task conventions.
- [Proposed Changes](docs/proposed-changes.md) - reviewable draft write-intent workflow.
- [Planner Judge Prompt](docs/planner-judge-prompt.md) - manually evaluate planner output.
- [Maintainers](docs/maintainers.md) - release and local development notes.

## Local Development

```sh
npm install
npm run build
npm test
```

Optional: run `npm run install-git-hooks` once per clone so `git push` runs
`npm run typecheck` first. See [githooks/README.md](githooks/README.md).

Release notes and assets are published on
[GitHub Releases](https://github.com/mason-bryant/context-conductor/releases).
