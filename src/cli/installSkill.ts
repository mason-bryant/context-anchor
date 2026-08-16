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
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import { SKILL_SLUG, renderClaudeSkill, renderCursorRule, wasWrittenByUs } from "../builtin/agentSkill.js";
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
  /** The tree this install is meant to stay inside, for reporting when a symlink sends it elsewhere. */
  boundary: string;
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
      boundary: root,
      render: renderClaudeSkill,
      needsLocalExclude: false,
    };
  }

  return {
    agent,
    path: join(cwd, ".cursor", "rules", `${SKILL_SLUG}.mdc`),
    boundary: cwd,
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

  const existing = readRegularFile(placement.path, shown);
  if (existing !== undefined) {
    if (existing === contents) {
      return [`${placement.agent}: unchanged  ${shown}`];
    }
    if (!wasWrittenByUs(existing) && !force) {
      throw new CliUsageError(
        `${shown} exists and was not written by anchor-mcp. Move it aside, or pass --force to overwrite it.`,
      );
    }
  }

  mkdirSync(dirname(placement.path), { recursive: true });
  writeFileSync(placement.path, contents, "utf8");
  return [`${placement.agent}: wrote     ${shown}`, ...escapeNote(placement.path, placement.boundary)];
}

/**
 * A line when a symlinked parent directory has sent the file outside the tree it was installed
 * into. `mkdirSync` and `writeFileSync` both follow symlinked ancestors, so `.cursor` or
 * `~/.claude` being a link puts the file somewhere the operator did not name.
 *
 * Reported rather than refused, because that link is usually deliberate: `~/.claude` pointing
 * into a dotfiles repository is a common arrangement, and `--stealth` writes there by design.
 * Nothing is destroyed either way -- an existing file at the far end is still read through
 * `readRegularFile` and refused unless anchor-mcp wrote it -- so the only defect worth fixing
 * is that it happened silently.
 *
 * Compared after resolving both sides: on macOS a temporary directory under /var already
 * resolves to /private/var, so comparing a resolved path against an unresolved boundary would
 * report an escape for every install run there.
 */
function escapeNote(target: string, boundary: string): string[] {
  const resolvedBoundary = realpathSync(boundary);
  const resolvedDir = realpathSync(dirname(target));
  if (resolvedDir === resolvedBoundary || resolvedDir.startsWith(resolvedBoundary + sep)) {
    return [];
  }
  return [`  note: a symlinked directory put this outside ${boundary}, at ${resolvedDir}`];
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
  const existing = readRegularFile(excludePath, display(excludePath, root)) ?? "";
  if (existing.split("\n").some((line) => line.trim() === entry)) {
    return [`  already excluded in ${display(excludePath, root)}`];
  }

  mkdirSync(dirname(excludePath), { recursive: true });
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(excludePath, `${existing}${separator}${entry}\n`, "utf8");
  return [`  excluded in ${display(excludePath, root)}`, ...escapeNote(excludePath, gitDir)];
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
      // A `.git` file that is not a gitdir pointer is not a checkout marker, so keep walking
      // rather than giving up here. Stopping would land the install in the current directory
      // while a real repository root sat above it -- the same "files nothing ever loads"
      // outcome the root resolution exists to prevent, reached by a different route.
      // The pointer has to lead somewhere, too. A worktree that was removed leaves its `.git`
      // file behind pointing at a directory that no longer exists, and trusting that would put
      // `info/exclude` under a path with no repository in it — writing a file nothing reads,
      // while a real root sat above. Three ways a `.git` file can fail to identify a checkout:
      // not a pointer, unreadable, and pointing at nothing. All three keep walking.
      const match = /^gitdir:\s*(.+)$/.exec(readGitPointer(candidate));
      const pointer = match?.[1] ? resolve(current, match[1]) : undefined;
      if (pointer && existsSync(pointer) && statSync(pointer).isDirectory()) {
        return { root: current, gitDir: pointer };
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * The contents of a regular file at `target`, or undefined when nothing is there. Anything
 * else present is a usage error.
 *
 * `lstatSync`, not `statSync`, and the reason is the write that follows rather than this read.
 * `statSync` resolves a symlink, so a symlinked target would be read *through* and then written
 * through — clobbering a file outside the working tree that the operator never named. Someone
 * pointing `.claude/skills/anchor-context/SKILL.md` at a shared copy in their home directory is
 * a reasonable thing to have done, and `install` must not quietly overwrite it. `lstat` also
 * sees a *broken* symlink, which `existsSync` reports as absent — the case that would otherwise
 * write straight through to a path outside the tree with no existing file to warn about.
 *
 * A directory is the other case, and `.cursor/rules` being itself a directory of rules makes a
 * folder here a plausible mistake. Unchecked, `readFileSync` raises EISDIR, which reaches the
 * operator as a stack trace saying nothing about what is in the way.
 *
 * Deliberately not bypassed by `--force`: that flag means "replace a file I did not write", not
 * "follow a link out of the repository".
 */
function readRegularFile(target: string, shown: string): string | undefined {
  const stats = lstatSync(target, { throwIfNoEntry: false });
  if (!stats) {
    return undefined;
  }
  if (stats.isSymbolicLink()) {
    throw new CliUsageError(
      `${shown} is a symbolic link. Writing it would change whatever it points at, outside this ` +
        `checkout; remove the link and run this again.`,
    );
  }
  if (!stats.isFile()) {
    throw new CliUsageError(`${shown} exists but is not a regular file. Move it aside and run this again.`);
  }
  return readFileSync(target, "utf8");
}

/** Unreadable is the same answer as unparseable here: not a pointer, keep looking. */
function readGitPointer(candidate: string): string {
  try {
    return readFileSync(candidate, "utf8").trim();
  } catch {
    return "";
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
