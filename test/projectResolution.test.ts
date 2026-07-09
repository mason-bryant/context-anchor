import { describe, expect, it } from "vitest";

import { buildContextBundlePlan } from "../src/contextPlanner.js";
import {
  anchorCandidateBoost,
  candidateBoostMap,
  isWithinPath,
  resolveCandidateProjects,
} from "../src/projectResolution.js";
import type { AnchorMeta, ProjectMappings } from "../src/types.js";

function makeAnchor(overrides: Partial<AnchorMeta> & Pick<AnchorMeta, "name">): AnchorMeta {
  return {
    path: overrides.name,
    category: overrides.category ?? "projects",
    summary: overrides.summary ?? "Summary text.",
    read_this_if: overrides.read_this_if ?? ["Load when testing."],
    ...overrides,
  };
}

const mappings: ProjectMappings = {
  claimSourceTypes: [
    { id: "url", label: "URL" },
    { id: "design-doc", label: "Design Doc" },
    { id: "adr", label: "ADR" },
    { id: "misc", label: "Misc" },
    { id: "trust-me-bro", label: "trust me bro", requiresPerson: true, lockedConfidence: "high" },
  ],
  projects: [
    {
      project: "payments",
      repos: [
        { repo: "repo-alpha", paths: ["services/payments"] },
        { repo: "repo-beta", paths: [] },
      ],
    },
    {
      project: "reporting",
      repos: [{ repo: "repo-alpha", paths: ["services/reporting"] }],
    },
  ],
};

describe("isWithinPath", () => {
  it("matches a directory and its descendants at a path boundary", () => {
    expect(isWithinPath("services/payments", "services/payments")).toBe(true);
    expect(isWithinPath("services/payments/charge.ts", "services/payments")).toBe(true);
    expect(isWithinPath("/services/payments/charge.ts", "services/payments")).toBe(true);
    expect(isWithinPath("services/payments-v2/x.ts", "services/payments")).toBe(false);
    expect(isWithinPath("services/billing/x.ts", "services/payments")).toBe(false);
    expect(isWithinPath("anything", "")).toBe(false);
  });
});

describe("resolveCandidateProjects", () => {
  it("returns undefined without a repo or path signal", () => {
    expect(resolveCandidateProjects({}, mappings)).toBeUndefined();
    expect(resolveCandidateProjects({ filePaths: [] }, mappings)).toBeUndefined();
  });

  it("maps a repo name to every project that lives in it", () => {
    const resolution = resolveCandidateProjects({ repo: "repo-alpha" }, mappings);
    expect(resolution?.candidates.map((c) => c.project).sort()).toEqual(["payments", "reporting"]);
    expect(resolution?.unknownRepo).toBeUndefined();
    expect(resolution?.explanations[0]).toContain("repo-alpha");
  });

  it("matches repo names case-insensitively", () => {
    const resolution = resolveCandidateProjects({ repo: "Repo-Alpha" }, mappings);
    expect(resolution?.candidates.map((c) => c.project).sort()).toEqual(["payments", "reporting"]);
  });

  it("narrows by path within the matched repo and ranks the narrowed project first", () => {
    const resolution = resolveCandidateProjects(
      { repo: "repo-alpha", filePaths: ["services/payments/charge.ts"] },
      mappings,
    );
    // payments gets repo (10) + path (8); reporting gets repo (10) only.
    expect(resolution?.candidates[0]).toMatchObject({ project: "payments", boost: 18 });
    expect(resolution?.candidates[1]).toMatchObject({ project: "reporting", boost: 10 });
  });

  it("resolves by file path alone across projects", () => {
    const resolution = resolveCandidateProjects(
      { filePaths: ["services/reporting/export.ts"] },
      mappings,
    );
    expect(resolution?.candidates.map((c) => c.project)).toEqual(["reporting"]);
    expect(resolution?.candidates[0]?.boost).toBe(8);
  });

  it("matches a whole-repo entry (no paths) on repo name only", () => {
    const resolution = resolveCandidateProjects(
      { repo: "repo-beta", filePaths: ["anywhere/in/repo.ts"] },
      mappings,
    );
    expect(resolution?.candidates.map((c) => c.project)).toEqual(["payments"]);
    expect(resolution?.candidates[0]?.boost).toBe(10);
  });

  it("degrades gracefully for an unknown repo, still using path matches", () => {
    const resolution = resolveCandidateProjects(
      { repo: "repo-unknown", filePaths: ["services/payments/charge.ts"] },
      mappings,
    );
    expect(resolution?.unknownRepo).toBe("repo-unknown");
    expect(resolution?.candidates.map((c) => c.project)).toEqual(["payments"]);
    expect(resolution?.explanations.some((line) => line.includes("repo-unknown"))).toBe(true);
  });

  it("surfaces an unknown repo even when nothing else resolves", () => {
    const resolution = resolveCandidateProjects({ repo: "repo-unknown" }, mappings);
    expect(resolution?.unknownRepo).toBe("repo-unknown");
    expect(resolution?.candidates).toEqual([]);
  });

  it("returns undefined when the registry is empty", () => {
    expect(resolveCandidateProjects({ repo: "repo-alpha" }, { projects: [] })).toEqual({
      candidates: [],
      unknownRepo: "repo-alpha",
      explanations: expect.any(Array),
    });
  });
});

describe("anchorCandidateBoost", () => {
  it("returns the highest matching boost for an anchor", () => {
    const anchor = makeAnchor({ name: "projects/payments/payments.md", projectSlug: "payments", project: ["payments"] });
    const boosts = candidateBoostMap(
      resolveCandidateProjects({ repo: "repo-alpha", filePaths: ["services/payments/a.ts"] }, mappings),
    );
    expect(anchorCandidateBoost(anchor, boosts)).toEqual({ project: "payments", boost: 18 });
  });

  it("returns undefined when nothing matches", () => {
    const anchor = makeAnchor({ name: "projects/other/other.md", projectSlug: "other", project: ["other"] });
    const boosts = candidateBoostMap(resolveCandidateProjects({ repo: "repo-beta" }, mappings));
    expect(anchorCandidateBoost(anchor, boosts)).toBeUndefined();
  });
});

describe("buildContextBundlePlan repo/path resolution", () => {
  const payments = makeAnchor({
    name: "projects/payments/payments.md",
    projectSlug: "payments",
    project: ["payments"],
    summary: "Payments project context.",
  });
  const reporting = makeAnchor({
    name: "projects/reporting/reporting.md",
    projectSlug: "reporting",
    project: ["reporting"],
    summary: "Reporting project context.",
  });
  const unrelated = makeAnchor({
    name: "projects/unrelated/unrelated.md",
    projectSlug: "unrelated",
    project: ["unrelated"],
    summary: "Unrelated project context.",
  });
  const anchors = [payments, reporting, unrelated];

  function plan(boosts: Map<string, number>) {
    return buildContextBundlePlan(
      anchors,
      { task: "investigate failing flow" },
      undefined,
      "2026-06-20T00:00:00.000Z",
      undefined,
      undefined,
      45,
      new Date("2026-06-20T00:00:00.000Z"),
      boosts,
    );
  }

  it("includes repo-mapped candidate projects with explanatory reasons", () => {
    const boosts = candidateBoostMap(resolveCandidateProjects({ repo: "repo-alpha" }, mappings));
    const result = plan(boosts);
    const names = result.included.map((a) => a.name);
    expect(names).toContain("projects/payments/payments.md");
    expect(names).toContain("projects/reporting/reporting.md");
    expect(names).not.toContain("projects/unrelated/unrelated.md");
    const paymentsItem = result.included.find((a) => a.name === "projects/payments/payments.md");
    expect(paymentsItem?.reason).toContain('candidate project "payments"');
  });

  it("ranks a path-narrowed project above a repo-only project", () => {
    const boosts = candidateBoostMap(
      resolveCandidateProjects({ repo: "repo-alpha", filePaths: ["services/payments/charge.ts"] }, mappings),
    );
    const result = plan(boosts);
    expect(result.included[0]?.name).toBe("projects/payments/payments.md");
  });

  it("leaves scoring unchanged when there is no resolution (back-compat)", () => {
    const withEmpty = plan(new Map());
    const without = buildContextBundlePlan(
      anchors,
      { task: "investigate failing flow" },
      undefined,
      "2026-06-20T00:00:00.000Z",
    );
    expect(withEmpty.included.map((a) => a.score)).toEqual(without.included.map((a) => a.score));
  });
});
