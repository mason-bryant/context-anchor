import { describe, expect, it } from "vitest";

import {
  RELATION_VOCABULARY,
  parseRelationTarget,
  relationTargetKindAllowed,
  relationVocabularyEntry,
} from "../src/relations/vocabulary.js";

describe("RELATION_VOCABULARY", () => {
  it("registers exactly the five locked keys", () => {
    expect(RELATION_VOCABULARY.map((entry) => entry.key).sort()).toEqual(
      ["depends_on", "implements", "owned_by", "related_to", "supersedes"].sort(),
    );
  });

  it("does not register derived_from or contradicts (claim-annotation grammar, not front-matter relations)", () => {
    expect(relationVocabularyEntry("derived_from")).toBeUndefined();
    expect(relationVocabularyEntry("contradicts")).toBeUndefined();
  });

  it("related_to is the only symmetric entry", () => {
    for (const entry of RELATION_VOCABULARY) {
      expect(entry.symmetric).toBe(entry.key === "related_to");
    }
  });

  it("depends_on and supersedes are anchor -> anchor", () => {
    expect(relationVocabularyEntry("depends_on")).toMatchObject({ sourceKinds: ["anchor"], targetKinds: ["anchor"] });
    expect(relationVocabularyEntry("supersedes")).toMatchObject({ sourceKinds: ["anchor"], targetKinds: ["anchor"] });
  });

  it("implements allows anchor|milestone|task sources targeting goal", () => {
    expect(relationVocabularyEntry("implements")).toMatchObject({
      sourceKinds: ["anchor", "milestone", "task"],
      targetKinds: ["goal"],
    });
  });

  it("owned_by allows anchor|goal|task sources targeting person|team", () => {
    expect(relationVocabularyEntry("owned_by")).toMatchObject({
      sourceKinds: ["anchor", "goal", "task"],
      targetKinds: ["person", "team"],
    });
  });

  it("returns undefined for an unregistered key", () => {
    expect(relationVocabularyEntry("some_custom_key")).toBeUndefined();
  });
});

describe("parseRelationTarget: canonical typed refs", () => {
  it("parses an anchor:<anchor-id> ref", () => {
    const result = parseRelationTarget("anchor:a-abc123");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toEqual({ kind: "anchor", id: "a-abc123" });
  });

  it("parses a goal:<project-slug>:<goal-id> ref", () => {
    const result = parseRelationTarget("goal:demo:G-001");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toEqual({ kind: "goal", projectSlug: "demo", goalId: "G-001" });
  });

  it("parses a person:<id> ref", () => {
    const result = parseRelationTarget("person:alice");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toEqual({ kind: "person", id: "alice" });
  });

  it("parses a team:<id> ref", () => {
    const result = parseRelationTarget("team:platform");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toEqual({ kind: "team", id: "platform" });
  });

  it("trims whitespace within the ref segments", () => {
    const result = parseRelationTarget("goal: demo : G-001 ");
    expect(result.parsed).toEqual({ kind: "goal", projectSlug: "demo", goalId: "G-001" });
  });
});

describe("parseRelationTarget: legacy bare strings", () => {
  it("treats a bare anchor path as legacy", () => {
    const result = parseRelationTarget("projects/demo/context.md");
    expect(result.legacy).toBe(true);
    expect(result.parsed).toBeUndefined();
  });

  it("treats a bare anchor name without extension as legacy", () => {
    const result = parseRelationTarget("projects/demo/context");
    expect(result.legacy).toBe(true);
  });

  it("treats an empty string as legacy with an empty malformedReason", () => {
    const result = parseRelationTarget("");
    expect(result.legacy).toBe(true);
    expect(result.malformedReason).toBe("empty");
  });
});

describe("parseRelationTarget: malformed typed refs", () => {
  it("reports a malformed goal ref missing the project slug segment", () => {
    const result = parseRelationTarget("goal:onlyoneslug");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toBeUndefined();
    expect(result.malformedReason).toBeDefined();
  });

  it("reports a malformed goal ref with an empty project slug", () => {
    const result = parseRelationTarget("goal::G-001");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toBeUndefined();
    expect(result.malformedReason).toBeDefined();
  });

  it("reports a malformed goal ref with an empty goal id", () => {
    const result = parseRelationTarget("goal:demo:");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toBeUndefined();
    expect(result.malformedReason).toBeDefined();
  });

  it("reports a malformed anchor ref with an empty id", () => {
    const result = parseRelationTarget("anchor:");
    expect(result.legacy).toBe(false);
    expect(result.parsed).toBeUndefined();
    expect(result.malformedReason).toBeDefined();
  });

  it("reports a malformed person ref with an empty id", () => {
    const result = parseRelationTarget("person:");
    expect(result.legacy).toBe(false);
    expect(result.malformedReason).toBeDefined();
  });

  it("reports a malformed team ref with an empty id", () => {
    const result = parseRelationTarget("team:");
    expect(result.legacy).toBe(false);
    expect(result.malformedReason).toBeDefined();
  });
});

describe("relationTargetKindAllowed", () => {
  it("allows a matching kind", () => {
    const entry = relationVocabularyEntry("depends_on")!;
    expect(relationTargetKindAllowed(entry, { kind: "anchor", id: "a-abc123" })).toBe(true);
  });

  it("rejects a wrong kind", () => {
    const entry = relationVocabularyEntry("depends_on")!;
    expect(relationTargetKindAllowed(entry, { kind: "person", id: "alice" })).toBe(false);
  });

  it("implements rejects an anchor-kind target (only goal is allowed)", () => {
    const entry = relationVocabularyEntry("implements")!;
    expect(relationTargetKindAllowed(entry, { kind: "anchor", id: "a-abc123" })).toBe(false);
    expect(relationTargetKindAllowed(entry, { kind: "goal", projectSlug: "demo", goalId: "G-001" })).toBe(true);
  });

  it("owned_by accepts person or team but not anchor", () => {
    const entry = relationVocabularyEntry("owned_by")!;
    expect(relationTargetKindAllowed(entry, { kind: "person", id: "alice" })).toBe(true);
    expect(relationTargetKindAllowed(entry, { kind: "team", id: "platform" })).toBe(true);
    expect(relationTargetKindAllowed(entry, { kind: "anchor", id: "a-abc123" })).toBe(false);
  });
});
