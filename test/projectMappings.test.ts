import { describe, expect, it } from "vitest";

import { normalizePathForStorage, parseProjectMappings, repoFileUrl } from "../src/projectMappings.js";

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

describe("parseProjectMappings web info", () => {
  it("keeps web url, branch, and template", () => {
    const parsed = parseProjectMappings({
      projects: [
        {
          project: "payments",
          repos: [
            {
              repo: "repo-alpha",
              paths: [],
              web: { url: "https://github.com/owner/repo-alpha", branch: "main", fileTemplate: "{url}/blob/{branch}/{path}" },
            },
          ],
        },
      ],
    });
    expect(parsed.projects[0]?.repos[0]?.web).toEqual({
      url: "https://github.com/owner/repo-alpha",
      branch: "main",
      fileTemplate: "{url}/blob/{branch}/{path}",
    });
  });

  it("drops a web block with no url and unmodeled web fields", () => {
    const parsed = parseProjectMappings({
      projects: [
        {
          project: "payments",
          repos: [
            { repo: "a", paths: [], web: { branch: "main" } },
            { repo: "b", paths: [], web: { url: "https://example.com/b", token: "secret" } },
          ],
        },
      ],
    });
    const repos = parsed.projects[0]?.repos ?? [];
    expect(repos.find((r) => r.repo === "a")?.web).toBeUndefined();
    expect(repos.find((r) => r.repo === "b")?.web).toEqual({ url: "https://example.com/b" });
  });
});

describe("repoFileUrl", () => {
  it("builds a GitHub-style file URL by default", () => {
    const repo = { web: { url: "https://github.com/owner/repo" } };
    expect(repoFileUrl(repo, "src/anchorService.ts")).toBe(
      "https://github.com/owner/repo/blob/main/src/anchorService.ts",
    );
  });

  it("honors a custom branch and appends a line anchor", () => {
    const repo = { web: { url: "https://github.com/owner/repo/", branch: "develop" } };
    expect(repoFileUrl(repo, "/src/x.ts", 42)).toBe(
      "https://github.com/owner/repo/blob/develop/src/x.ts#L42",
    );
  });

  it("applies a custom template for other hosts", () => {
    const repo = { web: { url: "https://gitlab.com/acme/api", fileTemplate: "{url}/-/blob/{branch}/{path}" } };
    expect(repoFileUrl(repo, "app/models/user.rb")).toBe(
      "https://gitlab.com/acme/api/-/blob/main/app/models/user.rb",
    );
  });

  it("encodes segments while preserving path and branch slashes", () => {
    const repo = { web: { url: "https://github.com/owner/repo", branch: "feature/new ui" } };
    expect(repoFileUrl(repo, "src/a b/c.ts")).toBe(
      "https://github.com/owner/repo/blob/feature/new%20ui/src/a%20b/c.ts",
    );
  });

  it("returns undefined without web url or path", () => {
    expect(repoFileUrl({ web: undefined }, "src/x.ts")).toBeUndefined();
    expect(repoFileUrl({ web: { url: "https://github.com/o/r" } }, "  ")).toBeUndefined();
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
