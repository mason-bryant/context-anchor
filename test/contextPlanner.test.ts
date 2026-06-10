import { describe, expect, it } from "vitest";

import {
  buildContextBundlePlan,
  computeLastValidatedAgeDays,
  estimateAnchorTokens,
  isAnchorStale,
} from "../src/contextPlanner.js";
import type { AnchorMeta } from "../src/types.js";

function makeAnchor(overrides: Partial<AnchorMeta> & Pick<AnchorMeta, "name">): AnchorMeta {
  return {
    path: overrides.name,
    category: overrides.category ?? "shared",
    summary: overrides.summary ?? "Summary text.",
    read_this_if: overrides.read_this_if ?? ["Load when testing."],
    ...overrides,
  };
}

describe("buildContextBundlePlan body-size budget packing", () => {
  it("excludes a large-body anchor that would fit under metadata-only estimates", () => {
    const small = makeAnchor({
      name: "projects/demo/demo.md",
      category: "projects",
      projectSlug: "demo",
      project: ["demo"],
      summary: "Demo storage decisions and constraints.",
      read_this_if: ["You are modifying demo project behavior."],
    });
    const large = makeAnchor({
      name: "shared/storage.md",
      category: "shared",
      summary: "Shared storage workflow for demo decisions.",
      read_this_if: ["You need storage workflow guidance."],
    });

    const bodyCharCounts = new Map([
      ["projects/demo/demo.md", 400],
      ["shared/storage.md", 12000],
    ]);

    const plan = buildContextBundlePlan(
      [small, large],
      {
        task: "Update demo storage decisions",
        project: "demo",
        budgetTokens: 1200,
        maxAnchors: 12,
      },
      undefined,
      "2026-06-10T00:00:00.000Z",
      undefined,
      bodyCharCounts,
    );

    expect(plan.included.map((anchor) => anchor.name)).toContain("projects/demo/demo.md");
    expect(plan.excluded.some((anchor) => anchor.name === "shared/storage.md" && anchor.reason.includes("outside token budget"))).toBe(
      true,
    );
  });
});

describe("estimateAnchorTokens", () => {
  it("uses body char counts when provided", () => {
    const anchor = makeAnchor({ name: "shared/large.md" });
    const withBody = estimateAnchorTokens(anchor, new Map([["shared/large.md", 8000]]));
    const withoutBody = estimateAnchorTokens(anchor);

    expect(withBody).toBeGreaterThan(withoutBody);
    expect(withBody).toBeGreaterThanOrEqual(Math.ceil(8000 / 4));
  });

  it("falls back to metadata-only estimate when body size is unknown", () => {
    const anchor = makeAnchor({ name: "server-rules/policy.md", category: "server-rules" });
    expect(estimateAnchorTokens(anchor)).toBeGreaterThanOrEqual(120);
    expect(estimateAnchorTokens(anchor, new Map())).toBeGreaterThanOrEqual(120);
  });
});

describe("staleness signals", () => {
  it("computes age days from strict ISO dates", () => {
    expect(computeLastValidatedAgeDays("2026-01-01", new Date("2026-06-10T12:00:00.000Z"))).toBe(160);
    expect(computeLastValidatedAgeDays("not-a-date")).toBeUndefined();
  });

  it("flags stale included anchors and emits missingContext guidance", () => {
    const stale = makeAnchor({
      name: "projects/demo/demo.md",
      category: "projects",
      projectSlug: "demo",
      project: ["demo"],
      summary: "Demo storage decisions and constraints.",
      read_this_if: ["You are modifying demo project behavior."],
      last_validated: "2025-01-01",
    });

    const plan = buildContextBundlePlan(
      [stale],
      {
        task: "Update demo storage decisions",
        project: "demo",
        budgetTokens: 4000,
      },
      undefined,
      "2026-06-10T00:00:00.000Z",
      undefined,
      undefined,
      45,
      new Date("2026-06-10T00:00:00.000Z"),
    );

    expect(plan.included[0]?.stale).toBe(true);
    expect(plan.included[0]?.lastValidatedAgeDays).toBeGreaterThan(45);
    expect(plan.missingContext.some((signal) => signal.includes("may be stale"))).toBe(true);
    expect(isAnchorStale("2026-06-01", 45, new Date("2026-06-10T00:00:00.000Z"))).toBe(false);
  });
});
