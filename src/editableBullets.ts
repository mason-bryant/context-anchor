type LineScanState = {
  inFence: false | { char: "`" | "~"; len: number };
  section?: string;
};

export type EditableBulletLocation =
  | { ok: true; section: string; line: number; text: string }
  | { ok: false; code: "editable_bullet_not_found" | "editable_bullet_not_allowed" };

export function replaceEditableBulletText(content: string, line: number, text: string): string {
  const location = locateEditableBullet(content, line);
  if (!location.ok) {
    throw editableBulletError(location, line);
  }
  const lines = content.split(/\r?\n/);
  lines[line - 1] = `- ${text}`;
  return lines.join("\n");
}

export function deleteEditableBullet(content: string, line: number): string {
  const location = locateEditableBullet(content, line);
  if (!location.ok) {
    throw editableBulletError(location, line);
  }
  const lines = content.split(/\r?\n/);
  const bulletIndex = line - 1;
  const endIndex = bulletBlockEndIndex(lines, bulletIndex);
  lines.splice(bulletIndex, endIndex - bulletIndex);
  return lines.join("\n");
}

export function locateEditableBullet(content: string, line: number): EditableBulletLocation {
  const lines = content.split(/\r?\n/);
  if (!Number.isInteger(line) || line < 1 || line > lines.length) {
    return { ok: false, code: "editable_bullet_not_found" };
  }

  const state: LineScanState = { inFence: false, section: undefined };
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    advanceScanState(state, current);
    if (index !== line - 1) {
      continue;
    }
    if (state.inFence || !current.startsWith("- ")) {
      return { ok: false, code: "editable_bullet_not_found" };
    }
    if (!state.section || !isEditableBulletSection(state.section)) {
      return { ok: false, code: "editable_bullet_not_allowed" };
    }
    return { ok: true, section: state.section, line, text: current.slice(2).trim() };
  }

  return { ok: false, code: "editable_bullet_not_found" };
}

export function isEditableBulletSection(section: string): boolean {
  const normalized = section
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "tl-dr" || normalized === "tldr";
}

function editableBulletError(location: Exclude<EditableBulletLocation, { ok: true }>, line: number): Error {
  if (location.code === "editable_bullet_not_allowed") {
    return new Error(`Line ${line} is not in an editable rendered-bullet section.`);
  }
  return new Error(`No editable rendered bullet found at line ${line}.`);
}

function bulletBlockEndIndex(lines: string[], bulletIndex: number): number {
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !/^\s/.test(line)) {
      return index;
    }
  }
  return lines.length;
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

  const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (heading) {
    const level = heading[1].length;
    if (level === 1) {
      state.section = undefined;
      return;
    }
    if (level === 2) {
      state.section = heading[2].replace(/\s+#+\s*$/, "").trim();
    }
  }
}

function opensFence(line: string): false | { char: "`" | "~"; len: number } {
  const match = /^(\s*)(`{3,}|~{3,})/.exec(line);
  if (!match) {
    return false;
  }
  const fence = match[2];
  return { char: fence[0] as "`" | "~", len: fence.length };
}

function closesFence(line: string, fence: { char: "`" | "~"; len: number }): boolean {
  const pattern = fence.char === "`" ? "`" : "~";
  const match = new RegExp(`^\\s*${pattern}{${fence.len},}\\s*$`).exec(line);
  return Boolean(match);
}
