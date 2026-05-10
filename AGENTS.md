# anchor-mcp Migration Guide

Use this file to convert an existing collection of context-anchor markdown documents
into the format expected by anchor-mcp. Work through each section in order.

---

## Step 1 — Initialise the Git Repository

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
- Project anchors: exactly three parts — `projects/<project-slug>/<file>.md`.
- `CONTEXT-ROOT.md` at the repo root is reserved and generated automatically. Do not move it.

**How to find invalid paths:**

List every `.md` file whose top-level directory is not in the valid set:

```bash
find . -name "*.md" ! -path "./.git/*" | awk -F/ '{print $2}' | sort -u
```

Any name in the output that is not one of the six valid categories (and not `CONTEXT-ROOT.md`)
needs to be moved. For each such directory, decide the right target:

- Agent behaviour / coding rules / role documents → `agent-rules/`
- General references, workflows, how-to guides → `shared/`
- Hard system constraints → `invariants/`
- Conflict-resolution notes → `conflicts/`
- Inactive / superseded → `archive/`

Also check for files nested more than one level deep inside a non-`projects` category
(two or more `/` after the category name). Flatten them to `<category>/<file>.md`.

Move files with `git mv` to preserve history:

```bash
git mv <old-path> <new-path>
```

Remove any empty directories left behind. Commit when all files are in valid locations.

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

**Missing `summary` or `read_this_if`:**
```bash
grep -rL "^summary:" --include="*.md" . | grep -v CONTEXT-ROOT
grep -rL "^read_this_if:" --include="*.md" . | grep -v CONTEXT-ROOT
```

**Malformed `last_validated` (catches trailing characters, wrong format):**
```bash
grep -rn "^last_validated:" --include="*.md" . \
  | grep -Ev "last_validated: [0-9]{4}-[0-9]{2}-[0-9]{2}$"
```

**Project slug mismatch under `projects/`:**
For each file at `projects/<slug>/…`, confirm its `project` front-matter value equals
`<slug>`. Extract and compare:
```bash
for f in projects/*/**.md; do
  slug=$(echo "$f" | cut -d/ -f2)
  grep "project:" "$f" | grep -qv "$slug" && echo "MISMATCH: $f (expected slug: $slug)"
done
```

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

**How to find files missing a section:**
```bash
for section in "Current State" "Decisions" "Constraints" "PRs"; do
  echo "=== Missing '## $section' ==="
  grep -rL "^## $section" --include="*.md" . | grep -v CONTEXT-ROOT
done
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

> **Tip:** Start the server with `--migration-warn-only` while adding sections.
> This demotes missing-section violations from BLOCK to WARN, allowing incremental
> migration without blocking all writes.

---

## Step 5 — Verification

Run through this checklist before connecting the repo to anchor-mcp.

**Taxonomy**
- [ ] `find . -name "*.md" ! -path "./.git/*" | awk -F/ '{print $2}' | sort -u`
      returns only valid category names (plus blank for root-level `CONTEXT-ROOT.md`)
- [ ] No `.md` files are nested more than one level inside a non-`projects` category
- [ ] No empty directories remain

**Front matter**
- [ ] `grep -rL "^summary:" --include="*.md" . | grep -v CONTEXT-ROOT` is empty
- [ ] `grep -rL "^read_this_if:" --include="*.md" . | grep -v CONTEXT-ROOT` is empty
- [ ] `grep -rn "^last_validated:" --include="*.md" . | grep -Ev "last_validated: [0-9]{4}-[0-9]{2}-[0-9]{2}$"` is empty
- [ ] All `projects/<slug>/` files have `project: <slug>` in their front matter

**Sections**
- [ ] All four required H2 sections present in every anchor (or `--migration-warn-only`
      is set while you complete them incrementally)

**Git**
- [ ] `git status` is clean (all changes committed)
- [ ] `git log --oneline -1` shows at least one commit

---

## Reference — anchor-mcp Configuration (stdio)

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
