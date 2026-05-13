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

/** Synthetic discovery-only category for built-in MCP policy (not a repo directory). */
export const SERVER_RULES_DISCOVERY_CATEGORY = "server-rules" as const;

export type DiscoveryCategory = AnchorCategory | typeof SERVER_RULES_DISCOVERY_CATEGORY;

/** Order for context root / discovery: built-ins first, then repo taxonomy. */
export const DISCOVERY_CATEGORY_ORDER: readonly DiscoveryCategory[] = [
  SERVER_RULES_DISCOVERY_CATEGORY,
  ...ANCHOR_CATEGORIES,
];

export function isDiscoveryCategory(input: unknown): input is DiscoveryCategory {
  return isAnchorCategory(input) || input === SERVER_RULES_DISCOVERY_CATEGORY;
}

export function discoveryCategoryIndex(category: DiscoveryCategory): number {
  return DISCOVERY_CATEGORY_ORDER.indexOf(category);
}

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

export function discoveryCategoryTitle(category: DiscoveryCategory): string {
  if (category === SERVER_RULES_DISCOVERY_CATEGORY) {
    return "Built-in server policy";
  }
  return categoryTitle(category);
}

