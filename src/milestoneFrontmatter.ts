import type { DateConfidence, MilestoneScheduleMeta, MilestoneTaskMeta, MilestoneTaskStatus } from "./types.js";

/** `milestone_id` values that match the typed milestone schema (align with Zod overlay). */
export function normalizedMilestoneId(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  if (raw === "backlog") {
    return "backlog";
  }
  if (/^M\d+$/.test(raw)) {
    return raw;
  }
  return undefined;
}

export function normalizedIsoDate(raw: unknown): string | undefined {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return undefined;
}

export function normalizedScheduleFromFm(fm: Record<string, unknown>): MilestoneScheduleMeta | undefined {
  const raw = fm.schedule;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const schedule = raw as Record<string, unknown>;
  const start = normalizedIsoDate(schedule.start);
  const target = normalizedIsoDate(schedule.target);
  const shipped = normalizedIsoDate(schedule.shipped);
  const dateConfidence = normalizedDateConfidence(schedule.date_confidence);

  if (!start && !target && !shipped && !dateConfidence) {
    return undefined;
  }

  return {
    ...(start !== undefined ? { start } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(shipped !== undefined ? { shipped } : {}),
    ...(dateConfidence !== undefined ? { dateConfidence } : {}),
  };
}

export function normalizedTasksFromFm(fm: Record<string, unknown>): MilestoneTaskMeta[] | undefined {
  const raw = fm.tasks;
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const tasks = raw.flatMap((item): MilestoneTaskMeta[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const task = item as Record<string, unknown>;
    const id = stringValue(task.id);
    const title = stringValue(task.title);
    const status = normalizedTaskStatus(task.status);
    if (!id || !title || !status) {
      return [];
    }
    const priority = numberValue(task.priority);
    const owner = stringValue(task.owner);
    const goalIds = Array.isArray(task.goal_ids)
      ? task.goal_ids.filter((goalId): goalId is string => typeof goalId === "string" && /^G-\d{1,6}$/.test(goalId))
      : undefined;
    const due = normalizedIsoDate(task.due);
    const completedOn = normalizedIsoDate(task.completed_on);
    const dateConfidence = normalizedDateConfidence(task.date_confidence);
    const notes = stringValue(task.notes);

    return [
      {
        id,
        title,
        status,
        ...(priority !== undefined ? { priority } : {}),
        ...(owner ? { owner } : {}),
        ...(goalIds && goalIds.length > 0 ? { goalIds } : {}),
        ...(due !== undefined ? { due } : {}),
        ...(completedOn !== undefined ? { completedOn } : {}),
        ...(dateConfidence !== undefined ? { dateConfidence } : {}),
        ...(notes ? { notes } : {}),
      },
    ];
  });

  return tasks.length > 0 ? tasks : undefined;
}

function normalizedDateConfidence(raw: unknown): DateConfidence | undefined {
  return raw === "committed" || raw === "internal_goal" || raw === "estimated" ? raw : undefined;
}

function normalizedTaskStatus(raw: unknown): MilestoneTaskStatus | undefined {
  return raw === "todo" || raw === "active" || raw === "blocked" || raw === "done" || raw === "cancelled"
    ? raw
    : undefined;
}

function stringValue(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function numberValue(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/** Positive integer `sequence` from milestone front matter, if present and valid. */
export function normalizedSequenceFromFm(fm: Record<string, unknown>): number | undefined {
  const seqRaw = fm.sequence;
  if (typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw > 0) {
    return seqRaw;
  }
  if (typeof seqRaw === "string" && /^\d+$/.test(seqRaw)) {
    const n = parseInt(seqRaw, 10);
    if (Number.isInteger(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}
