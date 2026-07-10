import { describe, expect, it } from "vitest";

import { suggestMarkdownLinks } from "../src/markdownLinks.js";

describe("suggestMarkdownLinks", () => {
  it("suggests only unambiguous Markdown replacements backed by the same anchor", () => {
    const content = [
      "- See `Google Doc \"Removing Current Balance From Reports V1\" (doc id 1s9cR-JFozYQzs0LGqnd4oOnn-Bp4-TY2fpnUsGdTFoo)`.",
      "- Read `PLATFORM/pages/6251708783` and coordinate in `#proj-kill-reports-v1`.",
      "",
      "## References",
      "- [Plan Historically accurate observables and dynamic attributes in RQL](https://rippling.atlassian.net/wiki/spaces/PLATFORM/pages/6251708783)",
      "- [#proj-kill-reports-v1](https://slack.com/app_redirect?channel=C096T2NCJHY)",
      "  {src: https://docs.google.com/document/d/1s9cR-JFozYQzs0LGqnd4oOnn-Bp4-TY2fpnUsGdTFoo/edit; observed: 2026-07-10; conf: high}",
    ].join("\n");

    const result = suggestMarkdownLinks(content);

    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestedContent).toContain('[Removing Current Balance From Reports V1](https://docs.google.com/document/d/1s9cR-JFozYQzs0LGqnd4oOnn-Bp4-TY2fpnUsGdTFoo/edit)');
    expect(result.suggestedContent).toContain('[Plan Historically accurate observables and dynamic attributes in RQL](https://rippling.atlassian.net/wiki/spaces/PLATFORM/pages/6251708783)');
    expect(result.suggestedContent).toContain('[#proj-kill-reports-v1](https://slack.com/app_redirect?channel=C096T2NCJHY)');
  });

  it("does not guess when a reference has multiple candidate URLs", () => {
    const result = suggestMarkdownLinks("`#project`\n[#project](https://slack.com/a)\n[#project](https://slack.com/b)");
    expect(result.suggestions).toEqual([]);
    expect(result.suggestedContent).toContain("`#project`");
  });
});
