import type { ValidationViolation } from "../types.js";
import { parseProjectAliases, isProjectContextAnchorPath, isValidProjectAliasSlug } from "../projectAliases.js";
import { parseAnchor } from "../storage/markdown.js";
import { classifyAnchorPath } from "../taxonomy.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

export const validateProjectAliases: Validator = async (context) => {
  const classification = classifyAnchorPath(context.name);
  if (classification.kind !== "anchor" || classification.category !== "projects") {
    return [];
  }

  const parsed = parseAnchor(context.newContent);
  const aliases = parseProjectAliases(parsed.frontmatter.aliases);
  if (aliases.length === 0) {
    return [];
  }

  const violations: ValidationViolation[] = [];
  const anchorType = parsed.frontmatter.type;

  if (!isProjectContextAnchorPath(context.name, anchorType)) {
    violations.push(
      maybeMigrationBlock(
        context,
        "project_alias_location",
        "Project aliases may only be declared on project context anchors (`type: context-anchor` or `*-project-context.md`).",
      ),
    );
    return violations;
  }

  const canonical = classification.projectSlug;
  if (!canonical) {
    return violations;
  }

  const normalized = new Set<string>();
  for (const alias of aliases) {
    if (!isValidProjectAliasSlug(alias)) {
      violations.push(
        maybeMigrationBlock(
          context,
          "project_alias_invalid",
          `Project alias "${alias}" must match slug form [a-z0-9][a-z0-9-]*.`,
        ),
      );
      continue;
    }
    const key = alias.toLowerCase();
    if (normalized.has(key)) {
      violations.push(
        maybeMigrationBlock(
          context,
          "project_alias_duplicate",
          `Project alias "${alias}" is duplicated in aliases.`,
        ),
      );
      continue;
    }
    normalized.add(key);
    if (key === canonical.toLowerCase()) {
      violations.push(
        maybeMigrationBlock(
          context,
          "project_alias_is_canonical",
          `Project alias "${alias}" must not equal the canonical project slug "${canonical}".`,
        ),
      );
    }
  }

  const siblings = await context.repo.listAnchors();
  for (const meta of siblings) {
    if (meta.name === context.name || !meta.projectSlug) {
      continue;
    }
    if (meta.projectSlug.toLowerCase() === canonical.toLowerCase()) {
      continue;
    }
    if (normalized.has(meta.projectSlug.toLowerCase())) {
      violations.push(
        maybeMigrationBlock(
          context,
          "project_alias_canonical_collision",
          `Project alias "${meta.projectSlug}" conflicts with canonical slug for project "${meta.projectSlug}".`,
        ),
      );
    }
    for (const alias of meta.aliases ?? []) {
      if (normalized.has(alias.toLowerCase())) {
        violations.push(
          maybeMigrationBlock(
            context,
            "project_alias_collision",
            `Project alias "${alias}" is already declared for project "${meta.projectSlug}".`,
          ),
        );
      }
    }
  }

  return violations;
};
