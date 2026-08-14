import { describe, expect, it } from "vitest";

import type { AnchorService } from "../../src/anchorService.js";
import { createAnchorMcpServer } from "../../src/server.js";
import { callTool, type ToolRegistry } from "../mcpToolHarness.js";
import type { ScopeSummary } from "../../src/db/knowledgeDb.js";

type AdvertisedServer = {
  _registeredTools: Record<
    string,
    {
      description?: string;
      handler: (input: unknown) => Promise<unknown>;
      inputSchema?: { parse: (input: unknown) => unknown };
    }
  >;
};

const SAMPLE_REPORT = {
  batchGuid: "b1",
  documentsImported: 1,
  revisionsCreated: 1,
  sectionsCreated: 2,
  blocksCreated: 3,
  scopesCreated: 1,
  relationsCreated: 0,
  associationsDerived: 2,
  mappingsImported: 0,
  mappingsUpdated: 0,
  peopleImported: 0,
  documentsRetired: 0,
  documentsReinstated: 0,
  unchanged: [],
};

const SAMPLE_PLAN = {
  requestId: "00000000-0000-4000-8000-000000000000",
  plannerVersion: "routing-1.0.0",
  recomputedAt: "2026-08-10T00:00:00.000Z",
  budget: { expanded: 2, listed: 10, recordsPerRoute: 25 },
  ranker: { id: "precedence", version: "1.0.0", deterministic: true, fellBack: false },
  candidateCount: 0,
  appliedSignals: { recordLexical: false },
  routes: [],
};

const SAMPLE_SCOPES: ScopeSummary[] = [
  {
    scopeGuid: "11111111-1111-1111-1111-111111111111",
    scopeSlug: "workspace",
    scopeKind: "workspace",
    title: "Workspace",
    summary: null,
    aliases: [],
  },
];

/**
 * The T3 write surface, stubbed once. These cases exercise reads and advertisement, so the
 * writes only need to exist — spreading them keeps adding a method from touching every stub.
 */
const WRITE_STUBS = {
  createAssertionAsOwner: async () => ({
    assertionGuid: "11111111-1111-4111-8111-111111111111",
    citationGuid: "22222222-2222-4222-8222-222222222222",
    version: 1,
    scopeGuid: "33333333-3333-4333-8333-333333333333",
    replayed: false,
  }),
  setAssertionStatusAsOwner: async () => ({
    assertionGuid: "11111111-1111-4111-8111-111111111111",
    status: "disputed" as const,
    previousStatus: "active" as const,
    version: 2,
    replayed: false,
    changed: true,
  }),
  updateAssertionAsOwner: async () => ({
    assertionGuid: "11111111-1111-4111-8111-111111111111",
    version: 2,
    replayed: false,
    changed: ["title" as const],
  }),
  retireAssertionAsOwner: async () => ({
    assertionGuid: "11111111-1111-4111-8111-111111111111",
    version: 2,
    replayed: false,
    associationsRetired: 1,
    relationsRetired: 0,
  }),
  addCitationAsOwner: async () => ({
    citationGuid: "55555555-5555-4555-8555-555555555555",
    assertionGuid: "11111111-1111-4111-8111-111111111111",
    version: 2,
    replayed: false,
  }),
  createAssertionRelationAsOwner: async () => ({
    relationGuid: "44444444-4444-4444-8444-444444444444",
    relationType: "contradicts" as const,
    replayed: false,
  }),
  setRecordScopesAsOwner: async () => ({
    added: ["security"],
    retired: [],
    unchanged: [],
    replayed: false,
  }),
};

describe("listScopeChanges tool registration", () => {
  it("is not registered when no database backend is configured", () => {
    const server = createAnchorMcpServer({} as AnchorService) as unknown as AdvertisedServer;
    expect(server._registeredTools.listScopeChanges).toBeUndefined();
  });

  it("is registered and returns typed change entries when a backend is configured", async () => {
    const entry = {
      entryGuid: "e1",
      entryType: "scope.renamed",
      streamId: "scope:abc",
      priorValue: { title: "Before" },
      resultingValue: { title: "After" },
      commandGuid: "c1",
      commandType: "scope.rename",
      batchGuid: null,
      actorPrincipalGuid: "p1",
      actorDisplayName: "Operator",
      reason: "because",
      occurredAt: new Date("2026-08-08T12:00:00.000Z"),
      recordedAt: new Date("2026-08-08T12:00:00.000Z"),
    };

    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async (input: { scope: string }) => {
          expect(input.scope).toBe("http-transport");
          return [entry];
        },
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    expect(server._registeredTools.listScopeChanges).toBeDefined();

    const result = (await callTool(server as unknown as ToolRegistry, "listScopeChanges", {
      scope: "http-transport",
      since: "7d",
    })) as { structuredContent: { changes: unknown[] } };
    expect(result.structuredContent.changes).toHaveLength(1);
  });

  /**
   * T-46 shipped once already as a flag no surface could set — declared on the selection input
   * but absent from PlanInput — and the fix for that was itself incomplete: PlanInput gained it
   * while the MCP tool schema did not, so it stayed unreachable from the only surface callers
   * use. Zod strips unknown keys, so the flag arriving as `undefined` at the facade is exactly
   * what "silently ignored" looks like from the outside.
   */
  it("passes recordLexical from the tool schema through to the planner", async () => {
    let received: Record<string, unknown> | undefined;
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async (input: Record<string, unknown>) => {
          received = input;
          return SAMPLE_PLAN;
        },
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    // Through the schema, not around it. Calling the handler directly with a literal proves
    // nothing about the tool's surface: the handler destructures whatever object it is given,
    // so the test passed identically with the schema field deleted. Zod strips unknown keys,
    // so parsing is the step that decides whether an MCP client can set this at all.
    const schema = server._registeredTools.planRoutedBundle!.inputSchema!;
    // Asserted on the parse output as well as through the harness: this test is specifically
    // about whether the SCHEMA carries the field, so it checks the parsed value directly and
    // then confirms the same input reaches the planner when sent the way a client sends it.
    const parsed = schema.parse({ task: "logging retention", recordLexical: true }) as {
      recordLexical?: boolean;
    };
    expect(parsed.recordLexical).toBe(true);

    await callTool(server as unknown as ToolRegistry, "planRoutedBundle", {
      task: "logging retention",
      recordLexical: true,
    });
    expect(received?.recordLexical).toBe(true);

    // Omitted, not defaulted to false — asserted on the parsed schema output, which is exactly
    // where this holds and no further. The handler spreads every optional field into the facade
    // call, so `recordLexical: undefined` is a present key by the next line, the same as its
    // five siblings. That is deliberate and unchanged here; distinguishing "absent" from
    // "present and undefined" downstream would mean changing all six, and nothing reads either
    // way — selection tests truthiness.
    //
    // What this still buys: a schema carrying `.default(false)` would put an explicit `false` on
    // every request, which is a different thing from the caller declining to ask. The surface
    // stays silent unless asked, and that is what is checked.
    const bare = schema.parse({ task: "logging retention" }) as Record<string, unknown>;
    expect(Object.hasOwn(bare, "recordLexical")).toBe(false);

    await callTool(server as unknown as ToolRegistry, "planRoutedBundle", { task: "logging retention" });
    expect(received?.recordLexical).toBeUndefined();
  });

  it("rejects input the tool schema forbids, which calling the handler directly does not", async () => {
    // The reason callTool exists, and a case only parsing can catch. An undeclared field proves
    // nothing -- the handler destructures named fields, so it drops unknown keys whether or not
    // Zod ran. Validation is different: the schema refuses a malformed commit sha, and a test
    // that skips it happily exercises the tool with input no client could send.
    //
    // My first version of this test asserted the undeclared-field case, and passed with parsing
    // removed. That is the exact defect this helper exists to prevent, written into its own
    // test.
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    await expect(
      callTool(server as unknown as ToolRegistry, "importDocuments", {
        repository: "context-anchor",
        commitSha: "not-a-sha",
        files: [{ path: "docs/a.md", content: "# A\n" }],
      }),
    ).rejects.toThrow(/40-character git SHA/);
  });

  it("trims scope and since at the schema, so a padded value resolves instead of failing downstream", () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    // Asserted against the schema rather than the handler: calling the handler directly
    // bypasses validation, so a handler-level check would prove nothing about the contract
    // an actual MCP client goes through.
    const schema = server._registeredTools.listScopeChanges!.inputSchema!;
    expect(schema.parse({ scope: "  http-transport  ", since: "  7d  " })).toMatchObject({
      scope: "http-transport",
      since: "7d",
    });

    expect(() => schema.parse({ scope: "   " })).toThrow();
  });
});

describe("listScopes tool registration", () => {
  it("is not registered when no database backend is configured", () => {
    const server = createAnchorMcpServer({} as AnchorService) as unknown as AdvertisedServer;
    expect(server._registeredTools.listScopes).toBeUndefined();
    // An agent must not be offered a tool that cannot work: routed retrieval reads and
    // writes the database on every call.
    expect(server._registeredTools.planRoutedBundle).toBeUndefined();
    expect(server._registeredTools.reportRecordUse).toBeUndefined();

    // The writes must disappear with the rest of the database surface. An advertised tool that
    // cannot work is worse than a missing one: an agent will call it and read the failure as a
    // fact about the workspace rather than about the configuration.
    expect(server._registeredTools.createAssertion).toBeUndefined();
    expect(server._registeredTools.updateAssertion).toBeUndefined();
    expect(server._registeredTools.retireAssertion).toBeUndefined();
    expect(server._registeredTools.addCitation).toBeUndefined();
    expect(server._registeredTools.setAssertionStatus).toBeUndefined();
    expect(server._registeredTools.createAssertionRelation).toBeUndefined();
    expect(server._registeredTools.setRecordScopes).toBeUndefined();
  });

  it("is registered and returns scopes when a database backend is configured", async () => {
    const fakeKnowledgeDb = {
      ...WRITE_STUBS,
      listScopesForOwner: async () => SAMPLE_SCOPES,
      listScopeChangesForOwner: async () => [],
      importDocumentsAsOwner: async () => SAMPLE_REPORT,
      planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
      reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
    };

    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: fakeKnowledgeDb,
    }) as unknown as AdvertisedServer;

    expect(server._registeredTools.listScopes).toBeDefined();
    // Registered together with the rest of the database surface, and absent entirely when no
    // database is configured — an agent must not see a tool that cannot work.
    expect(server._registeredTools.planRoutedBundle).toBeDefined();

    // T3's writes. These existed as library functions reachable only from contract tests, which
    // made the assertion pass the build order asks for impossible to actually perform — a
    // capability with no surface is not shipped, whatever its tests say.
    expect(server._registeredTools.createAssertion).toBeDefined();
    expect(server._registeredTools.setAssertionStatus).toBeDefined();
    expect(server._registeredTools.createAssertionRelation).toBeDefined();
    expect(server._registeredTools.setRecordScopes).toBeDefined();
    // The other three of the design's seven. A claim could be authored and its standing changed
    // but not edited, tombstoned or given a second citation, so the authoring pass could not be
    // performed end to end. Listed here because a registration nothing asserts is a registration
    // that can be deleted without a single test noticing.
    expect(server._registeredTools.updateAssertion).toBeDefined();
    expect(server._registeredTools.retireAssertion).toBeDefined();
    expect(server._registeredTools.addCitation).toBeDefined();

    // Registered is not wired. Each stub returns a shape only its own command produces, so a
    // tool pointed at the wrong facade method is caught here rather than in production: swapping
    // updateAssertion's handler for retireAssertionAsOwner otherwise passes every test in the
    // repo, while the tool tombstones every claim it is called on.
    const called = async (name: string, input: Record<string, unknown>) => {
      const tool = server._registeredTools[name]!;
      return (await tool.handler(tool.inputSchema!.parse(input))) as {
        structuredContent: Record<string, unknown>;
      };
    };

    const edited = await called("updateAssertion", {
      assertionGuid: "11111111-1111-4111-8111-111111111111",
      title: "A new title",
      reason: "because",
    });
    expect(edited.structuredContent.changed).toEqual(["title"]);

    const retired = await called("retireAssertion", {
      assertionGuid: "11111111-1111-4111-8111-111111111111",
      reason: "because",
    });
    expect(retired.structuredContent.associationsRetired).toBe(1);

    const cited = await called("addCitation", {
      assertionGuid: "11111111-1111-4111-8111-111111111111",
      citation: {
        blockGuid: "66666666-6666-4666-8666-666666666666",
        exactQuote: "a quote",
      },
      reason: "because",
    });
    expect(cited.structuredContent.citationGuid).toBe("55555555-5555-4555-8555-555555555555");

    // Superseding is a relationship, not a standing. The command refuses it, but the tool must
    // not offer it either: an advertised option that can only ever fail sends an agent down a
    // path with no successful ending.
    expect(() =>
      server._registeredTools.setAssertionStatus!.inputSchema!.parse({
        assertionGuid: "00000000-0000-4000-8000-000000000000",
        status: "superseded",
        reason: "r",
      }),
    ).toThrow();
    expect(() =>
      server._registeredTools.setAssertionStatus!.inputSchema!.parse({
        assertionGuid: "00000000-0000-4000-8000-000000000000",
        status: "retracted",
        reason: "r",
      }),
    ).not.toThrow();

    // A section is addressed by its stable key, so the schema must accept one without a guid:
    // section guids are revision-scoped and are resolved internally.
    expect(() =>
      server._registeredTools.setRecordScopes!.inputSchema!.parse({
        recordType: "section",
        stableKey: "doc#heading",
        scopeSlugs: ["security"],
        reason: "r",
      }),
    ).not.toThrow();

    // Each record kind has exactly one identity. The command refuses the wrong one, but the
    // schema saying so first means the caller learns before spending a round trip.
    expect(() =>
      server._registeredTools.setRecordScopes!.inputSchema!.parse({
        recordType: "section",
        scopeSlugs: ["security"],
        reason: "no stableKey",
      }),
    ).toThrow();
    expect(() =>
      server._registeredTools.setRecordScopes!.inputSchema!.parse({
        recordType: "assertion",
        stableKey: "doc#heading",
        scopeSlugs: ["security"],
        reason: "wrong identifier for the kind",
      }),
    ).toThrow();

    // Exactly one identity per kind, not merely at least one: a stray stableKey alongside a
    // valid recordGuid changes the derived idempotency key, so the same intent sent with and
    // without it would be accepted as two separate commands.
    expect(() =>
      server._registeredTools.setRecordScopes!.inputSchema!.parse({
        recordType: "assertion",
        recordGuid: "11111111-1111-4111-8111-111111111111",
        stableKey: "doc#heading",
        scopeSlugs: ["security"],
        reason: "both identifiers",
      }),
    ).toThrow();
    expect(() =>
      server._registeredTools.setRecordScopes!.inputSchema!.parse({
        recordType: "section",
        stableKey: "doc#heading",
        recordGuid: "11111111-1111-4111-8111-111111111111",
        scopeSlugs: ["security"],
        reason: "both identifiers",
      }),
    ).toThrow();
    // The MCP import path must be able to claim coverage too, or deletions linger for the
    // primary agent-facing importer while the CLI handles them.
    expect(
      server._registeredTools.importDocuments!.inputSchema!.parse({
        repository: "r",
        commitSha: "a".repeat(40),
        files: [{ path: "x.md", content: "# x" }],
        retireAbsentUnder: [""],
      }),
    ).toMatchObject({ retireAbsentUnder: [""] });
    expect(server._registeredTools.reportRecordUse).toBeDefined();

    const result = (await callTool(server as unknown as ToolRegistry, "listScopes", {})) as {
      structuredContent: { scopes: ScopeSummary[] };
    };
    expect(result.structuredContent.scopes).toEqual(SAMPLE_SCOPES);
  });
});

describe("importDocuments tool registration", () => {
  it("is not registered when no database backend is configured", () => {
    const server = createAnchorMcpServer({} as AnchorService) as unknown as AdvertisedServer;
    expect(server._registeredTools.importDocuments).toBeUndefined();
  });

  it("is registered and returns the import report when a backend is configured", async () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async (input: { files: unknown[] }) => {
          expect(input.files).toHaveLength(1);
          return SAMPLE_REPORT;
        },
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    expect(server._registeredTools.importDocuments).toBeDefined();

    const result = (await callTool(server as unknown as ToolRegistry, "importDocuments", {
      repository: "context-anchor",
      commitSha: "a".repeat(40),
      files: [{ path: "docs/a.md", content: "# A\n" }],
    })) as { structuredContent: { report: { documentsImported: number } } };
    expect(result.structuredContent.report.documentsImported).toBe(1);
  });

  it("passes projectMappings and people through, so those import paths are reachable", async () => {
    let received: Record<string, unknown> | undefined;
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async (input: Record<string, unknown>) => {
          received = input;
          return SAMPLE_REPORT;
        },
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    await callTool(server as unknown as ToolRegistry, "importDocuments", {
      repository: "context-anchor",
      commitSha: "a".repeat(40),
      files: [{ path: "docs/a.md", content: "# A\n" }],
      projectMappings: [{ repository: "context-anchor", pathPrefix: "src/http", project: "p", name: "http" }],
      people: [{ id: "mason", displayName: "Mason", identities: [{ kind: "email", value: "m@example.com" }] }],
    });

    // Without this, both import paths exist and are tested but can never run in production.
    expect(received?.projectMappings).toHaveLength(1);
    expect(received?.people).toHaveLength(1);
  });

  it("accepts a schema-valid payload carrying mappings and people", () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    const schema = server._registeredTools.importDocuments!.inputSchema!;
    expect(
      schema.parse({
        repository: "r",
        commitSha: "a".repeat(40),
        files: [{ path: "a.md", content: "" }],
        projectMappings: [{ repository: "r", pathPrefix: "src", project: "p", name: "n" }],
        people: [{ id: "i", displayName: "d", identities: [{ kind: "email", value: "e@x.com" }] }],
      }),
    ).toMatchObject({ repository: "r" });
  });

  it("requires a full 40-hex commit sha, since the import is defined as being of a pinned commit", () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    const schema = server._registeredTools.importDocuments!.inputSchema!;
    const files = [{ path: "docs/a.md", content: "# A\n" }];

    expect(schema.parse({ repository: "r", commitSha: "a".repeat(40), files })).toMatchObject({
      commitSha: "a".repeat(40),
    });
    for (const bad of ["HEAD", "main", "abc123", "a".repeat(39), "a".repeat(41), "z".repeat(40)]) {
      expect(() => schema.parse({ repository: "r", commitSha: bad, files }), bad).toThrow();
    }
  });

  it("requires at least one file", () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        ...WRITE_STUBS,
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
        planRoutedBundleAsOwner: async () => SAMPLE_PLAN,
        reportRecordUseAsOwner: async () => ({ recorded: 0, rejected: [] }),
      },
    }) as unknown as AdvertisedServer;

    const schema = server._registeredTools.importDocuments!.inputSchema!;
    // A valid sha, so the rejection can only come from the empty file list. With a short
    // sha this passed for the wrong reason once commitSha gained its 40-hex check.
    const commitSha = "a".repeat(40);
    expect(() => schema.parse({ repository: "r", commitSha, files: [] })).toThrow();
    expect(schema.parse({ repository: "r", commitSha, files: [{ path: "a.md", content: "" }] })).toMatchObject({
      repository: "r",
    });
  });
});
