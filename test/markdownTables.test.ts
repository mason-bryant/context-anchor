import { describe, expect, it } from "vitest";

import {
  extractMarkdownTables,
  isCompleteMarkdownTable,
  replaceMarkdownTable,
} from "../src/markdownTables.js";

const EXAMPLE = `### Definition and Registration

- Registration details remain before the table.
  {src: app/example.py; observed: 2026-07-13; conf: high; id: c-abc123}

| File | Purpose |
|------|--------|
| \`app/approved.py\` | Approved names. |
| \`app/views.py\` | Registry implementation. |

### CTE Translation Pipeline

- Pipeline details remain after the table.`;

describe("editable Markdown tables", () => {
  it("extracts a complete pipe table with stable source line boundaries", () => {
    expect(extractMarkdownTables(EXAMPLE)).toEqual([
      {
        line: 6,
        endLine: 9,
        text:
          "| File | Purpose |\n"
          + "|------|--------|\n"
          + "| `app/approved.py` | Approved names. |\n"
          + "| `app/views.py` | Registry implementation. |",
      },
    ]);
  });

  it("replaces only the addressed table and preserves surrounding anchor content", () => {
    const updated = replaceMarkdownTable(
      EXAMPLE,
      6,
      "| File | Purpose | Owner |\n"
        + "|------|---------|-------|\n"
        + "| `app/approved.py` | Allowlist. | Core RQL |",
    );

    expect(updated).toContain("- Registration details remain before the table.\n  {src: app/example.py;");
    expect(updated).toContain("| File | Purpose | Owner |");
    expect(updated).not.toContain("Registry implementation.");
    expect(updated).toContain("### CTE Translation Pipeline\n\n- Pipeline details remain after the table.");
  });

  it("ignores table-shaped text in backtick and tilde fenced code blocks", () => {
    const content = "```markdown\n| Not | A table |\n|-----|---------|\n| one | row |\n```\n\n~~~markdown\n| Also | Not a table |\n|------|-------------|\n| two | row |\n~~~\n\n| Real | Table |\n|------|-------|";

    expect(extractMarkdownTables(content)).toEqual([
      {
        line: 13,
        endLine: 14,
        text: "| Real | Table |\n|------|-------|",
      },
    ]);
  });

  it("does not split table cells on pipes inside multi-backtick code spans", () => {
    const table = "Name | Query\n---|---\nExample | ``code | with pipe``";

    expect(isCompleteMarkdownTable(table)).toBe(true);
    expect(extractMarkdownTables(table)).toEqual([{ line: 1, endLine: 3, text: table }]);
  });

  it("accepts one complete table and rejects surrounding or malformed content", () => {
    expect(isCompleteMarkdownTable("| A | B |\n|---|:---:|\n| 1 | 2 |")).toBe(true);
    expect(isCompleteMarkdownTable("Intro\n\n| A | B |\n|---|---|")).toBe(false);
    expect(isCompleteMarkdownTable("| A | B |\n| 1 | 2 |")).toBe(false);
    expect(isCompleteMarkdownTable("| A | B |\n|---|---|\n\nOutro")).toBe(false);
    expect(isCompleteMarkdownTable("| A | B |\n|---|---|\n| 1 | 2 | 3 |")).toBe(false);
    expect(isCompleteMarkdownTable("| A | B |\n|---|---|\n| 1 |")).toBe(false);
  });
});
