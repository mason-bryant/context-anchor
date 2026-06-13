# anchor-mcp

Persistent project memory for AI coding agents.

`anchor-mcp` helps Cursor, Codex, Claude, and other MCP clients start work with the
right project context already in view. It serves curated Markdown anchors from a
private git repo, plans task-specific context bundles, and validates every write so
decisions, constraints, roadmaps, PR history, and agent rules stay durable instead of
disappearing into chat.

Use it when you want agents to:

- load current decisions and constraints before touching code
- pull only relevant context instead of dumping an entire docs tree
- write durable discoveries back through validated, committed MCP tools
- keep roadmaps, milestones, proposed changes, and stale-context warnings auditable
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
anchors, and suggests follow-up full reads when excerpts are not enough. Broader
discovery is available through `loadContext` and `contextRoot`.

When facts change, agents write through MCP tools such as `updateAnchorSection`,
`updateAnchorFrontmatter`, or `writeAnchor`. Successful writes are validated,
committed to git, and optionally pushed, which keeps context changes reviewable and
recoverable.

## What It Keeps Organized

- Project state: current facts, decisions, constraints, PR history, and roadmaps.
- Agent rules: behavior, coding standards, review habits, and workflow conventions.
- Invariants and conflicts: hard constraints and resolved contradictions.
- Milestones: roadmap goal groupings with stable goal IDs and task-aware retrieval.
- Proposed changes: reviewable draft edits before they become durable context.

The HTTP server also serves a read-only explorer UI at `/ui` for browsing the
generated root, anchors, roadmap metadata, validation health, and planner output.

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
