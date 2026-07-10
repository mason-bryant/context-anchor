import { extractClaims } from "../claims.js";
import { parseClaimSource, type ParseClaimSourceContext } from "../graph/sourceId.js";
import { extractH2Sections } from "../storage/markdown.js";
import type { ProjectMappings, ValidationViolation } from "../types.js";
import type { ValidationContext, Validator } from "./types.js";
import { violation } from "./types.js";

const EMPTY_MAPPINGS: ProjectMappings = { projects: [], claimSourceTypes: [] };

/**
 * Warn (never block — dangling provenance refs are always a WARN, per the
 * design's "warn, never block" rule) when a claim's section-reference `src`
 * (`<anchor>#<heading>` or same-anchor `#<heading>`) points at an anchor or
 * heading that does not exist. Classification funnels entirely through
 * `parseClaimSource` (`src/graph/sourceId.ts`) — this validator supplies the
 * anchor-resolution and section-title lookups, it does not re-parse `src`
 * strings itself.
 */
export const validateClaimSourceSections: Validator = async (
  context: ValidationContext,
): Promise<ValidationViolation[]> => {
  const claims = extractClaims(context.newContent).filter((claim) => claim.sources.length > 0);
  if (claims.length === 0) {
    return [];
  }

  const anchorMetas = await context.repo.listAnchors();
  const anchorNames = new Set(anchorMetas.map((meta) => meta.name));
  // A new anchor being written for the first time is not in listAnchors yet;
  // same-anchor shorthand must still resolve against it.
  anchorNames.add(context.name);

  const resolveAnchorName = (value: string): string | undefined => {
    try {
      const resolved = context.repo.resolveAnchor(value).name;
      return anchorNames.has(resolved) ? resolved : undefined;
    } catch {
      return undefined;
    }
  };

  // parseClaimSource needs section titles synchronously, so resolve every
  // section-reference row's target anchor first and pre-fetch its H2 titles.
  // Collect the unique targets, then read them in parallel — a write with many
  // section references across many anchors should not pay one sequential
  // readRaw round-trip per anchor.
  const sectionTitlesByAnchor = new Map<string, ReadonlySet<string>>();
  const targetAnchors = new Set<string>();
  for (const source of claims.flatMap((claim) => claim.sources)) {
    const targetAnchor = sectionReferenceTargetAnchor(source.src, context.name, resolveAnchorName);
    if (targetAnchor) {
      targetAnchors.add(targetAnchor);
    }
  }
  await Promise.all(
    [...targetAnchors].map(async (targetAnchor) => {
      const content =
        targetAnchor === context.name ? context.newContent : await context.repo.readRaw(targetAnchor);
      sectionTitlesByAnchor.set(
        targetAnchor,
        new Set(content !== undefined ? extractH2Sections(content).keys() : []),
      );
    }),
  );

  const ctx: ParseClaimSourceContext = {
    anchorName: context.name,
    anchorNames,
    resolveAnchorName,
    getAnchorSectionTitles: (resolvedAnchorName: string) => sectionTitlesByAnchor.get(resolvedAnchorName),
    mappings: EMPTY_MAPPINGS,
    resolvePersonId: () => undefined,
  };

  const results: ValidationViolation[] = [];
  for (const claim of claims) {
    for (const source of claim.sources) {
      const parsed = parseClaimSource(source, ctx);
      if (parsed.warning) {
        results.push(
          violation(
            "WARN",
            parsed.warning.code,
            `Claim "${truncate(claim.text)}": ${parsed.warning.message}`,
            context.path,
          ),
        );
      }
    }
  }

  return results;
};

/**
 * Best-effort detection of "this src is a section reference naming this
 * anchor", used only to decide which anchors' section titles to pre-fetch.
 * Mirrors (loosely) the shape `parseClaimSource`'s internal section-reference
 * matcher accepts; a false positive here just pre-fetches an unused section
 * list, so it does not need to be exact.
 */
function sectionReferenceTargetAnchor(
  src: string,
  ownerAnchorName: string,
  resolveAnchorName: (value: string) => string | undefined,
): string | undefined {
  const trimmed = src.trim();
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex === -1) {
    return undefined;
  }
  const left = trimmed.slice(0, hashIndex).trim();
  const right = trimmed.slice(hashIndex + 1).trim();
  if (/^L\d+$/i.test(right) || /^PR\s*#?\d+$/i.test(trimmed)) {
    return undefined;
  }
  if (left === "") {
    return resolveAnchorName(ownerAnchorName) ?? ownerAnchorName;
  }
  return resolveAnchorName(left);
}

function truncate(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
