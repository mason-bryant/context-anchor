import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnchorMeta, AnchorRead } from "../types.js";
import { SERVER_RULES_DISCOVERY_CATEGORY } from "../taxonomy.js";

export const ACCEPTANCE_CRITERIA_NAME = "server-rules/acceptance-criteria.md";
export const MILESTONE_USAGE_NAME = "server-rules/milestone-usage.md";

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

export function getServerPolicyVersion(): string {
  return POLICY_VERSION;
}

/** Canonical \`.md\` path for a built-in anchor name (with or without extension). */
export function canonicalBuiltInAnchorName(name: string): string {
  const withMd = name.endsWith(".md") ? name : `${name}.md`;
  if (withMd === MILESTONE_USAGE_NAME) {
    return MILESTONE_USAGE_NAME;
  }
  return ACCEPTANCE_CRITERIA_NAME;
}

export function isBuiltInAnchorName(name: string): boolean {
  const normalized = name.endsWith(".md") ? name : `${name}.md`;
  return normalized === ACCEPTANCE_CRITERIA_NAME || normalized === MILESTONE_USAGE_NAME;
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
  const content = canonical === MILESTONE_USAGE_NAME ? MILESTONE_USAGE_BODY : ACCEPTANCE_CRITERIA_BODY;
  return {
    name: canonical,
    path: canonical,
    content,
    frontmatter: {},
    version: `builtin@${POLICY_VERSION}`,
  };
}
