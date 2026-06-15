import type { NextFunction, Request, Response, Express } from "express";

import type { AnchorService } from "../anchorService.js";
import { isDiscoveryCategory, type DiscoveryCategory } from "../taxonomy.js";
import type {
  ContextRootFormat,
  PlanContextBundleInput,
  ProposedChangeListInput,
  ProposedChangeOperation,
  ProposedChangeScope,
  ProposedChangeStatus,
  ProposeChangeInput,
} from "../types.js";
import { UI_CSS, UI_HTML, UI_JS } from "./assets.js";
import { toAnchorUiDetail, toAnchorUiMeta } from "./viewModel.js";

type UiAuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;
type UiAnchorSort = "name" | "updated" | "created";

export function registerUiRoutes(
  app: Express,
  service: AnchorService,
  options: {
    authMiddleware?: UiAuthMiddleware;
  } = {},
): void {
  app.get("/", (_req, res) => res.redirect(302, "/ui"));
  app.get(/^\/(?:server-rules|agent-rules|projects|invariants|conflicts|shared|archive)\/.*\.md$/, (req, res) => {
    const anchorName = req.path.replace(/^\/+/, "");
    res.redirect(302, `/ui?anchor=${encodeURIComponent(anchorName)}`);
  });
  app.get("/ui", (_req, res) => {
    res.type("html").send(UI_HTML);
  });
  app.get("/ui/app.css", (_req, res) => {
    res.type("css").send(UI_CSS);
  });
  app.get("/ui/app.js", (_req, res) => {
    res.type("js").send(UI_JS);
  });

  const protect = options.authMiddleware ? [options.authMiddleware] : [];

  app.get(
    "/api/ui/context-root",
    ...protect,
    jsonRoute(async (req) =>
      service.contextRoot({
        ...readDiscoveryFilters(req),
        format: readContextRootFormat(req),
      }),
    ),
  );

  app.get(
    "/api/ui/anchors",
    ...protect,
    jsonRoute(async (req) => {
      const sort = readUiAnchorSort(req);
      const offset = nonNegativeIntQuery(req, "offset", 200000) ?? 0;
      const limit = positiveIntQuery(req, "limit", 500);
      const page = await service.listAnchorsDiscoveryPage(readDiscoveryFilters(req), { sort, offset, limit });

      return {
        anchors: page.anchors.map(toAnchorUiMeta),
        offset: page.offset,
        ...(page.total !== undefined ? { total: page.total } : {}),
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
        sort,
        ...(page.projectFilter ? { projectFilter: page.projectFilter } : {}),
      };
    }),
  );

  app.get(
    "/api/ui/anchor",
    ...protect,
    jsonRoute(async (req) => {
      const name = requiredQueryString(req, "name");
      const anchor = await service.readAnchor(name);
      return { anchor: toAnchorUiDetail(anchor) };
    }),
  );

  app.get(
    "/api/ui/context-plan",
    ...protect,
    jsonRoute(async (req) => service.planContextBundle(readPlannerInput(req))),
  );

  app.get(
    "/api/ui/milestones",
    ...protect,
    jsonRoute(async (req) => ({ milestones: await service.listMilestones(optionalQueryString(req, "project")) })),
  );

  app.get(
    "/api/ui/milestone",
    ...protect,
    jsonRoute(async (req) => service.readMilestone(requiredQueryString(req, "name"))),
  );

  app.get(
    "/api/ui/proposed-changes",
    ...protect,
    jsonRoute(async (req) => service.listProposedChanges(readProposedChangesInput(req))),
  );

  app.get(
    "/api/ui/proposed-change",
    ...protect,
    jsonRoute(async (req) => service.readProposedChange(requiredQueryString(req, "id"))),
  );

  app.get(
    "/api/ui/proposed-change-preview",
    ...protect,
    jsonRoute(async (req) => service.previewProposedChange(requiredQueryString(req, "id"))),
  );

  app.post(
    "/api/ui/propose-change",
    ...protect,
    jsonRoute(async (req) => service.proposeChange(readProposeChangeBody(req))),
  );

  app.post(
    "/api/ui/proposed-change-review",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const status = requiredBodyString(body, "status");
      if (!isReviewStatus(status)) {
        throw new UiHttpError(400, `Invalid review status: ${status}`);
      }
      return service.reviewProposedChange({
        id: requiredBodyString(body, "id"),
        status,
        note: optionalBodyString(body, "note"),
        reviewedBy: optionalBodyString(body, "reviewedBy"),
        message: optionalBodyString(body, "message"),
        expectedLedgerFileCommit: optionalBodyString(body, "expectedLedgerFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/proposed-change-apply",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.applyProposedChange({
        id: requiredBodyString(body, "id"),
        approved: booleanBody(body, "approved"),
        appliedBy: optionalBodyString(body, "appliedBy"),
        message: optionalBodyString(body, "message"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedLedgerFileCommit: optionalBodyString(body, "expectedLedgerFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/anchor-frontmatter",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.updateAnchorFrontmatter({
        name: requiredBodyString(body, "name"),
        updates: bodyObject(body, "updates"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/anchor-section",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.updateAnchorSection({
        name: requiredBodyString(body, "name"),
        heading: requiredBodyString(body, "heading"),
        content: requiredBodyString(body, "content"),
        lastValidated: optionalBodyString(body, "lastValidated"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/anchor-append",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.appendToAnchorSection({
        name: requiredBodyString(body, "name"),
        heading: requiredBodyString(body, "heading"),
        content: requiredBodyString(body, "content"),
        lastValidated: optionalBodyString(body, "lastValidated"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/anchor-section-delete",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.deleteAnchorSection({
        name: requiredBodyString(body, "name"),
        heading: requiredBodyString(body, "heading"),
        lastValidated: optionalBodyString(body, "lastValidated"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.get(
    "/api/ui/anchor-versions",
    ...protect,
    jsonRoute(async (req) => ({
      versions: await service.listVersions(requiredQueryString(req, "name"), positiveIntQuery(req, "limit", 100)),
    })),
  );

  app.get(
    "/api/ui/anchor-diff",
    ...protect,
    jsonRoute(async (req) => ({
      patch: await service.diffAnchor(
        requiredQueryString(req, "name"),
        requiredQueryString(req, "fromVersion"),
        requiredQueryString(req, "toVersion"),
      ),
    })),
  );

  app.post(
    "/api/ui/anchor-revert",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.revertAnchor(
        requiredBodyString(body, "name"),
        requiredBodyString(body, "toVersion"),
        optionalBodyString(body, "message"),
      );
    }),
  );

  app.post(
    "/api/ui/anchor-rename",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.renameAnchor({
        from: requiredBodyString(body, "from"),
        to: requiredBodyString(body, "to"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/anchor-delete",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.deleteAnchor({
        name: requiredBodyString(body, "name"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );
}

function jsonRoute(handler: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      res.json(await handler(req));
    } catch (error) {
      const status = error instanceof UiHttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      res.status(status).json({ error: { message } });
    }
  };
}

function readDiscoveryFilters(req: Request): {
  project?: string;
  category?: DiscoveryCategory;
  tag?: string;
  runtime?: string;
  includeArchive?: boolean;
} {
  const category = optionalQueryString(req, "category");
  if (category && !isDiscoveryCategory(category)) {
    throw new UiHttpError(400, `Invalid category: ${category}`);
  }

  return {
    project: optionalQueryString(req, "project"),
    category: category as DiscoveryCategory | undefined,
    tag: optionalQueryString(req, "tag"),
    runtime: optionalQueryString(req, "runtime"),
    includeArchive: booleanQuery(req, "includeArchive"),
  };
}

function readContextRootFormat(req: Request): ContextRootFormat {
  const format = optionalQueryString(req, "format");
  if (!format) {
    return "both";
  }
  if (format !== "json" && format !== "markdown" && format !== "both") {
    throw new UiHttpError(400, `Invalid context root format: ${format}`);
  }
  return format;
}

function readUiAnchorSort(req: Request): UiAnchorSort {
  const sort = optionalQueryString(req, "sort");
  if (!sort) {
    return "updated";
  }
  if (sort !== "name" && sort !== "updated" && sort !== "created") {
    throw new UiHttpError(400, `Invalid anchor sort: ${sort}`);
  }
  return sort;
}

function readPlannerInput(req: Request): PlanContextBundleInput {
  const filters = readDiscoveryFilters(req);
  return {
    task: requiredQueryString(req, "task"),
    ...filters,
    budgetTokens: positiveIntQuery(req, "budgetTokens", 200000),
    maxAnchors: positiveIntQuery(req, "maxAnchors", 500),
    maxExcluded: positiveIntQuery(req, "maxExcluded", 500, { allowZero: true }),
  };
}

function readProposedChangesInput(req: Request): ProposedChangeListInput {
  const scope = optionalQueryString(req, "scope");
  if (scope && scope !== "agent-rules") {
    throw new UiHttpError(400, `Invalid scope: ${scope}`);
  }
  const status = optionalQueryString(req, "status");
  if (status && !isProposedChangeStatus(status)) {
    throw new UiHttpError(400, `Invalid status: ${status}`);
  }

  return {
    project: optionalQueryString(req, "project"),
    scope: scope as "agent-rules" | undefined,
    status: status as ProposedChangeStatus | undefined,
  };
}

function isProposedChangeStatus(value: string): value is ProposedChangeStatus {
  return (
    value === "pending" ||
    value === "applied" ||
    value === "rejected" ||
    value === "changes_requested" ||
    value === "superseded"
  );
}

function isReviewStatus(
  value: string,
): value is Extract<ProposedChangeStatus, "pending" | "rejected" | "changes_requested" | "superseded"> {
  return value === "pending" || value === "rejected" || value === "changes_requested" || value === "superseded";
}

function readProposeChangeBody(req: Request): ProposeChangeInput {
  const body = bodyRecord(req);
  return {
    scope: proposalScope(bodyObject(body, "scope")),
    target: requiredBodyString(body, "target"),
    summary: requiredBodyString(body, "summary"),
    operations: bodyArray(body, "operations") as ProposedChangeOperation[],
    rationale: optionalBodyString(body, "rationale"),
    createdBy: optionalBodyString(body, "createdBy"),
    message: optionalBodyString(body, "message"),
  };
}

function proposalScope(scope: Record<string, unknown>): ProposedChangeScope {
  const kind = requiredBodyString(scope, "kind");
  if (kind === "agent-rules") {
    return { kind };
  }
  if (kind === "project") {
    return { kind, project: requiredBodyString(scope, "project") };
  }
  throw new UiHttpError(400, `Invalid proposal scope kind: ${kind}`);
}

function requiredQueryString(req: Request, key: string): string {
  const value = optionalQueryString(req, key);
  if (!value) {
    throw new UiHttpError(400, `Missing required query parameter: ${key}`);
  }
  return value;
}

function optionalQueryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function bodyRecord(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UiHttpError(400, "Expected a JSON object body.");
  }
  return body as Record<string, unknown>;
}

function requiredBodyString(body: Record<string, unknown>, key: string): string {
  const value = optionalBodyString(body, key);
  if (!value) {
    throw new UiHttpError(400, `Missing required body field: ${key}`);
  }
  return value;
}

function optionalBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function bodyObject(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = body[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UiHttpError(400, `Invalid ${key}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function bodyArray(body: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = body[key];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new UiHttpError(400, `Invalid ${key}: expected an array of objects`);
  }
  return value as Array<Record<string, unknown>>;
}

function booleanBody(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }
  throw new UiHttpError(400, `Invalid ${key}: expected a boolean`);
}

function booleanQuery(req: Request, key: string): boolean | undefined {
  const value = optionalQueryString(req, key);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  throw new UiHttpError(400, `Invalid ${key}: expected a boolean`);
}

function positiveIntQuery(
  req: Request,
  key: string,
  max: number,
  options: { allowZero?: boolean } = {},
): number | undefined {
  const value = optionalQueryString(req, key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  const min = options.allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UiHttpError(400, `Invalid ${key}: expected an integer from ${min} to ${max}`);
  }
  return parsed;
}

function nonNegativeIntQuery(req: Request, key: string, max: number): number | undefined {
  const value = optionalQueryString(req, key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new UiHttpError(400, `Invalid ${key}: expected an integer from 0 to ${max}`);
  }
  return parsed;
}

class UiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
