/**
 * An error the operator can act on directly — a mistyped command, a precondition they can
 * satisfy. Printed as a bare message rather than a stack trace: a stack reads as "the tool
 * broke" when the actual meaning is "you asked for something I won't do yet, here's why".
 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function isCliUsageError(error: unknown): error is CliUsageError {
  return error instanceof CliUsageError;
}
