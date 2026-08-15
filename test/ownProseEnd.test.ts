import { describe, expect, it } from "vitest";

import { ownProseEnd } from "../src/db/routing/selectRoutes.js";

const span = (guid: string, start: number, end: number, revision = "rev-1") => ({
  section_guid: guid,
  revision_guid: revision,
  start_offset: start,
  end_offset: end,
});

describe("ownProseEnd", () => {
  it("ends a section at its first descendant, not at its own end", () => {
    // The whole point. A parent's span covers its children, so returning both put the same prose
    // in a response twice -- on the real workspace, 241 of one document's 242 sections were
    // wholly inside another.
    const ends = ownProseEnd([span("parent", 0, 100), span("child", 20, 60), span("second", 60, 100)]);
    expect(ends.get("parent")).toBe(20);
  });

  it("leaves a childless section at its own end", () => {
    const ends = ownProseEnd([span("parent", 0, 100), span("child", 20, 100)]);
    expect(ends.get("child")).toBe(100);
  });

  it("ends at the first descendant even when a deeper one starts earlier in the list", () => {
    // Input order is the query's, not the document's. Taking whichever descendant appeared first
    // in the array would end a section at a grandchild and swallow the child's heading.
    const ends = ownProseEnd([
      span("grandchild", 40, 60),
      span("parent", 0, 100),
      span("child", 30, 100),
    ]);
    expect(ends.get("parent")).toBe(30);
  });

  it("keeps sections in different revisions from nesting inside each other", () => {
    // Offsets index one revision's text. Two revisions both start at 0, so comparing across them
    // would make one document's section a descendant of another's and truncate it to nothing.
    const ends = ownProseEnd([span("a", 0, 100, "rev-1"), span("b", 10, 50, "rev-2")]);
    expect(ends.get("a")).toBe(100);
    expect(ends.get("b")).toBe(50);
  });

  it("does not treat a sibling that starts where this one ends as a descendant", () => {
    // Adjacent sections share a boundary: `next` starts exactly where `first` ends. A descendant
    // is identified by ending within its parent, which `next` does not, so the sibling is
    // rejected by that test rather than by the loop's early exit.
    const ends = ownProseEnd([span("first", 0, 50), span("next", 50, 100)]);
    expect(ends.get("first")).toBe(50);
    expect(ends.get("next")).toBe(100);
  });

  it("produces spans that never contain one another", () => {
    // The property the whole change exists for, asserted over the resulting ranges rather than
    // over one example: a five-level nest is where an off-by-one in the scan would show up.
    const rows = [
      span("h1", 0, 500),
      span("h2a", 10, 200),
      span("h3a", 30, 120),
      span("h4a", 50, 90),
      span("h2b", 200, 500),
      span("h3b", 230, 500),
    ];
    const ends = ownProseEnd(rows);
    const ranges = rows.map((row) => ({ start: row.start_offset, end: ends.get(row.section_guid)! }));

    for (const outer of ranges) {
      for (const inner of ranges) {
        if (outer === inner) {
          continue;
        }
        const contains = outer.start <= inner.start && outer.end >= inner.end;
        expect(contains).toBe(false);
      }
    }
  });
});
