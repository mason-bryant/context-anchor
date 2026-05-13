# anchor-mcp Migration Guide

Use this file to convert an existing collection of context-anchor markdown documents
into the format expected by anchor-mcp. Work through each section in order.

> **Two-tier workflow:** Steps 1 and 2 require direct access to the backing git
> repository and are performed once during initial setup by whoever owns the repo.
> Steps 2.5 through 5 can be performed entirely through the MCP tools — no shell
> access to the repo is needed.

---

## Step 1 — Initialise the Git Repository

> **Requires repo access.** This is a one-time bootstrap step.

anchor-mcp requires a git repository. Every write is committed; background sync uses
`git pull --rebase`. Without git, all writes fail.

```bash
cd <your-anchor-repo>
git init
git add .
git commit -m "initial: import existing context documents"
```

---

## Step 2 — Fix Directory Taxonomy

> **Requires repo access** for any files that are in the wrong location.
> Files outside the valid taxonomy are invisible to the MCP tools and cannot
> be moved or deleted through them.

anchor-mcp only recognises six top-level categories. Files outside these directories
are invisible to reads and blocked on writes.

**Valid top-level directories:**

| Directory | Purpose |
|---|---|
| `agent-rules/` | Agent behaviour rules, coding standards, role instructions |
| `projects/` | Per-project context anchors and roadmaps |
| `invariants/` | Hard architectural invariants |
| `conflicts/` | Conflict-resolution records |
| `shared/` | General shared knowledge — tools, workflows, how-to guides |
| `archive/` | Anchors no longer actively maintained |

**Depth rules:**

- Non-`projects` anchors: exactly one level deep — `<category>/<file>.md`. No subdirectories.
- Project anchors: either `projects/<project-slug>/<file>.md` **or** `projects/<project-slug>/milestones/<file>.md` for milestone anchors (`type: project-milestone`). No other nested directories under `projects/<slug>/` are allowed.
- `CONTEXT-ROOT.md` at the repo root is reserved and generated automatically. Do not move it.

**Audit what is currently visible to the MCP:**

Call `listAnchors` (with `includeArchive: true` to include archived files) to see
every anchor the server can read:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="listAnchors",
  arguments={ "includeArchive": true }
)
```

Any `.md` file that does not appear in this list is either in the wrong location or
missing required front matter. Those files must be fixed directly in the repo.

**Routing guide for misplaced files:**

- Agent behaviour / coding rules / role documents → `agent-rules/`
- General references, workflows, how-to guides → `shared/`
- Hard system constraints → `invariants/`
- Conflict-resolution notes → `conflicts/`
- Inactive / superseded → `archive/`

Also check for files nested more than one level deep inside a non-`projects` category.
Flatten them to `<category>/<file>.md`.

**Move files with `git mv` to preserve history:**

```bash
git mv <old-path> <new-path>
```

Remove any empty directories left behind. Commit when all files are in valid locations.
After committing, re-run `listAnchors` to confirm every file now appears.

---

## Step 2.5 — Extract Legacy Hardcoded `CONTEXT-ROOT.md` Content

Older repos may have a manually-written `CONTEXT-ROOT.md` that mixes policy text,
workflow guidance, or stale links (for example paths like `./context-engineering/*`).
That content should be moved into proper anchors, then `CONTEXT-ROOT.md` should be
regenerated from front matter.

**Important:**
- `CONTEXT-ROOT.md` is generated output, not a hand-authored home for long-form rules.
- Keep durable guidance in category anchors (`agent-rules/`, `projects/`, `shared/`, etc.).

### A. Identify hardcoded sections to migrate

Read the current state of the root using `contextRoot`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="contextRoot",
  arguments={ "format": "markdown" }
)
```

Look for signs that the root is legacy/manual:
- front matter present at top of `CONTEXT-ROOT.md`
- long prose sections and operational instructions
- links to non-existent paths or old taxonomy names

Use `searchAnchors` to locate any references to old taxonomy paths:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="searchAnchors",
  arguments={ "query": "context-engineering" }
)
```

### B. Route content to the right category

Use this routing when splitting content into anchors:

| Content type | Target directory | Typical `type` |
|---|---|---|
| Agent behavior, coding/review/process rules | `agent-rules/` | `agent-roles` |
| Project-specific state, plans, constraints | `projects/<slug>/` | `context-anchor` or `project-roadmap` |
| Cross-project how-to, workflows, references | `shared/` | `context-anchor` or `agent-roles` |
| Hard, stable system properties | `invariants/` | `context-anchor` |
| Temporary contradiction/resolution records | `conflicts/` | `context-anchor` |
| Retired/superseded material | `archive/` | `context-anchor` |

If a single legacy section mixes multiple concerns, split it into multiple files.

### C. Create/update anchors and remove legacy-only root prose

For each extracted chunk, create the target anchor using `writeAnchor`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="writeAnchor",
  arguments={
    "name": "agent-rules/my-rule.md",
    "content": "---\ntype: agent-roles\ntags:\n  - example\nsummary: \"One sentence describing this anchor.\"\nread_this_if:\n  - \"You need guidance on <topic>.\"\nlast_validated: 2026-01-01\n---\n\n## Current State\n\n...\n\n## Decisions\n\n...\n\n## Constraints\n\n...\n\n## PRs\n\nNone.\n"
  }
)
```

To update an existing anchor's front matter without resending the full body, use
`updateAnchorFrontmatter`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="updateAnchorFrontmatter",
  arguments={
    "name": "agent-rules/my-rule.md",
    "updates": { "summary": "Updated summary text.", "last_validated": "2026-01-01" }
  }
)
```

Do not preserve migrated prose by hand-editing `CONTEXT-ROOT.md`; preserve it in anchors.

### D. Regenerate `CONTEXT-ROOT.md`

After migration, regenerate instead of manually editing:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="writeContextRoot",
  arguments={}
)
```

Then verify stale links are gone by calling `contextRoot` again and reading the output.

### E. Do not synthesize root sections by hand

During migration, **do not write or preserve handcrafted sections** in `CONTEXT-ROOT.md`
(for example:
- `## Agent Rules` followed by manually assembled bullet lists with `Summary/Type/Read this if`
- long-form policy prose
- copied link catalogs
).

Those are migration debt. Move content into anchors and regenerate.

`CONTEXT-ROOT.md` must be treated as a generated snapshot only:
- Dynamic view at request time: call `contextRoot`.
- Snapshot on disk: `writeContextRoot`.
- Source of truth: anchor front matter and taxonomy-classified anchor paths.

### F. Migration acceptance checks for root generation

After running `writeContextRoot`, call `contextRoot` and verify all of the following:
- The output starts with `# CONTEXT-ROOT`.
- It contains the generator marker: `Generated by anchor-mcp from anchor front matter.`
- It contains no leftover legacy front matter block at the top.
- It contains no stale taxonomy links (for example `./context-engineering/`).
- It contains no hand-authored policy blocks that are not emitted by the generator template.

---

## Step 3 — Fix Front Matter

Every anchor (except `CONTEXT-ROOT.md`) must pass this schema on write. Validate
each file and add or correct any failing fields.

### Required fields

```yaml
type: "<non-empty string>"          # e.g. context-anchor, agent-roles, project-roadmap
tags:                               # array; may be empty but must be present
  - "<tag>"
summary: "<one sentence, max 240 characters>"
read_this_if:                       # 1–5 items, each max 160 characters
  - "<condition under which an agent should load this file>"
last_validated: "<YYYY-MM-DD>"      # strict ISO date, no trailing characters
```

`project` is optional globally but **required** for files under `projects/`:

```yaml
project:
  - "<project-slug>"               # must exactly match the directory name
```

### How to find front-matter violations

Call `listAnchors` to retrieve all anchors with their front matter metadata. Review the
returned `summary`, `read_this_if`, `last_validated`, and `project` fields for each entry:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="listAnchors",
  arguments={ "includeArchive": true }
)
```

For a closer look at a specific anchor's full front matter and body, use `readAnchor`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="readAnchor",
  arguments={ "name": "projects/my-project/my-anchor.md" }
)
```

**Checking for project slug mismatches under `projects/`:**

List anchors filtered by project and verify the returned `project` field matches the
directory slug for each result:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="listAnchors",
  arguments={ "project": "my-project" }
)
```

Any anchor whose `project` front matter value does not match `my-project` needs to
be corrected.

### Fixing violations

Use `updateAnchorFrontmatter` to correct individual fields without resending the body.
Pass `null` as a value to remove a key:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="updateAnchorFrontmatter",
  arguments={
    "name": "shared/my-guide.md",
    "updates": {
      "summary": "A guide to doing X in this project.",
      "read_this_if": ["You need to understand how X is done."],
      "last_validated": "2026-01-01"
    }
  }
)
```

If the anchor's front matter is too far from valid to patch incrementally, read it
with `readAnchor`, correct the full content, and rewrite it with `writeAnchor`.

### Writing good `summary` and `read_this_if` values

- `summary`: describe what the document **is**, not what it instructs. One sentence.
  Treat it as the answer to "what is this anchor about?"
- `read_this_if`: describe the **agent situation** that makes this file relevant.
  Each item should complete the sentence "Load this anchor if you are…" or "Load this
  anchor when you need to…". Be concrete — vague items waste context budget.

---

## Step 4 — Fix Required Document Sections

Every anchor body must contain these four H2 headings:

```markdown
## Current State
## Decisions
## Constraints
## PRs
```

### How to find anchors missing a section

There is no single query that lists all anchors missing a given section. The reliable
approach is to enumerate anchors and read each one:

1. Call `listAnchors` to get all anchor names.
2. For each anchor, call `readAnchor` and check whether the four required headings appear
   in the returned body.

To quickly search for anchors that reference (or notably lack) a particular heading,
use `searchAnchors`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="searchAnchors",
  arguments={ "query": "## Current State" }
)
```

Anchors that do not appear in the results are candidates for missing that section.

### Fixing missing sections

**If the section exists but has wrong or empty content**, use `updateAnchorSection`
(content must not include the heading line itself):

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="updateAnchorSection",
  arguments={
    "name": "shared/my-guide.md",
    "heading": "Current State",
    "content": "This guide covers X. It is actively maintained."
  }
)
```

**If the section is completely absent**, read the full anchor with `readAnchor`, add
the missing sections to the body, and rewrite it with `writeAnchor`. The server
blocks writes that are still missing required sections, so the write itself confirms
compliance.

**To append content to an existing section** without replacing it, use
`appendToAnchorSection`:

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="appendToAnchorSection",
  arguments={
    "name": "shared/my-guide.md",
    "heading": "PRs",
    "content": "- [PR Add feature X - #42](https://github.com/org/repo/pull/42)"
  }
)
```

**What belongs in each section:**

- **`## Current State`** — What exists today. Facts only; no plans or intentions.
  For rule/guide files, describe what the rule applies to and the current approach.
- **`## Decisions`** — Choices already made and reflected in this file. Each entry
  should state what was decided and why (if known).
- **`## Constraints`** — Hard limits that shape what is possible. Technical,
  organizational, or product constraints. Do not infer unless clearly implied.
- **`## PRs`** — Related pull requests. Format: `[PR <title> - #<number>](<url>)`.
  Group by status (Merged / Open / Closed). If none exist, write `None.`

> **Tip:** Start the server with `--migration-warn-only` to demote missing-section
> violations from BLOCK to WARN, allowing incremental migration without blocking all
> writes. This is a server configuration flag — see the Reference section below.

---

## Step 5 — Verification

Run through this checklist before treating the migration as complete.

**Taxonomy**

Call `listAnchors` with `includeArchive: true` and verify:
- [ ] Every expected anchor appears in the results.
- [ ] No anchor has a path outside the six valid categories.
- [ ] No project anchor is nested deeper than `projects/<slug>/<file>.md` (or
      `projects/<slug>/milestones/<file>.md` for milestone anchors).

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="listAnchors",
  arguments={ "includeArchive": true }
)
```

**Front matter**

- [ ] Every anchor returned by `listAnchors` has non-empty `summary` and `read_this_if`
      values in the result metadata.
- [ ] All `last_validated` values are strict ISO dates (`YYYY-MM-DD`, no trailing text).
- [ ] All anchors under `projects/<slug>/` have `project: [<slug>]` in their front matter.

Any write that passed without a BLOCK error has already been validated — validation is
enforced at write time, not separately.

**Sections**

- [ ] For any anchor added or updated during migration, `readAnchor` shows all four
      required sections (`## Current State`, `## Decisions`, `## Constraints`, `## PRs`).

Again, a successful `writeAnchor` (non-warn-only mode) guarantees sections are present.

**Context root**

- [ ] `contextRoot` returns output beginning with `# CONTEXT-ROOT` and containing no
      stale paths.

```json
CallMcpTool(
  server="anchor-mcp",
  toolName="contextRoot",
  arguments={ "format": "markdown" }
)
```

---

## Reference — anchor-mcp Configuration (stdio)

The server must be running and pointed at your anchor repo before any MCP tool calls
will work. Replace `anchor-mcp` with whatever name you give the server in your MCP
client config — that name is what you pass as the `server` argument in every tool call.

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "command": "node",
      "args": [
        "/path/to/context-conductor/dist/bin/anchor-mcp.js",
        "--repo", "/path/to/your-anchor-repo",
        "--migration-warn-only"
      ]
    }
  }
}
```

Remove `--migration-warn-only` once all files pass validation cleanly.
