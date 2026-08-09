import { describe, expect, it } from "vitest";

import type { AnchorService } from "../../src/anchorService.js";
import { createAnchorMcpServer } from "../../src/server.js";
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
  peopleImported: 0,
  unchanged: [],
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
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async (input: { scope: string }) => {
          expect(input.scope).toBe("http-transport");
          return [entry];
        },
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
      },
    }) as unknown as AdvertisedServer;

    expect(server._registeredTools.listScopeChanges).toBeDefined();

    const result = (await server._registeredTools.listScopeChanges!.handler({
      scope: "http-transport",
      since: "7d",
    })) as { structuredContent: { changes: unknown[] } };
    expect(result.structuredContent.changes).toHaveLength(1);
  });

  it("trims scope and since at the schema, so a padded value resolves instead of failing downstream", () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
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
  });

  it("is registered and returns scopes when a database backend is configured", async () => {
    const fakeKnowledgeDb = {
      listScopesForOwner: async () => SAMPLE_SCOPES,
      listScopeChangesForOwner: async () => [],
      importDocumentsAsOwner: async () => SAMPLE_REPORT,
    };

    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: fakeKnowledgeDb,
    }) as unknown as AdvertisedServer;

    expect(server._registeredTools.listScopes).toBeDefined();

    const result = (await server._registeredTools.listScopes!.handler({ traceId: undefined })) as {
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
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async (input: { files: unknown[] }) => {
          expect(input.files).toHaveLength(1);
          return SAMPLE_REPORT;
        },
      },
    }) as unknown as AdvertisedServer;

    expect(server._registeredTools.importDocuments).toBeDefined();

    const result = (await server._registeredTools.importDocuments!.handler({
      repository: "context-anchor",
      commitSha: "a".repeat(40),
      files: [{ path: "docs/a.md", content: "# A\n" }],
    })) as { structuredContent: { report: { documentsImported: number } } };
    expect(result.structuredContent.report.documentsImported).toBe(1);
  });

  it("requires a full 40-hex commit sha, since the import is defined as being of a pinned commit", () => {
    const server = createAnchorMcpServer({} as AnchorService, {
      knowledgeDb: {
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
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
        listScopesForOwner: async () => SAMPLE_SCOPES,
        listScopeChangesForOwner: async () => [],
        importDocumentsAsOwner: async () => SAMPLE_REPORT,
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
