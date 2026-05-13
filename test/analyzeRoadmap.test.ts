import { describe, expect, it } from "vitest";

import {
  analyzeRoadmapFromContent,
  extractAcceptanceCriteriaSpansNormalized,
  parsePolicyWeaken,
  policyWeakenSetsEqual,
} from "../src/roadmap/analyzeRoadmap.js";

describe("analyzeRoadmapFromContent", () => {
  it("counts goals and detects missing acceptance criteria blocks", () => {
    const md = `---
type: project-roadmap
tags: []
summary: "R"
read_this_if:
  - "Plan"
last_validated: 2026-05-10
---

# R

## Goals

### Goal A

#### Acceptance Criteria

#### Approved

- [ ] AC-001: Do thing. Evidence: test.

### Goal B

## Current State

x

## Decisions

d

## Constraints

c

## PRs

- [PR P - #1](https://github.com/x/pull/1)
`;
    const r = analyzeRoadmapFromContent(md, { isProjectRoadmap: true });
    expect(r.activeGoals).toBe(2);
    expect(r.goalsMissingCriteria).toEqual(["Goal B"]);
    expect(r.goalsWithCriteria).toBe(1);
  });

  it("flags proposed checklist lines missing AC-P id", () => {
    const md = `---
type: project-roadmap
tags: []
summary: "R"
read_this_if:
  - "Plan"
last_validated: 2026-05-10
---

# R

## Goals

### G

#### Acceptance Criteria

#### Proposed

- [ ] Bad line without id. Evidence: n/a.

## Current State

x

## Decisions

d

## Constraints

c

## PRs

- [PR P - #1](https://github.com/x/pull/1)
`;
    const r = analyzeRoadmapFromContent(md, { isProjectRoadmap: true });
    expect(r.hasProposedCriteria).toBe(true);
    expect(r.criteriaViolations.some((v) => v.includes("AC-P###"))).toBe(true);
  });
});

describe("extractAcceptanceCriteriaSpansNormalized", () => {
  it("captures H3 and H4 acceptance criteria headings", () => {
    const md = `---
type: project-roadmap
tags: []
summary: "R"
read_this_if:
  - "Plan"
last_validated: 2026-05-10
---

# R

### Acceptance Criteria

#### Approved

- old

## Current State

x

## Decisions

d

## Constraints

c

## PRs

- [PR P - #1](https://github.com/x/pull/1)
`;
    const a = extractAcceptanceCriteriaSpansNormalized(md);
    expect(a).toContain("#### Approved");
    const b = extractAcceptanceCriteriaSpansNormalized(md.replace("old", "new"));
    expect(a).not.toBe(b);
  });
});

describe("parsePolicyWeaken", () => {
  it("reads weaken entries from front matter", () => {
    const fm = {
      anchor_mcp_policy: { weaken: ["require_evidence"] },
    };
    const s = parsePolicyWeaken(fm);
    expect(s.has("require_evidence")).toBe(true);
    expect(policyWeakenSetsEqual(s, new Set(["require_evidence"]))).toBe(true);
  });
});
