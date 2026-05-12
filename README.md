# anchor-mcp

`anchor-mcp` is a git-backed MCP server for context anchors. It wraps a private markdown repository, exposes a small stable tool surface to agent runtimes, commits successful writes, and blocks or warns on mechanically checkable context-discipline rules.

## What Is Implemented

- Phase 0 storage support: point the server at a private git repo, or run `scripts/anchor-context-sync.sh` for basic add/commit/pull/push sync without MCP.
- Phase 1 read-only MCP tools: `listAnchors`, `readAnchor`, `readAnchorBatch`, `loadContext`, `searchAnchors`, and `listVersions`.
- Phase 2 write tools and validators: `writeAnchor`, `diffAnchor`, `revertAnchor`, `compactionReport`, `contextRoot`, `writeContextRoot`, and `conflictStatus`.
- Phase 3 transport support: stdio for local tools and Streamable HTTP/SSE for remote or containerized agents.

## Install

From the registry (pin a version for reproducible installs; `@latest` follows the newest publish):

```sh
npx -y @mason/anchor-mcp@0.1.0 --repo ~/agent-context
```

```sh
npx -y @mason/anchor-mcp@latest --repo ~/agent-context
```

Release notes and assets: [GitHub Releases](https://github.com/mason-bryant/context-conductor/releases).

### Releases (maintainers)

1. Bump `version` in `package.json` and commit (for example `npm version patch` updates the lockfile too).
2. Push to `main`, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match `package.json`, including the leading `v`).
3. The **Release** workflow publishes to npm and creates a GitHub Release. Configure a repository Actions secret `NPM_TOKEN` with an npm automation token that can publish `@mason/anchor-mcp`.

### Local development (this repo)

```sh
npm install
npm run build
```

In this checkout, run the built binary:

```sh
node dist/bin/anchor-mcp.js --repo ~/agent-context
```

## Storage Layout

By default, `--repo` points at the root of the anchor markdown tree:

```txt
~/agent-context/
  CONTEXT-ROOT.md        # generated, do not edit manually
  projects/
    demo/
      current.md
  agent-rules/
    codex.md
  invariants/
    auth.md
  conflicts/
    token-model.md
  shared/
    glossary.md
  archive/
    2026/
      retired.md
```

If the private repo contains the full `.agents/context` tree under a subdirectory, pass `--anchor-root`:

```sh
anchor-mcp --repo ~/agent-context --anchor-root .agents/context
```

For a checkout that should keep `.agents/context` in this private repo, symlink it:

```sh
mkdir -p ~/agent-context
ln -sfn ~/agent-context /path/to/your-project/.agents/context
```

## Connecting to Cursor (HTTP)

Start the server (no build step required):

```sh
npx tsx src/bin/anchor-mcp.ts \
  --repo ~/agent-context \
  --transport http \
  --host 127.0.0.1 \
  --port 3333
```

To auto-restart when source files change, add the `watch` flag:

```sh
npx tsx watch src/bin/anchor-mcp.ts \
  --repo ~/agent-context \
  --transport http \
  --host 127.0.0.1 \
  --port 3333
```

> **Note:** The `node dist/bin/anchor-mcp.js` form requires `npm run build` first and is intended for production deployments. Use `tsx` for local development.

Then add to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

### Accessing HTTP through ngrok

Keep the server bound to localhost, and allow only the tunnel hostname through
MCP Express Host header validation:

```json
{
  "allowedHosts": [
    "your-tunnel.ngrok-free.dev"
  ]
}
```

Save that as `anchor-mcp.config.json`, then start the server with:

```sh
npx tsx src/bin/anchor-mcp.ts \
  --repo ~/agent-context \
  --transport http \
  --host 127.0.0.1 \
  --port 3333 \
  --config ./anchor-mcp.config.json
```

`allowedHosts` accepts hostnames or full URLs. The same setting is available for
one-off runs as `--allowed-hosts` or `ANCHOR_MCP_ALLOWED_HOSTS`.

### Cursor rule snippet (session start)

Add a short rule under `.cursor/rules/` (or your global Cursor rules) so agents call anchors **before** other tools, even if MCP `instructions` are buried in context:

```md
- Before any non-trivial tool use (read/search/edit/shell), call anchor-mcp `loadContext` first.
- If you only need the index, `contextRoot` is enough; otherwise prefer `loadContext` with `includeContent: "excerpt"` (default behavior).
- If the response is too large or `truncated` is true: pass `nextCursor`, or lower `limit` / `maxBytes`, or set `includeContent` to `excerpt` or `none`.
- Never locate anchors by filesystem search; use MCP tools only.
```

### Updating anchors when facts change

The MCP server also ships session instructions (`src/server.ts`) telling agents to **write back** durable discoveries, not only answer in-thread:

- **Facts** → map to `## Current State`, `## Decisions`, or `## Constraints`, bump `last_validated` when those sections change materially, and add PR rows under `## PRs` with link text `PR <title> - #<number>`.
- **Approval** → changes to Decisions/Constraints (or removing bullets) require `writeAnchor` with `approved: true` after explicit user confirmation.
- **Roadmaps** → keep forward-looking specs and completed history in the project’s roadmap anchor when you use that pattern; heed `writeAnchor` warnings for oversized roadmaps or `## Completed` tables and use `compactionReport` to plan cleanup.

### Authentication (optional)

Set a shared secret to restrict access:

```sh
ANCHOR_MCP_AUTH_TOKEN=secret node dist/bin/anchor-mcp.js \
  --repo ~/agent-context \
  --transport http
```

Clients send either:

```txt
Authorization: Bearer secret
```

or:

```txt
x-anchor-mcp-token: secret
```

### Stdio (debugging only)

stdio transport is available for local debugging but is not recommended for general use.

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "command": "node",
      "args": [
        "/path/to/context-conductor/dist/bin/anchor-mcp.js",
        "--repo", "~/agent-context"
      ]
    }
  }
}
```

## Write Validation

`writeAnchor` validates before writing and committing.

Blocks:

- unknown top-level directories and root-level markdown anchors
- direct writes to generated `CONTEXT-ROOT.md`
- required front matter: `type`, `tags`, `summary`, `read_this_if`, `last_validated: YYYY-MM-DD`
- `projects/<project-slug>/<anchor>.md` anchors require `project` front matter containing `<project-slug>`
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

Example anchor:

```md
---
project:
  - demo
type: design
tags:
  - context
summary: "Current operating context for the demo project."
read_this_if:
  - "You are modifying demo project behavior."
  - "You need current decisions and constraints for demo work."
last_validated: 2026-05-10
---

# Demo Project

## Current State

- The demo project uses git-backed context anchors.

## Decisions

- Keep generated root content derived from front matter.

## Constraints

- Do not edit generated CONTEXT-ROOT.md manually.

## PRs

- [PR Add dynamic root - #123](https://github.com/example/repo/pull/123)
```

## Dynamic Context Root

`contextRoot` builds a live root index from anchor metadata. It groups anchors in this order:

```txt
agent-rules
projects
invariants
conflicts
shared
archive
```

Archive entries are excluded unless `includeArchive: true` or `category: "archive"` is passed.

`writeContextRoot` writes and commits a generated `CONTEXT-ROOT.md` at the anchor root. The generated file is excluded from `listAnchors`, validation, and future context-root entries.

`contextRoot` accepts:

```json
{
  "project": "demo",
  "category": "projects",
  "tag": "context",
  "runtime": "codex",
  "includeArchive": false,
  "format": "both"
}
```

## Load context (one call)

`loadContext` combines **discovery** (same `entries` as `contextRoot`, plus optional `markdown`) with **multiple anchor bodies** in a single tool call. Defaults: `limit` 12, `maxBytes` 250000, `includeContent` `excerpt`, `excerptChars` 1200.

Filter the index and load matching anchors:

```json
{
  "project": "demo",
  "category": "projects",
  "includeArchive": false,
  "includeContent": "excerpt",
  "format": "both"
}
```

Load explicit paths (order preserved):

```json
{
  "names": ["agent-rules/codex.md", "projects/demo/demo.md"],
  "includeContent": "full"
}
```

When `truncated` is true, call again with `nextCursor` from the previous response (same filters or explicit names are encoded in the cursor). If the payload is still too large for your client, reduce `limit` or `maxBytes`, or set `includeContent` to `excerpt` or `none`.

## Git Sync

Successful writes commit with structured metadata and then attempt `git push` unless `--no-push-on-write` is set. A background sync loop runs `git pull --rebase` every 45 seconds unless `--no-auto-sync` is set. Real conflicts are not auto-resolved; call `conflictStatus` to surface them to the agent.

For Phase 0 without MCP:

```sh
scripts/anchor-context-sync.sh ~/agent-context 45
```
