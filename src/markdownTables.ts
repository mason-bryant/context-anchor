export type MarkdownTable = {
  /** 1-based line containing the table header row. */
  line: number;
  /** 1-based line containing the final row in the table. */
  endLine: number;
  /** Complete Markdown source for the table, including header and separator rows. */
  text: string;
};

const FENCE_PATTERN = /^(\s*)((`{3,})|(~{3,}))(.*)$/;

export function extractMarkdownTables(content: string): MarkdownTable[] {
  const lines = content.split(/\r?\n/);
  const tables: MarkdownTable[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const fence = FENCE_PATTERN.exec(lines[index]);
    if (fence) {
      index = closingFenceIndex(lines, index, fence[3].charAt(0), fence[3].length);
      continue;
    }
    if (!isTableStart(lines, index)) {
      continue;
    }

    let nextIndex = index + 2;
    while (nextIndex < lines.length && looksLikeTableRow(lines[nextIndex]) && !isTableSeparator(lines[nextIndex])) {
      nextIndex += 1;
    }
    tables.push({
      line: index + 1,
      endLine: nextIndex,
      text: lines.slice(index, nextIndex).join("\n"),
    });
    index = nextIndex - 1;
  }

  return tables;
}

export function replaceMarkdownTable(content: string, line: number, text: string): string {
  const table = locateMarkdownTableByLine(content, line);
  const lines = content.split(/\r?\n/);
  lines.splice(table.line - 1, table.endLine - table.line + 1, ...text.split(/\r?\n/));
  return lines.join("\n");
}

export function isCompleteMarkdownTable(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const tables = extractMarkdownTables(text);
  return tables.length === 1 && tables[0].line === 1 && tables[0].endLine === lines.length;
}

function locateMarkdownTableByLine(content: string, line: number): MarkdownTable {
  const table = extractMarkdownTables(content).find((entry) => entry.line === line);
  if (!table) {
    throw new Error(`No Markdown table starts on line ${line}.`);
  }
  return table;
}

function isTableStart(lines: string[], index: number): boolean {
  return looksLikeTableRow(lines[index]) && isTableSeparator(lines[index + 1]);
}

function looksLikeTableRow(line: string | undefined): boolean {
  const trimmed = String(line || "").trim();
  return trimmed.includes("|") && splitTableRow(trimmed).length > 1;
}

function isTableSeparator(line: string | undefined): boolean {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function splitTableRow(line: string | undefined): string[] {
  let text = String(line || "").trim();
  if (text.startsWith("|")) {
    text = text.slice(1);
  }
  if (text.endsWith("|") && !text.endsWith("\\|")) {
    text = text.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "`") {
      inCode = !inCode;
      cell += char;
      continue;
    }
    if (char === "\\" && text.charAt(index + 1) === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function closingFenceIndex(lines: string[], startIndex: number, char: string, length: number): number {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (isClosingFence(lines[index], char, length)) {
      return index;
    }
  }
  return lines.length - 1;
}

function isClosingFence(line: string, char: string, length: number): boolean {
  const marker = char === "`" ? "`" : "~";
  return new RegExp(`^\\s*${marker}{${length},}\\s*$`).test(line);
}
