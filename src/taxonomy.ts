import { normalizeRelative } from "./utils/path.js";

export const ANCHOR_CATEGORIES = [
  "agent-rules",
  "projects",
  "invariants",
  "conflicts",
  "shared",
  "archive",
] as const;

export type AnchorCategory = (typeof ANCHOR_CATEGORIES)[number];

export const CONTEXT_ROOT_FILE = "CONTEXT-ROOT.md";

export type AnchorClassification =
  | {
      kind: "anchor";
      category: AnchorCategory;
      projectSlug?: string;
    }
  | {
      kind: "generated";
    }
  | {
      kind: "invalid";
      reason: string;
    };

export function classifyAnchorPath(input: string): AnchorClassification {
  const clean = normalizeRelative(input);

  if (clean === CONTEXT_ROOT_FILE) {
    return { kind: "generated" };
  }

  if (!clean.endsWith(".md")) {
    return { kind: "invalid", reason: "Anchor path must end in .md." };
  }

  const parts = clean.split("/");
  const topLevel = parts[0];

  if (!isAnchorCategory(topLevel)) {
    return { kind: "invalid", reason: `Unknown top-level anchor directory: ${topLevel || "(root)"}.` };
  }

  if (topLevel === "archive") {
    if (parts.length < 2) {
      return { kind: "invalid", reason: "Archive anchors must live under archive/." };
    }

    return { kind: "anchor", category: topLevel };
  }

  if (topLevel === "projects") {
    const projectSlug = parts[1];
    if (!projectSlug) {
      return { kind: "invalid", reason: "Project anchors must live under projects/<project-slug>/." };
    }

    if (parts.length !== 3) {
      return { kind: "invalid", reason: "Project anchors must use projects/<project-slug>/<anchor>.md." };
    }

    return { kind: "anchor", category: topLevel, projectSlug };
  }

  if (parts.length !== 2) {
    return { kind: "invalid", reason: `${topLevel} anchors must live directly under ${topLevel}/.` };
  }

  return { kind: "anchor", category: topLevel };
}

export function isAnchorCategory(input: unknown): input is AnchorCategory {
  return typeof input === "string" && ANCHOR_CATEGORIES.includes(input as AnchorCategory);
}

export function categoryTitle(category: AnchorCategory): string {
  switch (category) {
    case "agent-rules":
      return "Agent Rules";
    case "projects":
      return "Projects";
    case "invariants":
      return "Invariants";
    case "conflicts":
      return "Conflicts";
    case "shared":
      return "Shared";
    case "archive":
      return "Archive";
  }
}

