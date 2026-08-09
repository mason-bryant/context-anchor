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
      knowledgeDb: { listScopesForOwner: async () => SAMPLE_SCOPES, listScopeChangesForOwner: async () => [] },
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
