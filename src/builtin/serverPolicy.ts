import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAnchor } from "../storage/markdown.js";
import type { AnchorMeta, AnchorRead } from "../types.js";
import { SERVER_RULES_DISCOVERY_CATEGORY } from "../taxonomy.js";

export const ACCEPTANCE_CRITERIA_NAME = "server-rules/acceptance-criteria.md";
export const MILESTONE_USAGE_NAME = "server-rules/milestone-usage.md";
export const PROJECT_UPDATES_NAME = "server-rules/project-updates.md";

function readPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const POLICY_VERSION = readPackageVersion();

const ACCEPTANCE_CRITERIA_BODY = `---
type: agent-roles
tags:
  - anchor-mcp
  - acceptance-criteria
summary: Built-in rules for roadmap acceptance criteria, approval gates, missing-criteria warnings, and closeout reconciliation.
read_this_if:
  - Planning or implementing project work with a roadmap.
  - Creating or updating acceptance criteria in a project roadmap.
  - Closing out work against roadmap goals.
last_validated: 2026-05-12
---

# Acceptance criteria (built-in policy)

## Current State

This file is **server-owned policy** materialized by anchor-mcp. It is not stored in the context repo. It defines how agents should use roadmap acceptance criteria together with project context anchors.

## Decisions

- Acceptance criteria for active work live under each goal in the project roadmap (\`## Goals\` → per-goal \`#### Acceptance Criteria\` with \`#### Approved\` / \`#### Proposed\`).
- Context anchors record **shipped** facts; roadmaps hold **planned** definition-of-done.
- Every checklist criterion line under Approved must include a stable id matching \`AC-<digits>\` and an \`Evidence:\` hint. Proposed lines use \`AC-P<digits>\` and also require \`Evidence:\`.
- Agents must not claim phase completion while any applicable criterion is \`unknown\` — ask the human to clarify before treating work as done.
- Changing any acceptance criteria content (Approved or Proposed) requires an MCP write with \`approved: true\` after explicit human confirmation.

## Constraints

- The server enforces write-time gates; behavioral rules in this document still apply when tooling cannot observe agent output.
- Weakening default enforcement (via \`anchor_mcp_policy.weaken\` in roadmap front matter) requires human-approved writes and emits warnings.

## PRs

None.

---

## Agent workflow

1. During discovery, load built-in \`server-rules/*\` entries together with repo anchors.
2. Load the project context anchor for current truth, and the roadmap when planning, building, reviewing, or closing out.
3. For each relevant goal, read **Approved** criteria before editing code; treat them as definition of done.
4. If a goal in \`## Goals\` lacks \`#### Acceptance Criteria\`, **tell the user** before planning or claiming completion; offer **Proposed** criteria, clearly labeled.
5. Before your final response on roadmap-scoped work, reconcile each applicable criterion as **pass**, **fail**, **unknown**, or **not checked**, with evidence for any pass claim. **Unknown blocks a done claim** until the user clarifies or scope explicitly excludes that criterion.
6. When implementation reveals a criterion is wrong, propose a roadmap update; do **not** silently edit Approved criteria.
7. When work ships, move observable behavior into the context anchor **Current State** and decisions into **Decisions**; keep the roadmap’s completed history compact.

## Closeout snippet

\`\`\`markdown
Acceptance criteria:

- AC-001: pass — verified POST /login returns a JWT for valid credentials.
- AC-002: unknown — invalid-login behavior not exercised in this change; needs user clarification before claiming done.
\`\`\`
`;

const MILESTONE_USAGE_BODY = `---
type: agent-roles
tags:
  - anchor-mcp
  - milestones
  - server-policy
summary: Built-in guidance for project milestones, ordering, backlog placement, and avoiding inconsistent goal sequencing.
read_this_if:
  - Creating, updating, listing, or reading project milestones.
  - Assigning roadmap goals to milestones or reordering planned delivery.
  - Planning or implementing work when the project uses type project-milestone anchors.
last_validated: 2026-05-13
---

# Milestone usage (built-in policy)

## Current State

This file is **server-owned policy** materialized by anchor-mcp. Milestones live under \`projects/<slug>/milestones/\` as \`type: project-milestone\` anchors. Ordering is expressed with \`milestone_id\` (stable slug: \`M1\`, \`M2\`, … or the reserved \`backlog\`) and \`sequence\` (positive integer; required when \`milestone_id\` is not \`backlog\`). The display label for a sequenced milestone is \`M<sequence>\` (e.g. sequence \`1\` → \`M1\`). Reordering is done by updating \`sequence\` (and \`milestone_id\` if you use \`M<n>\` slugs) via MCP writes — the server blocks duplicate \`milestone_id\` or \`sequence\` within a project.

## Decisions

- Every roadmap goal that is in scope for milestone planning should appear in exactly one milestone’s \`relations.goal_ids\`, or in the **backlog** milestone (\`milestone_id: backlog\`, no \`sequence\`) until it is scheduled.
- Treat milestones as **ordered**: lower \`sequence\` is earlier planned delivery. When moving goals between milestones, preserve a coherent order (do not leave high-dependency work only in later milestones while claiming earlier milestones are independently shippable unless that is intentional).
- There is **no machine-encoded goal-to-goal dependency graph** in v1. Infer dependencies from goal titles, acceptance criteria, and roadmap prose. Before assigning a goal to an earlier milestone (\`M1\`, lower \`sequence\`), sanity-check that it does not implicitly require completion of a goal you placed only in a **later** milestone.
- Use \`listMilestones\` to see \`sequence\`, \`milestoneId\`, and \`displayId\`; use \`readMilestone\` to confirm \`goal_ids\` resolve to roadmap headings.

## Constraints

- Do not invent \`G-*\` goal ids in milestone \`goal_ids\`; they must match headings in the sibling \`<slug>-roadmap.md\` (use \`migrateRoadmapGoalIds\` when needed).
- Only one \`milestone_id: backlog\` anchor per project is allowed once you adopt \`milestone_id\` on milestones (enforced by duplicate-id validation).

## PRs

None.
`;

const PROJECT_UPDATES_BODY = `---
type: agent-roles
tags:
  - anchor-mcp
  - project-updates
  - backlog
  - server-policy
summary: Built-in guidance for project update rendering, milestone task summaries, and reserved backlog task handling.
read_this_if:
  - Rendering or preparing a project update from milestones.
  - Adding a user-requested task to a project backlog.
  - Updating structured milestone tasks for status reporting.
last_validated: 2026-05-25
---

# Project updates and backlog tasks (built-in policy)

## Current State

This file is **server-owned policy** materialized by anchor-mcp. Project updates are derived from project anchors, roadmaps, project milestones, and structured milestone tasks. Milestone task status values are \`todo\`, \`active\`, \`blocked\`, \`done\`, and \`cancelled\`. The reserved backlog milestone is the project-level holding bucket for unscheduled work and uses \`milestone_id: backlog\` with no \`sequence\`.

## Decisions

- Rendered project updates show scheduled milestone work first and end with backlog items when backlog items are present, because backlog grooming is always in progress.
- Backlog task requests are represented as structured tasks on the reserved backlog milestone, not as sequenced milestone scope.
- When a user asks to put a task on a project backlog, resolve the project's existing \`milestone_id: backlog\` milestone or create that reserved backlog milestone if it does not exist; add the task to its structured \`tasks\` list.
- Backlog task handling must not assign \`sequence\` to the backlog milestone and must not invent dates, owners, or roadmap goal ids. Only record \`owner\`, \`due\`, \`completed_on\`, \`date_confidence\`, or \`goal_ids\` when the user or existing anchors provide them.
- When a task date is needed for status reporting and no trusted value exists, ask the user for both the date and whether it is \`committed\`, an \`internal_goal\`, or \`estimated\` before recording \`due\`, \`completed_on\`, or \`date_confidence\`.
- Keep backlog task ids stable once written so future updates can refer to the same task without duplicating it.

## Constraints

- Only one reserved backlog milestone is allowed per project: \`milestone_id: backlog\`.
- A backlog milestone must not carry \`sequence\`; sequencing is only for scheduled milestones.
- Do not infer owners, dates, date confidence, or goal ids from task wording. Ask the user or leave optional structured fields absent.
- If existing validation requires additional milestone fields while creating the backlog milestone, satisfy only fields supported by existing project context or ask for the missing real value; do not fabricate planning metadata.

## PRs

None.

---

## Agent workflow

1. During discovery, load built-in \`server-rules/*\` entries with repo anchors when preparing project updates or editing milestone tasks.
2. For project update rendering, read the project context anchor, sibling roadmap, and milestones. Treat task metadata as status-reporting input, not as a substitute for durable Current State or Decisions.
3. Render sequenced milestones in ascending \`sequence\` order. If the backlog milestone has tasks, render it last under backlog wording.
4. For a user request like "put this on the project backlog", find the project, call \`listMilestones\`, and use the existing \`displayId: backlog\` / \`milestoneId: backlog\` entry when present.
5. If no backlog milestone exists, create the reserved backlog milestone under \`projects/<slug>/milestones/\` with \`milestone_id: backlog\`, no \`sequence\`, and a neutral status such as \`proposed\` unless existing project policy says otherwise.
6. Add the requested task to structured \`tasks\` with the minimal known fields: a stable \`id\`, the user-provided \`title\`, and \`status: todo\` unless the user explicitly gave another valid status.
7. If the user expects the task to carry a date and no trusted date exists, prompt for the date and its confidence class: \`committed\`, \`internal_goal\`, or \`estimated\`.
8. Do not add \`owner\`, \`due\`, \`completed_on\`, \`date_confidence\`, or \`goal_ids\` unless those values are explicitly supplied or already present in trusted project anchors.
`;

export function getServerPolicyVersion(): string {
  return POLICY_VERSION;
}

/** Canonical \`.md\` path for a built-in anchor name (with or without extension). */
export function canonicalBuiltInAnchorName(name: string): string {
  const withMd = name.endsWith(".md") ? name : `${name}.md`;
  if (withMd === MILESTONE_USAGE_NAME) {
    return MILESTONE_USAGE_NAME;
  }
  if (withMd === PROJECT_UPDATES_NAME) {
    return PROJECT_UPDATES_NAME;
  }
  return ACCEPTANCE_CRITERIA_NAME;
}

export function isBuiltInAnchorName(name: string): boolean {
  const normalized = name.endsWith(".md") ? name : `${name}.md`;
  return normalized === ACCEPTANCE_CRITERIA_NAME || normalized === MILESTONE_USAGE_NAME || normalized === PROJECT_UPDATES_NAME;
}

export function listBuiltInAnchorMetas(): AnchorMeta[] {
  return [
    {
      name: ACCEPTANCE_CRITERIA_NAME,
      path: ACCEPTANCE_CRITERIA_NAME,
      category: SERVER_RULES_DISCOVERY_CATEGORY,
      title: "Acceptance criteria policy",
      summary:
        "Rules for acceptance criteria approval, missing-criteria warnings, closeout reconciliation, and roadmap vs context-anchor lifecycle.",
      read_this_if: [
        "Planning or implementing project work with a roadmap.",
        "Creating or updating acceptance criteria.",
        "Closing out work against a roadmap goal.",
      ],
      type: "agent-roles",
      tags: ["anchor-mcp", "server-policy"],
      last_validated: "2026-05-12",
      updatedAt: "2026-05-12T00:00:00.000Z",
      createdAt: "2026-05-12T00:00:00.000Z",
      origin: "built-in",
      policyVersion: POLICY_VERSION,
    },
    {
      name: MILESTONE_USAGE_NAME,
      path: MILESTONE_USAGE_NAME,
      category: SERVER_RULES_DISCOVERY_CATEGORY,
      title: "Milestone usage policy",
      summary:
        "Guidance for milestone ordering, backlog milestones, assigning goals to milestones, and avoiding inconsistent sequencing.",
      read_this_if: [
        "Creating, updating, listing, or reading project milestones.",
        "Assigning roadmap goals to milestones or reordering planned delivery.",
        "Planning work when the project uses type project-milestone anchors.",
      ],
      type: "agent-roles",
      tags: ["anchor-mcp", "server-policy", "milestones"],
      last_validated: "2026-05-13",
      updatedAt: "2026-05-13T00:00:00.000Z",
      createdAt: "2026-05-13T00:00:00.000Z",
      origin: "built-in",
      policyVersion: POLICY_VERSION,
    },
    {
      name: PROJECT_UPDATES_NAME,
      path: PROJECT_UPDATES_NAME,
      category: SERVER_RULES_DISCOVERY_CATEGORY,
      title: "Project updates and backlog tasks policy",
      summary:
        "Guidance for project update rendering, structured milestone task summaries, and reserved backlog task handling.",
      read_this_if: [
        "Rendering or preparing a project update from milestones.",
        "Adding a user-requested task to a project backlog.",
        "Updating structured milestone tasks for status reporting.",
      ],
      type: "agent-roles",
      tags: ["anchor-mcp", "server-policy", "project-updates", "backlog"],
      last_validated: "2026-05-25",
      updatedAt: "2026-05-25T00:00:00.000Z",
      createdAt: "2026-05-25T00:00:00.000Z",
      origin: "built-in",
      policyVersion: POLICY_VERSION,
    },
  ];
}

export function readBuiltInAnchor(name: string): AnchorRead | undefined {
  if (!isBuiltInAnchorName(name)) {
    return undefined;
  }
  const canonical = canonicalBuiltInAnchorName(name);
  const content =
    canonical === MILESTONE_USAGE_NAME
      ? MILESTONE_USAGE_BODY
      : canonical === PROJECT_UPDATES_NAME
        ? PROJECT_UPDATES_BODY
        : ACCEPTANCE_CRITERIA_BODY;
  const { frontmatter } = parseAnchor(content);
  return {
    name: canonical,
    path: canonical,
    content,
    frontmatter,
    version: `builtin@${POLICY_VERSION}`,
  };
}
