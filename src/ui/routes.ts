import path from "node:path";
import { createRequire } from "node:module";

import express, { type NextFunction, type Request, type Response, type Express } from "express";

import type { AnchorService } from "../anchorService.js";
import { PeopleRegistryConflictError, ProjectMappingsConflictError } from "../git/repo.js";
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
import type { GraphEdgeType } from "../graph/model.js";
import { UI_CSS, UI_HTML, UI_JS } from "./assets.js";
import { toAnchorUiDetail, toAnchorUiMeta } from "./viewModel.js";

type UiAuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;
type UiAnchorSort = "name" | "updated" | "created" | "priority";

const require = createRequire(import.meta.url);

export function resolveMermaidDistDir(resolveModule: (id: string) => string = require.resolve): string | undefined {
  try {
    return path.dirname(resolveModule("mermaid/dist/mermaid.esm.min.mjs"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

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
  const mermaidDistDir = resolveMermaidDistDir();
  if (mermaidDistDir) {
    app.use(
      "/ui/vendor/mermaid",
      express.static(mermaidDistDir, {
        fallthrough: false,
        index: false,
      }),
    );
  }

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
      const claims = await service.listClaims({ name });
      const questions = await service.listQuestions({ name });
      const mermaidBlocks = await service.listMermaidBlocks({ name });
      return { anchor: toAnchorUiDetail(anchor, undefined, claims.claims, questions.questions, mermaidBlocks.blocks) };
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
    "/api/ui/project-priority",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.updateProjectPriority({
        project: optionalBodyString(body, "project"),
        name: optionalBodyString(body, "name"),
        priority: nullableNumberBody(body, "priority"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.get(
    "/api/ui/tasks-due",
    ...protect,
    jsonRoute(async (req) => {
      const project = optionalQueryString(req, "project");
      const dueBefore = optionalQueryString(req, "dueBefore");
      const dueAfter = optionalQueryString(req, "dueAfter");
      const completedBefore = optionalQueryString(req, "completedBefore");
      const completedAfter = optionalQueryString(req, "completedAfter");
      const noDue = req.query["noDue"] === "true";
      const unassigned = req.query["unassigned"] === "true";
      const statusRaw = optionalQueryString(req, "status");
      const status = statusRaw ? statusRaw.split(",") : undefined;
      const owner = optionalQueryString(req, "owner");
      const maxProjectPriority = finiteNumberQuery(req, "maxProjectPriority");
      const maxTaskPriority = finiteNumberQuery(req, "maxTaskPriority");
      const modifiedAfter = optionalQueryString(req, "modifiedAfter");
      return service.listTasksDue({
        ...(project ? { project } : {}),
        ...(dueBefore ? { dueBefore } : {}),
        ...(dueAfter ? { dueAfter } : {}),
        ...(completedBefore ? { completedBefore } : {}),
        ...(completedAfter ? { completedAfter } : {}),
        ...(modifiedAfter ? { modifiedAfter } : {}),
        ...(noDue ? { noDue } : {}),
        ...(unassigned ? { unassigned } : {}),
        ...(owner ? { owner } : {}),
        ...(maxProjectPriority !== undefined ? { maxProjectPriority } : {}),
        ...(maxTaskPriority !== undefined ? { maxTaskPriority } : {}),
        status: status as ("todo" | "active" | "blocked" | "done" | "cancelled")[] | undefined,
      });
    }),
  );

  app.get(
    "/api/ui/people",
    ...protect,
    jsonRoute(async (req) => service.listPeople(optionalQueryString(req, "team"))),
  );

  app.get(
    "/api/ui/people-search",
    ...protect,
    jsonRoute(async (req) => service.searchPeople(requiredQueryString(req, "q"), positiveIntQuery(req, "limit", 25) ?? 10)),
  );

  app.get(
    "/api/ui/person",
    ...protect,
    jsonRoute(async (req) => service.readPerson(requiredQueryString(req, "id"))),
  );

  app.get(
    "/api/ui/teams",
    ...protect,
    jsonRoute(async (_req) => service.listTeams()),
  );

  app.get(
    "/api/ui/team",
    ...protect,
    jsonRoute(async (req) => service.readTeam(requiredQueryString(req, "id"))),
  );

  app.get(
    "/api/ui/people-registry",
    ...protect,
    jsonRoute(async (_req) => service.getPeopleRegistry()),
  );

  app.post(
    "/api/ui/people-registry",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const registry = bodyObject(body, "registry");
      const people = bodyPeopleArray(registry);
      const teams = bodyTeamsArray(registry);
      try {
        await service.writePeopleRegistry({
          registry: { people, teams },
          message: optionalBodyString(body, "message"),
          coAuthor: optionalBodyString(body, "coAuthor"),
          expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
        });
      } catch (error) {
        if (error instanceof PeopleRegistryConflictError) {
          throw new UiHttpError(409, error.message);
        }
        throw error;
      }
      return { ok: true };
    }),
  );

  app.get(
    "/api/ui/project-mappings",
    ...protect,
    jsonRoute(async (_req) => service.getProjectMappings()),
  );

  app.post(
    "/api/ui/project-mappings",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const mappings = bodyObject(body, "mappings");
      try {
        await service.writeProjectMappings({
          mappings,
          message: optionalBodyString(body, "message"),
          coAuthor: optionalBodyString(body, "coAuthor"),
          expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
        });
      } catch (error) {
        if (error instanceof ProjectMappingsConflictError) {
          throw new UiHttpError(409, error.message);
        }
        throw error;
      }
      return { ok: true };
    }),
  );

  app.get(
    "/api/ui/roadmap-goals",
    ...protect,
    jsonRoute(async (req) => {
      const project = optionalQueryString(req, "project");
      if (!project) {
        throw new UiHttpError(400, "project is required");
      }
      const statusRaw = optionalQueryString(req, "status");
      const status =
        statusRaw === "active" || statusRaw === "completed" || statusRaw === "cancelled" ? statusRaw : undefined;
      const sortRaw = optionalQueryString(req, "sort");
      const sort = sortRaw === "status" || sortRaw === "id" || sortRaw === "recent" ? sortRaw : undefined;
      return service.listRoadmapGoals({ project, ...(status ? { status } : {}), ...(sort ? { sort } : {}) });
    }),
  );

  app.get(
    "/api/ui/claims",
    ...protect,
    jsonRoute(async (req) => {
      const name = optionalQueryString(req, "name");
      const project = optionalQueryString(req, "project");
      const statusRaw = optionalQueryString(req, "status");
      const status =
        statusRaw === "annotated" || statusRaw === "unannotated" || statusRaw === "malformed" ? statusRaw : undefined;
      const sectionRaw = optionalQueryString(req, "section");
      const section =
        sectionRaw === "Current State" || sectionRaw === "Decisions" || sectionRaw === "Constraints"
          ? sectionRaw
          : undefined;
      const confRaw = optionalQueryString(req, "conf");
      const conf = confRaw === "high" || confRaw === "medium" || confRaw === "low" ? confRaw : undefined;
      const q = optionalQueryString(req, "q");
      // These feed lexicographic ISO-date comparisons; drop malformed values.
      const isoDate = /^\d{4}-\d{2}-\d{2}$/;
      const observedBeforeRaw = optionalQueryString(req, "observedBefore");
      const observedBefore = observedBeforeRaw && isoDate.test(observedBeforeRaw) ? observedBeforeRaw : undefined;
      const observedAfterRaw = optionalQueryString(req, "observedAfter");
      const observedAfter = observedAfterRaw && isoDate.test(observedAfterRaw) ? observedAfterRaw : undefined;
      return service.listClaims({
        ...(name ? { name } : {}),
        ...(project ? { project } : {}),
        ...(status ? { status } : {}),
        ...(section ? { section } : {}),
        ...(conf ? { conf } : {}),
        ...(q ? { q } : {}),
        ...(observedBefore ? { observedBefore } : {}),
        ...(observedAfter ? { observedAfter } : {}),
      });
    }),
  );

  app.get(
    "/api/ui/graph-neighbors",
    ...protect,
    jsonRoute(async (req) => {
      const node = requiredQueryString(req, "node");
      const depth = positiveIntQuery(req, "depth", 3);
      const limit = positiveIntQuery(req, "limit", 200);
      const directionRaw = optionalQueryString(req, "direction");
      const direction =
        directionRaw === "forward" || directionRaw === "reverse" || directionRaw === "both" ? directionRaw : undefined;
      const edgeTypesRaw = optionalQueryString(req, "edgeTypes");
      const edgeTypes = edgeTypesRaw
        ? (edgeTypesRaw.split(",").map((value) => value.trim()).filter(Boolean) as GraphEdgeType[])
        : undefined;
      return service.graphNeighbors({
        node,
        ...(depth !== undefined ? { depth } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(direction ? { direction } : {}),
        ...(edgeTypes && edgeTypes.length > 0 ? { edgeTypes } : {}),
      });
    }),
  );

  app.get(
    "/api/ui/questions",
    ...protect,
    jsonRoute(async (req) => {
      const name = optionalQueryString(req, "name");
      const project = optionalQueryString(req, "project");
      const statusRaw = optionalQueryString(req, "status");
      const status =
        statusRaw === "open" || statusRaw === "resolved" || statusRaw === "deferred" || statusRaw === "wont-answer"
          ? statusRaw
          : undefined;
      const q = optionalQueryString(req, "q");
      return service.listQuestions({
        ...(name ? { name } : {}),
        ...(project ? { project } : {}),
        ...(status ? { status } : {}),
        ...(q ? { q } : {}),
      });
    }),
  );

  app.post(
    "/api/ui/question-status",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const action = optionalBodyString(body, "action");
      const line = optionalBodyNumber(body, "line");
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
        throw new UiHttpError(400, "Invalid line: expected a positive integer");
      }
      if (action === "reopen") {
        return service.reopenQuestion({
          name: requiredBodyString(body, "name"),
          line,
          id: optionalBodyString(body, "id"),
          question: optionalBodyString(body, "question"),
          owner: optionalBodyString(body, "owner"),
          message: optionalBodyString(body, "message"),
          approved: booleanBody(body, "approved"),
          coAuthor: optionalBodyString(body, "coAuthor"),
          expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
        });
      }
      const statusRaw = optionalBodyString(body, "status");
      const status =
        statusRaw === "resolved" || statusRaw === "deferred" || statusRaw === "wont-answer" ? statusRaw : undefined;
      return service.resolveQuestion({
        name: requiredBodyString(body, "name"),
        line,
        id: optionalBodyString(body, "id"),
        question: optionalBodyString(body, "question"),
        status,
        resolution: optionalBodyString(body, "resolution"),
        resolvedOn: optionalBodyString(body, "resolvedOn"),
        owner: optionalBodyString(body, "owner"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/question-text",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const line = optionalBodyNumber(body, "line");
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
        throw new UiHttpError(400, "Invalid line: expected a positive integer");
      }
      return service.updateQuestionText({
        name: requiredBodyString(body, "name"),
        line,
        id: optionalBodyString(body, "id"),
        question: optionalBodyString(body, "question"),
        text: optionalBodyString(body, "text"),
        delete: booleanBody(body, "delete") === true,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/claim-annotation",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.annotateClaim({
        name: requiredBodyString(body, "name"),
        claim: requiredBodyString(body, "claim"),
        src: optionalBodyString(body, "src"),
        observed: optionalBodyString(body, "observed"),
        conf: optionalBodyString(body, "conf"),
        id: optionalBodyString(body, "id"),
        kind: optionalBodyString(body, "kind"),
        person: optionalBodyString(body, "person"),
        clear: booleanBody(body, "clear"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/claim-sources",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const sources = bodyArray(body, "sources").map((source, index) => ({
        src: requiredObjectString(source, "src", `sources[${index}].src`),
        observed: requiredObjectString(source, "observed", `sources[${index}].observed`),
        conf: requiredObjectString(source, "conf", `sources[${index}].conf`),
        ...(optionalObjectString(source, "id") ? { id: optionalObjectString(source, "id") } : {}),
        ...(optionalObjectString(source, "kind") ? { kind: optionalObjectString(source, "kind") } : {}),
        ...(optionalObjectString(source, "person") ? { person: optionalObjectString(source, "person") } : {}),
      }));
      return service.setClaimSources({
        name: requiredBodyString(body, "name"),
        claim: optionalBodyString(body, "claim"),
        line: optionalBodyNumber(body, "line"),
        sources,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/claim-text",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const line = optionalBodyNumber(body, "line");
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
        throw new UiHttpError(400, "Invalid line: expected a positive integer");
      }
      return service.updateClaimText({
        name: requiredBodyString(body, "name"),
        claim: optionalBodyString(body, "claim"),
        line,
        text: optionalBodyString(body, "text"),
        delete: booleanBody(body, "delete") === true,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/mermaid-sources",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const sources = bodyArray(body, "sources").map((source, index) => ({
        src: requiredObjectString(source, "src", `sources[${index}].src`),
        observed: requiredObjectString(source, "observed", `sources[${index}].observed`),
        conf: requiredObjectString(source, "conf", `sources[${index}].conf`),
        ...(optionalObjectString(source, "id") ? { id: optionalObjectString(source, "id") } : {}),
        ...(optionalObjectString(source, "kind") ? { kind: optionalObjectString(source, "kind") } : {}),
        ...(optionalObjectString(source, "person") ? { person: optionalObjectString(source, "person") } : {}),
      }));
      return service.setMermaidBlockSources({
        name: requiredBodyString(body, "name"),
        line: positiveBodyLine(body, "line"),
        sources,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/mermaid-text",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.updateMermaidBlockText({
        name: requiredBodyString(body, "name"),
        line: positiveBodyLine(body, "line"),
        text: optionalBodyString(body, "text"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/bullet-text",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const line = optionalBodyNumber(body, "line");
      if (line === undefined || !Number.isInteger(line) || line < 1) {
        throw new UiHttpError(400, "Invalid line: expected a positive integer");
      }
      return service.updateBulletText({
        name: requiredBodyString(body, "name"),
        line,
        text: optionalBodyString(body, "text"),
        delete: booleanBody(body, "delete") === true,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-due",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const due = body["due"] === null ? null : optionalBodyString(body, "due") ?? null;
      return service.updateTaskDue({
        name: requiredBodyString(body, "name"),
        taskId: requiredBodyString(body, "taskId"),
        due,
        dateConfidence: optionalBodyString(body, "dateConfidence") as "committed" | "internal_goal" | "estimated" | undefined,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-owner",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const owner = body["owner"] === null ? null : optionalBodyString(body, "owner") ?? null;
      return service.updateTaskOwner({
        name: requiredBodyString(body, "name"),
        taskId: requiredBodyString(body, "taskId"),
        owner,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-priority",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.updateTaskPriority({
        name: requiredBodyString(body, "name"),
        taskId: requiredBodyString(body, "taskId"),
        priority: nullableNumberBody(body, "priority"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-notes",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const notes = body["notes"] === null ? null : optionalBodyString(body, "notes") ?? null;
      return service.updateTaskNotes({
        name: requiredBodyString(body, "name"),
        taskId: requiredBodyString(body, "taskId"),
        notes,
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-create",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      const goalIdsRaw = body["goalIds"];
      const goalIds = Array.isArray(goalIdsRaw)
        ? goalIdsRaw.filter((g): g is string => typeof g === "string")
        : undefined;
      return service.createTask({
        project: requiredBodyString(body, "project"),
        title: requiredBodyString(body, "title"),
        milestone: optionalBodyString(body, "milestone"),
        status: optionalBodyString(body, "status") as
          | "todo"
          | "active"
          | "blocked"
          | "done"
          | "cancelled"
          | undefined,
        owner: optionalBodyString(body, "owner"),
        priority: optionalNumberBody(body, "priority"),
        due: optionalBodyString(body, "due"),
        dateConfidence: optionalBodyString(body, "dateConfidence") as
          | "committed"
          | "internal_goal"
          | "estimated"
          | undefined,
        ...(goalIds && goalIds.length > 0 ? { goalIds } : {}),
        notes: optionalBodyString(body, "notes"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
      });
    }),
  );

  app.post(
    "/api/ui/task-complete",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.completeTask({
        taskId: requiredBodyString(body, "taskId"),
        name: optionalBodyString(body, "name"),
        project: optionalBodyString(body, "project"),
        completedOn: optionalBodyString(body, "completedOn"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-reopen",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.reopenTask({
        taskId: requiredBodyString(body, "taskId"),
        name: optionalBodyString(body, "name"),
        project: optionalBodyString(body, "project"),
        message: optionalBodyString(body, "message"),
        approved: booleanBody(body, "approved"),
        coAuthor: optionalBodyString(body, "coAuthor"),
        expectedFileCommit: optionalBodyString(body, "expectedFileCommit"),
      });
    }),
  );

  app.post(
    "/api/ui/task-delete",
    ...protect,
    jsonRoute(async (req) => {
      const body = bodyRecord(req);
      return service.deleteTask({
        taskId: requiredBodyString(body, "taskId"),
        name: optionalBodyString(body, "name"),
        project: optionalBodyString(body, "project"),
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
  if (sort !== "name" && sort !== "updated" && sort !== "created" && sort !== "priority") {
    throw new UiHttpError(400, `Invalid anchor sort: ${sort}`);
  }
  return sort;
}

function readPlannerInput(req: Request): PlanContextBundleInput {
  const filters = readDiscoveryFilters(req);
  const repo = optionalQueryString(req, "repo");
  const filePaths = readStringArrayQuery(req, "filePaths");
  return {
    task: requiredQueryString(req, "task"),
    ...filters,
    ...(repo ? { repo } : {}),
    ...(filePaths.length > 0 ? { filePaths } : {}),
    budgetTokens: positiveIntQuery(req, "budgetTokens", 200000),
    maxAnchors: positiveIntQuery(req, "maxAnchors", 500),
    maxExcluded: positiveIntQuery(req, "maxExcluded", 500, { allowZero: true }),
  };
}

/** Read a repeated query parameter (e.g. `?filePaths=a&filePaths=b`) as a trimmed, non-empty string array. */
function readStringArrayQuery(req: Request, key: string): string[] {
  const value = req.query[key];
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const items: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim().length > 0) {
      items.push(item.trim());
    }
  }
  return items;
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

function optionalBodyNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new UiHttpError(400, `Invalid ${key}: expected a number`);
}

function positiveBodyLine(body: Record<string, unknown>, key: string): number {
  const value = optionalBodyNumber(body, key);
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    throw new UiHttpError(400, `Invalid ${key}: expected a positive integer`);
  }
  return value;
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

function optionalObjectString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredObjectString(body: Record<string, unknown>, key: string, label: string): string {
  const value = optionalObjectString(body, key);
  if (!value) {
    throw new UiHttpError(400, `Missing required body field: ${label}`);
  }
  return value;
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

function nullableNumberBody(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new UiHttpError(400, `Invalid ${key}: expected a finite number or null`);
}

function optionalNumberBody(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new UiHttpError(400, `Invalid ${key}: expected a finite number`);
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

function finiteNumberQuery(req: Request, key: string): number | undefined {
  const value = optionalQueryString(req, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UiHttpError(400, `Invalid ${key}: expected a finite number`);
  }
  return parsed;
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

function bodyPeopleArray(registry: Record<string, unknown>) {
  const raw = registry["people"];
  if (!Array.isArray(raw)) {
    throw new UiHttpError(400, "registry.people must be an array");
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UiHttpError(400, `registry.people[${i}] must be an object`);
    }
    const obj = item as Record<string, unknown>;
    const id = requiredBodyString(obj, "id");
    const displayName = requiredBodyString(obj, "displayName");
    const teams = obj["teams"] !== undefined ? (Array.isArray(obj["teams"]) ? (obj["teams"] as string[]) : undefined) : undefined;
    const identities = obj["identities"] !== undefined ? (obj["identities"] as Record<string, unknown>) : undefined;
    const projects = Array.isArray(obj["projects"]) ? (obj["projects"] as unknown[]) : undefined;
    return {
      id,
      displayName,
      ...(identities ? { identities } : {}),
      ...(teams ? { teams } : {}),
      ...(projects ? { projects } : {}),
    };
  });
}

function bodyTeamsArray(registry: Record<string, unknown>) {
  const raw = registry["teams"];
  if (!Array.isArray(raw)) {
    throw new UiHttpError(400, "registry.teams must be an array");
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UiHttpError(400, `registry.teams[${i}] must be an object`);
    }
    const obj = item as Record<string, unknown>;
    const id = requiredBodyString(obj, "id");
    const displayName = requiredBodyString(obj, "displayName");
    const synonyms = obj["synonyms"] !== undefined ? (Array.isArray(obj["synonyms"]) ? (obj["synonyms"] as string[]) : undefined) : undefined;
    const slackHandles = obj["slackHandles"] !== undefined ? (Array.isArray(obj["slackHandles"]) ? (obj["slackHandles"] as string[]) : undefined) : undefined;
    const projects = Array.isArray(obj["projects"]) ? (obj["projects"] as unknown[]) : undefined;
    return {
      id,
      displayName,
      ...(synonyms ? { synonyms } : {}),
      ...(slackHandles ? { slackHandles } : {}),
      ...(projects ? { projects } : {}),
    };
  });
}

class UiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
