import { extractClaims } from "../claims.js";
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
