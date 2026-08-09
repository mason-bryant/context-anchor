import { describe, expect, it } from "vitest";

import type { AnchorService } from "../../src/anchorService.js";
import { createAnchorMcpServer } from "../../src/server.js";
import type { ScopeSummary } from "../../src/db/knowledgeDb.js";

type AdvertisedServer = {
  _registeredTools: Record<string, { description?: string; handler: (input: unknown) => Promise<unknown> }>;
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

describe("listScopes tool registration", () => {
  it("is not registered when no database backend is configured", () => {
    const server = createAnchorMcpServer({} as AnchorService) as unknown as AdvertisedServer;
    expect(server._registeredTools.listScopes).toBeUndefined();
  });

  it("is registered and returns scopes when a database backend is configured", async () => {
    const fakeKnowledgeDb = {
      listScopesForOwner: async () => SAMPLE_SCOPES,
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
