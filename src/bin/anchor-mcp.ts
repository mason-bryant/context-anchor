#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server";

import { parseCliArgs } from "../cli/args.js";
import { startHttpServer } from "../http/server.js";
import { createAnchorRuntime } from "../runtime.js";

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.transport === "http") {
    const server = await startHttpServer(options.config, {
      host: options.host,
      port: options.port,
      allowedHosts: options.allowedHosts,
      authToken: options.authToken,
      stateless: options.stateless,
    });
    console.error(`anchor-mcp listening on http://${options.host}:${options.port}/mcp`);
    process.once("SIGINT", () => server.close());
    process.once("SIGTERM", () => server.close());
    return;
  }

  const runtime = await createAnchorRuntime(options.config);
  runtime.startAutoSync();
  const transport = new StdioServerTransport();
  await runtime.mcpServer.connect(transport);

  const shutdown = async () => {
    runtime.stopAutoSync();
    await runtime.mcpServer.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
