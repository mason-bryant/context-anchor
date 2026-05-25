# Proposed Changes

Proposed changes are reviewable draft write-intent for anchor-mcp. They let an
agent stage a change, inspect the exact mutation, collect review feedback, and
only then apply the write to the target anchor or document.

Use this workflow when a change should be visible to reviewers before it is
treated as durable truth.

## Storage Model

Proposals live in dedicated ledger anchors instead of in the target document:

- project scope: `projects/<slug>/<slug>-proposed-changes.md`
- agent-rule scope: `agent-rules/agent-rules-proposed-changes.md`

Proposal anchors use the dedicated proposal types:

- `type: project-proposed-changes`
- `type: agent-rule-proposed-changes`

They also require `schema_version: 1`, a `proposal_scope` value, and a
`## Proposed Changes` section. Keep the proposal ledger focused on draft
intent, not on durable facts about the rest of the context tree.

### Project ledger front matter

```yaml
project:
  - your-slug
type: project-proposed-changes
tags:
  - proposed-changes
summary: "Reviewable proposed changes for project your-slug."
read_this_if:
  - "You are reviewing pending proposed changes for project your-slug."
last_validated: 2026-05-25
schema_version: 1
proposal_scope:
  kind: project
  project: your-slug
```

### Agent-rule ledger front matter

```yaml
type: agent-rule-proposed-changes
tags:
  - proposed-changes
summary: "Reviewable proposed changes for agent rules."
read_this_if:
  - "You are reviewing pending proposed changes to agent rules."
last_validated: 2026-05-25
schema_version: 1
proposal_scope:
  kind: agent-rules
```

Proposal ledgers still carry the standard anchor metadata. The
proposal-specific fields add to, rather than replace, the normal anchor schema.

## MCP Tools

### `proposeChange`

Creates a proposal entry from draft write-intent. Use it when you want to stage
a change in the proposal ledger rather than writing the target directly.

### `listProposedChanges`

Lists proposal entries for a scope so reviewers can see what is waiting for
inspection, preview, or application.

### `readProposedChange`

Reads a proposal entry in full. Use this when you want the proposal metadata
and the recorded draft change together.

### `previewProposedChange`

Shows the effect of the proposed operation without mutating the target. Use
this to inspect the exact result before review or application.

### `reviewProposedChange`

Records review feedback for a proposal. Supported review statuses are
`pending`, `rejected`, `changes_requested`, and `superseded`. Final acceptance
is expressed by calling `applyProposedChange` with explicit approval.

### `applyProposedChange`

Applies the approved proposal to the target anchor or document. This is the
step that performs the real write.

## Supported Operations

Proposed changes can describe one of these operations:

| Operation | Meaning |
|---|---|
| `frontmatter.merge` | Merge fields into target front matter. |
| `section.replace` | Replace the content of a section. |
| `section.append` | Append content to a section. |
| `section.delete` | Remove a section. |
| `anchor.create` | Create a new anchor file. |
| `document.replace` | Replace the full target document content. |

Use the narrowest operation that matches the requested edit. That keeps review
diffs easy to read and makes the eventual apply step easier to reason about.

## Workflow

1. Create the proposal with `proposeChange`.
2. Inspect the proposal with `readProposedChange`.
3. Preview the result with `previewProposedChange`.
4. Record the review outcome with `reviewProposedChange`.
5. Apply the proposal with `applyProposedChange` once the change is approved.

The proposal ledger is the source of review history. The target anchor remains
the source of durable truth only after application.

## Normal Context Loading

Normal context loading should not treat proposal ledgers as settled state.
Treat proposal anchors as draft review artifacts, not as durable facts to load
through `loadContext` or other general-purpose reads.

Load proposals only through the proposed-change tools when you need to inspect,
review, or apply them.

## Approval Boundary

Human approval still gates sensitive target writes at apply time. A proposal can
be reviewed and approved in the ledger, but the actual target mutation should
still respect the same approval rules that apply to direct writes.

That keeps the review record separate from the final write authorization.
