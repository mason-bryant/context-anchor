import type {
  ProjectUpdateFormat,
  ProjectUpdateMilestone,
  ProjectUpdateSnapshot,
  ProjectUpdateTask,
  RenderedProjectUpdate,
} from "./types.js";

const TASK_STATUS_ORDER: ProjectUpdateTask["status"][] = ["done", "active", "blocked", "todo", "cancelled"];

export function renderProjectUpdate(snapshot: ProjectUpdateSnapshot, format: ProjectUpdateFormat): RenderedProjectUpdate {
  const subject = format === "email" ? `Project update: ${snapshot.project} (${snapshot.asOf})` : undefined;
  const body =
    format === "slack"
      ? renderSlackUpdate(snapshot)
      : format === "email"
        ? renderEmailUpdate(snapshot)
        : renderMarkdownUpdate(snapshot);

  return {
    format,
    generatedAt: snapshot.generatedAt,
    asOf: snapshot.asOf,
    project: snapshot.project,
    ...(subject ? { subject } : {}),
    body,
    snapshot,
  };
}

export function toProjectUpdateTask(task: {
  id: string;
  title: string;
  status: ProjectUpdateTask["status"];
  owner?: string;
  goalIds?: string[];
  due?: string;
  completedOn?: string;
  dateConfidence?: ProjectUpdateTask["dateConfidence"];
  notes?: string;
}, anchor: string): ProjectUpdateTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    source: "milestone",
    anchor,
    ...(task.owner ? { owner: task.owner } : {}),
    ...(task.goalIds && task.goalIds.length > 0 ? { goalIds: task.goalIds } : {}),
    ...(task.due ? { due: task.due } : {}),
    ...(task.completedOn ? { completedOn: task.completedOn } : {}),
    ...(task.dateConfidence ? { dateConfidence: task.dateConfidence } : {}),
    ...(task.notes ? { notes: task.notes } : {}),
  };
}

export function sortUpdateTasks(tasks: ProjectUpdateTask[]): ProjectUpdateTask[] {
  return [...tasks].sort((left, right) => {
    const statusDelta = TASK_STATUS_ORDER.indexOf(left.status) - TASK_STATUS_ORDER.indexOf(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function renderMarkdownUpdate(snapshot: ProjectUpdateSnapshot): string {
  const lines = [
    `# Project Update: ${snapshot.project}`,
    "",
    `As of: ${snapshot.asOf}`,
    "",
    "## Progress",
    "",
    `- Milestones: ${milestoneProgressSummary(snapshot)}.`,
    `- Tasks: ${snapshot.progress.tasks.done} done, ${snapshot.progress.tasks.active} in progress, ${snapshot.progress.tasks.blocked} blocked, ${snapshot.progress.tasks.todo} not started.`,
    "",
  ];

  lines.push(...renderMilestoneGroups(snapshot, "markdown"));
  lines.push(...renderBacklog(snapshot, "markdown"));
  lines.push(...renderWarnings(snapshot));

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderSlackUpdate(snapshot: ProjectUpdateSnapshot): string {
  const lines = [
    `*Project update: ${snapshot.project}*`,
    `As of ${snapshot.asOf}`,
    `Progress: ${milestoneProgressSummary(snapshot)}; ${snapshot.progress.tasks.done}/${snapshot.progress.tasks.total} tasks done.`,
    "",
  ];

  lines.push(...renderMilestoneGroups(snapshot, "slack"));
  lines.push(...renderBacklog(snapshot, "slack"));
  if (snapshot.warnings.length > 0) {
    lines.push("*Warnings*");
    for (const warning of snapshot.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderEmailUpdate(snapshot: ProjectUpdateSnapshot): string {
  const lines = [
    `Project update: ${snapshot.project}`,
    "",
    `As of: ${snapshot.asOf}`,
    "",
    `Milestones: ${milestoneProgressSummary(snapshot)}.`,
    `Tasks: ${snapshot.progress.tasks.done} done, ${snapshot.progress.tasks.active} in progress, ${snapshot.progress.tasks.blocked} blocked, ${snapshot.progress.tasks.todo} not started.`,
    "",
  ];

  lines.push(...renderMilestoneGroups(snapshot, "email"));
  lines.push(...renderBacklog(snapshot, "email"));
  lines.push(...renderWarnings(snapshot));

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderMilestoneGroups(snapshot: ProjectUpdateSnapshot, format: ProjectUpdateFormat): string[] {
  const lines: string[] = [];
  const groups: Array<{ title: string; statuses: ProjectUpdateMilestone["status"][] }> = [
    { title: "Shipped Milestones", statuses: ["shipped"] },
    { title: "In Progress Milestones", statuses: ["active"] },
    { title: "Starting Soon", statuses: ["proposed"] },
    { title: "Cancelled Milestones", statuses: ["cancelled"] },
  ];

  for (const group of groups) {
    const milestones = snapshot.milestones.filter((milestone) => group.statuses.includes(milestone.status));
    if (milestones.length === 0) {
      continue;
    }
    lines.push(format === "slack" ? `*${group.title}*` : `## ${group.title}`, "");
    for (const milestone of milestones) {
      lines.push(...renderMilestone(milestone, format), "");
    }
  }

  return lines;
}

function renderMilestone(milestone: ProjectUpdateMilestone, format: ProjectUpdateFormat): string[] {
  const label = milestoneLabel(milestone);
  const goals = milestone.goals.map((goal) => formatGoalLabel(goal)).join(", ");
  const lines = [
    format === "slack" ? `_${label}_ (${milestone.status})` : `### ${label}`,
    ...(format === "slack" ? [] : [`Status: ${milestone.status}`]),
    ...(milestone.schedule ? [formatSchedule(milestone)] : []),
    ...(goals ? [`Goals: ${goals}`] : []),
  ];
  const tasks = sortUpdateTasks(milestone.tasks);
  if (tasks.length === 0) {
    lines.push("- No structured tasks recorded.");
    return lines;
  }

  for (const status of TASK_STATUS_ORDER) {
    const group = tasks.filter((task) => task.status === status);
    if (group.length === 0) {
      continue;
    }
    lines.push(format === "slack" ? taskStatusHeading(status) : `#### ${taskStatusHeading(status)}`);
    for (const task of group) {
      lines.push(`- ${formatTask(task)}`);
    }
  }
  return lines;
}

function renderBacklog(snapshot: ProjectUpdateSnapshot, format: ProjectUpdateFormat): string[] {
  const backlog = snapshot.backlog;
  if (!backlog || backlog.tasks.length === 0) {
    return [];
  }

  const lines = [format === "slack" ? "*Backlog*" : "## Backlog", "", "Backlog grooming: in progress."];
  for (const task of sortUpdateTasks(backlog.tasks)) {
    lines.push(`- ${formatTask(task)}`);
  }
  lines.push("");
  return lines;
}

function renderWarnings(snapshot: ProjectUpdateSnapshot): string[] {
  if (snapshot.warnings.length === 0) {
    return [];
  }
  return ["## Warnings", "", ...snapshot.warnings.map((warning) => `- ${warning}`), ""];
}

function milestoneLabel(milestone: ProjectUpdateMilestone): string {
  const prefix = milestone.displayId ?? milestone.milestoneId;
  return prefix ? `${prefix} - ${milestone.theme}` : milestone.theme;
}

function formatGoalLabel(goal: ProjectUpdateMilestone["goals"][number]): string {
  const legacyPrefix = new RegExp(`^Goal\\s+${escapeRegExp(goal.id)}\\s+--\\s+`, "i");
  return `${goal.id} ${goal.title.replace(legacyPrefix, "")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatSchedule(milestone: ProjectUpdateMilestone): string {
  const schedule = milestone.schedule;
  if (!schedule) {
    return "";
  }
  const bits = [
    schedule.start ? `starts ${schedule.start}` : undefined,
    schedule.target ? `target ${schedule.target}` : undefined,
    schedule.shipped ? `shipped ${schedule.shipped}` : undefined,
    schedule.dateConfidence ? `confidence ${schedule.dateConfidence}` : undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return bits.length > 0 ? `Schedule: ${bits.join("; ")}` : "";
}

function milestoneProgressSummary(snapshot: ProjectUpdateSnapshot): string {
  return `${snapshot.progress.milestones.shipped} shipped, ${snapshot.progress.milestones.active} active, ${snapshot.progress.milestones.proposed} upcoming, ${snapshot.progress.milestones.cancelled} cancelled`;
}

function taskStatusHeading(status: ProjectUpdateTask["status"]): string {
  switch (status) {
    case "done":
      return "Done";
    case "active":
      return "In Progress";
    case "blocked":
      return "Blocked";
    case "todo":
      return "Not Started";
    case "cancelled":
      return "Cancelled";
  }
}

function formatTask(task: ProjectUpdateTask): string {
  const bits = [
    `${task.id}: ${task.title}`,
    task.completedOn ? `completed ${task.completedOn}` : undefined,
    task.due ? `due ${task.due}${task.dateConfidence ? ` (${task.dateConfidence})` : ""}` : undefined,
    task.owner ? `owner ${task.owner}` : undefined,
    task.notes ? task.notes : undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return bits.join(" - ");
}
