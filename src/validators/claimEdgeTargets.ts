import { collectClaimIds, extractClaims } from "../claims.js";
import type { ValidationViolation } from "../types.js";
import type { ValidationContext, Validator } from "./types.js";
import { violation } from "./types.js";

/**
 * Warn (never block — dangling edge targets are always a WARN, per the
 * design's "warn, never block" rule, same split `claimSourceSections.ts`
 * uses) when a claim's `derived_from`/`contradicts` target — a well-formed
 * `<anchor>#<claim-id>` or same-anchor `#<claim-id>` reference (malformed
 * shapes are already blocked by `validateClaimAnnotations` via
 * `parseAnnotationBody`'s `EDGE_TARGET_PATTERN` check) — points at a claim id
 * that does not exist anywhere in the tree.
 *
 * This is a separate validator from `claimAnnotations.ts` (which only checks
 * per-row FORMAT, no tree access) because resolving "does this claim id
 * exist" needs the same anchor/claim tree walk `claimSourceSections.ts`
 * already does for section references.
 */
export const validateClaimEdgeTargets: Validator = async (
  context: ValidationContext,
): Promise<ValidationViolation[]> => {
  const claims = extractClaims(context.newContent).filter(
    (claim) => claim.derivedFrom.length > 0 || claim.contradicts.length > 0,
  );
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

  const targets = claims.flatMap((claim) =>
    [...claim.derivedFrom, ...claim.contradicts].map((target) => ({ claim, target })),
  );

  // Resolve each target's anchor side once, then read that anchor's claim ids
  // (in parallel, one read per distinct target anchor) rather than once per
  // edge — a claim citing several targets in the same anchor should not pay
  // repeated reads.
  const anchorForTarget = new Map<string, string | undefined>();
  const idsByAnchor = new Map<string, ReadonlySet<string>>();
  const targetAnchors = new Set<string>();

  for (const { target } of targets) {
    if (anchorForTarget.has(target)) {
      continue;
    }
    const parsed = parseEdgeTarget(target);
    if (!parsed) {
      // Should not happen: parseAnnotationBody already blocks malformed
      // target shapes, so a claim never carries one here. Defensive no-op.
      anchorForTarget.set(target, undefined);
      continue;
    }
    const anchorPart = parsed.anchor.trim();
    const resolved = anchorPart === "" ? resolveAnchorName(context.name) : resolveAnchorName(anchorPart);
    anchorForTarget.set(target, resolved);
    if (resolved) {
      targetAnchors.add(resolved);
    }
  }

  await Promise.all(
    [...targetAnchors].map(async (targetAnchor) => {
      const content = targetAnchor === context.name ? context.newContent : await context.repo.readRaw(targetAnchor);
      idsByAnchor.set(targetAnchor, content !== undefined ? collectClaimIds(extractClaims(content)) : new Set());
    }),
  );

  const results: ValidationViolation[] = [];
  for (const { claim, target } of targets) {
    const parsed = parseEdgeTarget(target);
    if (!parsed) {
      continue;
    }
    const resolvedAnchor = anchorForTarget.get(target);
    if (!resolvedAnchor) {
      results.push(
        violation(
          "WARN",
          "claim_edge_target_missing",
          `Claim "${truncate(claim.text)}": edge target "${target}" points at an anchor that does not exist.`,
          context.path,
        ),
      );
      continue;
    }
    const ids = idsByAnchor.get(resolvedAnchor);
    if (!ids?.has(parsed.claimId)) {
      results.push(
        violation(
          "WARN",
          "claim_edge_target_missing",
          `Claim "${truncate(claim.text)}": edge target "${target}" points at claim id "${parsed.claimId}" which does not exist in ${resolvedAnchor}.`,
          context.path,
        ),
      );
    }
  }

  return results;
};

const EDGE_TARGET_PATTERN = /^([^#]*)#([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function parseEdgeTarget(target: string): { anchor: string; claimId: string } | undefined {
  const match = EDGE_TARGET_PATTERN.exec(target);
  if (!match) {
    return undefined;
  }
  return { anchor: match[1], claimId: match[2] };
}

function truncate(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
