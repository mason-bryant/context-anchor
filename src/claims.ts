/**
 * Claim-level provenance annotations (Phase A of the claim-provenance design).
 *
 * A claim is a top-level bullet in a `## Current State`, `## Decisions`, or
 * `## Constraints` section. A claim may carry one or more provenance sources:
 *
 *   - Owner resolution resolves a person before a team.
 *     {src: PR #39; observed: 2026-06-17; conf: high}
 *     {src: src/people.ts; observed: 2026-06-18; conf: medium}
 *
 * A source is either a standalone indented line inside the bullet's block
 * (preferred) or a trailing `{...}` block on the bullet line itself.
 * Grammar: `{src: <source>; observed: <YYYY-MM-DD>; conf: high|medium|low[; kind: <source-kind>][; id: <kebab-case>]}`
 * Trust-me-bro sources use
 * `{src: trust me bro; kind: trust-me-bro; person: <person-id>; observed: <YYYY-MM-DD>; conf: high}`.
 * with order-insensitive keys. `src` values starting with `person:` record
 * told-by-a-person provenance and cap `conf` at `medium` (the conflicts-schema
 * semantics: `high` requires direct observation of an artifact or an explicit
 * trust-me-bro developer assertion).
 */

export const CLAIM_SECTIONS = ["Current State", "Decisions", "Constraints"] as const;

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
  /** Valid provenance sources attached to this claim. */
  sources: ClaimSource[];
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

const ANNOTATION_KEYS = new Set(["src", "observed", "conf", "id", "kind", "person"]);
const OBSERVED_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_KIND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STANDALONE_ANNOTATION_PATTERN = /^(\s+)\{([^{}]*)\}\s*$/;
const TRAILING_ANNOTATION_PATTERN = /^(- .*?)\s*\{([^{}]*)\}\s*$/;

export type AnnotationParseResult =
  | { ok: true; annotation: ClaimAnnotation }
  | { ok: false; errors: string[] };

/** True when a brace block's inner text is attempting the annotation grammar. */
export function looksLikeAnnotationBody(inner: string): boolean {
  return /(^|;)\s*(src|observed|conf|kind|person)\s*:/.test(inner);
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
      errors.push(`Unknown annotation key "${key}" (allowed: src, observed, conf, id, kind, person).`);
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
  return `{${parts.join("; ")}}`;
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

/**
 * Find the standalone annotation line inside a bullet's block, scanning the
 * indented continuation lines that follow the bullet at lines[bulletIndex].
 */
function findStandaloneAnnotationIndexes(lines: string[], bulletIndex: number): number[] {
  const indexes: number[] = [];
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
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

  for (const oldClaim of oldAnnotated) {
    // Pair duplicates in document order: first unconsumed new claim with the
    // same section kind and byte-identical text.
    const matchIndex = newClaims.findIndex(
      (candidate, index) =>
        !consumed.has(index) && candidate.section === oldClaim.section && candidate.text === oldClaim.text,
    );
    const oldSources = oldClaim.sources.map(sourceToAnnotation);
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

  if (insertions.length === 0) {
    return { content: newContent, carried, lost };
  }

  const lines = newContent.split(/\r?\n/);
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

  return { content: lines.join("\n"), carried, lost };
}

function sourceToAnnotation(source: ClaimSource): ClaimAnnotation {
  return {
    src: source.src,
    observed: source.observed,
    conf: source.conf,
    ...(source.id ? { id: source.id } : {}),
    ...(source.kind ? { kind: source.kind } : {}),
    ...(source.person ? { person: source.person } : {}),
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
    lines.splice(bulletIndex + 1, 0, ...sources.map((source) => `  ${formatAnnotationBody(source)}`));
  }

  return lines.join("\n");
}
