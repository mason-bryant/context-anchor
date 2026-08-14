import { describe, expect, it } from "vitest";
import { z } from "zod";

import { callTool, type ToolRegistry } from "./mcpToolHarness.js";

/**
 * The harness's own guarantee, asserted directly.
 *
 * Every other test that uses it asserts something about a tool. None of them would notice if the
 * harness stopped parsing — it can be changed to validate and then hand the handler the raw
 * literal, and the whole suite stays green. That is the defect the harness exists to prevent,
 * reproduced inside the harness, which is why it needs a test of its own rather than relying on
 * its callers to reveal it.
 */
describe("callTool", () => {
  const registryWith = (schema: { parse: (input: unknown) => unknown } | undefined) => {
    let received: unknown;
    const server = {
      _registeredTools: {
        sample: {
          inputSchema: schema,
          handler: async (input: unknown) => {
            received = input;
            return { ok: true };
          },
        },
      },
    } as unknown as ToolRegistry;
    return { server, seen: () => received as Record<string, unknown> | undefined };
  };

  it("hands the handler the parsed value, so an undeclared field cannot reach it", async () => {
    const { server, seen } = registryWith(z.object({ declared: z.string() }));

    await callTool(server, "sample", { declared: "yes", undeclared: "no" });

    expect(seen()).toEqual({ declared: "yes" });
    // Stated separately: a handler that happens to ignore the extra field would satisfy the line
    // above by luck. This asserts the key is absent, which only parsing achieves.
    expect(Object.hasOwn(seen()!, "undeclared")).toBe(false);
  });

  it("applies schema transforms, so tests see what a client's request becomes", async () => {
    const { server, seen } = registryWith(z.object({ scope: z.string().trim() }));

    await callTool(server, "sample", { scope: "  padded  " });

    expect(seen()).toEqual({ scope: "padded" });
  });

  it("refuses a tool that advertises no input schema", async () => {
    const { server } = registryWith(undefined);

    await expect(callTool(server, "sample", { anything: 1 })).rejects.toThrow(/no input schema/);
  });

  it("refuses a tool that is not registered", async () => {
    const { server } = registryWith(z.object({}));

    await expect(callTool(server, "absent", {})).rejects.toThrow(/not registered/);
  });
});
