export type ParsedSection = {
  ordinal: number;
  parentOrdinal: number | undefined;
  headingLevel: number;
  title: string;
  stableKey: string;
  /** Offsets into the ORIGINAL content, so a slice reproduces the source byte-for-byte. */
  startOffset: number;
  endOffset: number;
};

export type ParsedBlock = {
  ordinal: number;
  sectionOrdinal: number | undefined;
  blockType: "paragraph" | "code" | "table" | "list" | "quote";
  rawContent: string;
  startOffset: number;
  endOffset: number;
};

export type ParsedMarkdown = {
  sections: ParsedSection[];
  blocks: ParsedBlock[];
};

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Split a Markdown document into its heading structure and addressable blocks.
 *
 * Offsets index the original string, including front matter, so a citation captured later
 * (PR6) can slice exact bytes back out. Front matter itself yields no blocks — it is
 * metadata, not content someone would cite.
 *
 * Deliberately hand-rolled rather than pulled from a Markdown library: what is needed is a
 * faithful offset map over the raw text, and most parsers normalize away exactly the detail
 * (trailing whitespace, fence markers, original spacing) that makes offsets reproducible.
 */
export function parseMarkdownStructure(content: string, options: { documentName?: string } = {}): ParsedMarkdown {
  const documentName = options.documentName ?? "";
  const lines = splitKeepingOffsets(content);
  const bodyStart = frontMatterEnd(lines);

  const sections: ParsedSection[] = [];
  const blocks: ParsedBlock[] = [];
  const openHeadings: Array<{ ordinal: number; level: number; title: string }> = [];

  let inFence = false;
  let currentSectionOrdinal: number | undefined;
  let pendingBlockLines: Array<{ text: string; start: number; end: number }> = [];

  const flushBlock = () => {
    const meaningful = pendingBlockLines.filter((line) => line.text.trim().length > 0);
    if (meaningful.length === 0) {
      pendingBlockLines = [];
      return;
    }
    const start = meaningful[0]!.start;
    const end = meaningful[meaningful.length - 1]!.end;
    blocks.push({
      ordinal: blocks.length,
      sectionOrdinal: currentSectionOrdinal,
      blockType: classifyBlock(meaningful.map((line) => line.text)),
      rawContent: content.slice(start, end),
      startOffset: start,
      endOffset: end,
    });
    pendingBlockLines = [];
  };

  for (const line of lines) {
    if (line.start < bodyStart) {
      continue;
    }

    if (FENCE.test(line.text)) {
      // Toggle first, then collect: the fence markers belong to the block they delimit.
      pendingBlockLines.push(line);
      if (inFence) {
        inFence = false;
        flushBlock();
      } else {
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      pendingBlockLines.push(line);
      continue;
    }

    const heading = HEADING.exec(line.text);
    if (heading) {
      flushBlock();

      const level = heading[1]!.length;
      const title = heading[2]!.trim();

      // A heading closes every open heading at or below its level.
      while (openHeadings.length > 0 && openHeadings[openHeadings.length - 1]!.level >= level) {
        openHeadings.pop();
      }

      const ordinal = sections.length;
      const parent = openHeadings[openHeadings.length - 1];
      const path = [...openHeadings.map((h) => h.title), title];

      sections.push({
        ordinal,
        parentOrdinal: parent?.ordinal,
        headingLevel: level,
        title,
        stableKey: sectionStableKey(documentName, path),
        startOffset: line.start,
        // Extended as the section's content is consumed; the heading line alone is the floor.
        endOffset: line.end,
      });

      openHeadings.push({ ordinal, level, title });
      currentSectionOrdinal = ordinal;
      continue;
    }

    if (line.text.trim().length === 0) {
      flushBlock();
    } else {
      pendingBlockLines.push(line);
    }

    if (currentSectionOrdinal !== undefined) {
      sections[currentSectionOrdinal]!.endOffset = Math.max(sections[currentSectionOrdinal]!.endOffset, line.end);
    }
  }

  flushBlock();
  extendAncestorRanges(sections);

  return { sections, blocks };
}

/**
 * Document plus normalized heading path. This is what associations and diagnostics resolve
 * on, because section GUIDs are revision-scoped and change on every reimport. Normalization
 * is deliberately lossy about punctuation and spacing so cosmetic edits to a heading do not
 * orphan everything pointing at it — but it keeps the full path, so two headings with the
 * same text at different depths stay distinct.
 */
export function sectionStableKey(documentName: string, headingPath: string[]): string {
  return `${documentName}#${headingPath.map(slugify).join("/")}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitKeepingOffsets(content: string): Array<{ text: string; start: number; end: number }> {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;

  while (start <= content.length) {
    const newline = content.indexOf("\n", start);
    const end = newline === -1 ? content.length : newline;
    lines.push({ text: content.slice(start, end), start, end });
    if (newline === -1) {
      break;
    }
    start = newline + 1;
  }

  return lines;
}

/** Byte offset where the body begins, skipping a leading `---` front-matter block. */
function frontMatterEnd(lines: Array<{ text: string; start: number; end: number }>): number {
  if (lines.length === 0 || lines[0]!.text.trim() !== "---") {
    return 0;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.text.trim() === "---") {
      // Clamped: when the closing fence is the final line and the file has no trailing
      // newline, `end + 1` lands past EOF and every body line is skipped as front matter —
      // the document would import as zero sections and zero blocks, silently.
      const lastLine = lines[lines.length - 1]!;
      return Math.min(lines[index]!.end + 1, lastLine.end);
    }
  }
  // Unterminated front matter: treat the whole file as body rather than swallowing it.
  return 0;
}

/**
 * A parent section's range must cover its children. Ranges are grown during the scan only
 * for the innermost open heading, so ancestors are extended afterwards.
 */
function extendAncestorRanges(sections: ParsedSection[]): void {
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index]!;
    const parentOrdinal = section.parentOrdinal;
    if (parentOrdinal !== undefined) {
      const parent = sections[parentOrdinal]!;
      parent.endOffset = Math.max(parent.endOffset, section.endOffset);
    }
  }
}

function classifyBlock(lines: string[]): ParsedBlock["blockType"] {
  const first = lines[0]!.trim();

  if (FENCE.test(first)) {
    return "code";
  }
  if (first.startsWith(">")) {
    return "quote";
  }
  if (/^[-*+]\s/.test(first) || /^\d+\.\s/.test(first)) {
    return "list";
  }
  // A table needs its delimiter row; a single pipe line is just a paragraph.
  if (first.startsWith("|") && lines.length >= 2 && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[1]!)) {
    return "table";
  }
  return "paragraph";
}
