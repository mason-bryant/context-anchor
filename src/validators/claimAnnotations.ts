import { extractClaims, findInertClaimAnnotations } from "../claims.js";
import type { ValidationContext, Validator } from "./types.js";
import { violation } from "./types.js";
import type { ValidationViolation } from "../types.js";

/**
 * Block writes that contain malformed claim provenance annotations.
 * An unannotated claim is never a violation; only brace blocks that attempt
 * the annotation grammar (contain a src/observed/conf key) are validated.
 */
export const validateClaimAnnotations: Validator = (context: ValidationContext): ValidationViolation[] => {
  const results: ValidationViolation[] = [];

  for (const inert of findInertClaimAnnotations(context.newContent)) {
    const annotationLocation = inert.annotationLines.length === 1
      ? `annotation line ${inert.annotationLines[0]}`
      : `annotation lines ${inert.annotationLines.join(", ")}`;
    results.push(
      violation(
        "WARN",
        "claim_annotation_in_non_claim_section",
        `Bullet at line ${inert.bulletLine} in non-claim-bearing section "${inert.section}" has provenance on ${annotationLocation}, but no claim will be created and the annotation will be ignored. Move the bullet under Introduction, Invariants, Current State, Decisions, or Constraints (use an H3 topic beneath one of those H2 sections) or remove the annotation: "${truncate(inert.text)}"`,
        context.path,
      ),
    );
  }

  for (const claim of extractClaims(context.newContent)) {
    if (claim.status !== "malformed" || !claim.sourceErrors) {
      continue;
    }
    for (const sourceError of claim.sourceErrors) {
      for (const error of sourceError.errors) {
        results.push(
          violation(
            "BLOCK",
            "claim_annotation_invalid",
            `Line ${sourceError.line}: invalid provenance annotation on claim "${truncate(claim.text)}": ${error}`,
            context.path,
          ),
        );
      }
    }
  }

  return results;
};

function truncate(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
