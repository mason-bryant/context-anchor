import { describe, expect, it } from "vitest";

import type { AnchorService } from "../src/anchorService.js";
import { ANCHOR_SECTION_DEFINITIONS } from "../src/anchorStructure.js";
import { createAnchorMcpServer } from "../src/server.js";

type AdvertisedServer = {
  server: { _instructions?: string };
  _registeredTools: Record<string, { description?: string }>;
};

describe("MCP-advertised anchor structure guidance", () => {
  it("exposes the canonical Invariants and Constraints definitions to remote MCP agents", () => {
    const server = createAnchorMcpServer({} as AnchorService) as unknown as AdvertisedServer;
    const definitions = Object.entries(ANCHOR_SECTION_DEFINITIONS);

    for (const [section, purpose] of definitions) {
      expect(server.server._instructions).toContain(`${section}: ${purpose}`);
    }

    for (const toolName of ["readAnchor", "readAnchorBatch", "startTask", "loadContext", "writeAnchor"]) {
      const description = server._registeredTools[toolName]?.description;
      for (const [section, purpose] of definitions) {
        expect(description, `${toolName} should advertise the ${section} definition`).toContain(`${section}: ${purpose}`);
      }
    }

    expect(server._registeredTools.readAnchorSection?.description).toContain("one H2 section");
    expect(server._registeredTools.startTask?.description).toContain("Introduction-through-Invariants");
    expect(server._registeredTools.loadContext?.description).toContain("availableSections");
  });
});
