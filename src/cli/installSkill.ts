/**
 * `anchor-mcp install` — write the cross-agent skill into the project the operator is working
 * in (T-42).
 *
 * Note which repository this is: the *project* checkout the operator is standing in, not the
 * anchor repository `--repo` points at. The skill tells an agent how to reach the anchors; it
 * belongs beside the code the agent is editing. Installing it into the anchor store would put
 * it where no coding session ever looks.
 *
 * Within that checkout the target is the working-tree root rather than the current directory —
 * see findCheckout below for why.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  SKILL_MARKER,
  SKILL_SLUG,
  renderClaudeSkill,
  renderCursorRule,
} from "../builtin/agentSkill.js";
import { CliUsageError } from "./errors.js";

export const SKILL_AGENTS = ["claude", "cursor"] as const;
export type SkillAgent = (typeof SKILL_AGENTS)[number];

export type InstallSkillArgs = {
  /** Which harnesses to write for. Empty means every one we support. */
  agents: SkillAgent[];
  /** Keep the install out of git: user-level where the harness supports it, locally excluded where it does not. */
  stealth: boolean;
  /** Overwrite a file that exists and was not written by us. */
  force: boolean;
};

export type InstallSkillOptions = {
  /** The project checkout to install into. */
  cwd: string;
  home?: string;
};

type Placement = {
  agent: SkillAgent;
  path: string;
  render: () => string;
  /**
   * Set when a stealth install had to land inside the working tree anyway, because the harness
   * has no user-level rules directory. The file is registered in the local exclude file, which
   * is per-clone and never committed.
   */
  needsLocalExclude: boolean;
};

/**
 * Cursor reads project rules from `.cursor/rules` and nothing else on disk: its User Rules are
 * settings text, not files, and there is no `~/.cursor/rules`. So a stealth Cursor install has
 * only one honest form — the normal path, kept out of git by the clone-local exclude file.
 * Claude Code does have a user-level directory, so stealth there leaves the repo untouched.
 */
function placementFor(agent: SkillAgent, args: InstallSkillArgs, cwd: string, home: string): Placement {
  if (agent === "claude") {
    const root = args.stealth ? home : cwd;
    return {
      agent,
      path: join(root, ".claude", "skills", SKILL_SLUG, "SKILL.md"),
      render: renderClaudeSkill,
      needsLocalExclude: false,
    };
  }

  return {
    agent,
    path: join(cwd, ".cursor", "rules", `${SKILL_SLUG}.mdc`),
    render: renderCursorRule,
    needsLocalExclude: args.stealth,
  };
}

export function installSkill(args: InstallSkillArgs, options: InstallSkillOptions): string[] {
  const home = resolve(options.home ?? homedir());
  const checkout = findCheckout(resolve(options.cwd));
  const root = checkout?.root ?? resolve(options.cwd);
  const agents = args.agents.length > 0 ? args.agents : [...SKILL_AGENTS];
  const lines = [`project: ${root}`];

  for (const agent of agents) {
    const placement = placementFor(agent, args, root, home);
    lines.push(...write(placement, args.force, root));
    if (placement.needsLocalExclude) {
      lines.push(...excludeLocally(placement.path, root, checkout?.gitDir));
    }
  }

  return lines;
}

function write(placement: Placement, force: boolean, cwd: string): string[] {
  const contents = placement.render();
  const shown = display(placement.path, cwd);

  if (existsSync(placement.path)) {
    const existing = readFileSync(placement.path, "utf8");
    if (existing === contents) {
      return [`${placement.agent}: unchanged  ${shown}`];
    }
    if (!existing.includes(SKILL_MARKER) && !force) {
      throw new CliUsageError(
        `${shown} exists and was not written by anchor-mcp. Move it aside, or pass --force to overwrite it.`,
      );
    }
  }

  mkdirSync(dirname(placement.path), { recursive: true });
  writeFileSync(placement.path, contents, "utf8");
  return [`${placement.agent}: wrote     ${shown}`];
}

/**
 * `.git/info/exclude` rather than `.gitignore`: the point of stealth is that nobody else sees
 * the install, and `.gitignore` is itself a tracked file. Appending to a per-clone exclude
 * leaves no change to commit.
 */
function excludeLocally(target: string, root: string, gitDir: string | undefined): string[] {
  if (!gitDir) {
    // Not a mistake worth failing on: with no repository there is nothing the file could leak
    // into, which is the outcome --stealth was asking for.
    return ["  (no git repository here, so nothing to exclude)"];
  }

  const excludePath = join(gitDir, "info", "exclude");
  const entry = `/${relative(root, target).split("\\").join("/")}`;
  const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === entry)) {
    return [`  already excluded in ${display(excludePath, root)}`];
  }

  mkdirSync(dirname(excludePath), { recursive: true });
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(excludePath, `${existing}${separator}${entry}\n`, "utf8");
  return [`  excluded in ${display(excludePath, root)}`];
}

/**
 * The working-tree root and its git directory, found by walking up rather than shelling out.
 *
 * Both harnesses read their rules from the root of the checkout, so installing into whatever
 * directory the operator happened to be standing in would put the files somewhere nothing
 * looks — running this from `src/` should not produce `src/.claude/skills/`.
 *
 * The two paths are separate because a linked worktree or a submodule leaves a `.git` *file*
 * holding a `gitdir:` pointer. The exclude belongs in the directory that points at, so that it
 * applies to the worktree the file is actually in.
 */
function findCheckout(from: string): { root: string; gitDir: string } | undefined {
  let current = resolve(from);
  for (;;) {
    const candidate = join(current, ".git");
    if (existsSync(candidate)) {
      if (statSync(candidate).isDirectory()) {
        return { root: current, gitDir: candidate };
      }
      const match = /^gitdir:\s*(.+)$/.exec(readFileSync(candidate, "utf8").trim());
      return match?.[1] ? { root: current, gitDir: resolve(current, match[1]) } : undefined;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function display(target: string, cwd: string): string {
  const rel = relative(cwd, target);
  return rel && !rel.startsWith("..") ? rel : target;
}

export function parseSkillAgents(raw: string | undefined): SkillAgent[] {
  if (raw === undefined) {
    return [];
  }
  const names = raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new CliUsageError(`--agent needs a value. Expected one of: ${SKILL_AGENTS.join(", ")}.`);
  }
  for (const name of names) {
    if (!(SKILL_AGENTS as readonly string[]).includes(name)) {
      throw new CliUsageError(`Unknown agent "${name}". Expected one of: ${SKILL_AGENTS.join(", ")}.`);
    }
  }
  return [...new Set(names)] as SkillAgent[];
}
