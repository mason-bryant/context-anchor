export function buildAnchorCommitMessage(input: {
  action: "write" | "revert" | "delete" | "rename";
  name: string;
  renameTo?: string;
  message?: string;
  sectionsChanged?: string[];
  lastValidatedChanged?: boolean;
  coAuthor?: string;
}): string[] {
  const title =
    input.message?.trim() ||
    (input.action === "delete"
      ? `anchor-mcp: delete ${input.name}`
      : input.action === "rename" && input.renameTo
        ? `anchor-mcp: rename ${input.name} -> ${input.renameTo}`
        : `anchor-mcp: ${input.action} ${input.name}`);
  const body: string[] = [
    `Tool: anchor-mcp`,
    `Anchor: ${input.name}`,
    `Action: ${input.action}`,
  ];

  if (input.action === "rename" && input.renameTo) {
    body.push(`Rename to: ${input.renameTo}`);
  }

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

