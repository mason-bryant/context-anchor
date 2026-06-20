import { describe, expect, it } from "vitest";

import { buildContextBundlePlan } from "../src/contextPlanner.js";
import {
  anchorCandidateBoost,
  candidateBoostMap,
  resolveCandidateProjects,
} from "../src/projectResolution.js";
import type { AnchorMeta, ProjectResolutionConfig } from "../src/types.js";

function makeAnchor(overrides: Partial<AnchorMeta> & Pick<AnchorMeta, "name">): AnchorMeta {
  return {
    path: overrides.name,
    category: overrides.category ?? "projects",
    summary: overrides.summary ?? "Summary text.",
    read_this_if: overrides.read_this_if ?? ["Load when testing."],
    ...overrides,
  };
}

const config: ProjectResolutionConfig = {
  repoMap: { "repo-alpha": ["project-one", "project-two"] },
  pathPrefixes: [
    { prefix: "services/payments/", project: "payments", boost: 9 },
    { prefix: "services/reporting/", project: "reporting" },
  ],
};

describe("resolveCandidateProjects", () => {
  it("returns undefined when there is no repo or path signal", () => {
    expect(resolveCandidateProjects({}, config)).toBeUndefined();
    expect(resolveCandidateProjects({ filePaths: [] }, config)).toBeUndefined();
  });

  it("maps a repo name to its candidate projects", () => {
    const resolution = resolveCandidateProjects({ repo: "repo-alpha" }, config);
    expect(resolution?.candidates.map((c) => c.project)).toEqual(["project-one", "project-two"]);
    expect(resolution?.unknownRepo).toBeUndefined();
    expect(resolution?.explanations[0]).toContain("project-one");
  });

  it("matches repo names case-insensitively", () => {
    const resolution = resolveCandidateProjects({ repo: "Repo-Alpha" }, config);
    expect(resolution?.candidates.map((c) => c.project)).toEqual(["project-one", "project-two"]);
  });

  it("boosts candidate projects from matching file-path prefixes", () => {
    const resolution = resolveCandidateProjects(
      { filePaths: ["services/payments/charge.ts", "services/reporting/export.ts"] },
      config,
    );
    const byProject = new Map(resolution?.candidates.map((c) => [c.project, c.boost]));
    expect(byProject.get("payments")).toBe(9);
    expect(byProject.get("reporting")).toBe(8); // default boost when rule omits one
  });

  it("ranks higher-boost candidates first and sums repeated signals", () => {
    const resolution = resolveCandidateProjects(
      { repo: "repo-alpha", filePaths: ["services/payments/a.ts", "services/payments/b.ts"] },
      config,
    );
    // payments matched twice (9 + 9 = 18) outranks repo-mapped projects (10 each).
    expect(resolution?.candidates[0]).toMatchObject({ project: "payments", boost: 18 });
  });

  it("degrades gracefully for an unknown repo, still using path candidates", () => {
    const resolution = resolveCandidateProjects(
      { repo: "repo-unknown", filePaths: ["services/payments/charge.ts"] },
      config,
    );
    expect(resolution?.unknownRepo).toBe("repo-unknown");
    expect(resolution?.candidates.map((c) => c.project)).toEqual(["payments"]);
    expect(resolution?.explanations.some((line) => line.includes("repo-unknown"))).toBe(true);
  });

  it("surfaces an unknown repo even when no candidates resolve", () => {
    const resolution = resolveCandidateProjects({ repo: "repo-unknown" }, config);
    expect(resolution?.unknownRepo).toBe("repo-unknown");
    expect(resolution?.candidates).toEqual([]);
  });

  it("returns undefined when config is absent and only paths are given", () => {
    expect(resolveCandidateProjects({ filePaths: ["services/payments/a.ts"] }, undefined)).toBeUndefined();
  });
});

describe("anchorCandidateBoost", () => {
  it("returns the highest matching boost for an anchor", () => {
    const anchor = makeAnchor({ name: "projects/payments/payments.md", projectSlug: "payments", project: ["payments"] });
    const boosts = candidateBoostMap(
      resolveCandidateProjects({ filePaths: ["services/payments/a.ts"] }, config),
    );
    expect(anchorCandidateBoost(anchor, boosts)).toEqual({ project: "payments", boost: 9 });
  });

  it("returns undefined when nothing matches", () => {
    const anchor = makeAnchor({ name: "projects/other/other.md", projectSlug: "other", project: ["other"] });
    const boosts = candidateBoostMap(resolveCandidateProjects({ repo: "repo-alpha" }, config));
    expect(anchorCandidateBoost(anchor, boosts)).toBeUndefined();
  });
});

describe("buildContextBundlePlan repo/path resolution", () => {
  const projectOne = makeAnchor({
    name: "projects/project-one/project-one.md",
    projectSlug: "project-one",
    project: ["project-one"],
    summary: "Project one context.",
  });
  const projectTwo = makeAnchor({
    name: "projects/project-two/project-two.md",
    projectSlug: "project-two",
    project: ["project-two"],
    summary: "Project two context.",
  });
  const unrelated = makeAnchor({
    name: "projects/unrelated/unrelated.md",
    projectSlug: "unrelated",
    project: ["unrelated"],
    summary: "Unrelated project context.",
  });
  const anchors = [projectOne, projectTwo, unrelated];

  it("ranks repo-mapped candidate projects with explanatory reasons", () => {
    const boosts = candidateBoostMap(resolveCandidateProjects({ repo: "repo-alpha" }, config));
    const plan = buildContextBundlePlan(
      anchors,
      { task: "investigate failing flow", repo: "repo-alpha" },
      undefined,
      "2026-06-19T00:00:00.000Z",
      undefined,
      undefined,
      45,
      new Date("2026-06-19T00:00:00.000Z"),
      boosts,
    );

    const includedNames = plan.included.map((a) => a.name);
    expect(includedNames).toContain("projects/project-one/project-one.md");
    expect(includedNames).toContain("projects/project-two/project-two.md");
    expect(includedNames).not.toContain("projects/unrelated/unrelated.md");

    const projectOneItem = plan.included.find((a) => a.name === "projects/project-one/project-one.md");
    expect(projectOneItem?.reason).toContain('candidate project "project-one"');
  });

  it("boosts a path-prefix project above unrelated anchors", () => {
    const payments = makeAnchor({
      name: "projects/payments/payments.md",
      projectSlug: "payments",
      project: ["payments"],
      summary: "Payments project context.",
    });
    const boosts = candidateBoostMap(
      resolveCandidateProjects({ filePaths: ["services/payments/charge.ts"] }, config),
    );
    const plan = buildContextBundlePlan(
      [payments, unrelated],
      { task: "trace a charge", filePaths: ["services/payments/charge.ts"] },
      undefined,
      "2026-06-19T00:00:00.000Z",
      undefined,
      undefined,
      45,
      new Date("2026-06-19T00:00:00.000Z"),
      boosts,
    );

    expect(plan.included[0]?.name).toBe("projects/payments/payments.md");
  });

  it("leaves scoring unchanged when there is no repo/path resolution (back-compat)", () => {
    const planWithBoosts = buildContextBundlePlan(
      anchors,
      { task: "investigate failing flow" },
      undefined,
      "2026-06-19T00:00:00.000Z",
      undefined,
      undefined,
      45,
      new Date("2026-06-19T00:00:00.000Z"),
      new Map(),
    );
    const planWithout = buildContextBundlePlan(
      anchors,
      { task: "investigate failing flow" },
      undefined,
      "2026-06-19T00:00:00.000Z",
    );
    expect(planWithBoosts.included.map((a) => a.score)).toEqual(planWithout.included.map((a) => a.score));
  });
});
