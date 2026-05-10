export function buildAnchorCommitMessage(input: {
  action: "write" | "revert";
  name: string;
  message?: string;
  sectionsChanged?: string[];
  lastValidatedChanged?: boolean;
  coAuthor?: string;
}): string[] {
  const title = input.message?.trim() || `anchor-mcp: ${input.action} ${input.name}`;
  const body: string[] = [
    `Tool: anchor-mcp`,
    `Anchor: ${input.name}`,
    `Action: ${input.action}`,
  ];

  if (input.sectionsChanged?.length) {
    body.push(`Sections changed: ${input.sectionsChanged.join(", ")}`);
  }

  if (input.lastValidatedChanged !== undefined) {
    body.push(`last_validated changed: ${input.lastValidatedChanged ? "yes" : "no"}`);
  }

  if (input.coAuthor) {
    body.push("", `Co-Authored-By: ${input.coAuthor}`);
  }

  return ["-m", title, ...body.flatMap((line) => ["-m", line])];
}

