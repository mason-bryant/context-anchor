import type { NextFunction, Request, Response, Express } from "express";

import type { AnchorService } from "../anchorService.js";
import { isDiscoveryCategory, type DiscoveryCategory } from "../taxonomy.js";
import type { ContextRootFormat } from "../types.js";
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
      const anchors = await service.listAnchors(readDiscoveryFilters(req));
      return { anchors: anchors.map(toAnchorUiMeta) };
    }),
  );

  app.get(
    "/api/ui/anchor",
    ...protect,
    jsonRoute(async (req) => {
      const name = requiredQueryString(req, "name");
      const [anchor, metas] = await Promise.all([
        service.readAnchor(name),
        service.listAnchors({ includeArchive: true }),
      ]);
      const meta = metas.find((row) => row.name === anchor.name);
      return { anchor: toAnchorUiDetail(anchor, meta) };
    }),
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

class UiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
