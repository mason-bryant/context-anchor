import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import {
  carryClaimAnnotations,
  extractClaims,
  formatAnnotationBody,
  locateClaim,
  parseAnnotationBody,
  upsertClaimAnnotation,
} from "../src/claims.js";

describe("parseAnnotationBody", () => {
  it("parses a full annotation", () => {
    const result = parseAnnotationBody("src: PR #39; observed: 2026-06-17; conf: high; id: owner-resolution");
    expect(result).toEqual({
      ok: true,
      annotation: { src: "PR #39", observed: "2026-06-17", conf: "high", id: "owner-resolution" },
    });
  });

  it("parses person sources and keeps values containing colons", () => {
    const result = parseAnnotationBody("src: person:alice via slack; observed: 2026-06-17; conf: medium");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.annotation.src).toBe("person:alice via slack");
    }
  });

  it("rejects missing src, bad dates, and bad confidence", () => {
    const result = parseAnnotationBody("observed: 2026-13-99; conf: certain");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("non-empty src");
      expect(result.errors.join(" ")).toContain("YYYY-MM-DD");
      expect(result.errors.join(" ")).toContain("high, medium, or low");
    }
  });

  it("rejects unknown and duplicate keys and non-kebab ids", () => {
    const result = parseAnnotationBody(
      "src: a.md; src: b.md; observed: 2026-01-01; conf: low; id: Not_Kebab; source: x",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("Duplicate annotation key");
      expect(result.errors.join(" ")).toContain("Unknown annotation key");
      expect(result.errors.join(" ")).toContain("kebab-case");
    }
  });

  it("rejects overflow dates that Date.parse would silently roll over", () => {
    const result = parseAnnotationBody("src: a.md; observed: 2026-02-30; conf: low");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("valid YYYY-MM-DD");
    }
    expect(parseAnnotationBody("src: a.md; observed: 2028-02-29; conf: low").ok).toBe(true);
  });

  it("caps person-sourced claims at medium confidence", () => {
    const result = parseAnnotationBody("src: person:alice; observed: 2026-06-17; conf: high");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("cap at conf: medium");
    }
  });
});

const DOC = `---
type: context-anchor
---

# Demo

## Current State

- Owner resolution resolves a person before a team.
  {src: PR #39; observed: 2026-06-17; conf: high}
- The HTTP server refuses to start without an auth token. {src: src/http/server.ts; observed: 2026-06-01; conf: high}
- Legacy claim with no provenance.
- Broken claim annotation.
  {src: ; observed: yesterday; conf: certain}

## Decisions

- Registries are flat JSON lookup tables.
  - Sub-bullet detail that is not a claim.

## Constraints

- Anchors must include required sections.

## PRs

- [PR Something - #1](https://example.com/1)

\`\`\`
- fenced bullet {src: nope; observed: 2026-01-01; conf: high}
\`\`\`
`;

describe("extractClaims", () => {
  it("extracts claims from claim sections with both annotation forms", () => {
    const claims = extractClaims(DOC);
    const byText = new Map(claims.map((claim) => [claim.text, claim]));

    expect(byText.get("Owner resolution resolves a person before a team.")).toMatchObject({
      section: "Current State",
      status: "annotated",
      annotation: { src: "PR #39", observed: "2026-06-17", conf: "high" },
      annotationInline: false,
    });
    expect(byText.get("The HTTP server refuses to start without an auth token.")).toMatchObject({
      status: "annotated",
      annotation: { src: "src/http/server.ts" },
      annotationInline: true,
    });
    expect(byText.get("Legacy claim with no provenance.")).toMatchObject({ status: "unannotated" });
    expect(byText.get("Broken claim annotation.")).toMatchObject({ status: "malformed" });
    expect(byText.get("Registries are flat JSON lookup tables.")).toMatchObject({
      section: "Decisions",
      status: "unannotated",
    });
    expect(byText.get("Anchors must include required sections.")).toMatchObject({ section: "Constraints" });
  });

  it("ignores PRs sections, sub-bullets, and fenced code", () => {
    const claims = extractClaims(DOC);
    const texts = claims.map((claim) => claim.text);
    expect(texts.some((text) => text.includes("PR Something"))).toBe(false);
    expect(texts.some((text) => text.includes("Sub-bullet detail"))).toBe(false);
    expect(texts.some((text) => text.includes("fenced bullet"))).toBe(false);
  });
});

describe("locateClaim / upsertClaimAnnotation", () => {
  it("locates uniquely, reports not-found and ambiguity", () => {
    expect(locateClaim(DOC, "owner resolution")).toMatchObject({ ok: true });
    expect(locateClaim(DOC, "no such claim text")).toMatchObject({ ok: false, code: "claim_not_found" });
    expect(locateClaim(DOC, "claim")).toMatchObject({ ok: false, code: "claim_ambiguous" });
  });

  it("inserts a standalone annotation under an unannotated claim", () => {
    const updated = upsertClaimAnnotation(DOC, "Legacy claim", {
      src: "PR #54",
      observed: "2026-07-07",
      conf: "medium",
    });
    expect(updated).toContain("- Legacy claim with no provenance.\n  {src: PR #54; observed: 2026-07-07; conf: medium}");
  });

  it("replaces an existing standalone annotation in place", () => {
    const updated = upsertClaimAnnotation(DOC, "Owner resolution", {
      src: "PR #39",
      observed: "2026-07-07",
      conf: "medium",
    });
    expect(updated).toContain("  {src: PR #39; observed: 2026-07-07; conf: medium}");
    expect(updated).not.toContain("observed: 2026-06-17");
  });

  it("normalizes a trailing annotation to standalone form on edit and supports clearing", () => {
    const updated = upsertClaimAnnotation(DOC, "HTTP server refuses", {
      src: "src/http/server.ts",
      observed: "2026-07-07",
      conf: "high",
    });
    expect(updated).toContain(
      "- The HTTP server refuses to start without an auth token.\n  {src: src/http/server.ts; observed: 2026-07-07; conf: high}",
    );

    const cleared = upsertClaimAnnotation(updated, "HTTP server refuses", null);
    expect(cleared).toContain("- The HTTP server refuses to start without an auth token.\n- Legacy claim");
  });

  it("round-trips through formatAnnotationBody", () => {
    const body = formatAnnotationBody({ src: "person:alice", observed: "2026-07-07", conf: "medium", id: "a-b" });
    expect(body).toBe("{src: person:alice; observed: 2026-07-07; conf: medium; id: a-b}");
    const parsed = parseAnnotationBody(body.slice(1, -1));
    expect(parsed.ok).toBe(true);
  });
});

describe("carryClaimAnnotations", () => {
  const OLD = `## Current State

- Stable claim.
  {src: PR #1; observed: 2026-01-01; conf: high}
- Reworded claim, original wording.
  {src: PR #2; observed: 2026-02-01; conf: medium}
- Broken annotation claim.
  {src: ; observed: nope; conf: wat}
`;

  it("carries annotations onto byte-identical unannotated bullets", () => {
    const NEW = `## Current State

- New unrelated claim.
- Stable claim.
`;
    const result = carryClaimAnnotations(OLD, NEW);
    expect(result.carried.map((entry) => entry.text)).toEqual(["Stable claim."]);
    expect(result.content).toContain("- Stable claim.\n  {src: PR #1; observed: 2026-01-01; conf: high}");
    expect(result.content).not.toContain("New unrelated claim.\n  {src:");
  });

  it("reports reworded or removed annotated claims as lost, ignoring malformed ones", () => {
    const NEW = `## Current State

- Stable claim.
- Reworded claim, new wording.
`;
    const result = carryClaimAnnotations(OLD, NEW);
    expect(result.lost).toEqual([
      { text: "Reworded claim, original wording.", annotation: { src: "PR #2", observed: "2026-02-01", conf: "medium" } },
    ]);
  });

  it("never overwrites an annotation the writer supplied", () => {
    const NEW = `## Current State

- Stable claim.
  {src: PR #99; observed: 2026-07-07; conf: medium}
`;
    const result = carryClaimAnnotations(OLD, NEW);
    expect(result.carried).toEqual([]);
    expect(result.content).toContain("PR #99");
    expect(result.content).not.toContain("PR #1");
  });

  it("pairs duplicate bullet texts in document order and inserts bottom-up correctly", () => {
    const oldDoc = `## Current State

- Same text.
  {src: PR #1; observed: 2026-01-01; conf: high}
- Same text.
  {src: PR #2; observed: 2026-02-01; conf: low}
`;
    const newDoc = `## Current State

- Same text.
- Same text.
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.carried).toHaveLength(2);
    const claims = extractClaims(result.content);
    expect(claims.map((entry) => entry.annotation?.src)).toEqual(["PR #1", "PR #2"]);
  });

  it("does not match identical text across different sections", () => {
    const oldDoc = `## Current State

- Shared wording.
  {src: PR #1; observed: 2026-01-01; conf: high}
`;
    const newDoc = `## Decisions

- Shared wording.
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.carried).toEqual([]);
    expect(result.lost).toHaveLength(1);
  });
});

describe("AnchorService claims", () => {
  let tmpDir: string;
  let repo: AnchorRepository;
  let service: AnchorService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "anchor-claims-"));
    repo = new AnchorRepository({ repoPath: tmpDir });
    await repo.ensureReady();
    service = new AnchorService(repo, { pushOnWrite: false, migrationWarnOnly: false, staleAfterDays: 45 });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function anchorContent(extraClaim = ""): string {
    // Local date so writes that keep last_validated unchanged pass the
    // lastValidatedBump validator's local-time "today" check.
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return `---
project:
  - demo
type: context-anchor
tags:
  - context-anchor
summary: "Claims test anchor."
read_this_if:
  - "You are testing claims."
last_validated: ${localToday}
---

# Claims Demo

## Current State

- Annotated claim about the system.
  {src: PR #54; observed: 2026-07-07; conf: high}
- Legacy claim with no provenance.${extraClaim}

## Decisions

- A decision claim.

## Constraints

- A constraint claim.

## PRs

None.
`;
  }

  it("lists claims with coverage summary and status filter", async () => {
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    // The write adds unannotated claims, so the provenance nudge fires.
    expect(write.warnings.some((warning) => warning.code === "claim_annotation_missing")).toBe(true);

    const all = await service.listClaims({ project: "demo" });
    expect(all.summary).toEqual({ total: 4, annotated: 1, unannotated: 3, malformed: 0 });

    const unannotated = await service.listClaims({ name: "projects/demo/claims-demo", status: "unannotated" });
    expect(unannotated.claims.map((claim) => claim.text)).toEqual([
      "Legacy claim with no provenance.",
      "A decision claim.",
      "A constraint claim.",
    ]);
    expect(unannotated.claims[0]?.anchor).toBe("projects/demo/claims-demo.md");
    // The coverage summary reflects the full scope even when the list is filtered.
    expect(unannotated.summary).toEqual({ total: 4, annotated: 1, unannotated: 3, malformed: 0 });
  });

  it("filters claims by section, confidence, text search, and observed window", async () => {
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent("\n- Another dated claim.\n  {src: docs/spec.md; observed: 2026-01-15; conf: low}"),
      message: "test: add claims demo",
    });
    expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(write.version).toBeTruthy();

    const section = await service.listClaims({ project: "demo", section: "Decisions" });
    expect(section.claims.map((claim) => claim.text)).toEqual(["A decision claim."]);
    expect(section.summary.total).toBe(5);

    const lowConf = await service.listClaims({ project: "demo", conf: "low" });
    expect(lowConf.claims.map((claim) => claim.text)).toEqual(["Another dated claim."]);

    const byText = await service.listClaims({ project: "demo", q: "ANNOTATED CLAIM" });
    expect(byText.claims.map((claim) => claim.text)).toEqual(["Annotated claim about the system."]);

    const bySrc = await service.listClaims({ project: "demo", q: "docs/spec" });
    expect(bySrc.claims.map((claim) => claim.text)).toEqual(["Another dated claim."]);

    const reverify = await service.listClaims({ project: "demo", observedBefore: "2026-06-01" });
    expect(reverify.claims.map((claim) => claim.text)).toEqual(["Another dated claim."]);

    const recent = await service.listClaims({ project: "demo", observedAfter: "2026-06-01" });
    expect(recent.claims.map((claim) => claim.text)).toEqual(["Annotated claim about the system."]);
  });

  it("annotates and clears a claim through annotateClaim", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    const annotate = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      src: "person:alice",
      observed: "2026-07-07",
      conf: "medium",
    });
    expect(annotate.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(annotate.version).toBeTruthy();

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    expect(listed.claims).toHaveLength(2);
    expect(listed.claims.map((claim) => claim.annotation?.src)).toContain("person:alice");

    const cleared = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      clear: true,
    });
    expect(cleared.version).toBeTruthy();
    const after = await service.listClaims({ name: "projects/demo/claims-demo", status: "unannotated" });
    expect(after.claims.map((claim) => claim.text)).toContain("Legacy claim with no provenance.");
  });

  it("returns typed blocks for invalid annotations, unknown claims, and ambiguity", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    const invalid = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      src: "person:alice",
      observed: "2026-07-07",
      conf: "high",
    });
    expect(invalid.version).toBeUndefined();
    expect(invalid.warnings[0]?.code).toBe("claim_annotation_invalid");

    const missing = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "does not exist",
      src: "PR #1",
      observed: "2026-07-07",
      conf: "low",
    });
    expect(missing.warnings[0]?.code).toBe("claim_not_found");

    const ambiguous = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "claim",
      src: "PR #1",
      observed: "2026-07-07",
      conf: "low",
    });
    expect(ambiguous.warnings[0]?.code).toBe("claim_ambiguous");
  });

  it("carries annotations through section rewrites that omit them", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    // Agent-style rewrite: same bullets, annotations not reproduced.
    const rewrite = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: "- Annotated claim about the system.\n- Legacy claim with no provenance.",
      message: "test: routine section rewrite",
    });
    expect(rewrite.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(rewrite.warnings.some((warning) => warning.code === "claim_annotation_carried")).toBe(true);
    expect(rewrite.version).toBeTruthy();

    const after = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    expect(after.claims.map((claim) => claim.annotation?.src)).toEqual(["PR #54"]);
  });

  it("blocks rewrites that drop provenance from reworded claims unless approved", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    const reword = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: "- Annotated claim about the system, now reworded.\n- Legacy claim with no provenance.",
      message: "test: reworded claim",
    });
    expect(reword.version).toBeUndefined();
    expect(reword.requiresApproval).toBe(true);
    expect(reword.warnings[0]?.code).toBe("claim_annotation_lost");

    const approved = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: "- Annotated claim about the system, now reworded.\n- Legacy claim with no provenance.",
      message: "test: reworded claim (approved)",
      approved: true,
    });
    expect(approved.version).toBeTruthy();
    expect(
      approved.warnings.some((warning) => warning.severity === "WARN" && warning.code === "claim_annotation_lost"),
    ).toBe(true);
  });

  it("annotateClaim clear is not resurrected by carry and is not blocked as a loss", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    const cleared = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim",
      clear: true,
    });
    expect(cleared.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(cleared.version).toBeTruthy();

    const after = await service.listClaims({ name: "projects/demo/claims-demo" });
    expect(after.summary.annotated).toBe(0);
  });

  it("nudges only for newly added unannotated claims, not the legacy backlog", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    // Re-touching the anchor without adding claims: no nudge for the
    // pre-existing unannotated claims.
    const retouch = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content:
        "- Annotated claim about the system.\n  {src: PR #54; observed: 2026-07-07; conf: high}\n- Legacy claim with no provenance.",
      message: "test: retouch without new claims",
    });
    expect(retouch.warnings.some((warning) => warning.code === "claim_annotation_missing")).toBe(false);

    // Adding a new annotated claim: no nudge either.
    const annotatedAdd = await service.appendToAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: "- New sourced claim.\n  {src: PR #60; observed: 2026-07-07; conf: medium}",
      message: "test: add annotated claim",
    });
    expect(annotatedAdd.warnings.some((warning) => warning.code === "claim_annotation_missing")).toBe(false);

    // Adding a new claim without provenance: one nudge naming the claim.
    const bareAdd = await service.appendToAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: "- New unsourced claim.",
      message: "test: add unsourced claim",
    });
    expect(bareAdd.version).toBeTruthy();
    const nudge = bareAdd.warnings.find((warning) => warning.code === "claim_annotation_missing");
    expect(nudge?.severity).toBe("WARN");
    expect(nudge?.message).toContain("New unsourced claim.");
    expect(nudge?.message).toContain("annotateClaim");
  });

  it("does not nudge when a pre-existing claim moves between sections", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    // "A decision claim." moves from Decisions into Constraints: same text,
    // different section — not a new statement, so no nudge.
    const moved = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Constraints",
      content: "- A constraint claim.\n- A decision claim.",
      message: "test: move claim between sections",
      approved: true,
    });
    expect(moved.version).toBeTruthy();
    expect(moved.warnings.some((warning) => warning.code === "claim_annotation_missing")).toBe(false);
  });

  it("does not nudge on annotateClaim writes", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const cleared = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim",
      clear: true,
    });
    expect(cleared.version).toBeTruthy();
    expect(cleared.warnings.some((warning) => warning.code === "claim_annotation_missing")).toBe(false);
  });

  it("blocks writes containing malformed annotations but allows unannotated claims", async () => {
    const malformed = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent("\n- Bad claim.\n  {src: ; observed: nope; conf: wat}"),
      message: "test: malformed annotation",
    });
    expect(malformed.version).toBeUndefined();
    expect(malformed.warnings.some((warning) => warning.code === "claim_annotation_invalid")).toBe(true);

    const clean = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: clean write",
    });
    expect(clean.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
  });
});
