import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnchorMeta, AnchorRead } from "../types.js";
import { SERVER_RULES_DISCOVERY_CATEGORY } from "../taxonomy.js";

export const ACCEPTANCE_CRITERIA_NAME = "server-rules/acceptance-criteria.md";

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

export function getServerPolicyVersion(): string {
  return POLICY_VERSION;
}

export function isBuiltInAnchorName(name: string): boolean {
  const normalized = name.endsWith(".md") ? name : `${name}.md`;
  return normalized === ACCEPTANCE_CRITERIA_NAME;
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
  ];
}

export function readBuiltInAnchor(name: string): AnchorRead | undefined {
  if (!isBuiltInAnchorName(name)) {
    return undefined;
  }
  const content = ACCEPTANCE_CRITERIA_BODY;
  return {
    name: ACCEPTANCE_CRITERIA_NAME,
    path: ACCEPTANCE_CRITERIA_NAME,
    content,
    frontmatter: {},
    version: `builtin@${POLICY_VERSION}`,
  };
}
