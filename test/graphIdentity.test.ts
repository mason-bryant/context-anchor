import { describe, expect, it } from "vitest";

import {
  ANCHOR_ID_PATTERN,
  GRAPH_IDENTITY_VERSION,
  anchorIdFromFrontmatter,
  anchorNodeIdV2,
  buildIdentityCompatibilityMap,
  claimNodeIdV2,
  goalNodeIdV2,
  isValidAnchorId,
  milestoneNodeIdV2,
  mintAnchorId,
  sectionNodeIdV2,
  taskNodeIdV2,
} from "../src/graph/identity.js";
import { mintClaimId } from "../src/claims.js";

describe("GRAPH_IDENTITY_VERSION", () => {
  it("is 2", () => {
    expect(GRAPH_IDENTITY_VERSION).toBe(2);
  });
});

describe("ANCHOR_ID_PATTERN / isValidAnchorId", () => {
  it("accepts 6-char and 8-char lowercase base36 ids", () => {
    expect(isValidAnchorId("a-abc123")).toBe(true);
    expect(isValidAnchorId("a-ab3c123f9")).toBe(false); // 9 chars, too long
    expect(isValidAnchorId("a-1234ab7c9f")).toBe(false); // 10 chars, too long
    expect(isValidAnchorId("a-abcdef12")).toBe(true); // 8 chars
  });

  it("rejects wrong prefix, uppercase, and malformed shapes", () => {
    expect(isValidAnchorId("c-abc123")).toBe(false);
    expect(isValidAnchorId("a-ABC123")).toBe(false);
    expect(isValidAnchorId("a-ab_123")).toBe(false);
    expect(isValidAnchorId("abc123")).toBe(false);
    expect(isValidAnchorId("")).toBe(false);
    expect(isValidAnchorId("a-abc12")).toBe(false); // 5 chars, too short
  });

  it("matches the pattern directly for exhaustiveness", () => {
    expect(ANCHOR_ID_PATTERN.test("a-000000")).toBe(true);
    expect(ANCHOR_ID_PATTERN.test("a-zzzzzzzz")).toBe(true);
  });
});

describe("mintAnchorId", () => {
  it("mints ids matching the anchor id pattern", () => {
    const id = mintAnchorId(new Set());
    expect(isValidAnchorId(id)).toBe(true);
    expect(id.startsWith("a-")).toBe(true);
    expect(id.length).toBe(8); // "a-" + 6 chars
  });

  it("produces unique ids across repeated mints, feeding each mint back into the existing set", () => {
    const existing = new Set<string>();
    const minted = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = mintAnchorId(existing);
      expect(minted.has(id)).toBe(false);
      minted.add(id);
      existing.add(id);
    }
  });

  it("grows to 8 base36 chars on collision when the 6-char space is exhausted (forced collision)", () => {
    // Force every 6-char candidate to "collide" by pre-seeding a Set proxy
    // that reports has() = true for any 6-char shape, false for 8-char.
    const existing: ReadonlySet<string> = {
      has(value: string) {
        return /^a-[0-9a-z]{6}$/.test(value);
      },
    } as unknown as ReadonlySet<string>;
    const id = mintAnchorId(existing);
    expect(id.length).toBe(10); // "a-" + 8 chars
    expect(isValidAnchorId(id)).toBe(true);
  });
});

describe("mintClaimId byte-identical behavior after extraction", () => {
  it("still mints the c- prefixed 6-char shape", () => {
    const id = mintClaimId(new Set());
    expect(/^c-[0-9a-z]{6}$/.test(id)).toBe(true);
  });

  it("still grows to 8 chars on forced collision", () => {
    const existing: ReadonlySet<string> = {
      has(value: string) {
        return /^c-[0-9a-z]{6}$/.test(value);
      },
    } as unknown as ReadonlySet<string>;
    const id = mintClaimId(existing);
    expect(/^c-[0-9a-z]{8}$/.test(id)).toBe(true);
  });
});

describe("v2 canonical id constructors", () => {
  it("anchorNodeIdV2 shapes anchor:<anchor-id>", () => {
    expect(anchorNodeIdV2("a-abc123")).toBe("anchor:a-abc123");
  });

  it("goalNodeIdV2 shapes goal:<project>:<goal-id>", () => {
    expect(goalNodeIdV2("demo", "G-001")).toBe("goal:demo:G-001");
  });

  it("G-001 in two different projects produces two distinct v2 goal node ids (acceptance case)", () => {
    const a = goalNodeIdV2("project-a", "G-001");
    const b = goalNodeIdV2("project-b", "G-001");
    expect(a).not.toBe(b);
    expect(a).toBe("goal:project-a:G-001");
    expect(b).toBe("goal:project-b:G-001");
  });

  it("milestoneNodeIdV2 shapes milestone:<anchor-id>", () => {
    expect(milestoneNodeIdV2("a-abc123")).toBe("milestone:a-abc123");
  });

  it("taskNodeIdV2 shapes task:<anchor-id>#<task-id>", () => {
    expect(taskNodeIdV2("a-abc123", "T-001")).toBe("task:a-abc123#T-001");
  });

  it("sectionNodeIdV2 shapes section:<anchor-id>#<normalized-heading>", () => {
    expect(sectionNodeIdV2("a-abc123", "current-state")).toBe("section:a-abc123#current-state");
  });

  it("claimNodeIdV2 shapes claim:<anchor-id>#<claim-id>", () => {
    expect(claimNodeIdV2("a-abc123", "c-def456")).toBe("claim:a-abc123#c-def456");
  });
});

describe("anchorIdFromFrontmatter", () => {
  it("reads a present string anchor_id", () => {
    expect(anchorIdFromFrontmatter({ anchor_id: "a-abc123" })).toBe("a-abc123");
  });

  it("trims whitespace", () => {
    expect(anchorIdFromFrontmatter({ anchor_id: "  a-abc123  " })).toBe("a-abc123");
  });

  it("returns undefined when absent, empty, non-string, or frontmatter itself is undefined", () => {
    expect(anchorIdFromFrontmatter({})).toBeUndefined();
    expect(anchorIdFromFrontmatter({ anchor_id: "" })).toBeUndefined();
    expect(anchorIdFromFrontmatter({ anchor_id: "   " })).toBeUndefined();
    expect(anchorIdFromFrontmatter({ anchor_id: 123 as unknown as string })).toBeUndefined();
    expect(anchorIdFromFrontmatter(undefined)).toBeUndefined();
  });
});

describe("buildIdentityCompatibilityMap", () => {
  it("round-trips anchor v1<->v2 ids for anchors with a known anchor_id", () => {
    const map = buildIdentityCompatibilityMap({
      anchorIdByName: new Map([["projects/demo/context.md", "a-abc123"]]),
      projectSlugByGoalId: new Map(),
    });
    expect(map.toV2.get("anchor:projects/demo/context.md")).toBe("anchor:a-abc123");
    expect(map.toV1.get("anchor:a-abc123")).toBe("anchor:projects/demo/context.md");
    expect(map.entries).toEqual([{ v1: "anchor:projects/demo/context.md", v2: "anchor:a-abc123" }]);
    expect(map.unmapped).toEqual([]);
  });

  it("round-trips goal v1<->v2 ids for goals with a known project slug", () => {
    const map = buildIdentityCompatibilityMap({
      anchorIdByName: new Map(),
      projectSlugByGoalId: new Map([["G-001", "demo"]]),
    });
    expect(map.toV2.get("goal:G-001")).toBe("goal:demo:G-001");
    expect(map.toV1.get("goal:demo:G-001")).toBe("goal:G-001");
    expect(map.entries).toEqual([{ v1: "goal:G-001", v2: "goal:demo:G-001" }]);
  });

  it("reports anchors with no known anchor_id as unmapped (missing_anchor_id), not silently dropped", () => {
    const map = buildIdentityCompatibilityMap({
      anchorIdByName: new Map([["projects/demo/legacy.md", undefined]]),
      projectSlugByGoalId: new Map(),
    });
    expect(map.toV2.has("anchor:projects/demo/legacy.md")).toBe(false);
    expect(map.unmapped).toEqual([{ v1: "anchor:projects/demo/legacy.md", reason: "missing_anchor_id" }]);
  });

  it("reports goals with no known project slug as unmapped (missing_project_slug)", () => {
    const map = buildIdentityCompatibilityMap({
      anchorIdByName: new Map(),
      projectSlugByGoalId: new Map([["G-002", undefined]]),
    });
    expect(map.unmapped).toEqual([{ v1: "goal:G-002", reason: "missing_project_slug" }]);
  });

  it("handles a mix of mapped and unmapped anchors and goals together", () => {
    const map = buildIdentityCompatibilityMap({
      anchorIdByName: new Map([
        ["projects/demo/context.md", "a-abc123"],
        ["projects/demo/legacy.md", undefined],
      ]),
      projectSlugByGoalId: new Map([
        ["G-001", "demo"],
        ["G-002", undefined],
      ]),
    });
    expect(map.entries).toHaveLength(2);
    expect(map.unmapped).toHaveLength(2);
    expect(map.toV2.get("anchor:projects/demo/context.md")).toBe("anchor:a-abc123");
    expect(map.toV2.get("goal:G-001")).toBe("goal:demo:G-001");
  });
});
