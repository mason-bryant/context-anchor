#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server";

import { parseCliArgs } from "../cli/args.js";
import { startHttpServer } from "../http/server.js";
import { createAppLogger, errorMetadata, type AppLogger } from "../logger.js";
import { createAnchorRuntime } from "../runtime.js";

let activeLogger: AppLogger | undefined;

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const logger = createAppLogger(options.config.logging);
  activeLogger = logger;

  if (options.transport === "http") {
    const server = await startHttpServer(
      options.config,
      {
        host: options.host,
        port: options.port,
        allowedHosts: options.allowedHosts,
        authToken: options.authToken,
        stateless: options.stateless,
      },
      { logger },
    );
    console.error(`anchor-mcp listening on http://${options.host}:${options.port}/mcp`);
    process.once("SIGINT", () => server.close());
    process.once("SIGTERM", () => server.close());
    return;
  }

  const runtime = await createAnchorRuntime(options.config, { logger });
  runtime.startAutoSync();
  const transport = new StdioServerTransport();
  await runtime.mcpServer.connect(transport);
  logger.info("stdio transport connected");

  const shutdown = async () => {
    logger.info("anchor-mcp shutting down");
    runtime.stopAutoSync();
    await runtime.mcpServer.close();
    await runtime.requestLogger.close();
    await runtime.traceLogger.close();
    await logger.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch(async (error: unknown) => {
  activeLogger?.error("anchor-mcp fatal error", { error: errorMetadata(error) });
  await activeLogger?.close();
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
