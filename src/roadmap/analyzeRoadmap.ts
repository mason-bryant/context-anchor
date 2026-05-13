import type { RoadmapAcceptanceCriteriaSummary } from "../types.js";
import { parseAnchor } from "../storage/markdown.js";

const GOALS_H2 = /^##\s+(?:active\s+)?goals?\s*$/i;
const HEADING = /^(#{2,6})\s+(.+?)\s*#*\s*$/;
const CHECKLIST = /^\s*-\s+\[[ xX]\]\s+(.+)$/;
const APPROVED_ID = /\bAC-\d+\b/;
const PROPOSED_ID = /\bAC-P\d+\b/;
const EVIDENCE = /Evidence:/i;

export type RoadmapAnalysis = RoadmapAcceptanceCriteriaSummary & {
  criteriaViolations: string[];
};

type Fence = { char: "`" | "~"; len: number };

/** Parse `anchor_mcp_policy.weaken` from front matter (optional). */
export function parsePolicyWeaken(frontmatter: Record<string, unknown>): Set<string> {
  const raw = frontmatter.anchor_mcp_policy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return new Set();
  }
  const policy = raw as Record<string, unknown>;
  const weaken = policy.weaken;
  if (!Array.isArray(weaken)) {
    return new Set();
  }
  return new Set(weaken.filter((item): item is string => typeof item === "string" && item.length > 0));
}

export function policyWeakenSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
}

/**
 * Returns normalized concatenation of every `###` or `#### Acceptance Criteria` subtree
 * (heading line + body until next heading at same or higher level). Used for write approval gates.
 */
export function extractAcceptanceCriteriaSpansNormalized(content: string): string {
  const body = parseAnchor(content).body;
  const spans = extractAcceptanceCriteriaSpanBodies(body);
  return spans.map((span) => span.trim().replace(/\r\n/g, "\n")).join("\n---AC-SPAN---\n").trim();
}

function extractAcceptanceCriteriaSpanBodies(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const spans: string[] = [];
  let i = 0;
  let openFence: Fence | undefined;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (openFence) {
      if (tryCloseFence(line, openFence)) {
        openFence = undefined;
      }
      i += 1;
      continue;
    }

    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      i += 1;
      continue;
    }

    const hm = line.match(HEADING);
    if (hm?.[1] && hm[2]) {
      const level = hm[1].length;
      const title = hm[2].trim();
      if (level >= 3 && level <= 4 && /^acceptance criteria$/i.test(title)) {
        const start = i;
        const startLevel = level;
        i += 1;
        const chunk: string[] = [lines[start] ?? ""];
        while (i < lines.length) {
          const inner = lines[i] ?? "";
          if (openFence) {
            if (tryCloseFence(inner, openFence)) {
              openFence = undefined;
            }
            chunk.push(inner);
            i += 1;
            continue;
          }
          const innerOpen = tryOpenFence(inner);
          if (innerOpen) {
            openFence = innerOpen;
            chunk.push(inner);
            i += 1;
            continue;
          }
          const innerHm = inner.match(HEADING);
          if (innerHm?.[1] && innerHm[2]) {
            const innerLevel = innerHm[1].length;
            const closeSpan = startLevel >= 4 ? innerLevel < startLevel : innerLevel <= startLevel;
            if (closeSpan) {
              break;
            }
          }
          chunk.push(inner);
          i += 1;
        }
        spans.push(chunk.join("\n"));
        continue;
      }
    }
    i += 1;
  }

  return spans;
}

export function analyzeRoadmapFromContent(markdown: string, options: { isProjectRoadmap: boolean }): RoadmapAnalysis {
  const violations: string[] = [];
  const body = parseAnchor(markdown).body;

  const goalsRegion = extractGoalsRegion(body);
  if (!goalsRegion) {
    return {
      activeGoals: 0,
      goalsWithCriteria: 0,
      goalsMissingCriteria: [],
      goalsMissingCriteriaIds: [],
      goalsWithoutStableIds: [],
      hasProposedCriteria: false,
      criteriaViolations: violations,
    };
  }

  const goals = extractGoalsUnderRegion(goalsRegion);
  const goalsMissingCriteria: string[] = [];
  const goalsMissingCriteriaIds: string[] = [];
  const goalsWithoutStableIds: string[] = [];
  let goalsWithCriteria = 0;
  let hasProposedCriteria = false;

  for (const goal of goals) {
    if (!goal.id) {
      goalsWithoutStableIds.push(goal.title);
    }

    const acBlock = findChildHeadingBlock(goal.bodyLines, 4, "Acceptance Criteria", {
      stopAtSameLevelSibling: false,
    });
    if (!acBlock) {
      goalsMissingCriteria.push(goal.title);
      if (goal.id) {
        goalsMissingCriteriaIds.push(goal.id);
      }
      continue;
    }
    goalsWithCriteria += 1;

    const approved = findChildHeadingBlock(acBlock.bodyLines, 4, "Approved");
    const proposed = findChildHeadingBlock(acBlock.bodyLines, 4, "Proposed");

    if (approved) {
      const bullets = extractChecklistLines(approved.bodyLines.join("\n"));
      for (const bullet of bullets) {
        if (options.isProjectRoadmap) {
          if (!APPROVED_ID.test(bullet)) {
            violations.push(`Goal "${goal.title}": approved criterion missing stable id (AC-###): ${bullet.slice(0, 80)}`);
          }
          if (!EVIDENCE.test(bullet)) {
            violations.push(`Goal "${goal.title}": approved criterion missing Evidence: ${bullet.slice(0, 80)}`);
          }
        }
      }
    }

    if (proposed) {
      const bullets = extractChecklistLines(proposed.bodyLines.join("\n"));
      if (bullets.length > 0) {
        hasProposedCriteria = true;
      }
      for (const bullet of bullets) {
        if (options.isProjectRoadmap) {
          if (!PROPOSED_ID.test(bullet)) {
            violations.push(`Goal "${goal.title}": proposed criterion missing stable id (AC-P###): ${bullet.slice(0, 80)}`);
          }
          if (!EVIDENCE.test(bullet)) {
            violations.push(`Goal "${goal.title}": proposed criterion missing Evidence: ${bullet.slice(0, 80)}`);
          }
        }
      }
    }
  }

  return {
    activeGoals: goals.length,
    goalsWithCriteria,
    goalsMissingCriteria,
    goalsMissingCriteriaIds,
    goalsWithoutStableIds,
    hasProposedCriteria,
    criteriaViolations: violations,
  };
}

function extractGoalsRegion(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  let i = 0;
  let openFence: Fence | undefined;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (openFence) {
      if (tryCloseFence(line, openFence)) {
        openFence = undefined;
      }
      i += 1;
      continue;
    }
    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      i += 1;
      continue;
    }

    if (GOALS_H2.test(line)) {
      i += 1;
      const chunk: string[] = [];
      while (i < lines.length) {
        const inner = lines[i] ?? "";
        if (openFence) {
          if (tryCloseFence(inner, openFence)) {
            openFence = undefined;
          }
          chunk.push(inner);
          i += 1;
          continue;
        }
        const innerOpen = tryOpenFence(inner);
        if (innerOpen) {
          openFence = innerOpen;
          chunk.push(inner);
          i += 1;
          continue;
        }
        if (/^##\s+/.test(inner)) {
          break;
        }
        chunk.push(inner);
        i += 1;
      }
      return chunk.join("\n");
    }
    i += 1;
  }

  return undefined;
}

export function listRoadmapGoalDetails(markdown: string): Array<{
  id?: string;
  title: string;
  hasAcceptanceCriteria: boolean;
}> {
  const body = parseAnchor(markdown).body;
  const goalsRegion = extractGoalsRegion(body);
  if (!goalsRegion) {
    return [];
  }

  const goals = extractGoalsUnderRegion(goalsRegion);
  return goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    hasAcceptanceCriteria: Boolean(
      findChildHeadingBlock(goal.bodyLines, 4, "Acceptance Criteria", {
        stopAtSameLevelSibling: false,
      }),
    ),
  }));
}

type GoalBlock = { title: string; id?: string; bodyLines: string[] };

export function parseStableGoalIdFromHeading(title: string): string | undefined {
  const m = title.match(/^Goal\s+(G-\d+)\s+--\s+/i);
  return m?.[1];
}

function extractGoalsUnderRegion(regionBody: string): GoalBlock[] {
  const lines = regionBody.split(/\r?\n/);
  const goals: GoalBlock[] = [];
  let i = 0;
  let openFence: Fence | undefined;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (openFence) {
      if (tryCloseFence(line, openFence)) {
        openFence = undefined;
      }
      i += 1;
      continue;
    }
    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      i += 1;
      continue;
    }

    const hm = line.match(/^###\s+(.+?)\s*#*\s*$/);
    if (hm?.[1]) {
      const title = hm[1].trim();
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const inner = lines[i] ?? "";
        if (openFence) {
          if (tryCloseFence(inner, openFence)) {
            openFence = undefined;
          }
          bodyLines.push(inner);
          i += 1;
          continue;
        }
        const innerOpen = tryOpenFence(inner);
        if (innerOpen) {
          openFence = innerOpen;
          bodyLines.push(inner);
          i += 1;
          continue;
        }
        if (/^###\s+/.test(inner) || /^##\s+/.test(inner)) {
          break;
        }
        bodyLines.push(inner);
        i += 1;
      }
      const id = parseStableGoalIdFromHeading(title);
      goals.push({ title, id, bodyLines });
      continue;
    }
    i += 1;
  }

  return goals;
}

type H4Block = { bodyLines: string[] };

type FindHeadingOptions = {
  /** When false, only stop at a heading strictly shallower than `level` (e.g. keep #### siblings under #### Acceptance Criteria). */
  stopAtSameLevelSibling?: boolean;
};

function findChildHeadingBlock(
  lines: string[],
  level: number,
  title: string,
  options: FindHeadingOptions = {},
): H4Block | undefined {
  const stopAtSameLevel = options.stopAtSameLevelSibling ?? true;
  const hashes = "#".repeat(level);
  const re = new RegExp(`^${hashes}\\s+${escapeRegExp(title)}\\s*#*\\s*$`, "i");
  let i = 0;
  let openFence: Fence | undefined;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (openFence) {
      if (tryCloseFence(line, openFence)) {
        openFence = undefined;
      }
      i += 1;
      continue;
    }
    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      i += 1;
      continue;
    }

    if (re.test(line)) {
      i += 1;
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const inner = lines[i] ?? "";
        if (openFence) {
          if (tryCloseFence(inner, openFence)) {
            openFence = undefined;
          }
          bodyLines.push(inner);
          i += 1;
          continue;
        }
        const innerOpen = tryOpenFence(inner);
        if (innerOpen) {
          openFence = innerOpen;
          bodyLines.push(inner);
          i += 1;
          continue;
        }
        const innerHm = inner.match(/^(#{1,6})\s+/);
        if (innerHm?.[1]) {
          const innerLevel = innerHm[1].length;
          if (stopAtSameLevel) {
            if (innerLevel <= level) {
              break;
            }
          } else if (innerLevel < level) {
            break;
          }
        }
        bodyLines.push(inner);
        i += 1;
      }
      return { bodyLines };
    }
    i += 1;
  }

  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractChecklistLines(text: string): string[] {
  const out: string[] = [];
  let openFence: Fence | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (openFence) {
      if (tryCloseFence(line, openFence)) {
        openFence = undefined;
      }
      continue;
    }
    const opened = tryOpenFence(line);
    if (opened) {
      openFence = opened;
      continue;
    }
    const m = line.match(CHECKLIST);
    if (m?.[1]) {
      out.push(m[1].trim());
    }
  }
  return out;
}

function tryOpenFence(line: string): Fence | undefined {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m?.[1]) {
    return undefined;
  }
  const tick = m[1];
  const char: "`" | "~" = tick.startsWith("~") ? "~" : "`";
  return { char, len: tick.length };
}

function tryCloseFence(line: string, open: Fence): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  if (!m?.[1]) {
    return false;
  }
  const tick = m[1];
  const char: "`" | "~" = tick.startsWith("~") ? "~" : "`";
  return char === open.char && tick.length >= open.len;
}
