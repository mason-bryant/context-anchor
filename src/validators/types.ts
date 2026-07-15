import type { AnchorStore } from "../storage/store.js";
import type { AnchorSchemaMode, ValidationViolation } from "../types.js";

export type ValidationContext = {
  name: string;
  path: string;
  oldContent?: string;
  newContent: string;
  repo: AnchorStore;
  migrationWarnOnly: boolean;
  /** Goal 0 Phase 2 slice 3b write-time enforcement dial. Absent = `legacy` (no enforcement), so every pre-slice-3b caller is unaffected. */
  anchorSchemaMode?: AnchorSchemaMode;
  approved: boolean;
};

export type Validator = (context: ValidationContext) => Promise<ValidationViolation[]> | ValidationViolation[];

export function violation(
  severity: ValidationViolation["severity"],
  code: string,
  message: string,
  path?: string,
): ValidationViolation {
  return { severity, code, message, path };
}

export function maybeMigrationBlock(
  context: ValidationContext,
  code: string,
  message: string,
): ValidationViolation {
  return violation(context.migrationWarnOnly ? "WARN" : "BLOCK", code, message, context.path);
}
