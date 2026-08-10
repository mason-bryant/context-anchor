import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { CliUsageError } from "../../src/cli/errors.js";
import { collectRepositorySnapshot, DirtyWorkingTreeError } from "../../src/cli/repositorySnapshot.js";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

async function makeRepo(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "anchor-snap-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), content, "utf8");
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "initial");
  return repo;
}

describe("repository snapshot", () => {
  let repo: string;

  beforeAll(async () => {
    repo = await makeRepo({
      "CONTEXT-ROOT.md": "# Root\n",
      "projects/a/a-context.md": "# A\n",
      "notes.txt": "not markdown",
      // The real on-disk shape: an object keyed by `projects`, alongside sibling keys.
      // An earlier fixture used a bare array and passed while the real file imported
      // zero mappings.
      "project-mappings.json": JSON.stringify({
        projects: [
          {
            project: "anchor-mcp",
            repos: [
              { repo: "context-anchor", paths: [], web: { url: "https://example.test/ca" } },
              { repo: "rippling-main", paths: ["app", "lib"] },
            ],
          },
        ],
        claimSourceTypes: ["url", "trust-me-bro"],
      }),
      "people-registry.json": JSON.stringify({
        people: [{ id: "mason", displayName: "Mason Bryant", teams: ["asdf"] }],
        teams: [],
      }),
    });
  });

  it("collects only markdown, with repo-relative posix paths", async () => {
    const snapshot = await collectRepositorySnapshot(repo);

    const paths = snapshot.files.map((file) => file.path).sort();
    expect(paths).toEqual(["CONTEXT-ROOT.md", "projects/a/a-context.md"]);
    expect(snapshot.files.find((f) => f.path === "CONTEXT-ROOT.md")?.content).toBe("# Root\n");
  });

  it("never includes anything from .git", async () => {
    const snapshot = await collectRepositorySnapshot(repo);

    expect(snapshot.files.some((file) => file.path.split("/").includes(".git"))).toBe(false);
  });

  it("pins the full lowercase HEAD sha", async () => {
    const snapshot = await collectRepositorySnapshot(repo);

    expect(snapshot.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.commitSha).toBe(git(repo, "rev-parse", "HEAD").toLowerCase());
  });

  it("names the repository after its directory when there is no remote", async () => {
    const snapshot = await collectRepositorySnapshot(repo);

    expect(snapshot.repository).toBe(path.basename(repo));
  });

  it("honours an explicit repository name", async () => {
    const snapshot = await collectRepositorySnapshot(repo, { repository: "agent-context" });

    expect(snapshot.repository).toBe("agent-context");
  });

  // The registry on disk is project-first; the importer wants one flat row per
  // (repository, pathPrefix), because that pair is what routing matches on.
  it("flattens project-first mappings into one row per repository and path prefix", async () => {
    const snapshot = await collectRepositorySnapshot(repo);

    expect(snapshot.projectMappings).toEqual([
      {
        repository: "context-anchor",
        pathPrefix: "",
        project: "anchor-mcp",
        name: "context-anchor",
        webConfig: { url: "https://example.test/ca" },
      },
      { repository: "rippling-main", pathPrefix: "app", project: "anchor-mcp", name: "rippling-main-app" },
      { repository: "rippling-main", pathPrefix: "lib", project: "anchor-mcp", name: "rippling-main-lib" },
    ]);
  });

  it("also accepts a bare array of projects", async () => {
    const legacy = await makeRepo({
      "a.md": "# A\n",
      "project-mappings.json": JSON.stringify([{ project: "p", repos: [{ repo: "r", paths: [] }] }]),
    });

    const snapshot = await collectRepositorySnapshot(legacy);

    expect(snapshot.projectMappings).toEqual([
      { repository: "r", pathPrefix: "", project: "p", name: "r" },
    ]);
  });

  // Silence is the dangerous outcome here: the import reports "mappings: 0" and looks
  // like a success, so a registry that exists but yields nothing has to be an error.
  it("fails loudly when a registry exists but yields no mappings", async () => {
    const unusable = await makeRepo({
      "a.md": "# A\n",
      "project-mappings.json": JSON.stringify({ somethingElse: [] }),
    });

    await expect(collectRepositorySnapshot(unusable)).rejects.toThrow(/project-mappings\.json/);
  });

  it("maps people, defaulting identities to empty", async () => {
    const snapshot = await collectRepositorySnapshot(repo);

    expect(snapshot.people).toEqual([{ id: "mason", displayName: "Mason Bryant", identities: [] }]);
  });

  it("refuses a dirty working tree by default, naming the files and the way out", async () => {
    const dirty = await makeRepo({ "a.md": "# A\n" });
    await writeFile(path.join(dirty, "a.md"), "# A changed\n", "utf8");

    await expect(collectRepositorySnapshot(dirty)).rejects.toThrow(DirtyWorkingTreeError);
    await expect(collectRepositorySnapshot(dirty)).rejects.toThrow(/a\.md/);
    await expect(collectRepositorySnapshot(dirty)).rejects.toThrow(/--allow-dirty/);
  });

  it("counts untracked markdown as dirty", async () => {
    const dirty = await makeRepo({ "a.md": "# A\n" });
    await writeFile(path.join(dirty, "new.md"), "# New\n", "utf8");

    await expect(collectRepositorySnapshot(dirty)).rejects.toThrow(DirtyWorkingTreeError);
  });

  it("proceeds on a dirty tree when explicitly allowed, and says the sha does not match disk", async () => {
    const dirty = await makeRepo({ "a.md": "# A\n" });
    await writeFile(path.join(dirty, "a.md"), "# A changed\n", "utf8");

    const snapshot = await collectRepositorySnapshot(dirty, { allowDirty: true });

    expect(snapshot.dirty).toBe(true);
    // Content comes from disk, so it is deliberately not what commitSha points at.
    expect(snapshot.files[0]?.content).toBe("# A changed\n");
  });

  it("refuses a repository with no markdown rather than importing nothing", async () => {
    const empty = await makeRepo({ "readme.txt": "no anchors here" });

    await expect(collectRepositorySnapshot(empty)).rejects.toThrow(/no markdown/i);
  });

  it("reports a malformed registry by name instead of a raw parse error", async () => {
    const broken = await makeRepo({ "a.md": "# A\n", "people-registry.json": "{ not json" });

    await expect(collectRepositorySnapshot(broken)).rejects.toThrow(/people-registry\.json/);
  });

  // `null` is valid JSON and typeof "object", so a bare property read on it throws a
  // TypeError from the one function whose job is to explain what is wrong with the file.
  it.each(["null", "123", '"a string"', "true"])(
    "explains a registry whose JSON is %s instead of crashing",
    async (raw) => {
      const odd = await makeRepo({ "a.md": "# A\n", "project-mappings.json": raw });

      await expect(collectRepositorySnapshot(odd)).rejects.toBeInstanceOf(CliUsageError);
      await expect(collectRepositorySnapshot(odd)).rejects.toThrow(/project-mappings\.json/);
    },
  );

  it("omits registries that are absent", async () => {
    const bare = await makeRepo({ "a.md": "# A\n" });

    const snapshot = await collectRepositorySnapshot(bare);

    expect(snapshot.projectMappings).toBeUndefined();
    expect(snapshot.people).toBeUndefined();
  });

  // Every one of these is something the operator can fix, so they must print as a single
  // message rather than a stack trace. Asserting the type keeps that from regressing the
  // next time an error is added here.
  it("raises operator-actionable failures as CliUsageError, not bare Error", async () => {
    const notGit = await mkdtemp(path.join(os.tmpdir(), "anchor-notgit-"));
    const noMarkdown = await makeRepo({ "readme.txt": "nothing" });
    const badJson = await makeRepo({ "a.md": "# A\n", "people-registry.json": "{ not json" });
    const dirty = await makeRepo({ "a.md": "# A\n" });
    await writeFile(path.join(dirty, "a.md"), "# changed\n", "utf8");

    for (const repoPath of [notGit, noMarkdown, badJson, dirty]) {
      await expect(collectRepositorySnapshot(repoPath), repoPath).rejects.toBeInstanceOf(CliUsageError);
    }
  });

  it("refuses a path that is not a git repository", async () => {
    const notGit = await mkdtemp(path.join(os.tmpdir(), "anchor-notgit-"));

    await expect(collectRepositorySnapshot(notGit)).rejects.toThrow(/git repository/i);
  });
});
