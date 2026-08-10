#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/server";

import { HELP_TEXT, parseCliArgs, type CliOptions } from "../cli/args.js";
import { runDbCommand } from "../cli/dbCommands.js";
import { CliUsageError, isCliUsageError } from "../cli/errors.js";
import { runtimePaths, startServer, stopServer, waitForPortFree } from "../cli/lifecycle.js";
import { statusReport } from "../cli/status.js";
import { COMPOSE_MANAGED_DATABASE_URL } from "../db/cliArgs.js";
import { DEFAULT_DATABASE_SCHEMA_NAME } from "../db/config.js";
import { startHttpServer } from "../http/server.js";
import { createAppLogger, errorMetadata, type AppLogger } from "../logger.js";
import { createAnchorRuntime } from "../runtime.js";

let activeLogger: AppLogger | undefined;

const THIS_SCRIPT = fileURLToPath(import.meta.url);

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  // Before creating a logger or touching the anchor repository: printing usage should have
  // no side effects and no prerequisites.
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  switch (options.command) {
    case "db":
      await db(options);
      return;
    case "status":
      console.log((await statusReport(options)).join("\n"));
      return;
    case "stop":
      await stop(options);
      return;
    case "start":
      await start(options);
      return;
    case "restart":
      await restart(options);
      return;
    case "serve":
      await serve(options);
      return;
  }
}

async function db(options: CliOptions): Promise<void> {
  if (!options.db) {
    throw new Error("Missing db command.");
  }
  await runDbCommand(options.db, {
    // The compose container is the default target so `db migrate` works out of the box in
    // this repo; anywhere else DATABASE_URL is required and supplies the real target.
    databaseUrl: options.databaseUrl ?? COMPOSE_MANAGED_DATABASE_URL,
    schemaName: options.config.database?.schemaName ?? DEFAULT_DATABASE_SCHEMA_NAME,
    repoPath: options.config.repoPath,
  });
}

/**
 * `start` detaches, which only makes sense for HTTP — a detached stdio server has no client
 * on the other end of its pipes. So http is the default here rather than something the user
 * must configure: putting `transport: "http"` in the config file to satisfy `start` would
 * also flip every bare `anchor-mcp` launch, which is exactly what stdio MCP clients run.
 * An explicit stdio choice is still an error rather than something we silently override.
 */
function resolveDetachedTransport(options: CliOptions, command: string): void {
  if (options.transportExplicit && options.transport !== "http") {
    throw new CliUsageError(
      `"${command}" runs the server detached, which only works with the http transport ` +
        `(got "${options.transport}"). Use \`anchor-mcp serve\` for stdio.`,
    );
  }
}

async function start(options: CliOptions): Promise<void> {
  resolveDetachedTransport(options, "start");
  const passThrough = process.argv.slice(3);
  const result = await startServer({
    host: options.host,
    port: options.port,
    serverScript: THIS_SCRIPT,
    // The child runs `serve`, which defaults to stdio, so the http choice has to be made
    // explicit on its command line rather than inherited.
    argv: options.transportExplicit ? passThrough : ["--transport", "http", ...passThrough],
  });
  console.log(result.message);
  if (!result.started) {
    process.exitCode = 1;
  }
}

async function stop(options: CliOptions): Promise<void> {
  const result = await stopServer({ host: options.host, port: options.port });
  console.log(result.message);
  // "nothing was running" is the state the caller asked for, not a failure; a pidfile
  // pointing at someone else's process is.
  if (result.reason === "foreign-process") {
    process.exitCode = 1;
  }
}

async function restart(options: CliOptions): Promise<void> {
  resolveDetachedTransport(options, "restart");
  const stopped = await stopServer({ host: options.host, port: options.port });
  console.log(stopped.message);
  if (stopped.reason === "foreign-process") {
    process.exitCode = 1;
    return;
  }

  // Rebinding before the old socket is released fails with EADDRINUSE.
  if (!(await waitForPortFree(options.host, options.port))) {
    console.error(`Port ${options.host}:${String(options.port)} is still in use; not restarting.`);
    process.exitCode = 1;
    return;
  }

  await start(options);
}

async function serve(options: CliOptions): Promise<void> {
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
      { logger, databaseUrl: options.databaseUrl },
    );
    console.error(`anchor-mcp listening on http://${options.host}:${options.port}/mcp`);
    const shutdownHttp = () => {
      // Clear our own pidfile when we were started detached, so a later `stop` does not
      // report a stale file for a process that exited cleanly on its own.
      void import("node:fs/promises").then(({ rm }) =>
        rm(runtimePaths(options.host, options.port).pidFile, { force: true }).catch(() => {}),
      );
      server.close();
    };
    process.once("SIGINT", shutdownHttp);
    process.once("SIGTERM", shutdownHttp);
    return;
  }

  const runtime = await createAnchorRuntime(options.config, { logger, databaseUrl: options.databaseUrl });
  runtime.startAutoSync();
  const transport = new StdioServerTransport();
  await runtime.mcpServer.connect(transport);
  logger.info("stdio transport connected");

  const shutdown = async () => {
    logger.info("anchor-mcp shutting down");
    runtime.stopAutoSync();
    await runtime.mcpServer.close();
    await runtime.knowledgeDb?.close();
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
  if (isCliUsageError(error)) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
});
