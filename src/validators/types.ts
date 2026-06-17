import type { AnchorStore } from "../storage/store.js";
import type { ValidationViolation } from "../types.js";

export type ValidationContext = {
  name: string;
  path: string;
  oldContent?: string;
  newContent: string;
  repo: AnchorStore;
  migrationWarnOnly: boolean;
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
