# Agent Migration Rules — anchor-mcp Compatibility

This file describes the specific changes required to make every file in this repo
valid under the [anchor-mcp](https://github.com/mbryant/context-conductor) MCP server.
Work through issues 1–4 in order; do not skip ahead.

---

## Issue 1 — Directory Taxonomy Migration

The MCP server only recognises six top-level categories. Every file outside them is
invisible to reads and blocked on writes.

**Valid top-level directories:**

| Directory | Purpose |
|---|---|
| `agent-rules/` | Agent behaviour and coding rules |
| `projects/` | Per-project context anchors and roadmaps |
| `invariants/` | Hard architectural invariants |
| `conflicts/` | Conflict-resolution records |
| `shared/` | General shared knowledge (tools, workflows, guides) |
| `archive/` | Archived anchors |

**Depth rules:**

- Non-`projects` anchors must live at exactly `<category>/<file>.md` — one level deep, no subdirectories.
- Project anchors must live at `projects/<project-slug>/<file>.md` — exactly three path parts.
- `CONTEXT-ROOT.md` at the root is the only allowed root-level file (generated, do not edit manually).

**Required file moves — perform as `git mv` to preserve history:**

| Current path | New path | Notes |
|---|---|---|
| `coding/common-coding-rules.md` | `agent-rules/common-coding-rules.md` | |
| `coding/feature-flags.md` | `agent-rules/feature-flags.md` | |
| `coding/no-private-path-leakage.md` | `agent-rules/no-private-path-leakage.md` | |
| `context-engineering/context-anchor-rules.md` | `agent-rules/context-anchor-rules.md` | |
| `context-engineering/conflicts-and-invariants-rules.md` | `agent-rules/conflicts-and-invariants-rules.md` | |
| `context-engineering/markdown-rules.md` | `agent-rules/markdown-rules.md` | |
| `context-engineering/project-docs-lifecycle.md` | `agent-rules/project-docs-lifecycle.md` | |
| `context-engineering/roadmap-rules.md` | `agent-rules/roadmap-rules.md` | |
| `context-engineering/runbook-rules.md` | `agent-rules/runbook-rules.md` | |
| `git-workflows/stacked-branches.md` | `shared/stacked-branches.md` | |
| `tests/authoring-rql-tests.md` | `shared/authoring-rql-tests.md` | |
| `tests/running-tests.md` | `shared/running-tests.md` | |
| `datadog/datadog-dashboard-authoring.md` | `shared/datadog-dashboard-authoring.md` | |
| `rql-audits/adding-an-rql-audit.md` | `shared/adding-an-rql-audit.md` | |
| `cbp/cbp-native-model-guide.md` | *(delete)* | Exact duplicate of `projects/cbp/cbp-native-model-guide.md` |

After moving, remove the now-empty source directories.

---

## Issue 2 — Missing Required Front Matter Fields

Every anchor (except `CONTEXT-ROOT.md`) must contain these two fields or the MCP
server will block writes and omit the file from context-root generation:

```yaml
summary: "<One sentence, max 240 characters, describing what this anchor is about.>"
read_this_if:
  - "<Condition under which an agent should load this anchor, max 160 chars.>"
  - "<Add 1–5 total items.>"
```

Add `summary` and `read_this_if` immediately after the existing front matter fields
(before the closing `---`). Prescribed values for each file follow.

### agent-rules/ (formerly coding/)

**`agent-rules/common-coding-rules.md`**
```yaml
summary: "Coding standards covering planning, debugging, file/function size, type annotations, and test requirements."
read_this_if:
  - "You are writing, reviewing, or refactoring any code in this repo."
  - "You need to decide how to plan or debug a non-trivial change."
```

**`agent-rules/feature-flags.md`**
```yaml
summary: "Rules for gating, naming, and cleaning up feature flags in Rippling code."
read_this_if:
  - "You are adding, using, or removing a feature flag."
```

**`agent-rules/no-private-path-leakage.md`**
```yaml
summary: "Rule preventing machine-specific or private filesystem paths from appearing in committed code or agent context."
read_this_if:
  - "You are about to reference a local file path in a response, comment, or committed file."
```

### agent-rules/ (formerly context-engineering/)

**`agent-rules/context-anchor-rules.md`**
```yaml
summary: "Rules for creating and maintaining context anchor documents: placement, front matter, required sections, and lifecycle."
read_this_if:
  - "You are creating or updating a context anchor file."
  - "You need to know the required format or section structure for an anchor."
```

**`agent-rules/conflicts-and-invariants-rules.md`**
```yaml
summary: "Rules for documenting architectural invariants and conflict-resolution entries in anchor files."
read_this_if:
  - "You are documenting a hard architectural constraint or a known conflict between two rules."
```

**`agent-rules/markdown-rules.md`**
```yaml
summary: "Markdown authoring standards for all files in this context repo, including front matter conventions and section ordering."
read_this_if:
  - "You are writing or editing any markdown file in this repo."
```

**`agent-rules/project-docs-lifecycle.md`**
```yaml
summary: "Lifecycle rules for project documentation: when to create anchors, when to promote to tracked files, and when to archive."
read_this_if:
  - "You are deciding whether to create, update, promote, or archive a project document."
```

**`agent-rules/roadmap-rules.md`**
```yaml
summary: "Rules for writing and maintaining project roadmap files, including structure, content boundaries, and update cadence."
read_this_if:
  - "You are creating or updating a project roadmap file."
```

**`agent-rules/runbook-rules.md`**
```yaml
summary: "Rules for writing runbook documents: when to create them, required structure, and how to link them to context anchors."
read_this_if:
  - "You are creating or updating a runbook."
```

### shared/ (formerly git-workflows/)

**`shared/stacked-branches.md`**
```yaml
summary: "Workflow and commands for creating, rebasing, and managing stacked git branches in this repo."
read_this_if:
  - "You are creating or managing a stack of dependent PRs."
  - "You need to rebase or update a branch in a PR stack."
```

### shared/ (formerly tests/)

**`shared/authoring-rql-tests.md`**
```yaml
summary: "Guide for writing RQL test cases: test structure, fixtures, assertion patterns, and common pitfalls."
read_this_if:
  - "You are writing or modifying RQL test cases."
```

**`shared/running-tests.md`**
```yaml
summary: "How to run tests in this repo, including the mandatory hot test daemon MCP and what to avoid."
read_this_if:
  - "You need to run tests."
  - "You are about to use cde local test or a shell command to execute tests."
```

### shared/ (formerly datadog/)

**`shared/datadog-dashboard-authoring.md`**
```yaml
summary: "Rules and patterns for authoring Datadog dashboards: widget types, query format, naming conventions, and review checklist."
read_this_if:
  - "You are creating or editing a Datadog dashboard or monitor."
```

### shared/ (formerly rql-audits/)

**`shared/adding-an-rql-audit.md`**
```yaml
summary: "Step-by-step guide for adding a new RQL audit: required components, registration, and validation."
read_this_if:
  - "You are adding a new RQL audit."
  - "You need to understand how existing RQL audits are structured."
```

### projects/cbp/

**`projects/cbp/cbp-native-model-guide.md`**
```yaml
summary: "Architecture reference for Criteria-Based Permissions (CBP) on native RQL models: how preprocessing, enrollment, and enforcement work."
read_this_if:
  - "You are working on CBP enforcement, native model onboarding, or row-level security for RQL queries."
  - "You need to understand how the native_cbp_model_registry or CBP preprocessor works."
```

**`projects/cbp/cbp-roadmap.md`**
```yaml
summary: "Roadmap for deferred CBP enforcement work, including AST-checked constraint improvements and outstanding cleanup tasks."
read_this_if:
  - "You are planning or picking up CBP enforcement work."
  - "You need to know what CBP work is planned but not yet shipped."
```

### projects/custom-field-perf/

**`projects/custom-field-perf/custom-field-perf-project-context.md`**
```yaml
summary: "Context anchor for the custom-field query performance project: consolidation, blending, Iceberg sourcing, and experiment results."
read_this_if:
  - "You are working on custom field query performance, the consolidation CTE, or the Iceberg blending approach."
```

### projects/object-graph/

**`projects/object-graph/object-graph-project-context.md`**
```yaml
summary: "Context anchor for the object-graph project: current architecture, decisions, and constraints."
read_this_if:
  - "You are working on the object graph, graph traversal, or any feature that depends on object relationships."
```

### projects/trino-config-refactor/

**`projects/trino-config-refactor/trino-config-refactor-project-context.md`**
```yaml
summary: "Context anchor for the TrinoQueryConfig refactor: motivation, current state of the refactor, and key decisions."
read_this_if:
  - "You are working on TrinoQueryConfig, Trino query construction, or anything that touches query config assembly."
```

**`projects/trino-config-refactor/trino-config-refactor-roadmap.md`**
```yaml
summary: "Roadmap for the TrinoQueryConfig refactor: remaining work, sequencing, and open questions."
read_this_if:
  - "You are planning or picking up the next phase of the Trino config refactor."
```

### projects/typed-vtables/

**`projects/typed-vtables/typed-vtables-project-context.md`**
```yaml
summary: "Context anchor for the typed-vtables project: goals, current typing approach, and constraints."
read_this_if:
  - "You are working on typed vtables or adding type annotations to vtable definitions."
```

### projects/vtable-framework/

**`projects/vtable-framework/vtable-framework-project-context.md`**
```yaml
summary: "Context anchor for the vtable framework: architecture, base classes, registration, and key invariants."
read_this_if:
  - "You are working on the vtable framework itself or building a new vtable that uses the framework."
```

**`projects/vtable-framework/vtable-framework-roadmap.md`**
```yaml
summary: "Roadmap for vtable framework improvements: planned work, open design questions, and sequencing."
read_this_if:
  - "You are planning or picking up vtable framework improvements."
```

### projects/zviews-framework/

**`projects/zviews-framework/zviews-project-context.md`**
```yaml
summary: "Context anchor for the zviews framework: architecture, rendering pipeline, and current state."
read_this_if:
  - "You are working on the zviews framework or a view that uses it."
```

**`projects/zviews-framework/zviews-roadmap.md`**
```yaml
summary: "Roadmap for the zviews framework: planned features, open questions, and sequencing."
read_this_if:
  - "You are planning or picking up zviews framework work."
```

---

## Issue 3 — Project Slug Mismatch

Files under `projects/<slug>/` must have a `project` front matter value that exactly
matches `<slug>` (the directory name). The following file has a mismatch:

| File | Current `project` value | Correct value |
|---|---|---|
| `projects/custom-field-perf/custom-field-perf-project-context.md` | `custom-field-perf-2025` | `custom-field-perf` |

Change the `project` field in that file from:
```yaml
project:
  - custom-field-perf-2025
```
to:
```yaml
project:
  - custom-field-perf
```

Verify the other project files while editing — each file at `projects/<slug>/…` must
have `project: <slug>` or `project:\n  - <slug>`.

---

## Issue 4 — Missing Required H2 Sections

Every anchor must contain these four H2 headings in order:

```markdown
## Current State
## Decisions
## Constraints
## PRs
```

Files that are missing sections need them added. Use the following content guidelines:

- **`## Current State`** — What exists today. For rule/guide files, describe what the rule
  applies to and what the current approach is. Do not include plans or intentions.
- **`## Decisions`** — Decisions that have already been made and are reflected in the
  content of this file. For rule files, list choices made about how the rule works.
- **`## Constraints`** — Hard limits or requirements that shape what is possible.
  For rule files, list the constraints that motivated the rule.
- **`## PRs`** — Links to PRs related to this anchor. Use format
  `[PR <title> - #<number>](<url>)`. If there are no PRs, write `None.`

Files that clearly have no relevant PRs (e.g., pure rule documents) should include:

```markdown
## PRs

None.
```

> **Tip:** When running the MCP server during migration, start with `--migration-warn-only`
> to demote missing-section violations from BLOCK to WARN. This allows incremental
> migration without blocking all writes.

---

## Verification Checklist

After completing all changes, confirm:

- [ ] All source directories (`coding/`, `context-engineering/`, `git-workflows/`,
      `tests/`, `datadog/`, `rql-audits/`, `cbp/`) have been removed
- [ ] All files now live under a valid top-level category directory
- [ ] Every `.md` file (except `CONTEXT-ROOT.md`) has `summary` and `read_this_if` in its front matter
- [ ] `projects/custom-field-perf/custom-field-perf-project-context.md` has `project: custom-field-perf`
- [ ] Every file has all four required H2 sections: `Current State`, `Decisions`, `Constraints`, `PRs`
- [ ] `shared/running-tests.md` has `last_validated: 2026-05-01` (typo `2026-05-01c` fixed)
- [ ] The repo has been committed to git (`git init && git add . && git commit -m "initial"`)
