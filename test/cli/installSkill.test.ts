import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  SKILL_BODY_TEXT,
  SKILL_DESCRIPTION,
  SKILL_MARKER,
  renderClaudeSkill,
  renderCursorRule,
} from "../../src/builtin/agentSkill.js";
import { HELP_TEXT, parseCliArgs } from "../../src/cli/args.js";
import { SKILL_AGENTS, installSkill, parseSkillAgents } from "../../src/cli/installSkill.js";
import type { AnchorService } from "../../src/anchorService.js";
import { createAnchorMcpServer } from "../../src/server.js";

/**
 * The installed skill is prose that instructs an agent to call specific MCP tools, which makes
 * it the one kind of document this repository keeps getting wrong: it describes behaviour, so
 * nothing fails when the behaviour moves out from under it. The drift check below is the point
 * of this file as much as the file writing is.
 */

const CLAUDE_PATH = join(".claude", "skills", "anchor-context", "SKILL.md");
const CURSOR_PATH = join(".cursor", "rules", "anchor-context.mdc");

function project(withGit = true): { cwd: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "anchor-skill-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  if (withGit) {
    mkdirSync(join(cwd, ".git", "info"), { recursive: true });
  }
  return { cwd, home };
}

const defaults = { agents: [] as never[], stealth: false, force: false };

describe("anchor-mcp install", () => {
  it("writes both harnesses into the project by default", () => {
    const { cwd, home } = project();
    const report = installSkill({ ...defaults }, { cwd, home });

    expect(readFileSync(join(cwd, CLAUDE_PATH), "utf8")).toBe(renderClaudeSkill());
    expect(readFileSync(join(cwd, CURSOR_PATH), "utf8")).toBe(renderCursorRule());
    expect(report.join("\n")).toContain(CLAUDE_PATH);
    expect(report.join("\n")).toContain(CURSOR_PATH);
  });

  /**
   * The anchor repository is a different repository from the one being edited, and the skill is
   * useless in it -- no coding session reads the anchor store's own working tree. `install`
   * takes no repo argument for that reason, and this asserts the resolved target really is the
   * caller's directory rather than anything the server config points at.
   */
  it("installs into the project checkout, never into a home-relative default", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults }, { cwd, home });

    expect(existsSync(join(cwd, CLAUDE_PATH))).toBe(true);
    expect(existsSync(join(home, CLAUDE_PATH))).toBe(false);
  });

  /**
   * Both harnesses read their rules from the root of the checkout. Installing wherever the
   * operator happened to be standing would put `src/.claude/skills/` on disk, where the files
   * are real, the command reports success, and nothing ever loads them.
   */
  it("installs at the working-tree root, not the directory it was run from", () => {
    const { cwd, home } = project();
    const nested = join(cwd, "src", "db");
    mkdirSync(nested, { recursive: true });

    const report = installSkill({ ...defaults, agents: ["claude"] }, { cwd: nested, home });
    expect(existsSync(join(cwd, CLAUDE_PATH))).toBe(true);
    expect(existsSync(join(nested, ".claude"))).toBe(false);
    expect(report[0]).toBe(`project: ${cwd}`);
  });

  /**
   * A stray `.git` file that is not a gitdir pointer is not a checkout marker. Stopping there
   * would install into the subdirectory while the real root sat above it — the same "files
   * nothing ever loads" outcome the root resolution exists to prevent.
   */
  it("keeps walking past a .git file that is not a gitdir pointer", () => {
    const { cwd, home } = project();
    const nested = join(cwd, "vendor");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, ".git"), "notes someone left here\n", "utf8");

    installSkill({ ...defaults, agents: ["claude"] }, { cwd: nested, home });
    expect(existsSync(join(cwd, CLAUDE_PATH))).toBe(true);
    expect(existsSync(join(nested, ".claude"))).toBe(false);
  });

  /** A removed worktree leaves its `.git` file behind, pointing at a directory that is gone. */
  it("keeps walking past a gitdir pointer that leads nowhere", () => {
    const { cwd, home } = project();
    const nested = join(cwd, "stale-worktree");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, ".git"), `gitdir: ${join(cwd, "deleted", "wt")}\n`, "utf8");

    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd: nested, home });
    expect(existsSync(join(cwd, CURSOR_PATH))).toBe(true);
    expect(readFileSync(join(cwd, ".git", "info", "exclude"), "utf8")).toContain(
      "/.cursor/rules/anchor-context.mdc",
    );
    expect(existsSync(join(cwd, "deleted"))).toBe(false);
  });

  it("falls back to the current directory when there is no checkout to root at", () => {
    const { cwd, home } = project(false);
    installSkill({ ...defaults, agents: ["claude"] }, { cwd, home });
    expect(existsSync(join(cwd, CLAUDE_PATH))).toBe(true);
  });

  it("narrows to one harness with --agent", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home });

    expect(existsSync(join(cwd, CURSOR_PATH))).toBe(true);
    expect(existsSync(join(cwd, CLAUDE_PATH))).toBe(false);
  });

  it("is idempotent, so re-running to upgrade reports no churn", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults }, { cwd, home });
    const second = installSkill({ ...defaults }, { cwd, home });

    expect(second.filter((line) => line.includes("wrote"))).toEqual([]);
    expect(second.filter((line) => line.includes("unchanged"))).toHaveLength(2);
  });

  it("replaces a file it wrote, which is how an upgrade lands", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults }, { cwd, home });
    const target = join(cwd, CURSOR_PATH);
    writeFileSync(target, `stale content\n<!-- ${SKILL_MARKER} v0.0.1 -->\n`, "utf8");

    installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home });
    expect(readFileSync(target, "utf8")).toBe(renderCursorRule());
  });

  it("refuses a file of the same name that it did not write", () => {
    const { cwd, home } = project();
    mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(cwd, CURSOR_PATH), "a rule someone wrote by hand\n", "utf8");

    expect(() => installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home })).toThrow(/--force/);
    expect(readFileSync(join(cwd, CURSOR_PATH), "utf8")).toBe("a rule someone wrote by hand\n");
  });

  /**
   * A hand-written rule at this path talking *about* the installer is a plausible thing to
   * find, and recognising it by the bare words "installed by anchor-mcp" would call it ours and
   * destroy it on the next upgrade -- the exact outcome the guard exists to prevent.
   */
  it("refuses a hand-written file that merely mentions the marker text", () => {
    const { cwd, home } = project();
    const hand = `# our own rule\n\nThis replaces the one ${SKILL_MARKER} writes.\n`;
    mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(cwd, CURSOR_PATH), hand, "utf8");

    expect(() => installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home })).toThrow(/--force/);
    expect(readFileSync(join(cwd, CURSOR_PATH), "utf8")).toBe(hand);
  });

  /**
   * A symlinked target is written *through*, so following one would rewrite a file outside the
   * checkout that the operator never named. Pointing the skill at a shared copy in a home
   * directory is a reasonable thing to have done.
   */
  it("refuses a symlinked target rather than writing through it", () => {
    const { cwd, home } = project();
    const outside = join(home, "shared-rule.mdc");
    writeFileSync(outside, "a rule shared across repos\n", "utf8");
    mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
    symlinkSync(outside, join(cwd, CURSOR_PATH));

    expect(() => installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home })).toThrow(/symbolic link/);
    expect(readFileSync(outside, "utf8")).toBe("a rule shared across repos\n");
  });

  /** --force means "replace a file I did not write", not "follow a link out of the repository". */
  it("does not follow a symlink even with --force", () => {
    const { cwd, home } = project();
    const outside = join(home, "shared-rule.mdc");
    writeFileSync(outside, "a rule shared across repos\n", "utf8");
    mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
    symlinkSync(outside, join(cwd, CURSOR_PATH));

    expect(() => installSkill({ ...defaults, agents: ["cursor"], force: true }, { cwd, home })).toThrow(
      /symbolic link/,
    );
    expect(readFileSync(outside, "utf8")).toBe("a rule shared across repos\n");
  });

  /**
   * The case existsSync cannot see: it resolves the link, so a broken one reads as absent and
   * the write goes straight through to a path outside the tree, creating a file there.
   */
  it("refuses a broken symlink instead of creating its target", () => {
    const { cwd, home } = project();
    const outside = join(home, "never-created.mdc");
    mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
    symlinkSync(outside, join(cwd, CURSOR_PATH));

    expect(() => installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home })).toThrow(/symbolic link/);
    expect(existsSync(outside)).toBe(false);
  });

  /**
   * mkdirSync and writeFileSync both follow symlinked ancestors, so a linked `.cursor` puts the
   * file outside the checkout. Reported rather than refused: the link is usually deliberate
   * (`~/.claude` into a dotfiles repo is a common arrangement, and --stealth writes there by
   * design), and nothing is destroyed -- an existing file at the far end is still refused
   * unless anchor-mcp wrote it. What was wrong was that it happened without saying so.
   */
  it("says so when a symlinked parent directory puts the file outside the checkout", () => {
    const { cwd, home } = project();
    const outside = join(cwd, "..", "elsewhere");
    mkdirSync(join(outside, "rules"), { recursive: true });
    symlinkSync(outside, join(cwd, ".cursor"));

    const report = installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home });
    expect(report.join("\n")).toMatch(/note: a symlinked directory put this outside/);
    expect(existsSync(join(outside, "rules", "anchor-context.mdc"))).toBe(true);
  });

  it("still refuses a foreign file reached through a symlinked parent", () => {
    const { cwd, home } = project();
    const outside = join(cwd, "..", "elsewhere");
    mkdirSync(join(outside, "rules"), { recursive: true });
    symlinkSync(outside, join(cwd, ".cursor"));
    const leaf = join(outside, "rules", "anchor-context.mdc");
    writeFileSync(leaf, "someone else's rule\n", "utf8");

    expect(() => installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home })).toThrow(/--force/);
    expect(readFileSync(leaf, "utf8")).toBe("someone else's rule\n");
  });

  /** The common case must stay quiet, or the note is noise nobody reads. */
  it("adds no note for an ordinary install", () => {
    const { cwd, home } = project();
    const report = installSkill({ ...defaults }, { cwd, home });
    expect(report.join("\n")).not.toContain("note:");
  });

  /** `.cursor/rules` is itself a directory of rules, so a directory at this path is a plausible mistake. */
  it("reports a directory in the way instead of raising EISDIR", () => {
    const { cwd, home } = project();
    mkdirSync(join(cwd, CURSOR_PATH), { recursive: true });

    expect(() => installSkill({ ...defaults, agents: ["cursor"] }, { cwd, home })).toThrow(
      /not a regular file/,
    );
  });

  it("overwrites a foreign file with --force", () => {
    const { cwd, home } = project();
    mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(cwd, CURSOR_PATH), "a rule someone wrote by hand\n", "utf8");

    installSkill({ ...defaults, agents: ["cursor"], force: true }, { cwd, home });
    expect(readFileSync(join(cwd, CURSOR_PATH), "utf8")).toBe(renderCursorRule());
  });
});

describe("anchor-mcp install --stealth", () => {
  it("puts the Claude Code skill outside the project entirely", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults, agents: ["claude"], stealth: true }, { cwd, home });

    expect(readFileSync(join(home, CLAUDE_PATH), "utf8")).toBe(renderClaudeSkill());
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  /**
   * Cursor has no user-level rules directory -- project rules come from .cursor/rules and
   * nothing else on disk, its User Rules being settings text rather than a file. So stealth
   * here cannot mean "somewhere else"; it means the file stays put and git never sees it.
   */
  it("keeps the Cursor rule in the project but out of git", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });

    expect(existsSync(join(cwd, CURSOR_PATH))).toBe(true);
    const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("/.cursor/rules/anchor-context.mdc");
  });

  /** The entry is anchored with a leading slash, so it has to be relative to the root git reads it from. */
  it("writes a root-relative exclude even when run from a subdirectory", () => {
    const { cwd, home } = project();
    const nested = join(cwd, "src");
    mkdirSync(nested, { recursive: true });

    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd: nested, home });
    const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n")).toContain("/.cursor/rules/anchor-context.mdc");
  });

  it("reports a directory where the exclude file should be", () => {
    const { cwd, home } = project();
    mkdirSync(join(cwd, ".git", "info", "exclude"), { recursive: true });

    expect(() => installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home })).toThrow(
      /not a regular file/,
    );
  });

  it("does not append the same exclude twice", () => {
    const { cwd, home } = project();
    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });
    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });

    const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
    const entries = exclude.split("\n").filter((line) => line.trim() === "/.cursor/rules/anchor-context.mdc");
    expect(entries).toHaveLength(1);
  });

  it("preserves exclude entries that were already there", () => {
    const { cwd, home } = project();
    writeFileSync(join(cwd, ".git", "info", "exclude"), "# local ignores\n*.scratch\n", "utf8");
    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });

    const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("*.scratch");
    expect(exclude).toContain("/.cursor/rules/anchor-context.mdc");
  });

  it("appends on its own line when the existing exclude has no trailing newline", () => {
    const { cwd, home } = project();
    writeFileSync(join(cwd, ".git", "info", "exclude"), "*.scratch", "utf8");
    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });

    const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n")).toContain("*.scratch");
    expect(exclude.split("\n")).toContain("/.cursor/rules/anchor-context.mdc");
  });

  /** A linked worktree has a `.git` file pointing at its real git dir; the exclude lives there. */
  it("follows the gitdir pointer a worktree leaves behind", () => {
    const { cwd, home } = project(false);
    const realGitDir = join(cwd, "..", "worktrees", "wt");
    mkdirSync(realGitDir, { recursive: true });
    writeFileSync(join(cwd, ".git"), `gitdir: ${realGitDir}\n`, "utf8");

    installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });
    expect(readFileSync(join(realGitDir, "info", "exclude"), "utf8")).toContain(
      "/.cursor/rules/anchor-context.mdc",
    );
  });

  it("still installs when there is no git repository to exclude from", () => {
    const { cwd, home } = project(false);
    const report = installSkill({ ...defaults, agents: ["cursor"], stealth: true }, { cwd, home });

    expect(existsSync(join(cwd, CURSOR_PATH))).toBe(true);
    expect(report.join("\n")).toContain("no git repository");
  });
});

describe("install argument parsing", () => {
  it("accepts a comma list and drops duplicates", () => {
    expect(parseSkillAgents("cursor, claude ,cursor")).toEqual(["cursor", "claude"]);
  });

  it("rejects an agent it cannot install for, rather than silently installing nothing", () => {
    expect(() => parseSkillAgents("windsurf")).toThrow(/windsurf/);
    expect(() => parseSkillAgents("  ")).toThrow(/--agent/);
  });

  it("reaches the parser as a command with its flags", () => {
    const options = parseCliArgs(["install", "--stealth", "--agent", "claude"], {});
    expect(options.command).toBe("install");
    expect(options.install).toEqual({ agents: ["claude"], stealth: true, force: false });
  });

  it("defaults to every harness when --agent is absent", () => {
    expect(parseCliArgs(["install"], {}).install).toEqual({ agents: [], stealth: false, force: false });
  });

  it("leaves install absent for every other command", () => {
    expect(parseCliArgs(["status"], {}).install).toBeUndefined();
  });

  /**
   * `install` is what a new user runs before anything is set up, and it reads no server
   * setting. Resolving configuration first made it fail on a malformed config file in the
   * current directory, and on a DATABASE_URL exported for something else -- neither of which
   * it would have gone on to use. Same reasoning as the `--help` early return above it.
   */
  it("resolves no configuration, so a broken config cannot block it", () => {
    const { cwd } = project();
    writeFileSync(join(cwd, "anchor-mcp.config.json"), "{ not json,,", "utf8");

    const options = parseCliArgs(["install"], { DATABASE_URL: "not-a-url" }, { cwd });
    expect(options.command).toBe("install");
    expect(options.configPath).toBeUndefined();
    expect(options.databaseUrl).toBeUndefined();
  });

  /**
   * The help line said "claude, cursor, or both", which reads as offering `--agent both` -- a
   * value the parser has never accepted. It is now built from SKILL_AGENTS, so the promise and
   * the validation cannot disagree; this asserts the list a user is shown really does parse.
   */
  it("offers only agent names the parser accepts", () => {
    const offered = /--agent <list>\s+(.+?), comma-separated/.exec(HELP_TEXT)?.[1];
    expect(offered).toBeDefined();

    const names = offered!.split(" and/or ");
    expect(names).toEqual([...SKILL_AGENTS]);
    expect(() => parseSkillAgents(names.join(","))).not.toThrow();
  });
});

describe("the skill text", () => {
  it("says the same thing to both harnesses", () => {
    expect(renderClaudeSkill()).toContain(SKILL_BODY_TEXT);
    expect(renderCursorRule()).toContain(SKILL_BODY_TEXT);
  });

  it("carries the front matter each harness reads to decide relevance", () => {
    expect(renderClaudeSkill()).toContain("name: anchor-context");
    expect(renderClaudeSkill()).toContain(`description: ${SKILL_DESCRIPTION}`);
    // Stated rather than defaulted: an always-applied Cursor rule is one the model stops
    // reading, and the design turns on this arriving at a topic shift.
    expect(renderCursorRule()).toContain("alwaysApply: false");
    expect(renderCursorRule()).not.toContain("name: anchor-context");
  });

  it("identifies itself so an upgrade can tell its own file from someone else's", () => {
    expect(renderClaudeSkill()).toContain(SKILL_MARKER);
    expect(renderCursorRule()).toContain(SKILL_MARKER);
  });

  describe("names only tools the server actually registers", () => {
    let registered: Set<string>;

    beforeAll(() => {
      const unusedDb = new Proxy(
        {},
        {
          get: (_target, property) => {
            throw new Error(
              `The skill-text check constructed a database stub that must never be called, ` +
                `but ${String(property)} was accessed. It reads the tool registry only.`,
            );
          },
        },
      ) as never;
      const registry = createAnchorMcpServer({} as AnchorService, {
        knowledgeDb: unusedDb,
      }) as unknown as { _registeredTools: Record<string, unknown> };
      registered = new Set(Object.keys(registry._registeredTools));
    });

    /**
     * The whole skill is an instruction to call three tools by name. Rename one and every
     * installed copy -- in repositories this build will never see -- tells an agent to call
     * something that is not there, and no other test in this suite notices, because prose is
     * not executed.
     */
    it.each(["planRoutedBundle", "reportRecordUse", "startTask"])("mentions %s, which exists", (tool) => {
      // Whole word: `toContain` passes on a rename to planRoutedBundleV2, which is the exact
      // drift this is here to catch.
      expect(SKILL_BODY_TEXT).toMatch(new RegExp(`\\b${tool}\\b(?![A-Za-z0-9])`));
      expect(registered.has(tool)).toBe(true);
    });

    /**
     * Every identifier the skill mentions that is a field rather than a tool -- request
     * parameters (`task`, `routeKeys`, `traceId`) and response fields (`matchReasons`,
     * `recordLinks`) alike, since the prose names both and the check cannot tell them apart.
     *
     * Verified against the source below rather than trusted. The first version of this file
     * listed `reasons` here, which no response has ever carried -- the field is `matchReasons`
     * -- so the skill instructed every installed agent to read something that is not there, and
     * the guard meant to catch exactly that waved it through because I had written the name on
     * both sides. An allowlist asserted by the same hand that wrote the prose checks nothing.
     */
    const KNOWN_FIELDS = [
      "traceId",
      "recordLinks",
      "matchReasons",
      "task",
      "routeKeys",
      "requestId",
      "type",
      "guid",
      "routeKey",
      "stableKey",
    ];

    /** Property names declared where the routed response and the tool inputs are defined. */
    function declaredFields(): Set<string> {
      const sources = ["src/db/routing/plan.ts", "src/server.ts"].map((file) =>
        readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
      );
      return new Set(sources.flatMap((source) => [...source.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]!)));
    }

    it("allowlists only field names the code actually declares", () => {
      const declared = declaredFields();
      expect(KNOWN_FIELDS.filter((field) => !declared.has(field))).toEqual([]);
    });

    it("names no tool the server does not have", () => {
      // The whole identifier, digits included: a trailing `\b` after [A-Za-z]* simply fails to
      // match planRoutedBundleV2 rather than capturing it, so a versioned rename walks straight
      // past the check.
      const identifiers = [...SKILL_BODY_TEXT.matchAll(/`([a-z][A-Za-z0-9]*)/g)].map((match) => match[1]!);
      const tools = [...new Set(identifiers)].filter((name) => !KNOWN_FIELDS.includes(name));

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.filter((tool) => !registered.has(tool))).toEqual([]);
    });
  });
});
