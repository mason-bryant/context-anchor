export type DbCliCommand = "up" | "down" | "status" | "migrate" | "psql" | "reset";

const KNOWN_COMMANDS: readonly DbCliCommand[] = ["up", "down", "status", "migrate", "psql", "reset"];

export type DbCliArgs =
  | { command: Exclude<DbCliCommand, "reset"> }
  | { command: "reset"; yes: true };

export function parseDbCliArgs(argv: string[]): DbCliArgs {
  const [command, ...rest] = argv;

  if (!command) {
    throw new Error(`Missing command. Expected one of: ${KNOWN_COMMANDS.join(", ")}`);
  }

  if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`Unknown command "${command}". Expected one of: ${KNOWN_COMMANDS.join(", ")}`);
  }

  const hasYes = rest.includes("--yes");

  if (command !== "reset" && hasYes) {
    throw new Error(`--yes is only accepted with the "reset" command`);
  }

  if (command === "reset") {
    if (!hasYes) {
      throw new Error(`"reset" is destructive and requires an explicit --yes flag`);
    }
    return { command: "reset", yes: true };
  }

  return { command: command as Exclude<DbCliCommand, "reset"> };
}
