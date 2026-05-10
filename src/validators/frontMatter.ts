import * as z from "zod/v4";

import { parseAnchor } from "../storage/markdown.js";
import type { Validator } from "./types.js";
import { maybeMigrationBlock } from "./types.js";

const StringOrStringArray = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const LastValidated = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.date()]);

const AnchorFrontmatterSchema = z
  .object({
    project: StringOrStringArray,
    type: z.string().min(1),
    tags: z.array(z.string()).default([]),
    last_validated: LastValidated,
  })
  .passthrough();

export const validateFrontMatter: Validator = (context) => {
  const parsed = parseAnchor(context.newContent);
  const result = AnchorFrontmatterSchema.safeParse(parsed.frontmatter);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) =>
    maybeMigrationBlock(
      context,
      "front_matter_schema",
      `Front matter ${issue.path.join(".") || "root"}: ${issue.message}`,
    ),
  );
};
