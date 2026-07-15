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
