import { beforeAll, describe, expect, it } from "vitest";

import type { AnchorService } from "../src/anchorService.js";
import { createAnchorMcpServer } from "../src/server.js";

/**
 * Which tools advertise the shape of what they return (T-55).
 *
 * Not one of them did. The SDK validates a response against `outputSchema` and skips validation
 * entirely when none is declared, so every tool here was returning whatever its handler happened
 * to build, and the suite's assertions on `structuredContent` were checking a shape no client is
 * told about. The evidence in T-55 is blunt: flipping `jsonResult`'s `isError` to true, making
 * every db tool report failure to every client, left the suite green.
 *
 * This file does not fix that -- declaring 60-odd real response shapes is its own work, and
 * guessing them would be worse than declaring none, because a schema that disagrees with the
 * handler turns a working tool into a validation error for every caller. What it does is stop
 * the gap growing and leave the burn-down list somewhere it cannot rot: a new tool with no
 * outputSchema fails here, and removing a name from the list is how the work gets recorded.
 */

type Registry = { _registeredTools: Record<string, { outputSchema?: unknown }> };

/**
 * Tools registered before outputSchema was required of new ones.
 *
 * Every entry is a tool whose response shape is undeclared and therefore unvalidated. Shrinking
 * this list is the work; nothing may be added to it.
 */
const WITHOUT_OUTPUT_SCHEMA = new Set([
  "annotateClaim", "appendToAnchorSection", "applyAnchorMigration", "applyProposedChange",
  "compactionReport", "completeTask", "conflictStatus", "contextRoot", "createTask",
  "deleteAnchor", "deleteAnchorSection", "deleteTask", "diffAnchor", "getPeopleRegistry",
  "getProjectMappings", "getRelated", "graphCoverage", "graphNeighbors", "listAnchors",
  "listClaims", "listMilestones", "listPeople", "listProposedChanges", "listQuestions",
  "listRoadmapGoals", "listTasksDue", "listTeams", "listVersions", "loadContext",
  "migrateRoadmapGoalIds", "planContextBundle", "previewAnchorMigration", "previewProposedChange",
  "projectUpdateSnapshot", "proposeChange", "readAnchor", "readAnchorBatch", "readAnchorSection",
  "readMilestone", "readPerson", "readProposedChange", "readTeam", "renameAnchor",
  "renderProjectUpdate", "reopenQuestion", "reopenTask", "resolveQuestion", "revertAnchor",
  "reviewProposedChange", "searchAnchors", "setClaimSources", "startTask", "suggestMarkdownLinks",
  "updateAnchorFrontmatter", "updateAnchorSection", "updateProjectPriority", "updateTaskDue",
  "updateTaskNotes", "updateTaskOwner", "updateTaskPriority", "writeAnchor", "writeContextRoot",
  "writePeopleRegistry", "writeProjectMappings",
]);

/**
 * Database-backed tools, registered only when a knowledgeDb is supplied.
 *
 * A separate list because they are a separate registry. The first version of this file built the
 * server without a backend and checked only what that produced -- so every db tool was outside
 * the guard entirely, and a new one with no outputSchema would have passed while this file
 * claimed to prevent exactly that. Raised in review.
 */
const DB_TOOLS_WITHOUT_OUTPUT_SCHEMA = new Set([
  "addCitation", "createAssertion", "createAssertionRelation", "importDocuments",
  "listScopeChanges", "listScopes", "planRoutedBundle", "reportRecordUse", "retireAssertion",
  "setAssertionStatus", "setRecordScopes", "updateAssertion",
]);

describe("MCP tool output schemas", () => {
  let registry: Registry;
  let names: string[];
  let dbRegistry: Registry;
  let dbNames: string[];
  let dbOnly: string[];

  // In a hook rather than at describe-evaluation time. Building the server while the suite is
  // being defined turns any throw from createAnchorMcpServer into a collection error -- the file
  // fails to load, with no test named and a stack pointing at module evaluation, which is a poor
  // way to learn that tool registration is broken.
  beforeAll(() => {
    registry = createAnchorMcpServer({} as AnchorService) as unknown as Registry;
    names = Object.keys(registry._registeredTools).sort();

    // Constructed with a backend so the db-only tools register. The stub is never called: this
    // file reads the registry rather than invoking anything.
    dbRegistry = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {} as never,
    }) as unknown as Registry;
    dbNames = Object.keys(dbRegistry._registeredTools).sort();
    dbOnly = dbNames.filter((name) => !names.includes(name));
  });

  it("registers tools at all, so an empty registry cannot pass every check here", () => {
    // The checks below iterate the registry, so a construction failure producing no tools would
    // satisfy them vacuously -- which is exactly how a coverage guard stops guarding.
    //
    // Named rather than counted. A threshold fails on a legitimate tool removal, which teaches
    // whoever hits it that this file is noise; a tool that must exist for the server to be a
    // server does not move when the surface is refactored.
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("readAnchor");
  });

  it("requires a new tool to declare what it returns", () => {
    const undeclared = names.filter(
      (name) => !registry._registeredTools[name]!.outputSchema && !WITHOUT_OUTPUT_SCHEMA.has(name),
    );
    // A tool reaching here is new since 2026-08-16. Declare its outputSchema rather than adding
    // it to the list: the list is a record of debt that predates the rule, not a way past it.
    expect(undeclared).toEqual([]);
  });

  it("covers the database-backed tools, which register only with a backend", () => {
    expect(dbOnly.length).toBeGreaterThan(0);
    const undeclared = dbOnly.filter(
      (name) =>
        !dbRegistry._registeredTools[name]!.outputSchema && !DB_TOOLS_WITHOUT_OUTPUT_SCHEMA.has(name),
    );
    expect(undeclared).toEqual([]);
  });

  it("keeps the database burn-down list honest too", () => {
    const stale = [...DB_TOOLS_WITHOUT_OUTPUT_SCHEMA].filter(
      (name) => !dbNames.includes(name) || dbRegistry._registeredTools[name]?.outputSchema,
    );
    expect(stale).toEqual([]);
  });

  it("keeps the burn-down list honest as tools gain schemas or disappear", () => {
    // A name left on the list after its tool declared a schema, or after the tool was removed,
    // makes the list read as more debt than exists -- and a list nobody trusts is one nobody
    // works through. Removing the name is how progress gets recorded.
    const stale = [...WITHOUT_OUTPUT_SCHEMA].filter(
      (name) => !names.includes(name) || registry._registeredTools[name]?.outputSchema,
    );
    expect(stale).toEqual([]);
  });
});
