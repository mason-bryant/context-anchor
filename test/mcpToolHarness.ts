/**
 * The one way tests may invoke an MCP tool.
 *
 * A test that calls a handler with an object literal asserts nothing about the tool's surface.
 * Handlers destructure whatever they are given, so the test passes unchanged when the field is
 * deleted from the Zod schema — and Zod strips undeclared keys, so the schema is what decides
 * whether a client can send a field at all. That gap hid a routing flag being unreachable on two
 * consecutive PRs, each time with a test that appeared to prove it reachable.
 *
 * It lives in one file because the repository has twice found that a fix's own coverage was
 * narrower than the thing it covered. Two helpers previously existed with opposite failure
 * modes: one threw when a tool advertised no schema, the other silently fell back to the
 * unparsed input, which is the hole itself wearing a helper's clothes.
 */

export type RegisteredTool = {
  description?: string;
  handler: (input: unknown, extra?: unknown) => Promise<unknown>;
  inputSchema?: { parse: (input: unknown) => unknown };
};

export type ToolRegistry = { _registeredTools: Record<string, RegisteredTool> };

export function toolFor(server: ToolRegistry, name: string): RegisteredTool {
  const tool = server._registeredTools[name];
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }
  return tool;
}

/**
 * Parses through the registered schema, then invokes the handler with the parsed value.
 *
 * Deliberately no fallback when a schema is absent. A tool with no input schema is one a client
 * cannot send arguments to, so a test that quietly proceeds is asserting behaviour the surface
 * does not have — the same class of untruth this harness exists to prevent.
 */
export async function callTool(
  server: ToolRegistry,
  name: string,
  input: Record<string, unknown> = {},
  extra?: unknown,
): Promise<unknown> {
  const tool = toolFor(server, name);
  if (!tool.inputSchema) {
    throw new Error(
      `Tool ${name} advertises no input schema. A client cannot send it arguments, so a test ` +
        `that passes some is exercising a surface that does not exist.`,
    );
  }
  return tool.handler(tool.inputSchema.parse(input), extra);
}
