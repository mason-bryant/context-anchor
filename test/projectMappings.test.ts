import { describe, expect, it } from "vitest";

import { normalizePathForStorage, parseProjectMappings } from "../src/projectMappings.js";

describe("parseProjectMappings", () => {
  it("returns an empty registry for non-object input", () => {
    expect(parseProjectMappings(null)).toEqual({ projects: [] });
    expect(parseProjectMappings("nope")).toEqual({ projects: [] });
    expect(parseProjectMappings([])).toEqual({ projects: [] });
    expect(parseProjectMappings({})).toEqual({ projects: [] });
  });

  it("keeps well-formed projects, repos, and paths", () => {
    const parsed = parseProjectMappings({
      projects: [
        {
          project: "payments",
          repos: [
            { repo: "repo-alpha", paths: ["services/payments"] },
            { repo: "repo-beta", paths: [] },
          ],
        },
      ],
    });
    expect(parsed).toEqual({
      projects: [
        {
          project: "payments",
          repos: [
            { repo: "repo-alpha", paths: ["services/payments"] },
            { repo: "repo-beta", paths: [] },
          ],
        },
      ],
    });
  });

  it("normalizes path prefixes and drops empties", () => {
    const parsed = parseProjectMappings({
      projects: [
        {
          project: "payments",
          repos: [{ repo: "repo-alpha", paths: ["/services/payments/", "./libs/pay", "  ", "x/"] }],
        },
      ],
    });
    expect(parsed.projects[0]?.repos[0]?.paths).toEqual(["services/payments", "libs/pay", "x"]);
  });

  it("drops entries missing a project slug or repo name and unmodeled fields", () => {
    const parsed = parseProjectMappings({
      projects: [
        { repos: [{ repo: "repo-alpha", paths: [] }] },
        { project: "  ", repos: [] },
        { project: "payments", role: "owner", repos: [{ paths: ["x"] }, { repo: "repo-alpha", extra: 1, paths: ["a"] }] },
      ],
    });
    expect(parsed).toEqual({
      projects: [{ project: "payments", repos: [{ repo: "repo-alpha", paths: ["a"] }] }],
    });
  });

  it("drops projects that have no repos (not a mapping)", () => {
    const parsed = parseProjectMappings({
      projects: [
        { project: "unmapped", repos: [] },
        { project: "alsounmapped" },
        { project: "payments", repos: [{ repo: "repo-alpha", paths: [] }] },
      ],
    });
    expect(parsed.projects.map((p) => p.project)).toEqual(["payments"]);
  });

  it("dedupes projects and repos case-insensitively, unioning paths", () => {
    const parsed = parseProjectMappings({
      projects: [
        { project: "Payments", repos: [{ repo: "Repo-Alpha", paths: ["services/payments"] }] },
        { project: "payments", repos: [{ repo: "repo-alpha", paths: ["SERVICES/PAYMENTS", "libs/pay"] }] },
      ],
    });
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]?.project).toBe("Payments");
    expect(parsed.projects[0]?.repos).toEqual([
      { repo: "Repo-Alpha", paths: ["services/payments", "libs/pay"] },
    ]);
  });
});

describe("normalizePathForStorage", () => {
  it("strips leading ./ and surrounding slashes", () => {
    expect(normalizePathForStorage("/services/payments/")).toBe("services/payments");
    expect(normalizePathForStorage("./libs/pay")).toBe("libs/pay");
    expect(normalizePathForStorage("  app/x  ")).toBe("app/x");
    expect(normalizePathForStorage("/")).toBe("");
  });
});
