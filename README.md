# anchor-mcp

`anchor-mcp` is a git-backed MCP server for context anchors. It wraps a private markdown repository, exposes a small stable tool surface to agent runtimes, commits successful writes, and blocks or warns on mechanically checkable context-discipline rules.

## What Is Implemented

- Phase 0 storage support: point the server at a private git repo, or run `scripts/anchor-context-sync.sh` for basic add/commit/pull/push sync without MCP.
- Phase 1 read-only MCP tools: `listAnchors`, `readAnchor`, `readAnchorBatch`, `searchAnchors`, and `listVersions`.
- Phase 2 write tools and validators: `writeAnchor`, `diffAnchor`, `revertAnchor`, `compactionReport`, and `conflictStatus`.
- Phase 3 transport support: stdio for local tools and Streamable HTTP/SSE for remote or containerized agents.

## Install

```sh
npm install
npm run build
```

The package exposes:

```sh
npx -y @mason/anchor-mcp --repo ~/agent-context
```

In this local checkout, use:

```sh
node dist/bin/anchor-mcp.js --repo ~/agent-context
```

## Storage Layout

By default, `--repo` points at the root of the anchor markdown tree:

```txt
~/agent-context/
  project-a.md
  context-engineering/
    lifecycle.md
```

If the private repo contains the full `.agents/context` tree under a subdirectory, pass `--anchor-root`:

```sh
anchor-mcp --repo ~/agent-context --anchor-root .agents/context
```

For a checkout that should keep `.agents/context` in this private repo, symlink it:

```sh
mkdir -p ~/agent-context
ln -sfn ~/agent-context /path/to/rippling-main/.agents/context
```

## Local Agent Stdio

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "command": "node",
      "args": [
        "/Users/mbryant/github/context-conductor/dist/bin/anchor-mcp.js",
        "--repo",
        "/Users/mbryant/agent-context"
      ]
    }
  }
}
```

## HTTP/SSE Transport

```sh
node dist/bin/anchor-mcp.js \
  --repo ~/agent-context \
  --transport http \
  --host 127.0.0.1 \
  --port 3333
```

The MCP endpoint is:

```txt
http://127.0.0.1:3333/mcp
```

For a shared-secret deployment:

```sh
ANCHOR_MCP_AUTH_TOKEN=secret node dist/bin/anchor-mcp.js --repo ~/agent-context --transport http
```

Clients can send either:

```txt
Authorization: Bearer secret
```

or:

```txt
x-anchor-mcp-token: secret
```

## Write Validation

`writeAnchor` validates before writing and committing.

Blocks:

- required front matter: `project`, `type`, `tags`, `last_validated: YYYY-MM-DD`
- required sections: `## Current State`, `## Decisions`, `## Constraints`, `## PRs`
- PR link text format: `PR <title> - #<number>`
- `last_validated` must change when Current State, Decisions, or Constraints change
- `CLAUDE.md` requires sibling `AGENTS.md` containing `@CLAUDE.md`
- edits changing Decisions/Constraints or removing bullets require `approved: true`

Warnings:

- removed bullets should be moved to `## History` or marked superseded
- roadmaps over 400 lines should be compacted
- `## Completed` tables over 10 rows should be compacted

During migration, run with `--migration-warn-only` to downgrade schema and shape blocks into warnings while existing anchors are cleaned up.

## Git Sync

Successful writes commit with structured metadata and then attempt `git push` unless `--no-push-on-write` is set. A background sync loop runs `git pull --rebase` every 45 seconds unless `--no-auto-sync` is set. Real conflicts are not auto-resolved; call `conflictStatus` to surface them to the agent.

For Phase 0 without MCP:

```sh
scripts/anchor-context-sync.sh ~/agent-context 45
```

