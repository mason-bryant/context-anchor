import { classifyAnchorPath, SERVER_RULES_DISCOVERY_CATEGORY } from "../taxonomy.js";
import {
  normalizedMilestoneId,
  normalizedScheduleFromFm,
  normalizedSequenceFromFm,
  normalizedTasksFromFm,
} from "../milestoneFrontmatter.js";
import { analyzeRoadmapFromContent } from "../roadmap/analyzeRoadmap.js";
import { isProjectMilestoneType } from "../schema/milestoneTypes.js";
import { parseAnchor } from "../storage/markdown.js";
import type { AnchorMeta, AnchorRead, MilestonePlannerMeta, ValidationSeverity } from "../types.js";
import type { ClaimWithCertainty } from "../certainty.js";
import type { MermaidBlock } from "../mermaidBlocks.js";
import type { AnchorQuestion } from "../questions.js";
import {
  ALWAYS_REQUIRED_SECTIONS,
  ANCHOR_SECTION_DEFINITIONS,
  analyzeAnchorStructure,
  type AlwaysRequiredSectionName,
  type AnchorSectionName,
  type DesignHeaderStatus,
  type CurrentStateOrganizationStatus,
} from "../anchorStructure.js";
import type { CoverageRecordKind, CoverageState } from "../graph/coverage.js";
export type AnchorHealthStatus = "ok" | "warn" | "block";

export type AnchorHealthIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
};

export type RequiredSectionStatus = Record<AlwaysRequiredSectionName, boolean>;

export type AnchorUiHealth = {
  status: AnchorHealthStatus;
  issues: AnchorHealthIssue[];
};

export type AnchorUiMeta = AnchorMeta & {
  ui: {
    label: string;
    health: AnchorUiHealth;
  };
};

export type AnchorUiDetail = AnchorRead & {
  ui: {
    label: string;
    health: AnchorUiHealth;
    sections: RequiredSectionStatus;
    designHeader: DesignHeaderStatus;
    currentStateOrganization: CurrentStateOrganizationStatus;
    sectionDefinitions: Record<AnchorSectionName, string>;
    claims: (ClaimWithCertainty & { anchor: string })[];
    mermaidBlocks: (MermaidBlock & { anchor: string })[];
    questions: (AnchorQuestion & { anchor: string })[];
  };
};

export function toAnchorUiMeta(anchor: AnchorMeta): AnchorUiMeta {
  return {
    ...anchor,
    ui: {
      label: anchor.title || anchor.name,
      health: summarizeAnchorHealth(anchor),
    },
  };
}

export function toAnchorUiDetail(
  anchor: AnchorRead,
  meta?: AnchorMeta,
  claims: (ClaimWithCertainty & { anchor: string })[] = [],
  questions: (AnchorQuestion & { anchor: string })[] = [],
  mermaidBlocks: (MermaidBlock & { anchor: string })[] = [],
): AnchorUiDetail {
  const displayMeta = meta ?? anchorReadToMeta(anchor);
  const analysis = analyzeAnchorStructure(anchor.name, anchor.content);
  const sections = requiredSectionStatusFromSections(analysis.parsed.sections);

  return {
    ...anchor,
    ui: {
      label: displayMeta.title || anchor.name,
      health: summarizeAnchorHealth({ ...displayMeta, warnings: anchor.warnings }, sections),
      sections,
      designHeader: analysis.designHeader,
      currentStateOrganization: analysis.currentStateOrganization,
      sectionDefinitions: { ...ANCHOR_SECTION_DEFINITIONS },
      claims,
      mermaidBlocks,
      questions,
    },
  };
}

export function requiredSectionStatus(content: string): RequiredSectionStatus {
  return requiredSectionStatusFromSections(parseAnchor(content).sections);
}

function requiredSectionStatusFromSections(sections: ReadonlyMap<string, string>): RequiredSectionStatus {
  return Object.fromEntries(
    ALWAYS_REQUIRED_SECTIONS.map((section) => [section, sections.has(section)]),
  ) as RequiredSectionStatus;
}

export function summarizeAnchorHealth(
  anchor: AnchorMeta & { warnings?: AnchorRead["warnings"] },
  sections?: RequiredSectionStatus,
): AnchorUiHealth {
  const issues: AnchorHealthIssue[] = [];

  if (!isNonEmptyString(anchor.summary)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_summary",
      message: "Missing non-empty summary front matter.",
    });
  }

  if (!Array.isArray(anchor.read_this_if) || anchor.read_this_if.length === 0) {
    issues.push({
      severity: "BLOCK",
      code: "missing_read_this_if",
      message: "Missing read_this_if front matter.",
    });
  }

  if (!isNonEmptyString(anchor.type)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_type",
      message: "Missing non-empty type front matter.",
    });
  }

  if (!Array.isArray(anchor.tags)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_tags",
      message: "Missing tags array front matter.",
    });
  }

  if (!isValidDateLike(anchor.last_validated)) {
    issues.push({
      severity: "BLOCK",
      code: "missing_last_validated",
      message: "Missing strict YYYY-MM-DD last_validated front matter.",
    });
  }

  const classification = classifyAnchorPath(anchor.name);
  if (classification.kind === "anchor" && classification.projectSlug) {
    if (!frontmatterValueIncludes(anchor.project, classification.projectSlug)) {
      issues.push({
        severity: "BLOCK",
        code: "project_slug_mismatch",
        message: `Project front matter must include "${classification.projectSlug}".`,
      });
    }
  }

  if (sections) {
    for (const section of ALWAYS_REQUIRED_SECTIONS) {
      if (!sections[section]) {
        issues.push({
          severity: "BLOCK",
          code: "required_section",
          message: `Missing required section: ## ${section}.`,
        });
      }
    }
  }

  for (const warning of anchor.warnings ?? []) {
    if (!issues.some((issue) => issue.code === warning.code && issue.message === warning.message)) {
      issues.push(warning);
    }
  }

  const acceptance = anchor.acceptanceCriteria;
  if (acceptance?.criteriaViolations?.length) {
    for (const message of acceptance.criteriaViolations) {
      issues.push({
        severity: "BLOCK",
        code: "roadmap_acceptance_criteria",
        message,
      });
    }
  }

  if (acceptance?.goalsMissingCriteria.length) {
    issues.push({
      severity: "WARN",
      code: "roadmap_missing_acceptance_criteria",
      message: `${acceptance.goalsMissingCriteria.length} active roadmap goal(s) are missing acceptance criteria.`,
    });
  }

  if (acceptance?.goalsWithoutStableIds?.length) {
    issues.push({
      severity: "WARN",
      code: "roadmap_goal_stable_id",
      message: `${acceptance.goalsWithoutStableIds.length} roadmap goal(s) are missing stable G-### ids.`,
    });
  }

  if (acceptance?.hasProposedCriteria) {
    issues.push({
      severity: "WARN",
      code: "roadmap_proposed_acceptance_criteria",
      message: "Roadmap contains proposed acceptance criteria.",
    });
  }

  const status: AnchorHealthStatus = issues.some((issue) => issue.severity === "BLOCK")
    ? "block"
    : issues.some((issue) => issue.severity === "WARN")
      ? "warn"
      : "ok";

  return { status, issues };
}

function anchorReadToMeta(anchor: AnchorRead): AnchorMeta {
  const classification = classifyAnchorPath(anchor.name);
  const frontmatter = anchor.frontmatter;
  const parsed = parseAnchor(anchor.content);
  const meta: AnchorMeta = {
    name: anchor.name,
    path: anchor.path,
    category: anchor.name.startsWith("server-rules/")
      ? SERVER_RULES_DISCOVERY_CATEGORY
      : classification.kind === "anchor"
        ? classification.category
        : "shared",
    projectSlug: classification.kind === "anchor" ? classification.projectSlug : undefined,
    title: parsed.title,
    project: frontmatter.project,
    type: frontmatter.type,
    tags: frontmatter.tags,
    summary: typeof frontmatter.summary === "string" ? frontmatter.summary : "",
    read_this_if: Array.isArray(frontmatter.read_this_if)
      ? frontmatter.read_this_if.filter((item): item is string => typeof item === "string")
      : [],
    last_validated: frontmatter.last_validated,
    origin: anchor.name.startsWith("server-rules/") ? "built-in" : "repo",
  };

  if (isProjectRoadmapType(frontmatter.type)) {
    const analysis = analyzeRoadmapFromContent(anchor.content, { isProjectRoadmap: true });
    meta.acceptanceCriteria = {
      activeGoals: analysis.activeGoals,
      goalsWithCriteria: analysis.goalsWithCriteria,
      goalsMissingCriteria: analysis.goalsMissingCriteria,
      goalsMissingCriteriaIds:
        (analysis.goalsMissingCriteriaIds?.length ?? 0) > 0 ? analysis.goalsMissingCriteriaIds : undefined,
      goalsWithoutStableIds:
        (analysis.goalsWithoutStableIds?.length ?? 0) > 0 ? analysis.goalsWithoutStableIds : undefined,
      goalsDuplicateStableIds:
        (analysis.goalsDuplicateStableIds?.length ?? 0) > 0 ? analysis.goalsDuplicateStableIds : undefined,
      hasProposedCriteria: analysis.hasProposedCriteria,
      criteriaViolations: analysis.criteriaViolations.length > 0 ? analysis.criteriaViolations : undefined,
    };
  }

  if (isProjectMilestoneType(frontmatter.type)) {
    meta.milestone = milestoneMetaFromFrontmatter(frontmatter);
  }

  return meta;
}

function milestoneMetaFromFrontmatter(frontmatter: Record<string, unknown>): MilestonePlannerMeta | undefined {
  const status = frontmatter.status;
  const theme = frontmatter.theme;
  if (
    typeof status !== "string" ||
    !["proposed", "active", "shipped", "cancelled"].includes(status) ||
    typeof theme !== "string" ||
    theme.length === 0
  ) {
    return undefined;
  }

  const rel = frontmatter.relations as { goal_ids?: unknown } | undefined;
  const goalIds = Array.isArray(rel?.goal_ids)
    ? rel.goal_ids.filter((item): item is string => typeof item === "string")
    : [];
  const milestoneId = normalizedMilestoneId(frontmatter.milestone_id);
  const sequence = normalizedSequenceFromFm(frontmatter);
  const schedule = normalizedScheduleFromFm(frontmatter);
  const tasks = normalizedTasksFromFm(frontmatter);
  const steelThread = frontmatter.steel_thread;

  return {
    status: status as MilestonePlannerMeta["status"],
    theme,
    steelThread: typeof steelThread === "string" && steelThread.length > 0 ? steelThread : undefined,
    goalIds,
    ...(milestoneId !== undefined ? { milestoneId } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
    ...(schedule !== undefined ? { schedule } : {}),
    ...(tasks !== undefined ? { tasks } : {}),
  };
}

function isProjectRoadmapType(type: unknown): boolean {
  if (type === "project-roadmap") {
    return true;
  }
  if (Array.isArray(type)) {
    return type.some((item) => item === "project-roadmap");
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDateLike(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.valueOf());
  }

  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function frontmatterValueIncludes(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    return value === expected;
  }

  return Array.isArray(value) && value.includes(expected);
}

// ---------------------------------------------------------------------------
// Schema Coverage UI (Goal 0 Phase 2, WP-B:
// `goal0_phase2_mint_on_create_and_coverage_ui_plan.md`). Pure grouping,
// filtering, URL-param round-trip, and cursor-append helpers over the
// `GET /api/ui/graph-coverage` response shape (`AnchorService.graphCoverage`,
// `src/anchorService.ts` — not modified here). The browser UI
// (`src/ui/assets.ts`) is plain ES5 embedded in template strings and cannot
// import TypeScript modules, so it MIRRORS this logic inline; these exports
// are the unit-tested reference implementation, and any behavior change here
// must be applied to the corresponding code in `assets.ts` — the pair
// drifting apart is a bug. Most mirrors share this file's function names
// and are annotated as mirrors at their definition; the URL round-trip is
// the exception, living in the coverage blocks of the generic
// `applyUrlStateToControls`/`paramsForState` tab-URL wiring (annotated
// there too).
// ---------------------------------------------------------------------------

/** Display order for coverage-state badges/cards: worst-to-best structural signal first, matching WP5's precedence (malformed > dangling > ambiguous > partial), with the two mutually exclusive "happy"/"inert" ends last. */
export const COVERAGE_STATE_ORDER: readonly CoverageState[] = [
  "malformed",
  "dangling",
  "ambiguous",
  "partial",
  "structured",
  "prose_only",
];

const COVERAGE_STATE_LABELS: Record<CoverageState, string> = {
  structured: "Structured",
  partial: "Partial",
  prose_only: "Prose only",
  ambiguous: "Ambiguous",
  dangling: "Dangling",
  malformed: "Malformed",
};

/** Human label for a coverage-state badge. Badge text conveys state (not color alone) per the WP-B accessibility requirement. */
export function coverageStateLabel(state: CoverageState): string {
  return COVERAGE_STATE_LABELS[state] ?? state;
}

/** Human label for a coverage record's `kind` discriminator ("anchor" | "claim"). */
export function coverageKindLabel(kind: CoverageRecordKind["kind"]): string {
  return kind === "claim" ? "Claim" : "Anchor";
}

export type CoverageFilters = {
  /** Project slug filter; empty/undefined means every project. */
  project?: string;
  /** Multi-select state filter; empty/undefined means every state. */
  states?: readonly CoverageState[];
  /** Plain-text filter matched against the anchor name, case-insensitive substring. */
  anchorText?: string;
};

/** Every distinct `projectSlug` present across a page of records, sorted, for populating the project filter's option list. Anchor-less claim records have no `projectSlug` of their own, so this only ever reflects anchor records — consistent with `CoverageSummary.byProject` being anchor-scoped in `src/graph/coverage.ts`. */
export function deriveCoverageProjects(records: readonly CoverageRecordKind[]): string[] {
  const projects = new Set<string>();
  for (const record of records) {
    if (record.kind === "anchor" && record.projectSlug) {
      projects.add(record.projectSlug);
    }
  }
  return [...projects].sort();
}

/**
 * Apply the filter rail's state/anchor-name-text filters to an
 * already-fetched page of records. This is a client-side refinement over
 * whatever page the server already returned (the server-side `states`/
 * `project` query params narrow what gets fetched in the first place — see
 * `coverageQueryParams` below); this function exists so the table can also
 * apply the free-text anchor-name filter, and re-apply the state filter
 * instantly when the user toggles a state card without waiting on a network
 * round trip for records already in hand.
 *
 * The PROJECT filter is deliberately NOT applied here: project scoping is
 * server-side only (`project=`), because claim records carry no
 * `projectSlug` of their own — a client-side project comparison would
 * silently drop every claim row belonging to anchors that ARE in the
 * selected project.
 */
export function filterCoverageRecords(
  records: readonly CoverageRecordKind[],
  filters: CoverageFilters,
): CoverageRecordKind[] {
  const stateSet = filters.states && filters.states.length > 0 ? new Set(filters.states) : undefined;
  const text = filters.anchorText?.trim().toLowerCase();

  return records.filter((record) => {
    if (stateSet && !stateSet.has(record.state)) {
      return false;
    }
    if (text && !record.anchorName.toLowerCase().includes(text)) {
      return false;
    }
    return true;
  });
}

/** Query-string params to send to `GET /api/ui/graph-coverage` for a given filter set (the server-side `project`/`states` scoping; the free-text anchor filter is client-side only, since the endpoint has no text-search parameter). Omits keys with no effective value so the URL/query stays minimal. */
export function coverageQueryParams(filters: CoverageFilters, cursor?: string, limit?: number): Record<string, string> {
  const params: Record<string, string> = {};
  const project = filters.project?.trim();
  if (project) {
    params.project = project;
  }
  if (filters.states && filters.states.length > 0) {
    params.states = filters.states.join(",");
  }
  if (cursor) {
    params.cursor = cursor;
  }
  if (limit !== undefined && Number.isFinite(limit)) {
    params.limit = String(limit);
  }
  return params;
}

const COVERAGE_URL_PARAM_KEYS = {
  project: "coverageProject",
  states: "coverageStates",
  anchorText: "coverageSearch",
} as const;

/** Every URL query key this feature owns, for callers (the "known URL params" list in `src/ui/assets.ts`) that need to strip/reset params before rebuilding a URL for a different view. */
export const COVERAGE_URL_PARAM_NAMES: readonly string[] = Object.values(COVERAGE_URL_PARAM_KEYS);

const VALID_COVERAGE_STATES = new Set<CoverageState>([
  "structured",
  "partial",
  "prose_only",
  "ambiguous",
  "dangling",
  "malformed",
]);

function isCoverageStateValue(value: string): value is CoverageState {
  return VALID_COVERAGE_STATES.has(value as CoverageState);
}

/** Parse the Coverage tab's filter state back out of a `URLSearchParams`-like plain object (already split into individual `get(key)` string-or-null values), mirroring how the Tasks tab's filters round-trip through the URL in `src/ui/assets.ts`. Unknown state tokens are silently dropped rather than rejected, since they may be from a stale/foreign link — never worth hard-failing a read-only filter UI over. Repeated tokens (`states=dangling,dangling`) are deduplicated in order: `states` has set semantics, and a duplicate would make a single card toggle remove only one occurrence. */
export function coverageFiltersFromUrlParams(getParam: (key: string) => string | null): CoverageFilters {
  const project = getParam(COVERAGE_URL_PARAM_KEYS.project) || "";
  const statesRaw = getParam(COVERAGE_URL_PARAM_KEYS.states) || "";
  const seenStates = new Set<CoverageState>();
  const states = statesRaw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is CoverageState => {
      if (!isCoverageStateValue(value) || seenStates.has(value)) {
        return false;
      }
      seenStates.add(value);
      return true;
    });
  const anchorText = getParam(COVERAGE_URL_PARAM_KEYS.anchorText) || "";
  return {
    ...(project ? { project } : {}),
    ...(states.length > 0 ? { states } : {}),
    ...(anchorText ? { anchorText } : {}),
  };
}

/** Inverse of `coverageFiltersFromUrlParams`: the URL query params this filter state should serialize to. Only ever includes a key when it has an effective value, so applying it never leaves stale empty params behind (same convention `setParam`/`setNonDefaultParam` follow in `src/ui/assets.ts`). */
export function coverageUrlParamsFromFilters(filters: CoverageFilters): Record<string, string> {
  const params: Record<string, string> = {};
  const project = filters.project?.trim();
  if (project) {
    params[COVERAGE_URL_PARAM_KEYS.project] = project;
  }
  if (filters.states && filters.states.length > 0) {
    params[COVERAGE_URL_PARAM_KEYS.states] = filters.states.join(",");
  }
  const anchorText = filters.anchorText?.trim();
  if (anchorText) {
    params[COVERAGE_URL_PARAM_KEYS.anchorText] = anchorText;
  }
  return params;
}

/** Stable per-record identity for de-duplicating an appended "Load more" page against records already on screen: anchor name, kind, and (for claims) line number — the same fields the server's own cursor sort key (`coverageSortKey` in `src/graph/coverage.ts`) is built from. */
export function coverageRecordKey(record: CoverageRecordKind): string {
  const line = record.kind === "claim" ? record.line : -1;
  return `${record.kind}\n${record.anchorName}\n${line}`;
}

/**
 * Append a newly-fetched "Load more" page to the records already on screen.
 * De-duplicates by `coverageRecordKey` so a page fetched twice (e.g. a
 * double-click on "Load more" before the button disables) never duplicates
 * rows in the table.
 */
export function appendCoverageRecords(
  existing: readonly CoverageRecordKind[],
  nextPage: readonly CoverageRecordKind[],
): CoverageRecordKind[] {
  const seen = new Set(existing.map(coverageRecordKey));
  const appended = nextPage.filter((record) => {
    const key = coverageRecordKey(record);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return [...existing, ...appended];
}
