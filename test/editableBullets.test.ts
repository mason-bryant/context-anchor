import { describe, expect, it } from "vitest";

import { deleteEditableBullet, locateEditableBullet, replaceEditableBulletText } from "../src/editableBullets.js";

const DOC = `# Demo

## tl-dr

- Summary bullet.
- Second summary.

## Current State

- Claim bullet.

\`\`\`
## tl-dr
- Ignored fenced bullet.
\`\`\`
`;

describe("editable rendered bullets", () => {
  it("updates and deletes bullets only from editable sections", () => {
    expect(locateEditableBullet(DOC, 5)).toMatchObject({
      ok: true,
      section: "tl-dr",
      text: "Summary bullet.",
    });

    const updated = replaceEditableBulletText(DOC, 5, "Updated summary bullet.");
    expect(updated).toContain("- Updated summary bullet.");
    expect(updated).not.toContain("- Summary bullet.");

    const deleted = deleteEditableBullet(updated, 6);
    expect(deleted).not.toContain("- Second summary.");
  });

  it("rejects claim bullets and fenced bullets", () => {
    expect(locateEditableBullet(DOC, 10)).toMatchObject({
      ok: false,
      code: "editable_bullet_not_allowed",
    });
    expect(locateEditableBullet(DOC, 14)).toMatchObject({
      ok: false,
      code: "editable_bullet_not_found",
    });
  });

  it("stops treating bullets as editable after a later top-level heading", () => {
    const content = `## tl-dr

- Summary bullet.

# Next

- Not a tl-dr bullet.
`;

    expect(locateEditableBullet(content, 3)).toMatchObject({
      ok: true,
      section: "tl-dr",
      text: "Summary bullet.",
    });
    expect(locateEditableBullet(content, 7)).toMatchObject({
      ok: false,
      code: "editable_bullet_not_allowed",
    });
  });
});
