# Operator Reference

This guide covers the day-to-day operating details for `anchor-mcp`: storage layout,
HTTP setup, authentication, context loading, validation, and git sync.

## Storage Layout

Create the anchor context repository in a separate git repository from the codebase
where agents do everyday work. If the same anchors are reachable both as normal
workspace files and through MCP, agents can duplicate or conflict with their own edits.

By default, `--repo` points at the root of the anchor Markdown tree:

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

If the private repo contains the full `.agents/context` tree under a subdirectory,
pass `--anchor-root`:

```sh
anchor-mcp --repo ~/agent-context --anchor-root .agents/context
```

For a checkout that should keep `.agents/context` in this private repo, symlink it:

```sh
mkdir -p ~/agent-context
ln -sfn ~/agent-context /path/to/your-project/.agents/context
```

## HTTP Transport

HTTP transport always requires an auth token, even on localhost. A localhost-bound
server can later be exposed externally without changing the bind address, so there is
no safe localhost-only exception.

Generate a token:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create a config file and restrict its permissions:

```sh
echo '{"authToken":"your-generated-token"}' > anchor-mcp.config.json
chmod 600 anchor-mcp.config.json
```

Start the server:

```sh
npx -y @mason/anchor-mcp@latest \
  --repo ~/agent-context \
  --transport http \
  --host 127.0.0.1 \
  --port 3333 \
  --config ./anchor-mcp.config.json
```

The same HTTP server serves a read-only explorer UI at `http://127.0.0.1:3333/ui`.
Enter the same bearer token used for MCP requests.

Add the server to Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer your-generated-token"
      }
    }
  }
}
```

## Ngrok And Allowed Hosts

When exposing the server externally, keep it bound to `127.0.0.1` and let ngrok tunnel
to it. Add the tunnel hostname to the same config file as the auth token:

```json
{
  "authToken": "your-generated-token",
  "allowedHosts": [
    "your-tunnel.ngrok-free.app"
  ]
}
```

Requests arriving through ngrok carry the ngrok hostname in the `Host` header. The
`@modelcontextprotocol/express` layer rejects hosts that are not allowed before
requests reach the auth middleware.

`allowedHosts` accepts hostnames or full URLs. The same setting is available for
one-off runs as `--allowed-hosts` or `ANCHOR_MCP_ALLOWED_HOSTS`.

Point the MCP client at the tunnel:

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "url": "https://your-tunnel.ngrok-free.app/mcp",
      "headers": {
        "Authorization": "Bearer your-generated-token"
      }
    }
  }
}
```

## Authentication

HTTP clients must include the token on every request using either header:

```txt
Authorization: Bearer your-generated-token
```

```txt
x-anchor-mcp-token: your-generated-token
```

Token source precedence at startup is:

```txt
CLI flag -> environment variable -> config file
```

Examples:

```sh
anchor-mcp --transport http --auth-token your-generated-token
ANCHOR_MCP_AUTH_TOKEN=your-generated-token anchor-mcp --transport http
anchor-mcp --transport http --config ~/anchor-mcp.config.json
```

## Logging

File logging is disabled unless configured. Use `true` for defaults or an object to
override them:

```json
{
  "authToken": "your-generated-token",
  "logging": {
    "file": {
      "enabled": true,
      "dirname": "~/.anchor-mcp/logs",
      "filename": "anchor-mcp-%DATE%.log",
      "level": "info",
      "datePattern": "YYYY-MM-DD",
      "maxSize": "10m",
      "maxFiles": "14d",
      "zippedArchive": true
    }
  }
}
```

MCP request logging writes one JSON record per tool call to a separate rotated log:

```json
{
  "authToken": "your-generated-token",
  "logging": {
    "requests": {
      "enabled": true,
      "dirname": "~/.anchor-mcp/logs",
      "filename": "anchor-mcp-requests-%DATE%.log",
      "level": "info",
      "datePattern": "YYYY-MM-DD",
      "maxSize": "10m",
      "maxFiles": "14d",
      "zippedArchive": true,
      "includeArguments": true,
      "redactArguments": true
    }
  }
}
```

Set `includeArguments` to `false` to log only tool names and outcomes. Set
`redactArguments` to `false` only for local debugging when raw anchor content can be
written to disk.

## Session Start

Add a durable client rule so agents load context before other tools:

```md
- Before any non-trivial tool use (read/search/edit/shell), call anchor-mcp `startTask` when you know the project and task; otherwise call `loadContext` first.
- If you only need the index, `contextRoot` is enough; otherwise prefer `startTask` or `loadContext` with `includeContent: "excerpt"` (default behavior).
- If the response is too large or `truncated` is true: pass `nextCursor`, lower `limit` / `maxBytes`, or set `includeContent` to `excerpt` or `none`.
- Never locate anchors by filesystem search; use MCP tools only.
```

`startTask` runs `planContextBundle`, loads suggested anchor excerpts, reports stale
included anchors, includes active milestone summaries, and suggests follow-up
`readAnchor` calls when excerpts are not enough.

`loadContext` combines discovery metadata with multiple anchor bodies in one call.
Defaults are `limit: 12`, `maxBytes: 250000`, `includeContent: "excerpt"`, and
`excerptChars: 1200`.

When `truncated` is true, call again with `nextCursor` from the previous response. If
the payload is still too large for the client, reduce `limit` or `maxBytes`, or set
`includeContent` to `excerpt` or `none`.

## Project Resolution

`startTask` and `planContextBundle` accept an optional `repo` name and `filePaths`
list. When a request is scoped to a repository or touched files rather than a named
project, the server maps those signals to candidate project slugs and boosts their
anchors during scoring. The server cannot observe the editor, so clients should pass
`repo` and `filePaths` to benefit from resolution.

The mappings live in a project-first registry, `project-mappings.json`, at the anchor
root (alongside `people-registry.json`). It is not an anchor and is empty by default,
so no real-world repo or project names ship with the tool. The service caches it keyed
on the file's git commit, so resolution does not re-read it on every request.

```json
{
  "projects": [
    {
      "project": "payments",
      "repos": [
        { "repo": "repo-alpha", "paths": ["services/payments"] },
        { "repo": "repo-beta", "paths": [] }
      ]
    },
    {
      "project": "reporting",
      "repos": [{ "repo": "repo-alpha", "paths": ["services/reporting"] }]
    }
  ]
}
```

- Each project lists the repositories it lives in (0–n). Repo names match
  case-insensitively, and one repo may host several projects.
- Each repo entry may be narrowed to directory `paths` — plain prefixes, no globs:
  `services/payments` matches everything under `services/payments/`. An empty `paths`
  array means the whole repo maps to that project.
- A repo match boosts the project; a file path that falls under a configured path
  boosts it further, so a path-narrowed project ranks above a whole-repo match.
- An unrecognized repo degrades gracefully: candidates derived from matching paths are
  still returned, and the unknown repo is reported in `projectResolution.unknownRepo`
  and `missingContext` rather than producing an empty result.
- Results carry a `projectResolution` block explaining why each candidate project was
  included; resolution boosts scoring only and never mutates anchors.

Manage the registry through the `getProjectMappings` / `writeProjectMappings` MCP tools
(writes use the same optimistic-concurrency `expectedFileCommit` guard as the people
registry) or the `/ui` **Repo Mappings** tab, which provides add/edit/delete for
projects, their repos, and per-repo paths. The Planner tab also exposes `Repo` and
`File paths` inputs and renders the resolved candidate projects, their boosts, and the
per-candidate reasons.

## Writing Anchors

The server instructions tell agents to write back durable discoveries, not only answer
in chat, and to avoid editing anchor files under `--repo` directly on disk. Use MCP
write tools so validation and server-side commits stay aligned.

- Facts map to `## Current State`, `## Decisions`, or `## Constraints`.
- PR links go under `## PRs` with link text `PR <title> - #<number>`.
- Material changes to Current State, Decisions, or Constraints should refresh
  `last_validated`.
- Edits that change Decisions or Constraints, or remove bullets, require explicit
  approval through `approved: true`.
- `deleteAnchor` and `renameAnchor` always require `approved: true`.

Use proposed-change tools when reviewable draft intent is better than a durable edit.
See [proposed-changes.md](proposed-changes.md).

## Write Validation

`writeAnchor` and the chunked write tools (`updateAnchorFrontmatter`,
`updateAnchorSection`, `appendToAnchorSection`, `deleteAnchorSection`) synthesize full
Markdown and run the same validator pipeline before committing. Prefer chunked tools
for small edits so models do not resend large bodies.

Optional `expectedFileCommit`, from `readAnchor(...).fileCommit`, rejects stale
concurrent updates with `stale_base`.

Blocking validation covers:

- unknown top-level directories and root-level Markdown anchors
- direct writes to generated `CONTEXT-ROOT.md`
- required front matter: `type`, `tags`, `summary`, `read_this_if`,
  `last_validated: YYYY-MM-DD`
- project anchors missing matching `project` front matter
- required sections: `## Current State`, `## Decisions`, `## Constraints`, `## PRs`
- PR link text that does not match `PR <title> - #<number>`
- stale `last_validated` on substantive section changes
- missing sibling `AGENTS.md` references for `CLAUDE.md`
- built-in `server-rules/*` policy anchor edits
- acceptance-criteria subtree changes without approval
- roadmap acceptance criteria missing stable ids or evidence hints

Warnings cover:

- removed bullets that should move to history or be marked superseded
- roadmaps over 400 lines
- `## Completed` tables over 10 rows
- active roadmap policy weakenings

During migration, run with `--migration-warn-only` to downgrade schema and shape blocks
into warnings while existing anchors are cleaned up.

## Dynamic Context Root

`contextRoot` builds a live root index from anchor metadata. It prepends built-in
server policy rows (`category: "server-rules"`, `origin: "built-in"`) and then groups
repo anchors in this order:

```txt
server-rules
agent-rules
projects
invariants
conflicts
shared
archive
```

Archive entries are excluded unless `includeArchive: true` or `category: "archive"` is
passed. Project milestone anchors are excluded from the context-root index so startup
discovery stays focused on project anchors and roadmaps; use `listMilestones` or
`readMilestone` for milestone detail.

`writeContextRoot` writes and commits a generated `CONTEXT-ROOT.md` at the anchor root.
The generated file is excluded from `listAnchors`, validation, and future context-root
entries.

## Project Updates And Backlog

Project updates summarize roadmap, milestone, and structured task state for humans.
See [project-updates.md](project-updates.md) for rendering and backlog rules.

When a user asks to put a task on a project backlog, resolve or create the reserved
`milestone_id: backlog` milestone, add the task to its structured `tasks`, do not
assign `sequence`, and do not invent dates, owners, or goal ids.

## Staleness Signals

`planContextBundle` and `startTask` flag included anchors whose `last_validated` date
is older than the configured threshold. The default threshold is 45 days.

```sh
anchor-mcp --repo ~/agent-context --stale-after-days 30
```

Or:

```sh
ANCHOR_MCP_STALE_AFTER_DAYS=14
```

## Planner Eval

Run deterministic planner regression checks against fixture cases:

```sh
npm run eval
```

Optional flags: `--cases path/to/cases.json`, `--min-recall 0.8`. The script exits
non-zero when average recall falls below the floor. See
[planner-judge-prompt.md](planner-judge-prompt.md) for the separate manual LLM-judge
workflow.

## Git Sync

Successful writes commit with structured metadata and then attempt `git push` unless
`--no-push-on-write` is set. A background sync loop runs `git pull --rebase` every 45
seconds unless `--no-auto-sync` is set. Real conflicts are not auto-resolved; call
`conflictStatus` to surface them to the agent.

For basic sync without MCP:

```sh
scripts/anchor-context-sync.sh ~/agent-context 45
```

## Storage Backends And Performance

The default backend is still the local git-backed anchor store. Internally,
`AnchorService` depends on a storage interface so future hosted backends can provide
the same anchor, metadata, version, search, conflict, and registry capabilities without
being git repositories.

Revision checks use backend-neutral storage methods, while MCP compatibility fields
remain named `fileCommit` and `expectedFileCommit`. In the git backend, those values
are still git commit hashes for the touched file.

The git backend maintains an in-memory read index for parsed anchor metadata and a
bounded LRU cache for file content. Oversized files are not cached. Writes, deletes,
renames, generated context-root commits, and AutoSync pulls invalidate affected
entries.

Run the local read-path harness with:

```sh
npm run perf:read-paths
```

To include larger repos, pass comma-separated sizes:

```sh
ANCHOR_MCP_PERF_SIZES=100,1000,10000 npm run perf:read-paths
```
