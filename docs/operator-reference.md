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

## Server Lifecycle

```sh
anchor-mcp             # serve in the foreground on stdio — what MCP clients launch
anchor-mcp serve       # the same thing, named explicitly
anchor-mcp start       # run the HTTP server detached, logging to a file
anchor-mcp status      # resolved config, database state, and whether a server is up
anchor-mcp restart     # stop, wait for the port to free, start
anchor-mcp stop        # stop the detached server
```

A bare `anchor-mcp` with no subcommand still serves, so existing MCP client stanzas need
no change. The subcommand must come first, before any flags.

## Agent Skill

```sh
anchor-mcp install                     # .claude/skills/ and .cursor/rules/ in this directory
anchor-mcp install --agent cursor      # one harness only
anchor-mcp install --stealth           # keep it out of git
anchor-mcp install --force             # replace a same-named file anchor-mcp did not write
```

`install` writes into the current working directory — the project being edited, not the
anchor repository `--repo` points at. The skill's job is to tell an agent when to consult the
anchors, so it has to be where a coding session looks. It builds no runtime and touches no
database, which means it works before either exists.

The installed rule triggers on a **topic shift** rather than at session start: `startTask`
fires before the topic is known, and the topic changes several times before a session ends.
It also states precedence — an anchor beats AGENTS.md, and a conflict between them is
reported to the operator rather than quietly resolved.

`--stealth` sends the Claude Code skill to `~/.claude/skills/`, outside any repository, where
it applies to every project. Cursor has no equivalent: project rules come from `.cursor/rules`
and its User Rules are settings text rather than files, so the Cursor rule stays in the working
tree and is appended to `.git/info/exclude` — per clone, never committed. In a linked worktree
the exclude is written to the git dir the `.git` file points at, so it applies where the file
actually is.

`start`, `stop`, and `restart` apply only to the **HTTP** transport. A stdio server is a
child process of the MCP client that spawned it, with its stdin and stdout wired to that
client — there is typically one per client session, and its lifecycle belongs to the
client, not here. `stop` says so explicitly rather than reporting "nothing to stop",
which would read as a bug to anyone whose editor plainly has a server running.

`start` defaults to the HTTP transport, since detaching only makes sense there. Do not
set `transport: "http"` in the config file to achieve this — that would also flip every
bare `anchor-mcp` launch, which is what stdio clients run. An explicit
`--transport stdio` with `start` is an error rather than something silently overridden.

Runtime files live under `~/.anchor-mcp/`, keyed by host and port so instances on
different ports do not collide:

- `~/.anchor-mcp/run/<host>-<port>.pid`
- `~/.anchor-mcp/logs/server-<host>-<port>.log`

They are deliberately not written to the anchor repository, which auto-commits and
auto-pushes — a pidfile there would be committed to the context repo on the next sync.

`stop` reads the pidfile rather than probing the port, and verifies the recorded pid is
still an `anchor-mcp` process before signalling it. Pids get recycled; killing whatever
inherited the number would be worse than failing. A pidfile pointing at a foreign process
is reported and left in place, not silently deleted. A pidfile whose process is simply
gone is cleaned up.

Ordering after a reboot is `db start`, then `start`: with a database configured, the
server reads migration state during startup and will not boot if Postgres is unreachable.

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

The same HTTP server serves an explorer and guarded editor UI at
`http://127.0.0.1:3333/ui`. Enter the same bearer token used for MCP requests. In the
rendered anchor view, supported content includes inline editors for claims, summary
bullets, Mermaid diagrams, and Markdown pipe tables; writes use the same validation,
approval, and optimistic-concurrency checks as other server mutations.

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
included anchors, includes active milestone summaries, and suggests follow-up reads
when excerpts are not enough.

`loadContext` combines discovery metadata with multiple anchor bodies in one call.
Defaults are `limit: 12`, `maxBytes: 250000`, `includeContent: "excerpt"`, and
`excerptChars: 1200`.

In excerpt mode, a canonical project context anchor is budgeted and loaded using a
compact project overview rather than its complete body. The response includes its
front matter, the complete Markdown from `## Introduction` through `## Invariants`,
`availableSections`, an outline of the other H2 headings, and
`availableSectionPaths`, an outline of nested headings beneath those sections. Call
`readAnchorSection({ name, heading: "Current State" })` for a complete H2 or
`readAnchorSection({ name, heading: "Current State > Capabilities" })` for one nested
topic without loading the full anchor. If a title contains the `>` delimiter, pass an
array from `availableHeadingPaths` instead:
`readAnchorSection({ name, headingPath: ["Current State", "Input > Output"] })`.
Repeated paths are advertised once, with reads resolving to the final occurrence in
document order. Use `readAnchor` only when the complete document is needed.

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
        {
          "repo": "repo-alpha",
          "paths": ["services/payments"],
          "web": { "url": "https://github.com/acme/repo-alpha", "branch": "main" }
        },
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
- An optional `web` block enables building links to specific files in the repo:
  `web.url` is the repo's web home, `web.branch` defaults to `main`, and
  `web.fileTemplate` (default `{url}/blob/{branch}/{path}`, GitHub-style) can be
  overridden for other hosts (e.g. GitLab `{url}/-/blob/{branch}/{path}`). The
  `repoFileUrl(repo, path, line?)` helper substitutes `{url}`/`{branch}`/`{path}` and
  appends `#L<line>`.
- `externalLinkTemplates` optionally makes tenant-specific references in rendered anchor
  prose clickable without baking a tenant into the product. `confluencePage` supports
  `{space}` and `{pageId}` (for `Confluence SPACE/pages/123`), while `slackChannel`
  supports `{channel}` (for `#channel-name`) when your workspace needs a custom deep
  link. For example:

  ```json
  {
    "externalLinkTemplates": {
      "confluencePage": "https://your-domain.atlassian.net/wiki/spaces/{space}/pages/{pageId}",
      "slackChannel": "https://slack.com/app_redirect?channel={channel}&team=TEAM_ID"
    }
  }
  ```

  Google Doc references written as `Google Doc "Title" (doc id <id>)` and Slack channel
  references such as `#incident-room` link directly without configuration. Bare `PR #123`
  references link when the containing project resolves to exactly one mapped repository
  with a web URL.
- A repo match boosts the project; a file path that falls under a configured path
  boosts it further, so a path-narrowed project ranks above a whole-repo match.
- An unrecognized repo degrades gracefully: candidates derived from matching paths are
  still returned, and the unknown repo is reported in `projectResolution.unknownRepo`
  and `missingContext` rather than producing an empty result.
- Results carry a `projectResolution` block explaining why each candidate project was
  included; resolution boosts scoring only and never mutates anchors.

Manage the registry through the `getProjectMappings` / `writeProjectMappings` MCP tools
(writes use the same optimistic-concurrency `expectedFileCommit` guard as the people
registry) or the `/ui` **Repo Mappings** tab. The tab lists every project under
management — its project list is derived from anchors, so you map by adding repos/paths
to existing projects rather than typing a slug, and a mapping can never be created for a
project that has no anchor. **Clear mapping** removes a project's repos (the row stays
listed); projects with no repos are not persisted. A mapping whose project no longer has
an anchor (e.g. after a rename or delete) appears under **Orphaned mappings** with a
**Remove** action so it can be cleaned up. The Planner tab also exposes `Repo` and
`File paths` inputs and renders the resolved candidate projects, their boosts, and the
per-candidate reasons.

## Writing Anchors

### Reader-facing external links

Use explicit Markdown links for citations a reader should be able to open. Keep provenance
annotations as evidence metadata; they do not make the surrounding prose clickable.

```md
- Coordinate in [#project-channel](https://slack.com/app_redirect?channel=C123).
- Read [Design document](https://docs.google.com/document/d/ID/edit).

  {src: https://docs.google.com/document/d/ID/edit; observed: 2026-07-10; conf: high}
```

Use backticks only for literal code, paths, commands, and IDs. `suggestMarkdownLinks` is a
read-only migration helper: it only proposes replacements for backtick-wrapped Google Doc,
Confluence, and Slack references when the anchor already contains exactly one supporting URL.
Review its `suggestedContent`, then apply it deliberately through `writeAnchor` or a proposed
change. Ordinary writes return a non-blocking `markdown_link_suggested` warning when such a
replacement is available.

The server instructions tell agents to write back durable discoveries, not only answer
in chat, and to avoid editing anchor files under `--repo` directly on disk. Use MCP
write tools so validation and server-side commits stay aligned.

- Design-header claims map to `## Introduction` or `## Invariants`; operational facts
  map to `## Current State`, `## Decisions`, or `## Constraints`.
- PR links go under `## PRs` with link text `PR <title> - #<number>`.
- Material changes to Introduction, Invariants, Current State, Decisions, or Constraints should refresh
  `last_validated`.
- Edits that change Invariants, Decisions, or Constraints, or remove bullets, require explicit
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
- built-in `server-rules/*` policy anchor edits
- acceptance-criteria subtree changes without approval
- roadmap acceptance criteria missing stable ids or evidence hints

Warnings cover:

- project context anchors with a missing or misplaced design header: `## Introduction`
  (`### Purpose`, `### Goals`, `### Users`, `### Non-goals`) followed by
  `## Invariants`
- project context anchors whose `## Current State` has at least eight claims with
  claims left outside H3 topic headings (`current_state_unstructured`)
- Current State topics with more than twelve claims (`current_state_topic_oversized`)
- Current State sections with at least three release-history-style claims, such as
  “merged” or “shipped in PR #…” (`current_state_changelog_heavy`)
- removed bullets that should move to history or be marked superseded
- roadmaps over 400 lines
- `## Completed` tables over 10 rows
- active roadmap policy weakenings

During migration, run with `--migration-warn-only` to downgrade schema and shape blocks
into warnings while existing anchors are cleaned up.

#### Structured-anchor enforcement (`--anchor-schema-mode`)

`--anchor-schema-mode` (env `ANCHOR_MCP_ANCHOR_SCHEMA_MODE`) is the Goal 0 dial that
graduates a repo from "structure is optional" to "structure is required for new and
edited graph-participating anchors":

- `legacy` (default) — no new violations; missing `anchor_id`/`schema_version` or legacy
  relation targets stay silent (the Coverage view still reports them). Identical to
  pre-dial behavior.
- `warn` — a write that leaves a graph-participating anchor incompletely structured emits
  a WARN naming exactly what is missing.
- `enforce` — the same conditions BLOCK. New anchors are structured automatically by
  mint-on-create, so `enforce` in practice catches hand-authored/imported anchors missing
  the minted fields and legacy relation targets. It never blocks merely reading a legacy
  anchor, and (by design) never starts blocking an unrelated edit to an already-legacy
  anchor — only gaps a write newly introduces are enforced. Preview a fix with
  `previewAnchorMigration`.

### Project context design header

The durable `type: context-anchor` file directly under `projects/<slug>/` begins with
two orientation sections before the operational sections:

```markdown
## Introduction

### Purpose

### Goals

### Users

### Non-goals

## Invariants
```

Purpose states the problem the project exists to solve. Goals name intended outcomes;
Users identifies primary users and stakeholders; Non-goals establishes explicit scope
boundaries. Invariants are intentional, architecture-level guarantees that must always
remain true. Constraints are limits imposed by the current environment, technology,
organization, or operating context. The UI uses these same definitions in hoverable
info tooltips, and MCP reads/context loads return every definition in
`sectionDefinitions` for agents. The shared schema in `src/anchorStructure.ts` is the
source of truth for required headings, definitions, claim-bearing sections,
substantive-section validation, and approval-sensitive sections.
Prefer one testable invariant per bullet with a stable id such as `INV-001` so reviews,
decisions, and conflict reports can cite it without copying or ambiguously paraphrasing it.

Missing fields do not block MCP reads or writes; they return WARN entries. When the UI
opens a legacy project context anchor, it persists the missing blank sections and fields
in a migration commit before rendering detail. Raw and Rendered therefore show the same
Markdown, and bullets in Introduction and Invariants use the same claim/provenance editor
as Current State, Decisions, and Constraints. Treat Introduction and Invariants as the
project's authoritative design header: when later details conflict, flag the conflict for
resolution rather than silently preferring the detail. Semantic conflict detection remains
an agent review responsibility; the server only detects structural omissions and placement.

### Organizing Current State

`## Current State` records present implementation reality, not a chronological release
log. Small anchors can remain a concise flat list. Once the section grows, group claims
under descriptive H3 topics so humans can scan the document and agents can retrieve only
the relevant subtree. The shared schema advertises a recommended vocabulary:

```markdown
## Current State

### Architecture

### Capabilities

### Interfaces

### Data and Persistence

### Operations and Security

### Quality and Performance

### Known Limitations
```

These topic names are optional rather than a fixed template; use domain-specific H3
headings when they communicate the system more clearly. Keep observable behavior in
Current State, settled rationale in `## Decisions`, environmental limits in
`## Constraints`, and chronological delivery links in `## PRs`. If one topic grows
beyond a coherent section, split it into narrower H3 topics or a sibling project detail
anchor. Nested paths are fence-aware and may be read directly with
`readAnchorSection`, for example `Current State > Data and Persistence`.

The anchor detail UI exposes these signals in a **Current State Organization** card.
The card distinguishes concise, topic-oriented, and needs-organization states; shows
claim, ungrouped, and release-history counts; and displays either the anchor's actual
retrieval paths or the recommended topic paths. The Validation card continues to show
the corresponding warning codes and remediation messages.

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

## Structured Questions

Anchors can keep follow-up questions as readable Markdown while exposing them as
queryable data. `listQuestions` parses top-level bullets from these H2 sections:

- `## Open Questions`
- `## Questions`
- `## Resolved Questions`

Supported status markers include `[ ]`, `[x]`, `[-]`, `[resolved]`, `[deferred]`,
and `[wont-answer]`. Optional metadata lines under the bullet are parsed when they
start with `Resolution:`, `Resolved on:`, `Owner:`, or `Status:`.

Example:

```md
## Open Questions

- [ ] Q-1: Which source owns this decision?
- [x] Q-2: Should resolved questions remain queryable?
  Resolution: Yes, they remain useful as historical context.
  Resolved on: 2026-07-09
```

Use `resolveQuestion` to mark a question `resolved`, `deferred`, or `wont-answer`.
Use `reopenQuestion` to mark it open again. Both tools locate questions by line,
stable `Q-...` id, or unique text fragment.

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

## Database Backend (Optional)

The Git-backed anchor store above is the default and requires no setup. A separate,
optional Postgres-backed "knowledge" schema (G-042/M12: the database-backed redesign)
adds database-backed MCP tools alongside it — currently just `listScopes` — without
replacing anything. With no database configured, the server boots exactly as before and
these tools are not registered at all.

Local lifecycle (Docker required):

```sh
anchor-mcp db start          # start Postgres, wait for readiness, apply pending migrations
anchor-mcp db status         # schema version and pending migration count
anchor-mcp db migrate        # apply pending migrations only
anchor-mcp db import         # import the anchor repository at its current commit
anchor-mcp db psql           # interactive shell against the running database
anchor-mcp db stop           # stop the container, leaving data in place
anchor-mcp db reset --yes    # drop and recreate from migrations (destructive; --yes required)
```

`db start`/`db stop` are also spelled `db up`/`db down`, and the `npm run db:*` scripts
still work in this repository — they forward to the same implementation.

`db migrate` and `db status` talk to whatever `DATABASE_URL` names and work from an
installed package. `db start`, `db stop`, `db psql`, and `db reset` drive the container
declared in this repository's `docker-compose.yml`; from an installed package they report
that rather than failing inside `docker compose`. This is why a pending-migration failure
at startup names `anchor-mcp db migrate` and not an `npm` script: the script only exists
for people working in this repository, but the error is the first thing a package consumer
hits.

The server and every `db` command resolve `--config` / `ANCHOR_MCP_CONFIG` /
`./anchor-mcp.config.json` through the same code path, so `db migrate` cannot apply
migrations to one schema while the server refuses to start against another.

### Importing an anchor repository

`db import` reads the repository named by `repo`, pins the import to its `HEAD` commit,
and sends every Markdown file plus `project-mappings.json` and `people-registry.json`
to the T2 bootstrap importer.

It **refuses a dirty working tree**. An import is defined against a pinned commit, so
importing uncommitted content would record a sha that does not describe what was
imported, making "what was in this import" unanswerable later. `--allow-dirty` overrides
this and warns loudly; the recorded provenance is then knowingly inaccurate.

Re-importing the same commit writes nothing at all — the idempotency key short-circuits
each command before content is compared, so the report is entirely zeros and the command
says explicitly that the commit was already imported.

`project-mappings.json` is stored project-first (`{ projects: [...] }`, or a bare array)
while the importer wants one row per `(repository, pathPrefix)`, because that pair is
what routing matches on. The flattening names each component scope `${project}-${name}`,
where `name` is the repo name when it declares no path prefixes and `${repo}-${prefix}`
when it does. A registry that exists but yields no mappings is an error rather than a
silent zero, since routing scopes would otherwise be quietly missing.

Measured on a 47-file anchor repository: 47 documents, 894 sections, 1279 blocks, 26
scopes, 909 associations, in under a second.

`docker-compose.yml` pins the Postgres major version, sets `PGDATA` explicitly, and
bind-mounts data to the gitignored `.data/postgres/` directory. It publishes port
`55432` (not the default `5432`, and never `3333`, the dev HTTP server's port) so it
cannot collide with an existing local Postgres.

To point the server at it, set `DATABASE_URL` (never put a connection string in the
config file):

```sh
DATABASE_URL=postgres://anchor:anchor@127.0.0.1:55432/anchor_mcp npm run dev:http
```

Non-secret settings — pool size and the schema name — go in an optional `database` block
in `anchor-mcp.config.json`:

```json
{
  "database": {
    "poolSize": 10,
    "schemaName": "knowledge"
  }
}
```

The `db` CLI reads that same `database.schemaName`, so migrations and the server always
target one schema. It looks for `ANCHOR_MCP_CONFIG` first, then a repo-root
`anchor-mcp.config.json`, and falls back to `knowledge` when neither exists. Set
`ANCHOR_MCP_DB_SCHEMA` only when you deliberately want to point the CLI somewhere else
(a scratch or diagnostic schema) — it overrides the config file for that invocation.

If `DATABASE_URL` is set but the schema has pending migrations, the server refuses to
start with an explicit error rather than booting into a half-usable state. Access is
deny-by-default from the first migration: a workspace `owner` has full access with no
grant row required; a `member` sees nothing until an explicit `scope_grants` row exists
for them.
