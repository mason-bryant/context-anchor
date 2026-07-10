export const QUESTION_SECTIONS = ["Open Questions", "Questions", "Resolved Questions"] as const;

export const QUESTION_STATUSES = ["open", "resolved", "deferred", "wont-answer"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export type AnchorQuestion = {
  section: string;
  line: number;
  text: string;
  status: QuestionStatus;
  id?: string;
  resolution?: string;
  resolvedOn?: string;
  owner?: string;
};

export type QuestionLocation =
  | { ok: true; question: AnchorQuestion }
  | { ok: false; code: "question_not_found" | "question_ambiguous"; candidates: string[] };

export type QuestionTarget = { line: number } | { id: string } | { question: string };

type LineScanState = {
  inFence: false | { char: "`" | "~"; len: number };
  section?: string;
};

type ParsedQuestionBullet = {
  text: string;
  status?: QuestionStatus;
  id?: string;
};

const STATUS_TAG_PATTERN = /^(?:\[(open|resolved|deferred|wont-answer|won't-answer|wont answer)\]|(open|resolved|deferred|wont-answer|won't-answer|wont answer))\s*:?\s+/i;
const QUESTION_ID_PATTERN = /^(?:\[(Q-\d{1,6})\]|(Q-\d{1,6}))\s*(?::|-)?\s*/i;
const METADATA_PATTERN = /^\s+(Resolution|Resolved on|Owner|Status):\s*(.*?)\s*$/i;

export function extractQuestions(content: string): AnchorQuestion[] {
  const lines = content.split(/\r?\n/);
  const questions: AnchorQuestion[] = [];
  const state: LineScanState = { inFence: false, section: undefined };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    advanceScanState(state, line);
    if (state.inFence || !state.section || !isQuestionSection(state.section) || !line.startsWith("- ")) {
      continue;
    }

    const parsed = parseQuestionBullet(line.slice(2));
    const metadata = readQuestionMetadata(lines, index);
    const status = metadata.status ?? parsed.status ?? defaultStatusForSection(state.section);
    questions.push({
      section: state.section,
      line: index + 1,
      text: parsed.text,
      status,
      ...(parsed.id ? { id: parsed.id } : {}),
      ...(metadata.resolution ? { resolution: metadata.resolution } : {}),
      ...(metadata.resolvedOn ? { resolvedOn: metadata.resolvedOn } : {}),
      ...(metadata.owner ? { owner: metadata.owner } : {}),
    });
  }

  return questions;
}

export function locateQuestion(content: string, target: QuestionTarget): QuestionLocation {
  const questions = extractQuestions(content);
  if ("line" in target) {
    const hit = questions.find((question) => question.line === target.line);
    return hit ? { ok: true, question: hit } : { ok: false, code: "question_not_found", candidates: [] };
  }

  if ("id" in target) {
    const want = normalizeQuestionId(target.id);
    if (!want) {
      return { ok: false, code: "question_not_found", candidates: [] };
    }
    const hits = questions.filter((question) => question.id && normalizeQuestionId(question.id) === want);
    return questionLocationFromHits(hits);
  }

  const needle = target.question.trim().toLowerCase();
  const hits = questions.filter((question) => question.text.toLowerCase().includes(needle));
  return questionLocationFromHits(hits);
}

export function setQuestionStatus(
  content: string,
  target: QuestionTarget,
  input: { status: QuestionStatus; resolution?: string; resolvedOn?: string; owner?: string },
): string {
  const location = locateQuestion(content, target);
  if (!location.ok) {
    const targetLabel =
      "line" in target ? `line ${target.line}` : "id" in target ? `id "${target.id}"` : `"${target.question}"`;
    throw new Error(
      location.code === "question_not_found"
        ? `No question matching ${targetLabel}.`
        : `Question match ${targetLabel} is ambiguous (${location.candidates.length}+ matches).`,
    );
  }

  const question = location.question;
  const lines = content.split(/\r?\n/);
  const bulletIndex = question.line - 1;
  const endIndex = questionBlockEndIndex(lines, bulletIndex);
  const existingContinuation = lines.slice(bulletIndex + 1, endIndex).filter((line) => !isQuestionMetadataLine(line));
  const replacement = [formatQuestionBullet(question, input.status), ...existingContinuation];
  if (input.status !== "open") {
    if (input.resolution?.trim()) {
      replacement.push(`  Resolution: ${input.resolution.trim()}`);
    }
    if (input.resolvedOn?.trim()) {
      replacement.push(`  Resolved on: ${input.resolvedOn.trim()}`);
    }
  }
  const owner = input.owner?.trim() || question.owner;
  if (owner) {
    replacement.push(`  Owner: ${owner}`);
  }

  lines.splice(bulletIndex, endIndex - bulletIndex, ...replacement);
  return lines.join("\n");
}

export function replaceQuestionText(content: string, target: QuestionTarget, text: string): string {
  const location = locateQuestion(content, target);
  if (!location.ok) {
    throw questionTargetError(location, target);
  }

  const question = { ...location.question, text };
  const lines = content.split(/\r?\n/);
  const bulletIndex = question.line - 1;
  lines[bulletIndex] = formatQuestionBullet(question, question.status);
  return lines.join("\n");
}

export function deleteQuestion(content: string, target: QuestionTarget): string {
  const location = locateQuestion(content, target);
  if (!location.ok) {
    throw questionTargetError(location, target);
  }

  const lines = content.split(/\r?\n/);
  const bulletIndex = location.question.line - 1;
  const endIndex = questionBlockEndIndex(lines, bulletIndex);
  lines.splice(bulletIndex, endIndex - bulletIndex);
  return lines.join("\n");
}

function parseQuestionBullet(raw: string): ParsedQuestionBullet {
  let body = raw.trim();
  let status: QuestionStatus | undefined;

  const checkbox = /^\[([ xX~-])\]\s+/.exec(body);
  if (checkbox) {
    const marker = checkbox[1] ?? " ";
    status = marker.trim() === "" ? "open" : marker === "~" || marker === "-" ? "deferred" : "resolved";
    body = body.slice(checkbox[0].length).trim();
  }

  const statusTag = STATUS_TAG_PATTERN.exec(body);
  if (statusTag) {
    status = normalizeQuestionStatus(statusTag[1] ?? statusTag[2]) ?? status;
    body = body.slice(statusTag[0].length).trim();
  }

  const idMatch = QUESTION_ID_PATTERN.exec(body);
  const id = normalizeQuestionId(idMatch?.[1] ?? idMatch?.[2] ?? "");
  if (idMatch) {
    body = body.slice(idMatch[0].length).trim();
  }

  return { text: body, ...(status ? { status } : {}), ...(id ? { id } : {}) };
}

function readQuestionMetadata(
  lines: string[],
  bulletIndex: number,
): { resolution?: string; resolvedOn?: string; owner?: string; status?: QuestionStatus } {
  const metadata: { resolution?: string; resolvedOn?: string; owner?: string; status?: QuestionStatus } = {};
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !/^\s/.test(line)) {
      return metadata;
    }
    const match = METADATA_PATTERN.exec(line);
    if (!match) {
      continue;
    }
    const key = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").trim();
    if (!value) {
      continue;
    }
    if (key === "resolution") {
      metadata.resolution = value;
    } else if (key === "resolved on") {
      metadata.resolvedOn = value;
    } else if (key === "owner") {
      metadata.owner = value;
    } else if (key === "status") {
      metadata.status = normalizeQuestionStatus(value) ?? metadata.status;
    }
  }
  return metadata;
}

function questionBlockEndIndex(lines: string[], bulletIndex: number): number {
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !/^\s/.test(line)) {
      return index;
    }
  }
  return lines.length;
}

function formatQuestionBullet(question: AnchorQuestion, status: QuestionStatus): string {
  const idPrefix = question.id ? `${question.id}: ` : "";
  return `- ${questionStatusMarker(status)} ${idPrefix}${question.text}`;
}

function questionStatusMarker(status: QuestionStatus): string {
  if (status === "resolved") return "[x]";
  if (status === "deferred") return "[-]";
  if (status === "wont-answer") return "[wont-answer]";
  return "[ ]";
}

function isQuestionMetadataLine(line: string): boolean {
  return METADATA_PATTERN.test(line);
}

function questionLocationFromHits(hits: AnchorQuestion[]): QuestionLocation {
  if (hits.length === 1) {
    return { ok: true, question: hits[0] };
  }
  if (hits.length === 0) {
    return { ok: false, code: "question_not_found", candidates: [] };
  }
  return {
    ok: false,
    code: "question_ambiguous",
    candidates: hits.map((question) => question.text).slice(0, 10),
  };
}

function questionTargetError(location: Exclude<QuestionLocation, { ok: true }>, target: QuestionTarget): Error {
  const targetLabel =
    "line" in target ? `line ${target.line}` : "id" in target ? `id "${target.id}"` : `"${target.question}"`;
  return new Error(
    location.code === "question_not_found"
      ? `No question matching ${targetLabel}.`
      : `Question match ${targetLabel} is ambiguous (${location.candidates.length}+ matches).`,
  );
}

function isQuestionSection(section: string): boolean {
  return (QUESTION_SECTIONS as readonly string[]).some((candidate) => candidate.toLowerCase() === section.toLowerCase());
}

function defaultStatusForSection(section: string): QuestionStatus {
  return section.toLowerCase() === "resolved questions" ? "resolved" : "open";
}

function normalizeQuestionId(value: string): string {
  const match = /^Q-(\d{1,6})$/i.exec(value.trim());
  return match ? `Q-${match[1]}` : "";
}

function normalizeQuestionStatus(value: string | undefined): QuestionStatus | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\s]+/g, "-");
  if (normalized === "wont-answer" || normalized === "won-t-answer") {
    return "wont-answer";
  }
  return (QUESTION_STATUSES as readonly string[]).includes(normalized) ? (normalized as QuestionStatus) : undefined;
}

function advanceScanState(state: LineScanState, line: string): void {
  if (state.inFence) {
    if (closesFence(line, state.inFence)) {
      state.inFence = false;
    }
    return;
  }

  const opened = opensFence(line);
  if (opened) {
    state.inFence = opened;
    return;
  }

  const h2 = /^##\s+(.+?)\s*$/.exec(line);
  if (h2) {
    state.section = h2[1]?.trim();
  } else if (/^#\s/.test(line)) {
    state.section = undefined;
  }
}

function opensFence(line: string): false | { char: "`" | "~"; len: number } {
  const match = /^(\s*)(`{3,}|~{3,})/.exec(line);
  if (!match?.[2]) {
    return false;
  }
  return { char: match[2][0] as "`" | "~", len: match[2].length };
}

function closesFence(line: string, fence: { char: "`" | "~"; len: number }): boolean {
  const marker = fence.char.repeat(fence.len);
  return new RegExp(`^\\s*${escapeRegExp(marker)}`).test(line);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
