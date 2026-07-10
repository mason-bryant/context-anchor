import {
  formatAnnotationBody,
  claimStrength,
  claimStrengthScore,
  looksLikeAnnotationBody,
  parseAnnotationBody,
  type ClaimAnnotation,
  type ClaimConfidence,
  type ClaimSource,
  type ClaimStatus,
} from "./claims.js";

export type MermaidBlock = {
  line: number;
  endLine: number;
  text: string;
  status: ClaimStatus;
  sources: ClaimSource[];
  strength: ClaimConfidence;
  strengthScore: number;
  annotation?: ClaimAnnotation;
  sourceErrors?: { line: number; inline: boolean; errors: string[] }[];
};

const FENCE_PATTERN = /^(\s*)((`{3,})|(~{3,}))(.*)$/;
const STANDALONE_ANNOTATION_PATTERN = /^(\s+)\{([^{}]*)\}\s*$/;

export function extractMermaidBlocks(content: string): MermaidBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: MermaidBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const fence = FENCE_PATTERN.exec(lines[index]);
    if (!fence || firstFenceLanguage(fence[5]) !== "mermaid") {
      continue;
    }

    const fenceChar = fence[3].charAt(0);
    const fenceLen = fence[3].length;
    const code: string[] = [];
    let endIndex = index;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (isClosingFence(lines[scan], fenceChar, fenceLen)) {
        endIndex = scan;
        break;
      }
      code.push(lines[scan]);
    }
    if (endIndex === index) {
      continue;
    }

    const block: MermaidBlock = {
      line: index + 1,
      endLine: endIndex + 1,
      text: code.join("\n"),
      status: "unannotated",
      sources: [],
      strength: "low",
      strengthScore: 1,
    };
    for (const annotationIndex of findStandaloneAnnotationIndexes(lines, endIndex)) {
      applyParsedAnnotation(block, lines[annotationIndex], annotationIndex + 1);
    }
    finalizeBlock(block);
    blocks.push(block);
    index = endIndex;
  }

  return blocks;
}

export function replaceMermaidBlockText(content: string, line: number, text: string): string {
  const block = locateMermaidBlockByLine(content, line);
  const lines = content.split(/\r?\n/);
  lines.splice(block.line, block.endLine - block.line - 1, ...text.split(/\r?\n/));
  return lines.join("\n");
}

export function upsertMermaidBlockSources(content: string, line: number, sources: ClaimAnnotation[]): string {
  const block = locateMermaidBlockByLine(content, line);
  const lines = content.split(/\r?\n/);
  const sourceLines = [
    ...block.sources.filter((source) => source.line !== undefined).map((source) => source.line as number),
    ...(block.sourceErrors ?? []).map((entry) => entry.line),
  ];
  [...new Set(sourceLines)]
    .sort((left, right) => right - left)
    .forEach((sourceLine) => {
      lines.splice(sourceLine - 1, 1);
    });
  if (sources.length > 0) {
    lines.splice(block.endLine, 0, ...sources.map((source) => `  ${formatAnnotationBody(source)}`));
  }
  return lines.join("\n");
}

function locateMermaidBlockByLine(content: string, line: number): MermaidBlock {
  const block = extractMermaidBlocks(content).find((entry) => entry.line === line);
  if (!block) {
    throw new Error(`No Mermaid diagram starts on line ${line}.`);
  }
  return block;
}

function applyParsedAnnotation(block: MermaidBlock, line: string, lineNumber: number): void {
  const standalone = STANDALONE_ANNOTATION_PATTERN.exec(line);
  if (!standalone || !looksLikeAnnotationBody(standalone[2])) {
    return;
  }
  const parsed = parseAnnotationBody(standalone[2]);
  if (parsed.ok) {
    const source: ClaimSource = { ...parsed.annotation, line: lineNumber, inline: false };
    block.sources.push(source);
    block.annotation ??= parsed.annotation;
  } else {
    block.sourceErrors ??= [];
    block.sourceErrors.push({ line: lineNumber, inline: false, errors: parsed.errors });
  }
}

function finalizeBlock(block: MermaidBlock): void {
  block.strength = claimStrength(block.sources);
  block.strengthScore = claimStrengthScore(block.sources);
  block.status = block.sourceErrors && block.sourceErrors.length > 0 ? "malformed" : block.sources.length ? "annotated" : "unannotated";
}

function findStandaloneAnnotationIndexes(lines: string[], closingFenceIndex: number): number[] {
  const indexes: number[] = [];
  for (let index = closingFenceIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      return indexes;
    }
    if (!/^\s/.test(line)) {
      return indexes;
    }
    const standalone = STANDALONE_ANNOTATION_PATTERN.exec(line);
    if (standalone && looksLikeAnnotationBody(standalone[2])) {
      indexes.push(index);
      continue;
    }
    return indexes;
  }
  return indexes;
}

function firstFenceLanguage(info: string): string {
  return String(info || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
}

function isClosingFence(line: string, char: string, len: number): boolean {
  const marker = char === "`" ? "`" : "~";
  return new RegExp(`^\\s*${marker}{${len},}\\s*$`).test(line);
}
