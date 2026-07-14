/**
 * Claim-level provenance annotations (Phase A of the claim-provenance design).
 *
 * A claim is a top-level bullet in a `## Current State`, `## Decisions`, or
 * `## Constraints` section. A claim may carry one or more provenance sources:
 *
 *   - Owner resolution resolves a person before a team.
 *     {src: PR #39; observed: 2026-06-17; conf: high; id: c-7f3a9d}
 *     {src: src/people.ts; observed: 2026-06-18; conf: medium}
 *
 * A source is either a standalone indented line inside the bullet's block
 * (preferred) or a trailing `{...}` block on the bullet line itself.
 * Grammar: `{src: <source>; observed: <YYYY-MM-DD>; conf: high|medium|low[; kind: <source-kind>][; id: <opaque-id>]}`
 * Trust-me-bro sources use
 * `{src: trust me bro; kind: trust-me-bro; person: <person-id>; observed: <YYYY-MM-DD>; conf: high}`.
 * with order-insensitive keys. `src` values starting with `person:` record
 * told-by-a-person provenance and cap `conf` at `medium` (the conflicts-schema
 * semantics: `high` requires direct observation of an artifact or an explicit
 * trust-me-bro developer assertion).
 *
 * `id` is claim-level, not source-row-level (Work Package 1, claim knowledge
 * graph design part 3 "Stable claim ids"): a claim has at most one id, though
 * it may be written on any one of its source rows — the parser accepts it on
 * any row and marks the claim malformed (surfaced as `claim_annotation_invalid`
 * at the write-validator layer) if its rows carry two *different* ids. When
 * normalizing/serializing, the id is always emitted on the claim's first
 * annotation line.
 *
 * Every annotated claim gets an id; the server mints one at write time
 * (`mintClaimId`) for any annotated claim that lacks one, reported via a
 * `claim_id_minted` WARN (see `anchorService.ts`). Minted ids are opaque,
 * random, and match `^c-[a-z0-9]{6,8}$` (6 chars, grown to 8 on collision).
 * Grandfather clause: ids written before this format existed are plain
 * kebab-case slugs (e.g. `owner-resolution`) and remain valid, parseable ids
 * forever — `ID_PATTERN` accepts both shapes — but the server never *mints*
 * a kebab slug; only the `c-` form is newly minted.
 */

import { CLAIM_BEARING_SECTIONS } from "./anchorStructure.js";
import { mintPrefixedId } from "./ids.js";

export const CLAIM_SECTIONS = CLAIM_BEARING_SECTIONS;

export const CLAIM_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export type ClaimConfidence = (typeof CLAIM_CONFIDENCE_VALUES)[number];

export type ClaimSourceKind = string;

export const TRUST_ME_BRO_SOURCE = "trust me bro";
export const TRUST_ME_BRO_KIND: ClaimSourceKind = "trust-me-bro";

export type ClaimAnnotation = {
  src: string;
  observed: string;
  conf: ClaimConfidence;
  id?: string;
  kind?: ClaimSourceKind;
  person?: string;
  /**
   * Claim-to-claim edge target (WP5, claim knowledge graph design part 3
   * "Exactly two claim-to-claim edge types"): `<anchor>#<claim-id>`, or the
   * same-anchor shorthand `#<claim-id>`. One target per row; a claim cites
   * multiple `derived_from` targets by repeating the key across its stacked
   * source rows (mirrors how multiple `src` rows already stack).
   */
  derivedFrom?: string;
  /** Same shape and repeat-across-rows convention as `derivedFrom`. */
  contradicts?: string;
};

export type ClaimSource = ClaimAnnotation & {
  /** 1-based line number of this source annotation. */
  line?: number;
  /** True when the source is a trailing block on the claim bullet line itself. */
  inline?: boolean;
  /** Optional UI/API resolved href for this source. */
  href?: string;
  /** Optional UI/API resolved display name for person-backed sources. */
  personName?: string;
};

export type ClaimStatus = "annotated" | "unannotated" | "malformed";

export type AnchorClaim = {
  /** H2 section the claim lives in. */
  section: string;
  /** 1-based line number of the claim bullet in the document. */
  line: number;
  /** Bullet text without the leading `- ` or any trailing annotation block. */
  text: string;
  status: ClaimStatus;
  /**
   * Stable claim-level graph node id (opaque, server-minted for new ids;
   * legacy kebab-case ids are grandfathered). Present only when at least one
   * valid source row carries an `id`. Undefined for unannotated claims —
   * ids are never minted or attached to plain bullets.
   */
  id?: string;
  /** Valid provenance sources attached to this claim. */
  sources: ClaimSource[];
  /**
   * Every `derived_from` target across this claim's source rows, deduplicated,
   * in row order (WP5). Empty when the claim cites none. Lets callers (e.g.
   * `listClaims`'s "has contradictions"/"has derived_from" filters, the UI
   * neighbors panel) read edge targets off the claim without a second parse.
   */
  derivedFrom: string[];
  /** Every `contradicts` target across this claim's source rows, deduplicated, in row order (WP5). */
  contradicts: string[];
  /** Combined strength derived from valid sources. */
  strength: ClaimConfidence;
  /** Average numeric confidence score: low=1, medium=2, high=3. */
  strengthScore: number;
  /** Backward-compatible first valid source. */
  annotation?: ClaimAnnotation;
  /** Parse errors when status is "malformed". */
  annotationErrors?: string[];
  /** 1-based line number of the annotation (standalone line or the bullet line for trailing form). */
  annotationLine?: number;
  /** True when the annotation is a trailing block on the bullet line itself. */
  annotationInline?: boolean;
  sourceErrors?: { line: number; inline: boolean; errors: string[] }[];
};

export type InertClaimAnnotation = {
  /** Non-claim-bearing H2 section containing the bullet. */
  section: string;
  /** 1-based line number of the bullet the annotation appears to describe. */
  bulletLine: number;
  /** 1-based line numbers of every inline or standalone annotation attempt. */
  annotationLines: number[];
  /** Bullet text without the leading `- ` or a trailing annotation block. */
  text: string;
};

export type ClaimStrengthCounts = {
  high: number;
  medium: number;
  low: number;
};

export type ClaimProvenanceSummary = {
  totalClaims: number;
  annotatedClaims: number;
  unannotatedClaims: number;
  malformedClaims: number;
  sourceCount: number;
  claimStrengths: ClaimStrengthCounts;
  sourceStrengths: ClaimStrengthCounts;
  sourceKinds: Record<string, number>;
  oldestObserved?: string;
  newestObserved?: string;
};

const ANNOTATION_KEYS = new Set(["src", "observed", "conf", "id", "kind", "person", "derived_from", "contradicts"]);
const OBSERVED_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Any legacy kebab-case slug or a server-minted `c-xxxxxx[xx]` id (grandfather clause; see module docstring). */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Format the server mints: `c-` + 6 base36 chars, grown to 8 on collision. Never author-supplied by convention. */
const MINTED_ID_PATTERN = /^c-[a-z0-9]{6,8}$/;
const SOURCE_KIND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * `derived_from`/`contradicts` target format (WP5): `<anchor-path>#<claim-id>`
 * or the same-anchor shorthand `#<claim-id>`. The anchor part (when present)
 * is any non-empty string without `#`; the claim-id part must match the same
 * shape `ID_PATTERN` accepts (minted `c-xxxxxx` ids or legacy kebab slugs) so
 * a malformed id half is caught here rather than surfacing later as a dangling
 * reference. This checks FORMAT only — whether the target claim actually
 * exists is a tree-wide, write-path concern (`claim_edge_target_missing`
 * WARN), not something this parser can resolve.
 */
/** Format of a `derived_from`/`contradicts` target: `<anchor-path>#<claim-id>` (or same-anchor `#<claim-id>`). Exported so the graph extractor and the write-path validator classify targets identically to the parser (single source of truth). */
export const EDGE_TARGET_PATTERN = /^([^#]*)#([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const STANDALONE_ANNOTATION_PATTERN = /^(\s+)\{([^{}]*)\}\s*$/;
const TRAILING_ANNOTATION_PATTERN = /^(- .*?)\s*\{([^{}]*)\}\s*$/;

export type AnnotationParseResult =
  | { ok: true; annotation: ClaimAnnotation }
  | { ok: false; errors: string[] };

/** True when a brace block's inner text is attempting the annotation grammar. */
export function looksLikeAnnotationBody(inner: string): boolean {
  return /(^|;)\s*(src|observed|conf|kind|person|derived_from|contradicts)\s*:/.test(inner);
}

export function stripClaimAnnotations(content: string): string {
  const lines = content.split(/\r?\n/);
  const removeIndexes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("- ")) {
      continue;
    }

    const trailing = TRAILING_ANNOTATION_PATTERN.exec(line);
    if (trailing && looksLikeAnnotationBody(trailing[2])) {
      lines[index] = trailing[1];
    }
    for (const annotationIndex of findStandaloneAnnotationIndexes(lines, index)) {
      removeIndexes.add(annotationIndex);
    }
  }

  return lines.filter((_, index) => !removeIndexes.has(index)).join("\n");
}

export function parseAnnotationBody(inner: string): AnnotationParseResult {
  const errors: string[] = [];
  const fields = new Map<string, string>();

  for (const rawPart of inner.split(";")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const colon = part.indexOf(":");
    if (colon === -1) {
      errors.push(`Field "${part}" is missing a ':' separator.`);
      continue;
    }
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (!ANNOTATION_KEYS.has(key)) {
      errors.push(
        `Unknown annotation key "${key}" (allowed: src, observed, conf, id, kind, person, derived_from, contradicts).`,
      );
      continue;
    }
    if (fields.has(key)) {
      errors.push(`Duplicate annotation key "${key}".`);
      continue;
    }
    fields.set(key, value);
  }

  const src = fields.get("src") ?? "";
  const observed = fields.get("observed") ?? "";
  const conf = fields.get("conf") ?? "";
  const id = fields.get("id");
  const rawKind = fields.get("kind");
  const rawPerson = fields.get("person");
  const derivedFrom = fields.get("derived_from");
  const contradicts = fields.get("contradicts");
  const kind = normalizeClaimSourceKind(rawKind, src);

  if (rawKind !== undefined && kind === undefined) {
    errors.push(`kind must be a source type id like url, misc, design-doc, adr, or trust-me-bro, got "${rawKind}".`);
  }
  if (!src && kind !== TRUST_ME_BRO_KIND) {
    errors.push("Annotation requires a non-empty src (PR reference, file path, anchor name, URL, or person:<id>).");
  }
  if (!observed) {
    errors.push("Annotation requires an observed date (YYYY-MM-DD).");
  } else if (!isRealCalendarDate(observed)) {
    errors.push(`observed must be a valid YYYY-MM-DD date, got "${observed}".`);
  }
  if (!conf) {
    errors.push("Annotation requires conf (high, medium, or low).");
  } else if (!CLAIM_CONFIDENCE_VALUES.includes(conf as ClaimConfidence)) {
    errors.push(`conf must be high, medium, or low, got "${conf}".`);
  }
  if (id !== undefined && !ID_PATTERN.test(id)) {
    errors.push(`id must be kebab-case, got "${id}".`);
  }
  if (derivedFrom !== undefined && !EDGE_TARGET_PATTERN.test(derivedFrom)) {
    errors.push(
      `derived_from must be "<anchor>#<claim-id>" or the same-anchor shorthand "#<claim-id>", got "${derivedFrom}".`,
    );
  }
  if (contradicts !== undefined && !EDGE_TARGET_PATTERN.test(contradicts)) {
    errors.push(
      `contradicts must be "<anchor>#<claim-id>" or the same-anchor shorthand "#<claim-id>", got "${contradicts}".`,
    );
  }
  if (kind === TRUST_ME_BRO_KIND) {
    if (!rawPerson) {
      errors.push("trust-me-bro sources require a non-empty person field.");
    }
    if (conf && conf !== "high") {
      errors.push("trust-me-bro sources always use conf: high.");
    }
  }
  if (src.startsWith("person:") && conf === "high" && kind !== TRUST_ME_BRO_KIND) {
    errors.push(
      "Person-sourced claims cap at conf: medium; re-verify against an artifact and cite it as src to use high.",
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    annotation: {
      src: kind === TRUST_ME_BRO_KIND ? TRUST_ME_BRO_SOURCE : src,
      observed,
      conf: conf as ClaimConfidence,
      ...(id !== undefined ? { id } : {}),
      ...(kind && kind !== "evidence" ? { kind } : {}),
      ...(rawPerson ? { person: rawPerson } : {}),
      ...(derivedFrom !== undefined ? { derivedFrom } : {}),
      ...(contradicts !== undefined ? { contradicts } : {}),
    },
  };
}

function normalizeClaimSourceKind(rawKind: string | undefined, src: string): ClaimSourceKind | undefined {
  const value = (rawKind ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const source = src.trim().toLowerCase();
  if (!value) {
    return source === TRUST_ME_BRO_SOURCE ? TRUST_ME_BRO_KIND : undefined;
  }
  if (value === "source" || value === "evidence") {
    return "url";
  }
  if (value === TRUST_ME_BRO_KIND || value === TRUST_ME_BRO_SOURCE) {
    return TRUST_ME_BRO_KIND;
  }
  return SOURCE_KIND_PATTERN.test(value) ? value : undefined;
}

/** True only for dates that survive a round-trip, so overflow like 2026-02-30 is rejected. */
function isRealCalendarDate(value: string): boolean {
  if (!OBSERVED_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatAnnotationBody(annotation: ClaimAnnotation): string {
  const parts = [`src: ${annotation.src}`];
  if (annotation.kind) {
    parts.push(`kind: ${annotation.kind}`);
  }
  if (annotation.person) {
    parts.push(`person: ${annotation.person}`);
  }
  parts.push(`observed: ${annotation.observed}`, `conf: ${annotation.conf}`);
  if (annotation.id) {
    parts.push(`id: ${annotation.id}`);
  }
  if (annotation.derivedFrom) {
    parts.push(`derived_from: ${annotation.derivedFrom}`);
  }
  if (annotation.contradicts) {
    parts.push(`contradicts: ${annotation.contradicts}`);
  }
  return `{${parts.join("; ")}}`;
}

/**
 * Mint a new claim-level id: `c-` + 6 random base36 chars, grown to 8 chars
 * if that collides with `existing` (collision-checked against the full set
 * of ids already present in the tree, passed in by the caller). Opaque,
 * immutable once minted, and never content-derived (see module docstring).
 * Delegates to the shared `mintPrefixedId` (`src/ids.ts`, Goal 0 Phase 1 WP1)
 * so this algorithm and `mintAnchorId`'s stay byte-identical by construction.
 */
export function mintClaimId(existing: ReadonlySet<string>): string {
  return mintPrefixedId("c", existing);
}

/** Collect every id already present on a list of claims (annotated claims may have at most one each). */
export function collectClaimIds(claims: readonly AnchorClaim[]): Set<string> {
  const ids = new Set<string>();
  for (const claim of claims) {
    if (claim.id) {
      ids.add(claim.id);
    }
  }
  return ids;
}

/** True when `id` matches the server-minted format (`c-` + 6-8 base36 chars). */
export function isMintedClaimIdFormat(id: string): boolean {
  return MINTED_ID_PATTERN.test(id);
}

export function claimStrength(sources: readonly Pick<ClaimAnnotation, "conf">[]): ClaimConfidence {
  if (sources.length === 0) {
    return "low";
  }
  const average =
    sources.reduce((sum, source) => sum + confidenceScore(source.conf), 0) / sources.length;
  if (average < 1.5) {
    return "low";
  }
  if (average < 2.5) {
    return "medium";
  }
  return "high";
}

export function claimStrengthScore(sources: readonly Pick<ClaimAnnotation, "conf">[]): number {
  if (sources.length === 0) {
    return 1;
  }
  return sources.reduce((sum, source) => sum + confidenceScore(source.conf), 0) / sources.length;
}

export function summarizeClaimProvenance(claims: readonly AnchorClaim[]): ClaimProvenanceSummary {
  const summary: ClaimProvenanceSummary = {
    totalClaims: claims.length,
    annotatedClaims: 0,
    unannotatedClaims: 0,
    malformedClaims: 0,
    sourceCount: 0,
    claimStrengths: emptyStrengthCounts(),
    sourceStrengths: emptyStrengthCounts(),
    sourceKinds: {},
  };

  for (const claim of claims) {
    if (claim.status === "annotated") {
      summary.annotatedClaims += 1;
    } else if (claim.status === "unannotated") {
      summary.unannotatedClaims += 1;
    } else if (claim.status === "malformed") {
      summary.malformedClaims += 1;
    }
    summary.claimStrengths[claim.strength] += 1;

    for (const source of claim.sources) {
      summary.sourceCount += 1;
      summary.sourceStrengths[source.conf] += 1;
      const kind = sourceKindForSummary(source);
      summary.sourceKinds[kind] = (summary.sourceKinds[kind] ?? 0) + 1;
      if (!summary.oldestObserved || source.observed < summary.oldestObserved) {
        summary.oldestObserved = source.observed;
      }
      if (!summary.newestObserved || source.observed > summary.newestObserved) {
        summary.newestObserved = source.observed;
      }
    }
  }

  return summary;
}

export function mergeClaimProvenanceSummaries(summaries: readonly ClaimProvenanceSummary[]): ClaimProvenanceSummary {
  const merged: ClaimProvenanceSummary = {
    totalClaims: 0,
    annotatedClaims: 0,
    unannotatedClaims: 0,
    malformedClaims: 0,
    sourceCount: 0,
    claimStrengths: emptyStrengthCounts(),
    sourceStrengths: emptyStrengthCounts(),
    sourceKinds: {},
  };

  for (const summary of summaries) {
    merged.totalClaims += summary.totalClaims;
    merged.annotatedClaims += summary.annotatedClaims;
    merged.unannotatedClaims += summary.unannotatedClaims;
    merged.malformedClaims += summary.malformedClaims;
    merged.sourceCount += summary.sourceCount;
    mergeStrengthCounts(merged.claimStrengths, summary.claimStrengths);
    mergeStrengthCounts(merged.sourceStrengths, summary.sourceStrengths);
    for (const [kind, count] of Object.entries(summary.sourceKinds)) {
      merged.sourceKinds[kind] = (merged.sourceKinds[kind] ?? 0) + count;
    }
    if (summary.oldestObserved && (!merged.oldestObserved || summary.oldestObserved < merged.oldestObserved)) {
      merged.oldestObserved = summary.oldestObserved;
    }
    if (summary.newestObserved && (!merged.newestObserved || summary.newestObserved > merged.newestObserved)) {
      merged.newestObserved = summary.newestObserved;
    }
  }

  return merged;
}

function emptyStrengthCounts(): ClaimStrengthCounts {
  return { high: 0, medium: 0, low: 0 };
}

function mergeStrengthCounts(target: ClaimStrengthCounts, source: ClaimStrengthCounts): void {
  target.high += source.high;
  target.medium += source.medium;
  target.low += source.low;
}

function sourceKindForSummary(source: Pick<ClaimAnnotation, "kind" | "src">): string {
  if (source.kind) {
    return source.kind;
  }
  return source.src.trim().toLowerCase() === TRUST_ME_BRO_SOURCE ? TRUST_ME_BRO_KIND : "url";
}

function confidenceScore(conf: ClaimConfidence): number {
  return conf === "high" ? 3 : conf === "medium" ? 2 : 1;
}

type LineScanState = {
  inFence: boolean;
  section: string | undefined;
};

function advanceScanState(state: LineScanState, line: string): void {
  if (/^\s*(```|~~~)/.test(line)) {
    state.inFence = !state.inFence;
    return;
  }
  if (state.inFence) {
    return;
  }
  const heading = /^##\s+(.+?)\s*$/.exec(line);
  if (heading) {
    state.section = heading[1];
  } else if (/^#\s/.test(line)) {
    state.section = undefined;
  }
}

/** Extract claims (top-level bullets in claim sections) with their annotations. */
export function extractClaims(content: string): AnchorClaim[] {
  const lines = content.split(/\r?\n/);
  const claims: AnchorClaim[] = [];
  const state: LineScanState = { inFence: false, section: undefined };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    advanceScanState(state, line);
    if (state.inFence || !state.section || !isClaimSection(state.section)) {
      continue;
    }
    if (!line.startsWith("- ")) {
      continue;
    }

    const claim: AnchorClaim = {
      section: state.section,
      line: index + 1,
      text: line.slice(2).trim(),
      status: "unannotated",
      sources: [],
      derivedFrom: [],
      contradicts: [],
      strength: "low",
      strengthScore: 1,
    };

    const trailing = TRAILING_ANNOTATION_PATTERN.exec(line);
    if (trailing && looksLikeAnnotationBody(trailing[2])) {
      claim.text = trailing[1].slice(2).trim();
      applyParsedAnnotation(claim, trailing[2], index + 1, true);
    }
    for (const annotationIndex of findStandaloneAnnotationIndexes(lines, index)) {
      const standalone = STANDALONE_ANNOTATION_PATTERN.exec(lines[annotationIndex]);
      if (standalone) {
        applyParsedAnnotation(claim, standalone[2], annotationIndex + 1, false);
      }
    }
    finalizeClaim(claim);

    claims.push(claim);
  }

  return claims;
}

/**
 * Find claim-shaped annotations that cannot create claims because their
 * bullets live under a non-claim-bearing H2 section. These annotations would
 * otherwise be inert: `extractClaims` deliberately ignores the bullet before
 * parsing or validating its provenance rows.
 */
export function findInertClaimAnnotations(content: string): InertClaimAnnotation[] {
  const lines = content.split(/\r?\n/);
  const results: InertClaimAnnotation[] = [];
  const state: LineScanState = { inFence: false, section: undefined };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    advanceScanState(state, line);
    if (state.inFence || !state.section || isClaimSection(state.section) || !line.startsWith("- ")) {
      continue;
    }

    const annotationLines: number[] = [];
    let text = line.slice(2).trim();
    const trailing = TRAILING_ANNOTATION_PATTERN.exec(line);
    if (trailing && looksLikeAnnotationBody(trailing[2])) {
      annotationLines.push(index + 1);
      text = trailing[1].slice(2).trim();
    }
    for (const annotationIndex of findStandaloneAnnotationIndexes(lines, index)) {
      annotationLines.push(annotationIndex + 1);
    }
    if (annotationLines.length > 0) {
      results.push({
        section: state.section,
        bulletLine: index + 1,
        annotationLines,
        text,
      });
    }
  }

  return results;
}

function isClaimSection(section: string): boolean {
  return (CLAIM_SECTIONS as readonly string[]).includes(section);
}

function applyParsedAnnotation(claim: AnchorClaim, inner: string, line: number, inline: boolean): void {
  const parsed = parseAnnotationBody(inner);
  if (claim.annotationLine === undefined) {
    claim.annotationLine = line;
    claim.annotationInline = inline;
  }
  if (parsed.ok) {
    const source: ClaimSource = { ...parsed.annotation, line, inline };
    claim.sources.push(source);
    claim.annotation ??= parsed.annotation;
  } else {
    claim.sourceErrors ??= [];
    claim.sourceErrors.push({ line, inline, errors: parsed.errors });
  }
}

function finalizeClaim(claim: AnchorClaim): void {
  claim.strength = claimStrength(claim.sources);
  claim.strengthScore = claimStrengthScore(claim.sources);

  // Claim-to-claim edge targets (WP5): collect every `derived_from` /
  // `contradicts` value across the claim's source rows, deduplicated, in row
  // order. Unlike `id` (one value, conflict on mismatch), these are
  // deliberately repeatable — a claim may derive from or contradict several
  // targets by stacking the key across rows.
  claim.derivedFrom = dedupeInOrder(claim.sources.map((source) => source.derivedFrom).filter(isDefined));
  claim.contradicts = dedupeInOrder(claim.sources.map((source) => source.contradicts).filter(isDefined));

  // `id` is claim-level (WP1): accept it on any source row, but two rows of
  // the same claim carrying *different* ids is a malformed annotation.
  const idConflict = claimLevelId(claim);
  if (idConflict.ok) {
    claim.id = idConflict.id;
  } else {
    claim.sourceErrors ??= [];
    claim.sourceErrors.push({
      line: claim.annotationLine ?? claim.line,
      inline: claim.annotationInline ?? false,
      errors: [idConflict.error],
    });
  }

  if (claim.sourceErrors && claim.sourceErrors.length > 0) {
    claim.status = "malformed";
    claim.annotationErrors = claim.sourceErrors.flatMap((entry) =>
      entry.errors.map((error) => `Line ${entry.line}: ${error}`),
    );
  } else if (claim.sources.length > 0) {
    claim.status = "annotated";
  } else {
    claim.status = "unannotated";
  }
}

/** Resolve the single id shared across a claim's source rows, or report a conflict. */
function claimLevelId(claim: AnchorClaim): { ok: true; id: string | undefined } | { ok: false; error: string } {
  const ids = new Set(claim.sources.map((source) => source.id).filter((id): id is string => Boolean(id)));
  if (ids.size <= 1) {
    return { ok: true, id: [...ids][0] };
  }
  return {
    ok: false,
    error: `Claim "${truncateForError(claim.text)}" has conflicting ids across its source rows: ${[...ids].join(", ")}. A claim has exactly one id; put it on a single row.`,
  };
}

function truncateForError(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function dedupeInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * Find the standalone annotation line inside a bullet's block, scanning the
 * indented continuation lines that follow the bullet at lines[bulletIndex].
 */
function findStandaloneAnnotationIndexes(lines: string[], bulletIndex: number): number[] {
  const indexes: number[] = [];
  let fence: { char: "`" | "~"; len: number } | undefined;
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      return indexes;
    }
    if (!/^\s/.test(line)) {
      return indexes;
    }
    const fenceMarker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMarker) {
      const marker = fenceMarker[1];
      const char = marker[0] as "`" | "~";
      if (!fence) {
        fence = { char, len: marker.length };
        continue;
      }
      if (char === fence.char && marker.length >= fence.len && !fenceMarker[2].trim()) {
        fence = undefined;
      }
      continue;
    }
    if (fence) {
      continue;
    }
    const standalone = STANDALONE_ANNOTATION_PATTERN.exec(line);
    if (standalone && looksLikeAnnotationBody(standalone[2])) {
      indexes.push(index);
    }
  }
  return indexes;
}

export type CarryResult = {
  content: string;
  /** Annotations re-attached to byte-identical bullets that arrived unannotated. */
  carried: { text: string; annotation: ClaimAnnotation; sources: ClaimAnnotation[] }[];
  /** Valid annotations whose claim text no longer exists in the new content. */
  lost: { text: string; annotation: ClaimAnnotation; sources: ClaimAnnotation[] }[];
};

/**
 * Carry valid annotations from oldContent onto newContent claims whose bullet
 * text is byte-identical and unannotated (the "agent rewrote the section and
 * regenerated the bullets" case). Annotations whose claim text disappeared or
 * was reworded are reported as lost so the caller can gate the write.
 *
 * A new claim that already carries its own (valid or malformed) annotation is
 * never touched: the writer supplied provenance deliberately. Malformed old
 * annotations are neither carried nor protected — dropping them is cleanup.
 *
 * One exception (WP1 carry-by-id): a claim that kept its id but was reworded
 * has its source rows refreshed from the old set, since a text-only edit can
 * leave stale placeholder rows behind the correct id. A reworded claim whose
 * new annotation is malformed is still left untouched, so the malformed error
 * surfaces instead of being masked.
 */
export function carryClaimAnnotations(oldContent: string, newContent: string): CarryResult {
  const oldAnnotated = extractClaims(oldContent).filter(
    (claim): claim is AnchorClaim & { annotation: ClaimAnnotation } =>
      claim.sources.length > 0 && claim.annotation !== undefined,
  );
  if (oldAnnotated.length === 0) {
    return { content: newContent, carried: [], lost: [] };
  }

  const newClaims = extractClaims(newContent);
  const consumed = new Set<number>();
  const carried: CarryResult["carried"] = [];
  const lost: CarryResult["lost"] = [];
  const insertions: { afterLine: number; sources: ClaimAnnotation[] }[] = [];
  // Reworded-but-kept-id claims: replace by id (not line — insertions run
  // first and can shift line numbers) against the post-insertion content.
  const replacementsById: { id: string; sources: ClaimAnnotation[] }[] = [];

  for (const oldClaim of oldAnnotated) {
    const oldSources = oldClaim.sources.map(sourceToAnnotation);

    // Id match wins over text match (WP1 carry-by-id): a reworded claim that
    // kept its id never loses provenance, even though the bullet text no
    // longer matches byte-for-byte. Only unconsumed new claims are eligible.
    const idMatchIndex = oldClaim.id
      ? newClaims.findIndex((candidate, index) => !consumed.has(index) && candidate.id === oldClaim.id)
      : -1;
    if (idMatchIndex !== -1) {
      consumed.add(idMatchIndex);
      const match = newClaims[idMatchIndex];
      if (match.text !== oldClaim.text && match.status !== "malformed") {
        // Reworded-but-kept-id: replace whatever annotation rows are on the
        // new claim with the full old source set (the id is already correct
        // on the new claim, but other fields like src/observed/conf may be
        // stale placeholders from a text-only edit).
        replacementsById.push({ id: oldClaim.id as string, sources: oldSources });
        carried.push({ text: match.text, annotation: oldClaim.annotation, sources: oldSources });
      }
      // Byte-identical text needs no action (the claim's own annotation carried
      // with it), and a malformed new annotation is left untouched so its error
      // surfaces (claim_annotation_invalid) rather than being silently
      // overwritten by the old sources.
      continue;
    }

    // Pair duplicates in document order: first unconsumed new claim with the
    // same section kind and byte-identical text.
    const matchIndex = newClaims.findIndex(
      (candidate, index) =>
        !consumed.has(index) && candidate.section === oldClaim.section && candidate.text === oldClaim.text,
    );
    if (matchIndex === -1) {
      lost.push({ text: oldClaim.text, annotation: oldClaim.annotation, sources: oldSources });
      continue;
    }
    consumed.add(matchIndex);
    const match = newClaims[matchIndex];
    if (match.status !== "unannotated") {
      continue;
    }
    insertions.push({ afterLine: match.line, sources: oldSources });
    carried.push({ text: match.text, annotation: oldClaim.annotation, sources: oldSources });
  }

  if (insertions.length === 0 && replacementsById.length === 0) {
    return { content: newContent, carried, lost };
  }

  let content = newContent;
  if (insertions.length > 0) {
    const lines = content.split(/\r?\n/);
    // Insert bottom-up so earlier insertions do not shift later line numbers.
    insertions
      .sort((left, right) => right.afterLine - left.afterLine)
      .forEach((insertion) => {
        lines.splice(
          insertion.afterLine,
          0,
          ...insertion.sources.map((annotation) => `  ${formatAnnotationBody(annotation)}`),
        );
      });
    content = lines.join("\n");
  }

  for (const replacement of replacementsById) {
    const target = extractClaims(content).find((claim) => claim.id === replacement.id);
    if (!target) {
      continue;
    }
    content = upsertClaimSources(content, { line: target.line }, replacement.sources);
  }

  return { content, carried, lost };
}

function sourceToAnnotation(source: ClaimSource): ClaimAnnotation {
  return {
    src: source.src,
    observed: source.observed,
    conf: source.conf,
    ...(source.id ? { id: source.id } : {}),
    ...(source.kind ? { kind: source.kind } : {}),
    ...(source.person ? { person: source.person } : {}),
    ...(source.derivedFrom ? { derivedFrom: source.derivedFrom } : {}),
    ...(source.contradicts ? { contradicts: source.contradicts } : {}),
  };
}

/**
 * Claims that this write introduces without provenance: unannotated claims in
 * newContent whose section+text did not exist in oldContent. Pre-existing
 * unannotated claims are not reported, so touching an anchor does not nag
 * about legacy backlog; only the writer's own new statements are flagged.
 */
export function newlyAddedUnannotatedClaims(
  oldContent: string | undefined,
  newContent: string,
): AnchorClaim[] {
  const existing = new Set<string>();
  if (oldContent !== undefined) {
    for (const claim of extractClaims(oldContent)) {
      existing.add(claim.text);
    }
  }
  return extractClaims(newContent).filter(
    (claim) => claim.status === "unannotated" && !existing.has(claim.text),
  );
}

export type MintedClaimId = { text: string; id: string };

export type MintClaimIdsResult = {
  content: string;
  /** Every claim that received a freshly minted id, for the `claim_id_minted` WARN. */
  minted: MintedClaimId[];
};

/**
 * Mint a stable id for every annotated claim in `content` that lacks one
 * (WP1 write pipeline). `existingIds` should contain every id already present
 * elsewhere in the tree so minted ids are tree-unique. Ids already present in
 * `content` itself (a legacy/manual id on another claim in the same document)
 * are also folded into the uniqueness set, so a freshly minted id never
 * collides with an id already in this document. Never touches unannotated or
 * malformed claims — an id is added only where valid provenance exists.
 */
export function mintMissingClaimIds(content: string, existingIds: ReadonlySet<string>): MintClaimIdsResult {
  const claims = extractClaims(content);
  const candidates = claims.filter((claim) => claim.status === "annotated" && !claim.id);
  if (candidates.length === 0) {
    return { content, minted: [] };
  }

  // Seed with tree ids AND the ids already present in this document, so a
  // mint can never collide with a legacy/manual id on a sibling claim here.
  const usedIds = new Set(existingIds);
  for (const id of collectClaimIds(claims)) {
    usedIds.add(id);
  }
  const minted: MintedClaimId[] = [];
  let updated = content;

  // Mint bottom-up (highest line first) via line-targeted upsert so each
  // mutation's line numbers stay valid for the next.
  for (const claim of [...candidates].sort((left, right) => right.line - left.line)) {
    const id = mintClaimId(usedIds);
    usedIds.add(id);
    // Candidates are filtered to `!claim.id` above, so no row carries an
    // existing id to strip; sourceToAnnotation carries every other field
    // (including derivedFrom/contradicts, WP5) through unmolested.
    const sources: ClaimAnnotation[] = claim.sources.map(sourceToAnnotation);
    if (sources.length > 0) {
      sources[0] = { ...sources[0], id };
    }
    updated = upsertClaimSources(updated, { line: claim.line }, sources);
    minted.push({ text: claim.text, id });
  }

  return { content: updated, minted: minted.reverse() };
}

export type ClaimLocation =
  | { ok: true; claim: AnchorClaim }
  | { ok: false; code: "claim_not_found" | "claim_ambiguous"; candidates: string[] };

/** Locate a unique claim by case-insensitive substring match against claim text. */
export function locateClaim(content: string, match: string): ClaimLocation {
  const needle = match.trim().toLowerCase();
  const claims = extractClaims(content);
  const hits = claims.filter((claim) => claim.text.toLowerCase().includes(needle));
  if (hits.length === 1) {
    return { ok: true, claim: hits[0] };
  }
  if (hits.length === 0) {
    return { ok: false, code: "claim_not_found", candidates: [] };
  }
  return {
    ok: false,
    code: "claim_ambiguous",
    candidates: hits.map((claim) => claim.text).slice(0, 10),
  };
}

/** Locate a claim by its current 1-based bullet line. */
export function locateClaimByLine(content: string, line: number): ClaimLocation {
  const claims = extractClaims(content);
  const hit = claims.find((claim) => claim.line === line);
  if (hit) {
    return { ok: true, claim: hit };
  }
  return { ok: false, code: "claim_not_found", candidates: [] };
}

/**
 * Insert, replace, or clear a claim's annotation. The claim is located by
 * unique substring match; the caller is expected to have pre-checked with
 * locateClaim for typed error handling.
 */
export function upsertClaimAnnotation(
  content: string,
  match: string,
  annotation: ClaimAnnotation | null,
): string {
  return upsertClaimSources(content, { claim: match }, annotation === null ? [] : [annotation]);
}

export type ClaimTarget = { claim: string } | { line: number };

function claimLocationForTarget(content: string, target: ClaimTarget): AnchorClaim {
  const location = "line" in target ? locateClaimByLine(content, target.line) : locateClaim(content, target.claim);
  if (!location.ok) {
    const targetLabel = "line" in target ? `line ${target.line}` : `"${target.claim}"`;
    throw new Error(
      location.code === "claim_not_found"
        ? `No claim matching ${targetLabel}.`
        : `Claim match ${targetLabel} is ambiguous (${location.candidates.length}+ matches).`,
    );
  }
  return location.claim;
}

function claimBlockEndIndex(lines: string[], bulletIndex: number): number {
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || !/^\s/.test(line)) {
      return index;
    }
  }
  return lines.length;
}

export function replaceClaimText(content: string, target: ClaimTarget, text: string): string {
  const claim = claimLocationForTarget(content, target);
  const lines = content.split(/\r?\n/);
  const bulletIndex = claim.line - 1;
  if (claim.annotationInline) {
    const trailing = TRAILING_ANNOTATION_PATTERN.exec(lines[bulletIndex]);
    if (trailing && looksLikeAnnotationBody(trailing[2])) {
      lines[bulletIndex] = `- ${text} {${trailing[2]}}`;
      return lines.join("\n");
    }
  }
  lines[bulletIndex] = `- ${text}`;
  return lines.join("\n");
}

export function deleteClaim(content: string, target: ClaimTarget): string {
  const claim = claimLocationForTarget(content, target);
  const lines = content.split(/\r?\n/);
  const bulletIndex = claim.line - 1;
  lines.splice(bulletIndex, claimBlockEndIndex(lines, bulletIndex) - bulletIndex);
  return lines.join("\n");
}

export function upsertClaimSources(
  content: string,
  target: ClaimTarget,
  sources: ClaimAnnotation[],
): string {
  const claim = claimLocationForTarget(content, target);
  const lines = content.split(/\r?\n/);
  const bulletIndex = claim.line - 1;

  if (claim.annotationInline) {
    const trailing = TRAILING_ANNOTATION_PATTERN.exec(lines[bulletIndex]);
    if (trailing) {
      lines[bulletIndex] = trailing[1];
    }
  }

  const standaloneLines = [
    ...claim.sources.filter((source) => !source.inline && source.line !== undefined).map((source) => source.line as number),
    ...(claim.sourceErrors ?? []).filter((entry) => !entry.inline).map((entry) => entry.line),
  ];
  [...new Set(standaloneLines)]
    .sort((left, right) => right - left)
    .forEach((line) => {
      lines.splice(line - 1, 1);
    });

  if (sources.length > 0) {
    lines.splice(bulletIndex + 1, 0, ...normalizeIdPlacement(sources).map((source) => `  ${formatAnnotationBody(source)}`));
  }

  return lines.join("\n");
}

/**
 * Claim-level ids live on the first source row when serialized (WP1): move the
 * single id to the first row, stripping it from the rest, so multi-row writes
 * never accidentally scatter or duplicate the id.
 *
 * Guard: if callers supply *more than one distinct* id across a claim's rows
 * (possible via setClaimSources / tool input), do NOT collapse them — write
 * the rows through unchanged so the parser flags the claim malformed
 * ("conflicting ids across its source rows"), per the WP1 spec. Silently
 * picking one would hide an authoring error the writer needs to see.
 */
function normalizeIdPlacement(sources: readonly ClaimAnnotation[]): ClaimAnnotation[] {
  const distinctIds = new Set(sources.map((source) => source.id).filter((value): value is string => Boolean(value)));
  if (distinctIds.size > 1) {
    return [...sources];
  }
  const id = [...distinctIds][0];
  if (!id || sources.length === 0) {
    return [...sources];
  }
  return sources.map((source, index) => {
    const { id: _drop, ...rest } = source;
    return index === 0 ? { ...rest, id } : rest;
  });
}
