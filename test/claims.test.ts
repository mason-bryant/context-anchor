import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnchorService } from "../src/anchorService.js";
import { AnchorRepository } from "../src/git/repo.js";
import {
  CLAIM_SECTIONS,
  carryClaimAnnotations,
  collectClaimIds,
  extractClaims,
  findInertClaimAnnotations,
  formatAnnotationBody,
  deleteClaim,
  isMintedClaimIdFormat,
  locateClaim,
  locateClaimByLine,
  looksLikeAnnotationBody,
  mintClaimId,
  mintMissingClaimIds,
  parseAnnotationBody,
  parseIdOnlyAnnotationBody,
  replaceClaimText,
  stripClaimAnnotations,
  upsertClaimAnnotation,
  upsertClaimSources,
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

  it("parses trust-me-bro developer assertions as high-confidence person-backed sources", () => {
    const result = parseAnnotationBody(
      "src: trust me bro; kind: trust-me-bro; person: alice; observed: 2026-07-08; conf: high",
    );
    expect(result).toEqual({
      ok: true,
      annotation: {
        src: "trust me bro",
        kind: "trust-me-bro",
        person: "alice",
        observed: "2026-07-08",
        conf: "high",
      },
    });
    const body = formatAnnotationBody({
      src: "trust me bro",
      kind: "trust-me-bro",
      person: "alice",
      observed: "2026-07-08",
      conf: "high",
    });
    expect(body).toBe("{src: trust me bro; kind: trust-me-bro; person: alice; observed: 2026-07-08; conf: high}");
  });

  it("parses slug-like configurable evidence kinds", () => {
    const result = parseAnnotationBody("src: docs/design.md; kind: design doc; observed: 2026-07-08; conf: medium");
    expect(result).toEqual({
      ok: true,
      annotation: { src: "docs/design.md", kind: "design-doc", observed: "2026-07-08", conf: "medium" },
    });
  });

  it("parses and round-trips derived_from / contradicts edge targets (WP5)", () => {
    const body = "src: PR #55; observed: 2026-07-08; conf: high; id: c-abc123; derived_from: projects/demo/other.md#c-def456; contradicts: #c-ghi789";
    const result = parseAnnotationBody(body);
    expect(result).toEqual({
      ok: true,
      annotation: {
        src: "PR #55",
        observed: "2026-07-08",
        conf: "high",
        id: "c-abc123",
        derivedFrom: "projects/demo/other.md#c-def456",
        contradicts: "#c-ghi789",
      },
    });
    // Serialize round-trip: formatAnnotationBody emits both keys.
    if (result.ok) {
      const reserialized = formatAnnotationBody(result.annotation);
      expect(reserialized).toContain("derived_from: projects/demo/other.md#c-def456");
      expect(reserialized).toContain("contradicts: #c-ghi789");
      // And the re-parse is byte-stable.
      const inner = reserialized.slice(1, -1);
      expect(parseAnnotationBody(inner)).toEqual(result);
    }
  });

  it("accepts the same-anchor shorthand #<claim-id> for edge targets", () => {
    const result = parseAnnotationBody("src: PR #1; observed: 2026-07-08; conf: medium; derived_from: #c-parent1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.annotation.derivedFrom).toBe("#c-parent1");
    }
  });

  it("BLOCKS a malformed edge-target FORMAT (no #, empty id, or bad id shape)", () => {
    const noHash = parseAnnotationBody("src: PR #1; observed: 2026-07-08; conf: low; derived_from: projects/demo/other.md");
    expect(noHash.ok).toBe(false);
    if (!noHash.ok) {
      expect(noHash.errors.join(" ")).toContain("derived_from must be");
    }
    const emptyId = parseAnnotationBody("src: PR #1; observed: 2026-07-08; conf: low; contradicts: anchor#");
    expect(emptyId.ok).toBe(false);
    if (!emptyId.ok) {
      expect(emptyId.errors.join(" ")).toContain("contradicts must be");
    }
    const badId = parseAnnotationBody("src: PR #1; observed: 2026-07-08; conf: low; derived_from: anchor#Not_Valid");
    expect(badId.ok).toBe(false);
  });

  it("collects derived_from / contradicts across a multi-row claim onto the claim (WP5)", () => {
    const content = [
      "## Current State",
      "",
      "- A downstream claim.",
      "  {src: PR #1; observed: 2026-07-08; conf: high; id: c-multi1; derived_from: #c-parent1}",
      "  {src: docs/a.md; observed: 2026-07-08; conf: medium; derived_from: #c-parent2; contradicts: #c-rival1}",
      "",
    ].join("\n");
    const [claim] = extractClaims(content);
    expect(claim.status).toBe("annotated");
    expect(claim.id).toBe("c-multi1");
    expect(claim.derivedFrom).toEqual(["#c-parent1", "#c-parent2"]);
    expect(claim.contradicts).toEqual(["#c-rival1"]);
  });

  it("keeps person fields for configurable person-backed evidence kinds", () => {
    const result = parseAnnotationBody(
      "src: engineer-attestation; kind: engineer-attestation; person: Alice Example; observed: 2026-07-08; conf: high",
    );
    expect(result).toEqual({
      ok: true,
      annotation: {
        src: "engineer-attestation",
        kind: "engineer-attestation",
        person: "Alice Example",
        observed: "2026-07-08",
        conf: "high",
      },
    });
  });

  it("rejects trust-me-bro sources without a person or high confidence", () => {
    const missing = parseAnnotationBody("src: trust me bro; observed: 2026-07-08; conf: high");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.join(" ")).toContain("person field");
    }

    const medium = parseAnnotationBody(
      "src: trust me bro; kind: trust-me-bro; person: alice; observed: 2026-07-08; conf: medium",
    );
    expect(medium.ok).toBe(false);
    if (!medium.ok) {
      expect(medium.errors.join(" ")).toContain("always use conf: high");
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

describe("parseIdOnlyAnnotationBody (Goal 0 Phase 1 WP4)", () => {
  it("parses a valid id-only body", () => {
    const result = parseIdOnlyAnnotationBody("id: c-abc123");
    expect(result).toEqual({ ok: true, id: "c-abc123" });
  });

  it("parses a valid id-only body with a legacy kebab-case id", () => {
    const result = parseIdOnlyAnnotationBody("id: owner-resolution");
    expect(result).toEqual({ ok: true, id: "owner-resolution" });
  });

  it("returns undefined (defer to parseAnnotationBody) when the body also carries a provenance key", () => {
    expect(parseIdOnlyAnnotationBody("id: c-abc123; src: PR #1")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("id: c-abc123; observed: 2026-07-13")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("id: c-abc123; conf: high")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("id: c-abc123; kind: url")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("id: c-abc123; person: alice")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("id: c-abc123; derived_from: #c-other")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("id: c-abc123; contradicts: #c-other")).toBeUndefined();
  });

  it("returns undefined when there is no id key at all (defer to parseAnnotationBody for its own error reporting)", () => {
    expect(parseIdOnlyAnnotationBody("src: PR #1; observed: 2026-07-13; conf: high")).toBeUndefined();
    expect(parseIdOnlyAnnotationBody("")).toBeUndefined();
  });

  it("reports a malformed id-only body with an invalid id shape", () => {
    const result = parseIdOnlyAnnotationBody("id: Not_Valid!");
    expect(result).toEqual({ ok: false, errors: [expect.stringContaining("id must be kebab-case")] });
  });
});

describe("looksLikeAnnotationBody: bare id (Goal 0 Phase 1 WP4)", () => {
  it("recognizes a bare id-only body as an annotation attempt", () => {
    expect(looksLikeAnnotationBody("id: c-abc123")).toBe(true);
  });

  it("still recognizes bodies carrying the pre-existing keys", () => {
    expect(looksLikeAnnotationBody("src: PR #1; observed: 2026-07-13; conf: high")).toBe(true);
  });
});

describe("extractClaims", () => {
  it("treats Introduction and Invariants bullets as editable claims", () => {
    const claims = extractClaims(`## Introduction

### Goals

- Make project intent easy to review.

## Invariants

- INV-001: Stored context remains reviewable Markdown.
`);

    expect(claims.map((claim) => ({ section: claim.section, text: claim.text }))).toEqual([
      { section: "Introduction", text: "Make project intent easy to review." },
      { section: "Invariants", text: "INV-001: Stored context remains reviewable Markdown." },
    ]);
  });

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

  it("finds standalone and inline annotations that are inert outside claim-bearing H2 sections", () => {
    const inert = findInertClaimAnnotations(`## Definition and Registration

- Standalone source claim.
  {src: src/views.py; observed: 2026-07-13; conf: high}
- Inline source claim. {src: PR #42; observed: 2026-07-13; conf: medium}
- Bullet containing a fenced annotation example.
  \`\`\`markdown
  {src: src/nested-fence.py; observed: 2026-07-13; conf: high}
  \`\`\`

\`\`\`
- Fenced source claim.
  {src: src/fenced.py; observed: 2026-07-13; conf: high}
\`\`\`

## Current State

### Definition and Registration

- Active source claim.
  {src: src/active.py; observed: 2026-07-13; conf: high}
`);

    expect(inert).toEqual([
      {
        section: "Definition and Registration",
        bulletLine: 3,
        annotationLines: [4],
        text: "Standalone source claim.",
      },
      {
        section: "Definition and Registration",
        bulletLine: 5,
        annotationLines: [5],
        text: "Inline source claim.",
      },
    ]);
  });

  it("does not parse a standalone annotation example inside a bullet's fenced continuation", () => {
    const claims = extractClaims(`## Current State

- Claim with a provenance example.
  \`\`\`markdown
  {src: src/example.py; observed: 2026-07-13; conf: high}
  \`\`\`
`);

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      text: "Claim with a provenance example.",
      status: "unannotated",
      sources: [],
    });
  });

  it("extracts multiple sources and computes combined strength", () => {
    const doc = `## Current State

- Multi-source claim.
  {src: src/a.ts; observed: 2026-07-01; conf: high}
  {src: PR #42; observed: 2026-07-02; conf: medium}
`;
    const [claim] = extractClaims(doc);
    expect(claim.sources.map((source) => source.src)).toEqual(["src/a.ts", "PR #42"]);
    expect(claim.annotation?.src).toBe("src/a.ts");
    expect(claim.strength).toBe("high");
    expect(claim.strengthScore).toBe(2.5);
  });

  it("strips claim annotations while preserving claim text", () => {
    const stripped = stripClaimAnnotations(`- Standalone source claim.
  {src: PR #42; observed: 2026-07-08; conf: medium}
- Inline source claim. {src: src/a.ts; observed: 2026-07-08; conf: high}
- Unsourced claim.`);

    expect(stripped).toBe(`- Standalone source claim.
- Inline source claim.
- Unsourced claim.`);
  });

  it("keeps valid sources while reporting malformed source rows", () => {
    const doc = `## Current State

- Mixed source claim.
  {src: src/a.ts; observed: 2026-07-01; conf: high}
  {src: ; observed: nope; conf: certain}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("malformed");
    expect(claim.sources.map((source) => source.src)).toEqual(["src/a.ts"]);
    expect(claim.sourceErrors?.[0]?.line).toBe(5);
    expect(claim.annotationErrors?.join(" ")).toContain("Line 5");
  });

  it("parses a claim-level id from a multi-row claim when the id is on the second line", () => {
    const doc = `## Current State

- Multi-row claim with id on the second source.
  {src: src/a.ts; observed: 2026-07-01; conf: high}
  {src: PR #42; observed: 2026-07-02; conf: medium; id: c-abc123}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("annotated");
    expect(claim.id).toBe("c-abc123");
  });

  it("accepts a legacy kebab-case id as a valid claim id", () => {
    const doc = `## Current State

- Legacy-id claim.
  {src: PR #1; observed: 2026-01-01; conf: high; id: owner-resolution}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("annotated");
    expect(claim.id).toBe("owner-resolution");
    expect(isMintedClaimIdFormat(claim.id as string)).toBe(false);
  });

  it("blocks (marks malformed) a claim whose rows carry conflicting ids", () => {
    const doc = `## Current State

- Conflicting id claim.
  {src: src/a.ts; observed: 2026-07-01; conf: high; id: c-aaaaaa}
  {src: PR #42; observed: 2026-07-02; conf: medium; id: c-bbbbbb}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("malformed");
    expect(claim.annotationErrors?.join(" ")).toContain("conflicting ids");
  });
});

describe("extractClaims: id-only claims (Goal 0 Phase 1 WP4)", () => {
  it("parses a standalone id-only claim as unannotated-with-id, not malformed or dropped", () => {
    const doc = `## Current State

- Legacy claim with a stable id but no provenance.
  {id: c-abc123}
`;
    const [claim] = extractClaims(doc);
    expect(claim).toBeDefined();
    expect(claim.status).toBe("unannotated");
    expect(claim.id).toBe("c-abc123");
    expect(claim.idProvenanceless).toBe(true);
    expect(claim.sources).toEqual([]);
    expect(claim.strength).toBe("low");
  });

  it("parses a trailing (inline) id-only claim the same way", () => {
    const doc = `## Current State

- Legacy claim with a stable id but no provenance. {id: c-abc123}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("unannotated");
    expect(claim.id).toBe("c-abc123");
    expect(claim.idProvenanceless).toBe(true);
    expect(claim.annotationInline).toBe(true);
    // The bullet text itself must not retain the annotation block.
    expect(claim.text).toBe("Legacy claim with a stable id but no provenance.");
  });

  it("round-trips byte-identically: extracting and re-serializing the same content changes nothing", () => {
    const doc = `## Current State

- Legacy claim with a stable id but no provenance.
  {id: c-abc123}
`;
    const claims = extractClaims(doc);
    expect(claims).toHaveLength(1);
    // No write helper is invoked; re-parsing the same untouched content
    // yields byte-identical claim data every time (pure function, no
    // hidden normalization on read).
    const reparsed = extractClaims(doc);
    expect(reparsed).toEqual(claims);
  });

  it("does not count an id-only claim as a source, so summarizeClaimProvenance treats it as unannotated", () => {
    const doc = `## Current State

- Legacy claim with a stable id but no provenance.
  {id: c-abc123}
- Fully annotated claim.
  {src: PR #1; observed: 2026-07-13; conf: high}
`;
    const claims = extractClaims(doc);
    expect(claims.map((c) => c.status)).toEqual(["unannotated", "annotated"]);
    expect(claims[0].sources).toHaveLength(0);
    expect(claims[1].sources).toHaveLength(1);
  });

  it("marks the claim malformed when an id-only row conflicts with a different id on another row", () => {
    const doc = `## Current State

- Conflicting id-only claim.
  {id: c-aaaaaa}
  {id: c-bbbbbb}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("malformed");
    expect(claim.annotationErrors?.join(" ")).toContain("conflicting ids");
  });

  it("marks the claim malformed when an id-only row conflicts with a differently-valued annotated source's id", () => {
    const doc = `## Current State

- Conflicting mixed id claim.
  {src: PR #1; observed: 2026-07-13; conf: high; id: c-aaaaaa}
  {id: c-bbbbbb}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("malformed");
    expect(claim.annotationErrors?.join(" ")).toContain("conflicting ids");
  });

  it("is not provenanceless when an id-only row's id matches the SAME id already carried by an annotated source (redundant, not conflicting)", () => {
    const doc = `## Current State

- Redundant same-id claim.
  {src: PR #1; observed: 2026-07-13; conf: high; id: c-abc123}
  {id: c-abc123}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("annotated");
    expect(claim.id).toBe("c-abc123");
    expect(claim.idProvenanceless).toBe(false);
  });

  it("rejects an id-only row with a malformed id shape as malformed (not silently accepted)", () => {
    const doc = `## Current State

- Bad id shape claim.
  {id: Not_Valid!}
`;
    const [claim] = extractClaims(doc);
    expect(claim.status).toBe("malformed");
    expect(claim.annotationErrors?.join(" ")).toContain("kebab-case");
  });

  it("existing fully-annotated and plain-unannotated claim parsing is unchanged alongside an id-only claim in the same document", () => {
    const claims = extractClaims(DOC);
    const byText = new Map(claims.map((claim) => [claim.text, claim]));
    expect(byText.get("Owner resolution resolves a person before a team.")).toMatchObject({ status: "annotated" });
    expect(byText.get("Legacy claim with no provenance.")).toMatchObject({ status: "unannotated", id: undefined });
  });
});

describe("mintClaimId / collectClaimIds / mintMissingClaimIds", () => {
  it("mints ids matching the c-xxxxxx format and unique against the existing set", () => {
    const existing = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const id = mintClaimId(existing);
      expect(id).toMatch(/^c-[a-z0-9]{6,8}$/);
      expect(existing.has(id)).toBe(false);
      existing.add(id);
    }
  });

  it("grows to 8 characters when the 6-character space is exhausted", () => {
    // Force every possible 6-char id to appear "taken" so mintClaimId must
    // grow to 8 chars; we simulate this with a Set-like object that always
    // reports a hit for 6-char candidates only.
    const existing: ReadonlySet<string> = {
      has: (value: string) => /^c-[a-z0-9]{6}$/.test(value),
    } as unknown as ReadonlySet<string>;
    const id = mintClaimId(existing);
    expect(id).toMatch(/^c-[a-z0-9]{8}$/);
  });

  it("collects every id present across a list of claims", () => {
    const doc = `## Current State

- Claim one.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-one111}
- Claim two.
  {src: PR #2; observed: 2026-01-02; conf: medium; id: c-two222}
- Claim three, unannotated.
`;
    const ids = collectClaimIds(extractClaims(doc));
    expect(ids).toEqual(new Set(["c-one111", "c-two222"]));
  });

  it("mints missing ids for annotated claims and reports each mint, without re-minting existing ids", () => {
    const doc = `## Current State

- Already has an id.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-existg}
- Needs an id.
  {src: PR #2; observed: 2026-01-02; conf: medium}
- Unannotated claim stays id-less.
`;
    const result = mintMissingClaimIds(doc, new Set(["c-existg"]));
    expect(result.minted).toHaveLength(1);
    expect(result.minted[0]?.text).toBe("Needs an id.");
    expect(result.minted[0]?.id).toMatch(/^c-[a-z0-9]{6,8}$/);

    const claims = extractClaims(result.content);
    expect(claims.find((claim) => claim.text === "Already has an id.")?.id).toBe("c-existg");
    expect(claims.find((claim) => claim.text === "Needs an id.")?.id).toBe(result.minted[0]?.id);
    expect(claims.find((claim) => claim.text === "Unannotated claim stays id-less.")?.id).toBeUndefined();
  });

  it("never mints for unannotated or malformed claims", () => {
    const doc = `## Current State

- Unannotated claim.
- Malformed claim.
  {src: ; observed: nope; conf: certain}
`;
    const result = mintMissingClaimIds(doc, new Set());
    expect(result.minted).toEqual([]);
    expect(result.content).toBe(doc);
  });

  it("does not mint an id that collides with a legacy/manual id already in the same document", () => {
    // A legacy id lives on another claim in the same content, but is NOT in
    // the tree-id set passed in. mintMissingClaimIds must fold in-document
    // ids into its uniqueness set so the mint never collides, leaving the
    // resulting document free of duplicate ids (no false duplicate later).
    const doc = `## Current State

- Claim with a manual id.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-legacy}
- Claim needing a minted id.
  {src: PR #2; observed: 2026-01-02; conf: medium}
`;
    const result = mintMissingClaimIds(doc, new Set());
    expect(result.minted).toHaveLength(1);
    expect(result.minted[0]?.id).not.toBe("c-legacy");
    const ids = collectClaimIds(extractClaims(result.content));
    expect(ids.size).toBe(2); // two distinct ids, no collision
    expect(ids.has("c-legacy")).toBe(true);
    expect(ids.has(result.minted[0]?.id as string)).toBe(true);
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

  it("locates by line and replaces all sources", () => {
    expect(locateClaimByLine(DOC, 12)).toMatchObject({ ok: true });
    const updated = upsertClaimSources(DOC, { line: 12 }, [
      { src: "src/a.ts", observed: "2026-07-07", conf: "high" },
      { src: "PR #55", observed: "2026-07-08", conf: "medium" },
    ]);
    expect(updated).toContain(
      "- Legacy claim with no provenance.\n  {src: src/a.ts; observed: 2026-07-07; conf: high}\n  {src: PR #55; observed: 2026-07-08; conf: medium}",
    );
  });

  it("collapses a single id onto the first row when replacing sources", () => {
    const updated = upsertClaimSources(DOC, { line: 12 }, [
      { src: "src/a.ts", observed: "2026-07-07", conf: "high" },
      { src: "PR #55", observed: "2026-07-08", conf: "medium", id: "c-single" },
    ]);
    // The id moves to the first serialized row, stripped from the second.
    expect(updated).toContain(
      "- Legacy claim with no provenance.\n  {src: src/a.ts; observed: 2026-07-07; conf: high; id: c-single}\n  {src: PR #55; observed: 2026-07-08; conf: medium}",
    );
    const claim = extractClaims(updated).find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.status).toBe("annotated");
    expect(claim?.id).toBe("c-single");
  });

  it("does not silently collapse conflicting ids: >1 distinct id stays malformed", () => {
    // If a caller supplies two distinct ids across a claim's rows,
    // normalizeIdPlacement must leave them in place so the parser flags the
    // claim malformed rather than hiding the authoring conflict.
    const updated = upsertClaimSources(DOC, { line: 12 }, [
      { src: "src/a.ts", observed: "2026-07-07", conf: "high", id: "c-aaaaaa" },
      { src: "PR #55", observed: "2026-07-08", conf: "medium", id: "c-bbbbbb" },
    ]);
    expect(updated).toContain("id: c-aaaaaa");
    expect(updated).toContain("id: c-bbbbbb");
    const claim = extractClaims(updated).find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.status).toBe("malformed");
    expect(claim?.annotationErrors?.join(" ")).toContain("conflicting ids");
  });

  it("replaces claim text while preserving attached sources", () => {
    const updated = replaceClaimText(DOC, { line: 9 }, "Owner resolution prefers registered people.");
    expect(updated).toContain(
      "- Owner resolution prefers registered people.\n  {src: PR #39; observed: 2026-06-17; conf: high}",
    );
    expect(updated).not.toContain("- Owner resolution resolves a person before a team.");

    const inline = replaceClaimText(DOC, { line: 11 }, "HTTP auth remains required.");
    expect(inline).toContain(
      "- HTTP auth remains required. {src: src/http/server.ts; observed: 2026-06-01; conf: high}",
    );
  });

  it("deletes a claim with its attached source block", () => {
    const updated = deleteClaim(DOC, { line: 9 });
    expect(updated).not.toContain("Owner resolution resolves a person before a team.");
    expect(updated).not.toContain("src: PR #39");
    expect(updated).toContain("- The HTTP server refuses to start without an auth token.");
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

  it("carries all sources on byte-identical bullets", () => {
    const oldDoc = `## Current State

- Stable claim.
  {src: PR #1; observed: 2026-01-01; conf: high}
  {src: src/a.ts; observed: 2026-01-02; conf: medium}
`;
    const newDoc = `## Current State

- Stable claim.
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.carried[0]?.sources).toEqual([
      { src: "PR #1", observed: "2026-01-01", conf: "high" },
      { src: "src/a.ts", observed: "2026-01-02", conf: "medium" },
    ]);
    expect(result.content).toContain(
      "- Stable claim.\n  {src: PR #1; observed: 2026-01-01; conf: high}\n  {src: src/a.ts; observed: 2026-01-02; conf: medium}",
    );
  });

  it("reports reworded or removed annotated claims as lost, ignoring malformed ones", () => {
    const NEW = `## Current State

- Stable claim.
- Reworded claim, new wording.
`;
    const result = carryClaimAnnotations(OLD, NEW);
    expect(result.lost).toEqual([
      {
        text: "Reworded claim, original wording.",
        annotation: { src: "PR #2", observed: "2026-02-01", conf: "medium" },
        sources: [{ src: "PR #2", observed: "2026-02-01", conf: "medium" }],
      },
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

  it("carries sources by id onto a reworded claim, id match winning over text match", () => {
    const oldDoc = `## Current State

- Original wording, kept id.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-keepid}
  {src: src/a.ts; observed: 2026-01-02; conf: medium}
`;
    const newDoc = `## Current State

- Completely reworded text, same id.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-keepid}
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.lost).toEqual([]);
    // The second old source row (src/a.ts) is missing from the reworded
    // claim's single annotation line, so id-match still re-applies the full
    // old source set rather than silently keeping the partial new one.
    expect(result.carried.map((entry) => entry.text)).toEqual(["Completely reworded text, same id."]);

    const claims = extractClaims(result.content);
    const reworded = claims.find((claim) => claim.text === "Completely reworded text, same id.");
    expect(reworded?.id).toBe("c-keepid");
    expect(reworded?.sources.map((source) => source.src)).toEqual(["PR #1", "src/a.ts"]);
    expect(reworded?.status).toBe("annotated");
  });

  it("keeps derived_from across a reword that keeps its id (WP5)", () => {
    const oldDoc = `## Current State

- Original wording, kept id, has an edge.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-keepid; derived_from: #c-parent1}
`;
    // Reworded text; the new annotation dropped the derived_from key entirely.
    const newDoc = `## Current State

- Reworded but keeps id, edge dropped from the new annotation.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-keepid}
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.lost).toEqual([]);
    const reworded = extractClaims(result.content).find((claim) => claim.id === "c-keepid");
    expect(reworded?.status).toBe("annotated");
    // Carry-by-id re-applies the full old source set, so the derived_from edge
    // survives the reword even though the new annotation omitted it.
    expect(reworded?.derivedFrom).toEqual(["#c-parent1"]);
  });

  it("leaves a reworded claim alone when its kept id already carries the full old source set", () => {
    const oldDoc = `## Current State

- Original wording.
  {src: PR #7; observed: 2026-03-01; conf: high; id: c-samesrc}
`;
    const newDoc = `## Current State

- Reworded text, same source already present.
  {src: PR #7; observed: 2026-03-01; conf: high; id: c-samesrc}
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.lost).toEqual([]);
    // Sources are already identical, so this is still reported as carried
    // (the replacement is a no-op rewrite) rather than lost or blocked.
    expect(result.carried.map((entry) => entry.text)).toEqual(["Reworded text, same source already present."]);
    expect(result.content).toContain(
      "- Reworded text, same source already present.\n  {src: PR #7; observed: 2026-03-01; conf: high; id: c-samesrc}",
    );
  });

  it("reports loss when both the id and the byte-identical text are absent from new content", () => {
    const oldDoc = `## Current State

- Original wording, dropped id.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-dropid}
`;
    const newDoc = `## Current State

- Reworded text with no matching id anywhere.
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.carried).toEqual([]);
    expect(result.lost.map((entry) => entry.text)).toEqual(["Original wording, dropped id."]);
  });

  it("does not overwrite a reworded-but-kept-id claim whose new annotation is malformed", () => {
    // The kept id sits on a valid row, so the claim still exposes its id even
    // though a sibling row is malformed. Carry-by-id must NOT replace the rows
    // here, or it would mask the malformed annotation the writer must fix.
    const oldDoc = `## Current State

- Original wording, kept id.
  {src: PR #1; observed: 2026-01-01; conf: high; id: c-malf}
`;
    const newDoc = `## Current State

- Reworded text, same id but a malformed sibling row.
  {src: PR #2; observed: 2026-01-02; conf: high; id: c-malf}
  {src: PR #3; observed: not-a-date; conf: high}
`;
    const result = carryClaimAnnotations(oldDoc, newDoc);
    expect(result.carried).toEqual([]);
    // The old source (PR #1) is not injected; the writer's malformed rows stand.
    expect(result.content).not.toContain("PR #1");
    const reworded = extractClaims(result.content).find(
      (claim) => claim.text === "Reworded text, same id but a malformed sibling row.",
    );
    expect(reworded?.status).toBe("malformed");
    expect(reworded?.id).toBe("c-malf");
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

  function anchorContent(extraClaim = "", lastValidated?: string): string {
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
last_validated: ${lastValidated ?? localToday}
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

  function dateKey(value: unknown): unknown {
    return value instanceof Date ? value.toISOString().slice(0, 10) : value;
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
    // annotateClaim funnels through writeAnchor, so both annotated claims
    // (the pre-existing one and this newly annotated one) end up with a
    // minted claim id (WP1 acceptance: no annotated claim leaves a write
    // without an id).
    expect(listed.claims.every((claim) => Boolean(claim.id))).toBe(true);

    const cleared = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      clear: true,
    });
    expect(cleared.version).toBeTruthy();
    const after = await service.listClaims({ name: "projects/demo/claims-demo", status: "unannotated" });
    expect(after.claims.map((claim) => claim.text)).toContain("Legacy claim with no provenance.");
  });

  it("does not require a last_validated bump for provenance-only source edits", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent("", "1900-01-01"),
      message: "test: add stale claims demo",
    });

    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [{ src: "PR #42", observed: "2026-07-08", conf: "medium" }],
    });

    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(set.version).toBeTruthy();

    const read = await service.readAnchor("projects/demo/claims-demo");
    expect(dateKey(read.frontmatter.last_validated)).toBe("1900-01-01");
    // The claim had no id before this edit, so the write pipeline mints one
    // (WP1) — the source line still carries PR #42, plus a fresh id.
    expect(read.content).toContain("src: PR #42; observed: 2026-07-08; conf: medium");
    expect(read.content).toMatch(/\{src: PR #42; observed: 2026-07-08; conf: medium; id: c-[a-z0-9]{6,8}\}/);
  });

  it("sets multiple sources by line and resolves source links", async () => {
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    await service.writeProjectMappings({
      mappings: {
        projects: [
          {
            project: "demo",
            repos: [
              {
                repo: "repo-alpha",
                paths: [],
                web: {
                  url: "https://github.com/owner/repo-alpha",
                  branch: "main",
                  pullRequestTemplate: "{url}/pull/{number}",
                },
              },
            ],
          },
        ],
      },
      message: "test: add project mappings",
    });

    const read = await service.readAnchor("projects/demo/claims-demo");
    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      line: 19,
      sources: [
        { src: "src/a.ts#L12", observed: "2026-07-08", conf: "high" },
        { src: "PR #42", observed: "2026-07-07", conf: "medium" },
      ],
      expectedFileCommit: read.fileCommit,
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(set.version).toBeTruthy();

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "PR #42" });
    const claim = listed.claims.find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.sources.map((source) => source.src)).toEqual(["src/a.ts#L12", "PR #42"]);
    expect(claim?.strength).toBe("high");
    expect(claim?.sources[0]?.href).toBe("https://github.com/owner/repo-alpha/blob/main/src/a.ts#L12");
    expect(claim?.sources[1]?.href).toBe("https://github.com/owner/repo-alpha/pull/42");
  });

  it("does not resolve person-sourced claims as repo-prefixed files", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    await service.writeProjectMappings({
      mappings: {
        projects: [
          {
            project: "demo",
            repos: [
              {
                repo: "person",
                paths: [],
                web: { url: "https://github.com/owner/person" },
              },
            ],
          },
        ],
      },
      message: "test: add project mappings",
    });

    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [{ src: "person:alice", observed: "2026-07-08", conf: "medium" }],
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "person:alice" });
    const claim = listed.claims.find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.sources[0]).toMatchObject({ src: "person:alice", conf: "medium" });
    expect(claim?.sources[0]?.href).toBeUndefined();
  });

  it("accepts default and configured evidence source types", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    await service.writeProjectMappings({
      mappings: {
        claimSourceTypes: [
          { id: "runbook", label: "Runbook" },
        ],
        projects: [],
      },
      message: "test: configure source types",
    });

    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [
        { src: "src/a.ts", kind: "source", observed: "2026-07-08", conf: "high" },
        { src: "docs/evidence.md", kind: "evidence", observed: "2026-07-08", conf: "medium" },
        { src: "docs/design.md", kind: "design-doc", observed: "2026-07-08", conf: "medium" },
        { src: "docs/adr-001.md", kind: "adr", observed: "2026-07-08", conf: "medium" },
        { src: "docs/runbook.md", kind: "runbook", observed: "2026-07-08", conf: "low" },
      ],
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "runbook" });
    const claim = listed.claims.find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.sources.map((source) => source.kind ?? "url")).toEqual(["url", "url", "design-doc", "adr", "runbook"]);
    expect(claim?.sources[0]?.kind).toBeUndefined();
    expect(claim?.sources[1]?.kind).toBeUndefined();

    const rejected = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [{ src: "docs/unknown.md", kind: "unknown-type", observed: "2026-07-08", conf: "medium" }],
    });
    expect(rejected.warnings.some((warning) => warning.message.includes("unknown claim source type"))).toBe(true);
  });

  it("accepts configured person-backed source types", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    await service.writePeopleRegistry({
      registry: {
        people: [{ id: "alice", displayName: "Alice Example", identities: { names: ["AE"] } }],
        teams: [],
      },
      message: "test: add person",
    });
    await service.writeProjectMappings({
      mappings: {
        claimSourceTypes: [
          { id: "engineer-attestation", label: "Engineer Attestation", requiresPerson: true, lockedConfidence: "high" },
        ],
        projects: [],
      },
      message: "test: configure person-backed source type",
    });

    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [
        {
          src: "engineer-attestation",
          kind: "engineer-attestation",
          person: "Alice Example",
          observed: "2026-07-08",
          conf: "high",
        },
      ],
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "Alice" });
    const claim = listed.claims.find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.sources[0]).toMatchObject({
      src: "engineer-attestation",
      kind: "engineer-attestation",
      person: "alice",
      personName: "Alice Example",
      conf: "high",
    });

    const rejected = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [
        {
          src: "engineer-attestation",
          kind: "engineer-attestation",
          person: "Alice Example",
          observed: "2026-07-08",
          conf: "medium",
        },
      ],
    });
    expect(rejected.warnings.some((warning) => warning.message.includes("engineer-attestation sources require conf: high"))).toBe(
      true,
    );
  });

  it("sets trust-me-bro sources by resolving a named developer to a person id", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    await service.writePeopleRegistry({
      registry: {
        people: [{ id: "alice", displayName: "Alice Example", identities: { names: ["AE"] } }],
        teams: [],
      },
      message: "test: add person",
    });

    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [
        {
          src: "trust me bro",
          kind: "trust-me-bro",
          person: "Alice Example",
          observed: "2026-07-08",
          conf: "high",
        },
      ],
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "alice" });
    const claim = listed.claims.find((entry) => entry.text === "Legacy claim with no provenance.");
    expect(claim?.sources[0]).toMatchObject({
      src: "trust me bro",
      kind: "trust-me-bro",
      person: "alice",
      personName: "Alice Example",
      conf: "high",
    });
    expect(claim?.strength).toBe("high");

    const rejected = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [
        {
          src: "trust me bro",
          kind: "trust-me-bro",
          person: "Unknown Person",
          observed: "2026-07-08",
          conf: "high",
        },
      ],
    });
    expect(rejected.warnings.some((warning) => warning.code === "claim_annotation_invalid")).toBe(true);
  });

  it("rejects stale setClaimSources writes", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const read = await service.readAnchor("projects/demo/claims-demo");
    await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim",
      src: "PR #1",
      observed: "2026-07-07",
      conf: "medium",
    });

    const stale = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [{ src: "PR #2", observed: "2026-07-08", conf: "low" }],
      expectedFileCommit: read.fileCommit,
    });
    expect(stale.version).toBeUndefined();
    expect(stale.warnings[0]?.code).toBe("stale_base");
  });

  it("updates and deletes claim text by line while preserving or removing sources", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Legacy claim",
      sources: [{ src: "PR #2", observed: "2026-07-08", conf: "medium" }],
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const before = await service.listClaims({ name: "projects/demo/claims-demo", q: "Legacy claim" });
    const target = before.claims.find((claim) => claim.text === "Legacy claim with no provenance.");
    expect(target).toBeTruthy();

    const updated = await service.updateClaimText({
      name: "projects/demo/claims-demo",
      line: target?.line,
      text: "Legacy claim now has revised wording.",
      approved: true,
    });
    expect(updated.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "revised wording" });
    expect(listed.claims[0]?.text).toBe("Legacy claim now has revised wording.");
    expect(listed.claims[0]?.sources.map((source) => source.src)).toEqual(["PR #2"]);

    const needsApproval = await service.updateClaimText({
      name: "projects/demo/claims-demo",
      line: listed.claims[0]?.line,
      delete: true,
    });
    expect(needsApproval.version).toBeUndefined();
    expect(needsApproval.warnings[0]?.code).toBe("requires_approval");

    const deleted = await service.updateClaimText({
      name: "projects/demo/claims-demo",
      line: listed.claims[0]?.line,
      delete: true,
      approved: true,
    });
    expect(deleted.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const after = await service.listClaims({ name: "projects/demo/claims-demo", q: "revised wording" });
    expect(after.claims).toHaveLength(0);
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

  it("warns when a provenance annotation is inert in a non-claim-bearing H2 section", async () => {
    const content = anchorContent().replace(
      "## Decisions",
      `## Definition and Registration

- A ZView declares its schema in Python.
  {src: app/hub_platform/z_views/models/base/views.py; observed: 2026-07-13; conf: high}

## Decisions`,
    );
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content,
      message: "test: add inert provenance annotation",
    });

    expect(write.version).toBeTruthy();
    const warning = write.warnings.find(
      (entry) => entry.code === "claim_annotation_in_non_claim_section",
    );
    expect(warning).toMatchObject({ severity: "WARN" });
    expect(warning?.message).toContain('section "Definition and Registration"');
    expect(warning?.message).toContain("no claim will be created");
    expect(warning?.message).toContain("use an H3 topic");
    for (const section of CLAIM_SECTIONS) {
      expect(warning?.message).toContain(section);
    }

    const listed = await service.listClaims({ name: "projects/demo/claims-demo" });
    expect(listed.summary.malformed).toBe(0);
    expect(listed.claims.some((claim) => claim.text.includes("ZView declares"))).toBe(false);
  });

  it("mints a stable id for an annotated claim that lacks one, reporting a claim_id_minted WARN", async () => {
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    const minted = write.warnings.find((warning) => warning.code === "claim_id_minted");
    expect(minted).toBeTruthy();
    expect(minted?.severity).toBe("WARN");
    expect(minted?.message).toContain("Annotated claim about the system.");

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    expect(listed.claims).toHaveLength(1);
    expect(listed.claims[0]?.id).toMatch(/^c-[a-z0-9]{6,8}$/);
  });

  it("acceptance: after a successful write, listClaims shows zero annotated claims without ids", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent("\n- Another annotated claim.\n  {src: PR #60; observed: 2026-07-08; conf: medium}"),
      message: "test: add claims demo",
    });
    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    expect(listed.claims.length).toBeGreaterThan(0);
    expect(listed.claims.every((claim) => Boolean(claim.id))).toBe(true);
  });

  it("mints alongside a legacy id in the same document without a false duplicate block", async () => {
    // First claim carries a manual legacy id; second annotated claim has no
    // id and must be minted. The mint must not collide with the legacy id,
    // and the write must not spuriously BLOCK as claim_id_duplicate.
    const content = anchorContent(
      "\n- A second annotated claim needing a mint.\n  {src: PR #61; observed: 2026-07-08; conf: high}",
    ).replace(
      "- Annotated claim about the system.\n  {src: PR #54; observed: 2026-07-07; conf: high}",
      "- Annotated claim about the system.\n  {src: PR #54; observed: 2026-07-07; conf: high; id: manual-legacy-id}",
    );
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content,
      message: "test: legacy id plus a mint",
    });
    expect(write.version).toBeTruthy();
    expect(write.warnings.some((warning) => warning.code === "claim_id_duplicate")).toBe(false);
    expect(write.warnings.some((warning) => warning.code === "claim_id_minted")).toBe(true);

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    const legacy = listed.claims.find((claim) => claim.text === "Annotated claim about the system.");
    const minted = listed.claims.find((claim) => claim.text === "A second annotated claim needing a mint.");
    expect(legacy?.id).toBe("manual-legacy-id");
    expect(minted?.id).toMatch(/^c-[a-z0-9]{6,8}$/);
    expect(minted?.id).not.toBe("manual-legacy-id");
  });

  it("does not re-mint an id for a claim that already has one", async () => {
    const write = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    expect(write.warnings.some((warning) => warning.code === "claim_id_minted")).toBe(true);
    const firstId = (await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" })).claims[0]
      ?.id;
    expect(firstId).toBeTruthy();

    // Touch the anchor again without changing the annotated claim: no
    // second mint, and the id is unchanged.
    const retouch = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Decisions",
      content: "- A decision claim.\n- Another decision claim.",
      message: "test: unrelated retouch",
    });
    expect(retouch.warnings.some((warning) => warning.code === "claim_id_minted")).toBe(false);
    const secondId = (await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" })).claims[0]
      ?.id;
    expect(secondId).toBe(firstId);
  });

  it("mints tree-unique ids across anchors: no collisions across two anchors written in the same session", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add first claims demo",
    });
    const secondContent = anchorContent().replace("projects/demo", "projects/demo2");
    await service.writeAnchor({
      name: "projects/demo2/claims-demo-2",
      content: `---
project:
  - demo2
type: context-anchor
tags:
  - context-anchor
summary: "Second claims test anchor."
read_this_if:
  - "You are testing claims."
last_validated: 2026-07-08
---

# Claims Demo 2

## Current State

- Annotated claim in a second anchor.
  {src: PR #61; observed: 2026-07-08; conf: high}

## Decisions

- A decision claim.

## Constraints

- A constraint claim.

## PRs

None.
`,
      message: "test: add second claims demo",
    });

    const all = await service.listClaims({ status: "annotated" });
    const ids = all.claims.map((claim) => claim.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reword-keeping-id: rewriting a section that keeps a claim's id carries sources without gating", async () => {
    const initial = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const mintedId = initial.warnings.find((warning) => warning.code === "claim_id_minted")?.message.match(
      /Minted claim id (\S+)/,
    )?.[1];
    expect(mintedId).toBeTruthy();

    const reword = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: `- Annotated claim about the system, reworded but keeps its id.\n  {src: PR #54; observed: 2026-07-07; conf: high; id: ${mintedId}}\n- Legacy claim with no provenance.`,
      message: "test: reword keeping id",
      // The pre-existing approval gate (validateApprovalGate) blocks any
      // bullet-text change independent of provenance; approved: true clears
      // that unrelated gate so this test isolates the WP1 assertion below:
      // id-carry means claim_annotation_lost never fires for this rewording.
      approved: true,
    });
    expect(reword.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(reword.warnings.some((warning) => warning.code === "claim_annotation_lost")).toBe(false);
    expect(reword.version).toBeTruthy();

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    expect(listed.claims[0]?.id).toBe(mintedId);
    expect(listed.claims[0]?.text).toBe("Annotated claim about the system, reworded but keeps its id.");
  });

  it("reword-dropping-id: rewording a claim without its id still gates as a loss", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });

    const reword = await service.updateAnchorSection({
      name: "projects/demo/claims-demo",
      heading: "Current State",
      content: "- Annotated claim about the system, reworded with no id carried.\n- Legacy claim with no provenance.",
      message: "test: reword dropping id",
    });
    expect(reword.version).toBeUndefined();
    expect(reword.requiresApproval).toBe(true);
    expect(reword.warnings[0]?.code).toBe("claim_annotation_lost");
  });

  it("setClaimSources preserves an existing id when replacing a claim's sources", async () => {
    const initial = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const mintedId = initial.warnings.find((warning) => warning.code === "claim_id_minted")?.message.match(
      /Minted claim id (\S+)/,
    )?.[1];
    expect(mintedId).toBeTruthy();

    const set = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim about the system",
      sources: [{ src: "PR #70", observed: "2026-07-09", conf: "medium" }],
    });
    expect(set.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    // setClaimSources replaces sources silently (carryClaimAnnotations: false
    // internally) and is not expected to emit its own claim_id_minted WARN
    // when it is only preserving an id that already existed.
    expect(set.warnings.some((warning) => warning.code === "claim_id_minted")).toBe(false);

    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    const claim = listed.claims.find((entry) => entry.text === "Annotated claim about the system.");
    expect(claim?.id).toBe(mintedId);
    expect(claim?.sources[0]?.src).toBe("PR #70");
  });

  it("setClaimSources blocks an attempt to change an existing claim id (ids are immutable)", async () => {
    const initial = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const mintedId = initial.warnings.find((warning) => warning.code === "claim_id_minted")?.message.match(
      /Minted claim id (\S+)/,
    )?.[1];
    expect(mintedId).toBeTruthy();

    // Re-supplying the SAME id is fine.
    const same = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim about the system",
      sources: [{ src: "PR #71", observed: "2026-07-09", conf: "medium", id: mintedId }],
    });
    expect(same.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    // Supplying a DIFFERENT id is blocked so published <anchor>#<id> refs stay valid.
    const changed = await service.setClaimSources({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim about the system",
      sources: [{ src: "PR #72", observed: "2026-07-09", conf: "medium", id: "c-different" }],
    });
    const block = changed.warnings.find((warning) => warning.severity === "BLOCK");
    expect(block?.code).toBe("claim_id_immutable");

    // The id is unchanged after the rejected write.
    const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    const claim = listed.claims.find((entry) => entry.text === "Annotated claim about the system.");
    expect(claim?.id).toBe(mintedId);
  });

  it("skips the tree-wide id walk on a write that changes no claim ids", async () => {
    const initial = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    expect(initial.warnings.some((warning) => warning.code === "claim_id_minted")).toBe(true);

    const walk = vi.spyOn(
      service as unknown as { collectTreeClaimIds: (name: string) => Promise<Set<string>> },
      "collectTreeClaimIds",
    );

    // Edit only the PRs section of the COMMITTED content (which already carries
    // the minted ids): no claim is added/changed/reworded and no id is
    // introduced, so the expensive cross-tree walk must be skipped.
    const committed = await service.readAnchor("projects/demo/claims-demo");
    const prsEdit = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: committed.content.replace("None.", "- [PR Something - #100](https://example.com/pull/100)"),
      message: "test: edit PRs section only",
    });
    expect(prsEdit.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
    expect(prsEdit.warnings.some((warning) => warning.code === "claim_id_minted")).toBe(false);
    expect(walk).not.toHaveBeenCalled();

    // A write that adds a new annotated claim DOES need the walk (mint + dup-check).
    walk.mockClear();
    const afterPrs = await service.readAnchor("projects/demo/claims-demo");
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: afterPrs.content.replace(
        "## Decisions",
        "- A newly added annotated claim.\n  {src: PR #200; observed: 2026-07-09; conf: high}\n\n## Decisions",
      ),
      message: "test: add a new annotated claim",
    });
    expect(walk).toHaveBeenCalled();

    walk.mockRestore();
  });

  it("annotateClaim clear removes the id along with the rest of the provenance", async () => {
    await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add claims demo",
    });
    const beforeClear = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
    expect(beforeClear.claims[0]?.id).toBeTruthy();

    const cleared = await service.annotateClaim({
      name: "projects/demo/claims-demo",
      claim: "Annotated claim about the system",
      clear: true,
    });
    expect(cleared.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);

    const afterClear = await service.listClaims({ name: "projects/demo/claims-demo" });
    const claim = afterClear.claims.find((entry) => entry.text === "Annotated claim about the system.");
    expect(claim?.status).toBe("unannotated");
    expect(claim?.id).toBeUndefined();
  });

  it("blocks a write whose claim id duplicates another claim's id in the same write", async () => {
    const duplicateContent = anchorContent(
      `\n- Second annotated claim.\n  {src: PR #62; observed: 2026-07-08; conf: high; id: c-duptest}`,
    ).replace(
      "- Annotated claim about the system.\n  {src: PR #54; observed: 2026-07-07; conf: high}",
      "- Annotated claim about the system.\n  {src: PR #54; observed: 2026-07-07; conf: high; id: c-duptest}",
    );
    const duplicate = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: duplicateContent,
      message: "test: duplicate id in same write",
    });
    expect(duplicate.version).toBeUndefined();
    expect(duplicate.warnings.some((warning) => warning.code === "claim_id_duplicate")).toBe(true);
  });

  it("blocks a write whose claim id collides with an id already used elsewhere in the tree", async () => {
    const first = await service.writeAnchor({
      name: "projects/demo/claims-demo",
      content: anchorContent(),
      message: "test: add first claims demo",
    });
    const mintedId = first.warnings.find((warning) => warning.code === "claim_id_minted")?.message.match(
      /Minted claim id (\S+)/,
    )?.[1];
    expect(mintedId).toBeTruthy();

    const collidingContent = `---
project:
  - other
type: context-anchor
tags:
  - context-anchor
summary: "Other anchor."
read_this_if:
  - "You are testing claims."
last_validated: 2026-07-08
---

# Other Anchor

## Current State

- A claim in a different anchor reusing the same id.
  {src: PR #63; observed: 2026-07-08; conf: high; id: ${mintedId}}

## Decisions

- Another decision.

## Constraints

- Another constraint.

## PRs

None.
`;
    const collision = await service.writeAnchor({
      name: "projects/other/other-anchor",
      content: collidingContent,
      message: "test: colliding id in a different anchor",
    });
    expect(collision.version).toBeUndefined();
    expect(collision.warnings.some((warning) => warning.code === "claim_id_duplicate")).toBe(true);
  });

  describe("section-reference claim sources (WP2)", () => {
    it("does not warn or block on a valid cross-anchor section reference", async () => {
      await service.writeAnchor({
        name: "projects/demo/other-anchor",
        content: anchorContent(),
        message: "test: add other anchor",
      });
      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A cross-anchor sourced claim.\n  {src: projects/demo/other-anchor#Current State; observed: 2026-07-08; conf: medium}",
        ),
        message: "test: add section-referenced claim",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      expect(write.warnings.some((warning) => warning.code === "claim_source_section_missing")).toBe(false);
    });

    it("resolves same-anchor #heading shorthand against the containing anchor", async () => {
      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A same-anchor sourced claim.\n  {src: #Decisions; observed: 2026-07-08; conf: medium}",
        ),
        message: "test: add same-anchor section reference",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      expect(write.warnings.some((warning) => warning.code === "claim_source_section_missing")).toBe(false);
    });

    it("warns (never blocks) when a section reference's heading does not exist", async () => {
      await service.writeAnchor({
        name: "projects/demo/other-anchor",
        content: anchorContent(),
        message: "test: add other anchor",
      });
      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A dangling-heading claim.\n  {src: projects/demo/other-anchor#Nonexistent Heading; observed: 2026-07-08; conf: medium}",
        ),
        message: "test: add dangling section reference",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      const warning = write.warnings.find((entry) => entry.code === "claim_source_section_missing");
      expect(warning?.severity).toBe("WARN");
      expect(warning?.message).toContain("Nonexistent Heading");
      expect(write.version).toBeTruthy();
    });

    it("warns (never blocks) when a section reference's anchor does not exist", async () => {
      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A dangling-anchor claim.\n  {src: projects/demo/ghost-anchor#Current State; observed: 2026-07-08; conf: medium}",
        ),
        message: "test: add dangling anchor section reference",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      const warning = write.warnings.find((entry) => entry.code === "claim_source_section_missing");
      expect(warning?.severity).toBe("WARN");
      expect(write.version).toBeTruthy();
    });

    it("resolves a section-reference source to a /ui?anchor= deep link", async () => {
      await service.writeAnchor({
        name: "projects/demo/other-anchor",
        content: anchorContent(),
        message: "test: add other anchor",
      });
      await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A cross-anchor sourced claim.\n  {src: projects/demo/other-anchor#Current State; observed: 2026-07-08; conf: medium}",
        ),
        message: "test: add section-referenced claim",
      });

      const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "cross-anchor" });
      const claim = listed.claims.find((entry) => entry.text === "A cross-anchor sourced claim.");
      expect(claim?.sources[0]?.href).toBe("/ui?anchor=" + encodeURIComponent("projects/demo/other-anchor.md"));
    });

    it("deep-links to the correct anchor when the referenced heading itself contains a #", async () => {
      // A heading like "C# Notes" leaves a `#` inside the section node id
      // (`section:<anchor>#C# Notes`); the deep-link resolver must split on the
      // FIRST `#` (anchor names never contain `#`) to recover the anchor name.
      // Splitting on the last `#` would truncate to `<anchor>#C`.
      await service.writeAnchor({
        name: "projects/demo/other-anchor",
        content: anchorContent() + "\n## C# Notes\n\n- A note about C#.\n",
        message: "test: add other anchor with a hash heading",
      });
      await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A hash-heading sourced claim.\n  {src: projects/demo/other-anchor#C# Notes; observed: 2026-07-08; conf: medium}",
        ),
        message: "test: add hash-heading section reference",
      });

      const listed = await service.listClaims({ name: "projects/demo/claims-demo", q: "hash-heading" });
      const claim = listed.claims.find((entry) => entry.text === "A hash-heading sourced claim.");
      // href must point at the anchor, not a truncated/garbled path.
      expect(claim?.sources[0]?.href).toBe("/ui?anchor=" + encodeURIComponent("projects/demo/other-anchor.md"));
      // The heading resolves, so there is no dangling-section warning either.
      expect(claim?.status).toBe("annotated");
    });
  });

  describe("derived_from / contradicts claim edges (WP5)", () => {
    // Write an anchor whose Current State has one annotated claim, then return
    // its server-minted claim id so downstream claims can cite it.
    async function seedParentClaim(): Promise<{ anchor: string; parentId: string }> {
      const write = await service.writeAnchor({
        name: "projects/demo/parent-anchor",
        content: anchorContent(),
        message: "test: seed parent claim",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      const listed = await service.listClaims({ name: "projects/demo/parent-anchor", status: "annotated" });
      const parent = listed.claims.find((claim) => claim.text === "Annotated claim about the system.");
      expect(parent?.id).toBeTruthy();
      return { anchor: "projects/demo/parent-anchor.md", parentId: parent!.id! };
    }

    it("warns (never blocks) on a well-formed but dangling edge target", async () => {
      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A downstream claim citing a ghost.\n  {src: PR #1; observed: 2026-07-08; conf: high; derived_from: projects/demo/claims-demo.md#c-nonexist}",
        ),
        message: "test: dangling edge target",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      const warning = write.warnings.find((entry) => entry.code === "claim_edge_target_missing");
      expect(warning?.severity).toBe("WARN");
      expect(warning?.message).toContain("c-nonexist");
      expect(write.version).toBeTruthy();
    });

    it("blocks a malformed edge-target FORMAT (claim_annotation_invalid)", async () => {
      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          "\n- A downstream claim with a malformed edge.\n  {src: PR #1; observed: 2026-07-08; conf: high; derived_from: projects/demo/claims-demo.md}",
        ),
        message: "test: malformed edge target",
      });
      const block = write.warnings.find((entry) => entry.code === "claim_annotation_invalid");
      expect(block?.severity).toBe("BLOCK");
      expect(write.version).toBeUndefined();
    });

    it("authoring a derived_from produces a traversable edge in graphNeighbors", async () => {
      const { anchor: parentAnchor, parentId } = await seedParentClaim();

      const write = await service.writeAnchor({
        name: "projects/demo/claims-demo",
        content: anchorContent(
          `\n- A downstream derived claim.\n  {src: PR #2; observed: 2026-07-08; conf: high; derived_from: ${parentAnchor}#${parentId}}`,
        ),
        message: "test: author a derived_from edge",
      });
      expect(write.warnings.filter((warning) => warning.severity === "BLOCK")).toEqual([]);
      // The target claim exists, so no dangling-target warning fires.
      expect(write.warnings.some((warning) => warning.code === "claim_edge_target_missing")).toBe(false);
      expect(write.version).toBeTruthy();

      // Find the downstream claim's minted node id.
      const listed = await service.listClaims({ name: "projects/demo/claims-demo", status: "annotated" });
      const downstream = listed.claims.find((claim) => claim.text === "A downstream derived claim.");
      expect(downstream?.id).toBeTruthy();
      expect(downstream?.derivedFrom).toEqual([`${parentAnchor}#${parentId}`]);

      const result = await service.graphNeighbors({
        node: `projects/demo/claims-demo.md#${downstream!.id}`,
        edgeTypes: ["derived_from"],
        direction: "forward",
        depth: 1,
      });
      if ("candidates" in result) {
        throw new Error("expected a resolved node, got candidates");
      }
      const edge = result.edges.find((entry) => entry.type === "derived_from");
      expect(edge).toBeTruthy();
      expect(edge?.from).toBe(`claim:projects/demo/claims-demo.md#${downstream!.id}`);
      expect(edge?.to).toBe(`claim:${parentAnchor}#${parentId}`);
      // The parent claim node is reachable in one hop.
      expect(result.nodes.some((node) => node.id === `claim:${parentAnchor}#${parentId}`)).toBe(true);
    });
  });
});
