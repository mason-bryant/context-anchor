/**
 * Claim-level provenance annotations (Phase A of the claim-provenance design).
 *
 * A claim is a top-level bullet in a `## Current State`, `## Decisions`, or
 * `## Constraints` section. A claim may carry one provenance annotation:
 *
 *   - Owner resolution resolves a person before a team.
 *     {src: PR #39; observed: 2026-06-17; conf: high}
 *
 * The annotation is either a standalone indented line inside the bullet's
 * block (preferred) or a trailing `{...}` block on the bullet line itself.
 * Grammar: `{src: <source>; observed: <YYYY-MM-DD>; conf: high|medium|low[; id: <kebab-case>]}`
 * with order-insensitive keys. `src` values starting with `person:` record
 * told-by-a-person provenance and cap `conf` at `medium` (the conflicts-schema
 * semantics: `high` requires direct observation of an artifact).
 */

export const CLAIM_SECTIONS = ["Current State", "Decisions", "Constraints"] as const;

export const CLAIM_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export type ClaimConfidence = (typeof CLAIM_CONFIDENCE_VALUES)[number];

export type ClaimAnnotation = {
  src: string;
  observed: string;
  conf: ClaimConfidence;
  id?: string;
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
  annotation?: ClaimAnnotation;
  /** Parse errors when status is "malformed". */
  annotationErrors?: string[];
  /** 1-based line number of the annotation (standalone line or the bullet line for trailing form). */
  annotationLine?: number;
  /** True when the annotation is a trailing block on the bullet line itself. */
  annotationInline?: boolean;
};

const ANNOTATION_KEYS = new Set(["src", "observed", "conf", "id"]);
const OBSERVED_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STANDALONE_ANNOTATION_PATTERN = /^(\s+)\{([^{}]*)\}\s*$/;
const TRAILING_ANNOTATION_PATTERN = /^(- .*?)\s*\{([^{}]*)\}\s*$/;

export type AnnotationParseResult =
  | { ok: true; annotation: ClaimAnnotation }
  | { ok: false; errors: string[] };

/** True when a brace block's inner text is attempting the annotation grammar. */
export function looksLikeAnnotationBody(inner: string): boolean {
  return /(^|;)\s*(src|observed|conf)\s*:/.test(inner);
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
      errors.push(`Unknown annotation key "${key}" (allowed: src, observed, conf, id).`);
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

  if (!src) {
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
  if (src.startsWith("person:") && conf === "high") {
    errors.push(
      "Person-sourced claims cap at conf: medium; re-verify against an artifact and cite it as src to use high.",
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    annotation: { src, observed, conf: conf as ClaimConfidence, ...(id !== undefined ? { id } : {}) },
  };
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
  const parts = [`src: ${annotation.src}`, `observed: ${annotation.observed}`, `conf: ${annotation.conf}`];
  if (annotation.id) {
    parts.push(`id: ${annotation.id}`);
  }
  return `{${parts.join("; ")}}`;
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
    };

    const trailing = TRAILING_ANNOTATION_PATTERN.exec(line);
    if (trailing && looksLikeAnnotationBody(trailing[2])) {
      claim.text = trailing[1].slice(2).trim();
      applyParsedAnnotation(claim, trailing[2], index + 1, true);
    } else {
      const annotationIndex = findStandaloneAnnotationIndex(lines, index);
      if (annotationIndex !== undefined) {
        const standalone = STANDALONE_ANNOTATION_PATTERN.exec(lines[annotationIndex]);
        if (standalone) {
          applyParsedAnnotation(claim, standalone[2], annotationIndex + 1, false);
        }
      }
    }

    claims.push(claim);
  }

  return claims;
}

function isClaimSection(section: string): boolean {
  return (CLAIM_SECTIONS as readonly string[]).includes(section);
}

function applyParsedAnnotation(claim: AnchorClaim, inner: string, line: number, inline: boolean): void {
  const parsed = parseAnnotationBody(inner);
  claim.annotationLine = line;
  claim.annotationInline = inline;
  if (parsed.ok) {
    claim.status = "annotated";
    claim.annotation = parsed.annotation;
  } else {
    claim.status = "malformed";
    claim.annotationErrors = parsed.errors;
  }
}

/**
 * Find the standalone annotation line inside a bullet's block, scanning the
 * indented continuation lines that follow the bullet at lines[bulletIndex].
 */
function findStandaloneAnnotationIndex(lines: string[], bulletIndex: number): number | undefined {
  for (let index = bulletIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      return undefined;
    }
    if (!/^\s/.test(line)) {
      return undefined;
    }
    const standalone = STANDALONE_ANNOTATION_PATTERN.exec(line);
    if (standalone && looksLikeAnnotationBody(standalone[2])) {
      return index;
    }
  }
  return undefined;
}

export type CarryResult = {
  content: string;
  /** Annotations re-attached to byte-identical bullets that arrived unannotated. */
  carried: { text: string; annotation: ClaimAnnotation }[];
  /** Valid annotations whose claim text no longer exists in the new content. */
  lost: { text: string; annotation: ClaimAnnotation }[];
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
      claim.status === "annotated" && claim.annotation !== undefined,
  );
  if (oldAnnotated.length === 0) {
    return { content: newContent, carried: [], lost: [] };
  }

  const newClaims = extractClaims(newContent);
  const consumed = new Set<number>();
  const carried: CarryResult["carried"] = [];
  const lost: CarryResult["lost"] = [];
  const insertions: { afterLine: number; annotation: ClaimAnnotation }[] = [];

  for (const oldClaim of oldAnnotated) {
    // Pair duplicates in document order: first unconsumed new claim with the
    // same section kind and byte-identical text.
    const matchIndex = newClaims.findIndex(
      (candidate, index) =>
        !consumed.has(index) && candidate.section === oldClaim.section && candidate.text === oldClaim.text,
    );
    if (matchIndex === -1) {
      lost.push({ text: oldClaim.text, annotation: oldClaim.annotation });
      continue;
    }
    consumed.add(matchIndex);
    const match = newClaims[matchIndex];
    if (match.status !== "unannotated") {
      continue;
    }
    insertions.push({ afterLine: match.line, annotation: oldClaim.annotation });
    carried.push({ text: match.text, annotation: oldClaim.annotation });
  }

  if (insertions.length === 0) {
    return { content: newContent, carried, lost };
  }

  const lines = newContent.split(/\r?\n/);
  // Insert bottom-up so earlier insertions do not shift later line numbers.
  insertions
    .sort((left, right) => right.afterLine - left.afterLine)
    .forEach((insertion) => {
      lines.splice(insertion.afterLine, 0, `  ${formatAnnotationBody(insertion.annotation)}`);
    });

  return { content: lines.join("\n"), carried, lost };
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
  const location = locateClaim(content, match);
  if (!location.ok) {
    throw new Error(
      location.code === "claim_not_found"
        ? `No claim matching "${match}".`
        : `Claim match "${match}" is ambiguous (${location.candidates.length}+ matches).`,
    );
  }

  const claim = location.claim;
  const lines = content.split(/\r?\n/);
  const bulletIndex = claim.line - 1;

  if (claim.annotationLine !== undefined) {
    const annotationIndex = claim.annotationLine - 1;
    if (claim.annotationInline) {
      const trailing = TRAILING_ANNOTATION_PATTERN.exec(lines[annotationIndex]);
      if (trailing) {
        // Normalize trailing-form annotations to the standalone form on edit.
        lines[annotationIndex] = trailing[1];
        if (annotation !== null) {
          lines.splice(annotationIndex + 1, 0, `  ${formatAnnotationBody(annotation)}`);
        }
      }
    } else if (annotation === null) {
      lines.splice(annotationIndex, 1);
    } else {
      const indent = /^(\s*)/.exec(lines[annotationIndex])?.[1] ?? "  ";
      lines[annotationIndex] = `${indent}${formatAnnotationBody(annotation)}`;
    }
  } else if (annotation !== null) {
    lines.splice(bulletIndex + 1, 0, `  ${formatAnnotationBody(annotation)}`);
  }

  return lines.join("\n");
}
