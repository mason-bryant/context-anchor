import type { AnchorRepository } from "../git/repo.js";
import type { ValidationViolation } from "../types.js";

export type ValidationContext = {
  name: string;
  repoRelativePath: string;
  oldContent?: string;
  newContent: string;
  repo: AnchorRepository;
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
  return violation(context.migrationWarnOnly ? "WARN" : "BLOCK", code, message, context.repoRelativePath);
}

