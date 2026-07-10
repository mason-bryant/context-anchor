/**
 * Canonical source-node classifier (WP2 of the claim knowledge graph plan).
 *
 * `parseClaimSource` is THE single place claim `src` strings (plus the
 * structured `kind`/`person` annotation keys) are classified into a canonical,
 * deterministic graph node id. It reuses the PR-reference / file-path parsing
 * already used for UI/API source-link resolution (`src/graph/sourceParsing.ts`,
 * originally in `anchorService.ts`'s `resolveClaimSourceHref`, PR #63) so links
 * and node ids can never diverge.
 *
 * Canonical node id forms:
 *   - `pr:<repo>#<n>`
 *   - `file:<repo>:<path>` (repo resolved via project-mappings; unmapped paths
 *     get `file:?:<path>`)
 *   - `anchor:<name>`
 *   - `section:<anchor>#<normalized-heading>`
 *   - `url:<normalized>`
 *   - `person:<person-id>` (from the structured `person` key, resolved via the
 *     people registry; unresolved keeps the raw token)
 *
 * `kind` is a hint to CONFIRM, not to re-derive: it never overrides what the
 * `src` string (or the structured `person` key) actually parses to. A
 * `trust-me-bro` row with no artifact `src` produces ONLY the person node.
 */

import { normalizeSectionTitle } from "../anchorPatch.js";
import { TRUST_ME_BRO_SOURCE, type ClaimSource } from "../claims.js";
import type { ProjectMappings, ProjectRepoMapping } from "../types.js";
import {
  isHttpUrl,
  normalizeUrl,
  parseFileSource,
  parsePullRequestSource,
  parseRepoPrefixedSource,
} from "./sourceParsing.js";
import type { ClaimSourceNodeType, ParsedSourceNode } from "./model.js";

export type { ParsedSourceNode as ParsedClaimSource };

export type ParseClaimSourceContext = {
  /** Name of the anchor the claim lives in (used for project resolution and same-anchor `#heading` shorthand). */
  anchorName: string;
  /** All known anchor names, for anchor-name / section-anchor resolution. Accepts a resolver so callers can reuse existing normalization. */
  anchorNames: ReadonlySet<string>;
  /** Resolve a possibly-unnormalized anchor name (e.g. without `.md`) to its canonical stored name, or undefined when the value does not resolve to an anchor that exists in the tree (both a bad path and a well-formed name with no matching anchor return undefined). */
  resolveAnchorName: (value: string) => string | undefined;
  /** Registered H2 section titles for a given (already-resolved) anchor name, or undefined if the anchor cannot be read. */
  getAnchorSectionTitles: (anchorName: string) => ReadonlySet<string> | undefined;
  mappings: ProjectMappings;
  /** Resolve a structured `person` annotation key to a canonical person id, or undefined if unresolved. */
  resolvePersonId: (rawPerson: string) => string | undefined;
};

export type ParseClaimSourceWarning = {
  code: "claim_source_section_missing";
  message: string;
};

export type ParseClaimSourceResult = {
  /** The primary node parsed from `src` (or the person node when there is no src, e.g. trust-me-bro). Undefined when the row has neither a usable src nor a person. */
  node?: ParsedSourceNode;
  /** The person node, when the row carries a structured `person` key (independent of / in addition to a `src`-derived node). */
  personNode?: ParsedSourceNode;
  /** Populated when a section reference's anchor or heading does not resolve; write path should surface this as a WARN, never a block. */
  warning?: ParseClaimSourceWarning;
};

/**
 * Classify one claim source row into its canonical node id(s). Never throws;
 * unresolvable inputs degrade to a best-effort node id (e.g. `file:?:<path>`)
 * or a warning, per the design's "warn, never block" rule for provenance.
 */
export function parseClaimSource(
  row: Pick<ClaimSource, "src" | "kind" | "person">,
  ctx: ParseClaimSourceContext,
): ParseClaimSourceResult {
  const personNode = row.person ? personSourceNode(row.person, ctx) : undefined;

  const src = (row.src ?? "").trim();
  // A trust-me-bro row (or any person-backed row) with no artifact src
  // produces only the person node — never a phantom "trust me bro" source node.
  if (!src || src.toLowerCase() === TRUST_ME_BRO_SOURCE) {
    return personNode ? { node: personNode, personNode } : {};
  }

  if (src.toLowerCase().startsWith("person:")) {
    // Legacy `person:<id>` src form: resolve the same way as the structured key.
    const rawId = src.slice("person:".length);
    const node = personSourceNode(rawId, ctx);
    return { node, personNode: personNode ?? node };
  }

  if (isHttpUrl(src)) {
    return { node: urlSourceNode(src), personNode };
  }

  const prefixed = parseRepoPrefixedSource(src);
  const prNumber = parsePullRequestSource(prefixed.path);
  if (prNumber !== undefined) {
    return { node: prSourceNode(prNumber, prefixed.repo, ctx), personNode };
  }

  // Bare anchor-name reference (no `#heading`) takes priority over section
  // parsing so a plain anchor name is never misread as an empty-heading
  // section reference.
  const resolvedAnchor = ctx.resolveAnchorName(src);
  if (resolvedAnchor && ctx.anchorNames.has(resolvedAnchor)) {
    return { node: anchorSourceNode(resolvedAnchor), personNode };
  }

  // Section reference: `<anchor-name>#<heading>` or same-anchor `#<heading>`.
  // Tried before generic file-path parsing so `<anchor>#Heading` (no `#L`)
  // is read as a section rather than a bogus file-with-line-number.
  const sectionRef = parseSectionReference(src, ctx);
  if (sectionRef) {
    return { node: sectionRef.node, personNode, warning: sectionRef.warning };
  }

  const parsedFile = parseFileSource(prefixed.path);
  if (parsedFile) {
    return { node: fileSourceNode(parsedFile.path, prefixed.repo, ctx), personNode };
  }

  // Nothing recognized: fall back to an opaque url-shaped node id so every
  // src string still yields a deterministic, shareable node.
  return { node: urlSourceNode(src), personNode };
}

function makeNode(type: ClaimSourceNodeType, nodeId: string, display?: string): ParsedSourceNode {
  return { nodeId, type, ...(display ? { display } : {}) };
}

function personSourceNode(rawPerson: string, ctx: ParseClaimSourceContext): ParsedSourceNode {
  const trimmed = rawPerson.trim();
  const resolved = ctx.resolvePersonId(trimmed);
  const id = resolved ?? trimmed;
  return makeNode("person", `person:${id}`, resolved ? undefined : trimmed);
}

function urlSourceNode(value: string): ParsedSourceNode {
  return makeNode("url", `url:${normalizeUrl(value)}`);
}

function anchorSourceNode(anchorName: string): ParsedSourceNode {
  return makeNode("anchor", `anchor:${anchorName}`);
}

function prSourceNode(
  prNumber: number,
  requestedRepo: string | undefined,
  ctx: ParseClaimSourceContext,
): ParsedSourceNode {
  const repo = resolveRepoForAnchor(ctx, requestedRepo);
  const repoLabel = repo?.repo ?? requestedRepo ?? "?";
  return makeNode("pr", `pr:${repoLabel}#${prNumber}`);
}

function fileSourceNode(
  filePath: string,
  requestedRepo: string | undefined,
  ctx: ParseClaimSourceContext,
): ParsedSourceNode {
  const repo = resolveRepoForAnchor(ctx, requestedRepo, filePath);
  const repoLabel = repo?.repo ?? requestedRepo;
  return makeNode(
    "file",
    repoLabel ? `file:${repoLabel}:${filePath}` : `file:?:${filePath}`,
  );
}

/**
 * Resolve which mapped repo a PR/file source belongs to, using the claim's
 * containing anchor's project (mirrors `resolveClaimSourceHref`'s repo
 * selection, minus the "must have a web.url" requirement — canonicalization
 * needs a repo *name*, not a link, so repos without web config still count).
 */
function resolveRepoForAnchor(
  ctx: ParseClaimSourceContext,
  requestedRepo: string | undefined,
  filePath?: string,
): ProjectRepoMapping | undefined {
  const projectMapping = projectMappingForAnchor(ctx);
  const repos = projectMapping?.repos ?? [];
  if (requestedRepo) {
    return repos.find((repo) => repo.repo.toLowerCase() === requestedRepo.toLowerCase());
  }
  if (repos.length === 1) {
    return repos[0];
  }
  if (filePath) {
    const pathMatches = repos.filter(
      (repo) => repo.paths.length > 0 && repo.paths.some((prefix) => isWithinPath(filePath, prefix)),
    );
    if (pathMatches.length === 1) {
      return pathMatches[0];
    }
  }
  return undefined;
}

function isWithinPath(filePath: string, prefix: string): boolean {
  const cleanPrefix = prefix.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanFile = filePath.replace(/^\.\/+/, "").replace(/^\/+/, "");
  return cleanFile === cleanPrefix || cleanFile.startsWith(`${cleanPrefix}/`);
}

function projectMappingForAnchor(ctx: ParseClaimSourceContext) {
  const projectSlug = anchorProjectSlug(ctx.anchorName);
  if (!projectSlug) {
    return undefined;
  }
  return ctx.mappings.projects.find((mapping) => mapping.project.toLowerCase() === projectSlug.toLowerCase());
}

/** `projects/<slug>/...` → `<slug>`; anything else has no project. */
function anchorProjectSlug(anchorName: string): string | undefined {
  const clean = anchorName.replace(/^\.?\/+/, "");
  const parts = clean.split("/");
  return parts[0] === "projects" ? parts[1] : undefined;
}

// Split on the FIRST `#` (not greedy) so `<anchor>#<heading>` reads the whole
// remainder as the heading even if the heading itself contains `#` (e.g. a
// heading legitimately titled "C# Notes").
const SECTION_REFERENCE_PATTERN = /^([^#]*)#(.+)$/;

function parseSectionReference(
  src: string,
  ctx: ParseClaimSourceContext,
): { node: ParsedSourceNode; warning?: ParseClaimSourceWarning } | undefined {
  // By the time this runs, http URLs, PR references, and bare anchor names
  // have already been tried and failed, so any remaining `X#Y` is either a
  // section reference or a `path#L123` file-line reference (the only other
  // grammar that uses `#`). Reject the latter and let it fall through to
  // parseFileSource.
  const match = SECTION_REFERENCE_PATTERN.exec(src);
  if (!match) {
    return undefined;
  }
  const [, anchorPart, headingPart] = match;
  if (/^L\d+$/i.test(headingPart.trim())) {
    return undefined;
  }

  const isSameAnchorShorthand = anchorPart.trim() === "";
  const targetAnchorName = isSameAnchorShorthand
    ? ctx.resolveAnchorName(ctx.anchorName)
    : ctx.resolveAnchorName(anchorPart.trim());

  const normalizedHeading = normalizeSectionTitle(headingPart.trim());

  if (!targetAnchorName || !ctx.anchorNames.has(targetAnchorName)) {
    // Anchor side doesn't resolve (including a same-anchor lookup failing,
    // which should not happen in practice): the design treats "anchor
    // missing" the same as "heading missing" — warn, never block, and still
    // hand back a deterministic (if unresolved) section node id.
    return {
      node: makeNode("section", `section:${anchorPart.trim() || ctx.anchorName}#${normalizedHeading}`),
      warning: {
        code: "claim_source_section_missing",
        message: `Section reference "${src}" points at an anchor that does not exist.`,
      },
    };
  }

  const sectionTitles = ctx.getAnchorSectionTitles(targetAnchorName);
  const headingExists = sectionTitles?.has(normalizedHeading) ?? false;

  return {
    node: makeNode("section", `section:${targetAnchorName}#${normalizedHeading}`),
    ...(headingExists
      ? {}
      : {
          warning: {
            code: "claim_source_section_missing" as const,
            message: `Section reference "${src}" points at heading "${normalizedHeading}" which does not exist in ${targetAnchorName}.`,
          },
        }),
  };
}
