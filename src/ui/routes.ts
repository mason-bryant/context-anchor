import type { NextFunction, Request, Response, Express } from "express";

import type { AnchorService } from "../anchorService.js";
import { isDiscoveryCategory, type DiscoveryCategory } from "../taxonomy.js";
import type { ContextRootFormat, PlanContextBundleInput, ProposedChangeListInput, ProposedChangeStatus } from "../types.js";
import { UI_CSS, UI_HTML, UI_JS } from "./assets.js";
import { toAnchorUiDetail, toAnchorUiMeta } from "./viewModel.js";

type UiAuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

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
      const { anchors, projectFilter } = await service.listAnchorsDiscovery(readDiscoveryFilters(req));
      return {
        anchors: anchors.map(toAnchorUiMeta),
        ...(projectFilter ? { projectFilter } : {}),
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

function booleanQuery(req: Request, key: string): boolean | undefined {
  const value = optionalQueryString(req, key);
  if (value === undefined) {
    return undefined;
  }
  return value === "1" || value.toLowerCase() === "true";
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

class UiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
