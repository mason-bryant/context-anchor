import { parseDocument, isMap, YAMLMap, type Document } from "yaml";

import {
  parseBodyH2Segments,
  stringifyBodyH2Segments,
  type BodyH2Segment,
} from "./storage/markdown.js";

/** Normalize a user-supplied heading (`## PRs` or `PRs`) to the section title key. */
export function normalizeSectionTitle(heading: string): string {
  const t = heading.trim();
  const m = t.match(/^##\s+(.+?)\s*#*\s*$/);
  if (m?.[1]) {
    return m[1].trim();
  }
  return t;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Raw split of a full anchor document into its front-matter block and body,
 * WITHOUT going through gray-matter's YAML parse/re-dump. Mirrors
 * gray-matter's own delimiter detection exactly (see `splitFrontmatterRaw`
 * below for the precise algorithm) so this stays in lockstep with
 * `parseAnchor`/`matter()` reads elsewhere — only the parsing of the YAML
 * *inside* the fences differs (or is skipped entirely for section-only
 * edits), never the fence-finding itself.
 *
 * `rawFrontmatter` is the exact source text between the fences (comments,
 * blank lines, original line endings, everything) — never touched by
 * anything other than `mergeAnchorFrontmatter`'s targeted key edits.
 */
type RawFrontmatterSplit =
  | {
      hasFrontmatter: true;
      /** Exact bytes of the opening fence (`---`, no trailing newline). */
      openFence: string;
      /**
       * Raw text between the opening and closing fences, exactly as
       * written (no trim) — INCLUDES the newline right after the opening
       * `---` and the newline right before the closing `---` (which are
       * the same single newline when front matter is empty).
       */
      rawFrontmatter: string;
      /** Exact bytes of the closing fence (`---`, no trailing newline). */
      closeFence: string;
      /** Newline bytes right after the closing fence, if any (may be ""). */
      closeNewline: string;
      body: string;
    }
  | { hasFrontmatter: false; body: string };

/**
 * Matches gray-matter's own delimiter search byte-for-byte (see
 * `gray-matter/index.js` `parseMatter`, `defaults.js` for `open`/`close`):
 * the opening delimiter is the literal 3 bytes `---` at the very start of
 * the string (guarded so `----` does NOT count as an opening fence — the
 * 4th char being another `-` disqualifies it), and — critically — gray-matter
 * slices off ONLY those 3 bytes, leaving the newline that follows them in
 * the string it then searches. The closing delimiter is found by a PLAIN
 * SUBSTRING search for `\n---` over what remains (`str.indexOf('\n---')`),
 * not a "whole line is exactly `---`" match. Consequences this function
 * reproduces on purpose: empty front matter (`---\n---\n...`) closes
 * immediately, because the open fence's own trailing newline IS the `\n` the
 * close search matches; `\n----\n` closes at the first three dashes (a lone
 * `-` starts the body); a closing fence with no trailing newline (end of
 * file) still closes. Keeping this in lockstep with gray-matter means raw
 * split boundaries always agree with `parseAnchor`'s gray-matter-based read.
 */
function splitFrontmatterRaw(fullContent: string): RawFrontmatterSplit {
  if (!fullContent.startsWith("---") || fullContent.charAt(3) === "-") {
    return { hasFrontmatter: false, body: fullContent };
  }
  // Everything after the literal opening `---` (3 bytes) — still includes
  // the newline that follows it, exactly like gray-matter's `str` at this
  // point in `parseMatter`.
  const afterOpen = fullContent.slice(3);

  const closeMarker = "\n---";
  const closeIdx = afterOpen.indexOf(closeMarker);
  if (closeIdx === -1) {
    // No closing fence: gray-matter treats the whole thing as body (no
    // front matter recognized) once the close scan fails to find a
    // delimiter — mirror that by treating this as "no front matter".
    return { hasFrontmatter: false, body: fullContent };
  }

  // Raw text between the fences, exactly as written (no trim, no
  // re-parse) — INCLUDING the newline that immediately precedes the
  // closing `---` (closeMarker's own leading `\n`, which doubles as the
  // opening fence's trailing newline when front matter is empty), so
  // `rawFrontmatter` always ends in exactly one newline and reassembly is
  // a plain concatenation with no separator bytes to track separately.
  const rawFrontmatter = afterOpen.slice(0, closeIdx + 1);
  let afterClose = afterOpen.slice(closeIdx + closeMarker.length);
  // gray-matter strips exactly one `\r` then exactly one `\n` immediately
  // following the closing delimiter (see parse.js), never more.
  let closeNewline = "";
  if (afterClose[0] === "\r") {
    closeNewline += "\r";
    afterClose = afterClose.slice(1);
  }
  if (afterClose[0] === "\n") {
    closeNewline += "\n";
    afterClose = afterClose.slice(1);
  }
  const body = afterClose;

  return {
    hasFrontmatter: true,
    openFence: "---",
    rawFrontmatter,
    closeFence: "---",
    closeNewline,
    body,
  };
}

function reassembleFrontmatterRaw(split: RawFrontmatterSplit & { hasFrontmatter: true }, rawFrontmatter: string): string {
  return split.openFence + rawFrontmatter + split.closeFence + split.closeNewline + split.body;
}

/**
 * Detect the dominant newline style of a raw front-matter block so a
 * lossless YAML edit (which always emits LF internally) can be converted
 * back to CRLF when the source used it — applied uniformly to the whole
 * re-emitted block, never per-key, so it never becomes a source of
 * "reformatted sibling" bugs itself.
 */
function detectNewlineStyle(raw: string): "\r\n" | "\n" {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function toNewlineStyle(text: string, style: "\r\n" | "\n"): string {
  const lf = text.replace(/\r\n/g, "\n");
  return style === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}

/**
 * `schema: "yaml-1.1"` matches gray-matter's own engine (js-yaml, which
 * implements YAML 1.1): both recognize bare `YYYY-MM-DD`-shaped scalars as
 * the YAML 1.1 `!!timestamp` type. This matters ONLY for values this module
 * itself re-emits (untouched nodes reproduce their original source text
 * regardless of schema) — without it, `yaml`'s default `core` schema has no
 * timestamp type, sees no ambiguity, and would emit a new/changed
 * `last_validated: "2026-05-14"`-style string BARE. A later `parseAnchor`
 * read (gray-matter/js-yaml) would then parse that bare scalar back as a
 * `Date` object instead of the string that was written — a real, silent
 * round-trip bug, not just a formatting one. `keepSourceTokens: true` is
 * what lets `doc.toString()` reproduce the exact source formatting of every
 * untouched node (quote style, block scalars, comments, blank lines).
 */
const YAML_PARSE_OPTIONS = { schema: "yaml-1.1", keepSourceTokens: true } as const;

/**
 * Apply one update entry to a lossless YAML document node in place:
 * - `null` deletes the key (no-op if absent).
 * - a plain object whose existing value is ALSO a map merges recursively,
 *   touching only the changed leaves (used by relation-conversion edits,
 *   which replace one `relations.<key>` array while leaving sibling keys
 *   byte-identical).
 * - anything else sets/replaces the key wholesale.
 */
function applyUpdatesToYamlDoc(doc: Document.Parsed | Document, updates: Record<string, unknown>): void {
  if (doc.contents == null) {
    // An empty/no-front-matter document has `contents: null`. `doc.set()`
    // would auto-vivify a map for us, but under the `yaml-1.1` schema that
    // auto-vivified default resolves to `!!omap` (an ordered-map SEQUENCE
    // of single-key mappings) instead of a plain block mapping — a real
    // bug in the "no front matter yet" edge case, not a formatting quirk.
    // Explicitly creating a plain YAMLMap first sidesteps it.
    doc.contents = new YAMLMap(doc.schema);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      doc.delete(key);
      continue;
    }
    if (isPlainObject(value)) {
      const existing = doc.get(key, true);
      if (isMap(existing)) {
        applyUpdatesToYamlMap(existing, value);
        continue;
      }
    }
    doc.set(key, value);
  }
}

function applyUpdatesToYamlMap(mapNode: YAMLMap, updates: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      mapNode.delete(key);
      continue;
    }
    if (isPlainObject(value)) {
      const existing = mapNode.get(key, true);
      if (isMap(existing)) {
        applyUpdatesToYamlMap(existing, value);
        continue;
      }
    }
    mapNode.set(key, value);
  }
}

/**
 * Merge YAML front-matter keys, byte-preserving every line this call does
 * not explicitly touch (see module doc / plan: "Byte-preserving front-matter
 * writer"). `null` in `updates` removes a key. Nested plain-object values
 * whose existing target is also a map merge recursively (only the changed
 * leaves move) — this is what keeps `relations.<key>` conversions from
 * disturbing sibling relation keys.
 *
 * Implementation: parses ONLY the raw front-matter block (never the body)
 * with `yaml`'s `parseDocument`, which retains a CST alongside the AST so
 * `doc.toString()` reproduces the source formatting (quote style, block
 * scalars, comments, key order, blank lines) for every node that wasn't
 * `.set()`/`.delete()`d. Newly added keys get the library's default style,
 * which is fine — only pre-existing, untouched keys must be byte-identical.
 */
export function mergeAnchorFrontmatter(fullContent: string, updates: Record<string, unknown>): string {
  const split = splitFrontmatterRaw(fullContent);

  if (!split.hasFrontmatter) {
    // No front matter at all: synthesize one from scratch. There is nothing
    // to preserve, so falling back to gray-matter's stringify here (via a
    // fresh document) keeps behavior identical to before for this edge case.
    const doc = parseDocument("", YAML_PARSE_OPTIONS);
    applyUpdatesToYamlDoc(doc, updates);
    const yamlText = doc.toString();
    if (yamlText.trim() === "") {
      return fullContent;
    }
    return `---\n${yamlText}---\n\n${fullContent}`;
  }

  const newlineStyle = detectNewlineStyle(split.rawFrontmatter);
  // yaml only understands LF; normalize in, restore the source style out.
  const normalizedSource = split.rawFrontmatter.replace(/\r\n/g, "\n");

  // A leading run of blank lines has no node to attach to, so `yaml`'s
  // CST-preserving toString() silently drops it on round-trip (there is
  // nothing for the blank-line comment/whitespace token to precede). Carve
  // it off and reattach it verbatim rather than losing it — this is
  // exactly the same "empty front matter" shape as `---\n---\n`, just with
  // extra blank lines before the close fence instead of zero.
  const leadingBlankMatch = /^(?:[ \t]*\n)*/.exec(normalizedSource);
  const leadingBlank = leadingBlankMatch?.[0] ?? "";
  const yamlSource = normalizedSource.slice(leadingBlank.length);

  const doc = parseDocument(yamlSource, YAML_PARSE_OPTIONS);
  applyUpdatesToYamlDoc(doc, updates);
  let yamlText = doc.toString();
  if (yamlText === "") {
    // Every key was removed (or the block was already empty and stayed
    // that way): matches gray-matter's own stringify, which drops the
    // front-matter block entirely when data is `{}` rather than emitting
    // an empty `---\n---\n` (or blank-padded) shell.
    return split.body;
  }
  if (!yamlText.endsWith("\n")) {
    yamlText += "\n";
  }
  const rawFrontmatterOut = toNewlineStyle(leadingBlank + yamlText, newlineStyle);

  return reassembleFrontmatterRaw(split, rawFrontmatterOut);
}

function findSectionIndex(segments: BodyH2Segment[], title: string): number {
  const want = normalizeSectionTitle(title);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "section" && seg.title === want) {
      return i;
    }
  }
  return -1;
}

/**
 * Section-edit paths never touch front matter, so the raw front-matter block
 * (fences, comments, formatting, everything) is carried through VERBATIM —
 * no YAML round-trip at all. Only the body is replaced.
 */
function bodyFromFull(fullContent: string): { body: string; split: RawFrontmatterSplit } {
  const split = splitFrontmatterRaw(fullContent);
  return { body: split.body, split };
}

function assembleFull(split: RawFrontmatterSplit, newBody: string): string {
  if (!split.hasFrontmatter) {
    return newBody;
  }
  return split.openFence + split.rawFrontmatter + split.closeFence + split.closeNewline + newBody;
}

/** Replace an H2 section body (lines below the heading until the next H2). `content` must not include the `##` line. */
export function replaceAnchorSection(fullContent: string, heading: string, content: string): string {
  const { body, split } = bodyFromFull(fullContent);
  const segments = parseBodyH2Segments(body);
  const idx = findSectionIndex(segments, heading);
  if (idx < 0) {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const seg = segments[idx];
  if (seg.kind !== "section") {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const newLines = content.split(/\r?\n/);
  const next: BodyH2Segment = { ...seg, bodyLines: newLines };
  const out = [...segments.slice(0, idx), next, ...segments.slice(idx + 1)];
  return assembleFull(split, stringifyBodyH2Segments(out));
}

/** Append markdown to the end of a section body (after trimming trailing whitespace, one blank line is inserted when needed). */
export function appendToAnchorSection(fullContent: string, heading: string, appendMarkdown: string): string {
  const { body, split } = bodyFromFull(fullContent);
  const segments = parseBodyH2Segments(body);
  const idx = findSectionIndex(segments, heading);
  if (idx < 0) {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const seg = segments[idx];
  if (seg.kind !== "section") {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const appendLines = appendMarkdown.split(/\r?\n/);
  let bodyLines = [...seg.bodyLines];
  if (bodyLines.length > 0) {
    const last = bodyLines[bodyLines.length - 1];
    if (last !== "" && appendLines.length > 0 && appendLines[0] !== "") {
      bodyLines.push("");
    }
  }
  bodyLines = bodyLines.concat(appendLines);
  const next: BodyH2Segment = { ...seg, bodyLines };
  const out = [...segments.slice(0, idx), next, ...segments.slice(idx + 1)];
  return assembleFull(split, stringifyBodyH2Segments(out));
}

/** Remove an entire H2 section including its heading line. */
export function deleteAnchorSection(fullContent: string, heading: string): string {
  const { body, split } = bodyFromFull(fullContent);
  const segments = parseBodyH2Segments(body);
  const idx = findSectionIndex(segments, heading);
  if (idx < 0) {
    throw new Error(`No section matching heading: ${normalizeSectionTitle(heading)}`);
  }
  const out = segments.filter((_, i) => i !== idx);
  return assembleFull(split, stringifyBodyH2Segments(out));
}
