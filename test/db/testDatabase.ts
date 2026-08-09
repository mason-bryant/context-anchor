import { Socket } from "node:net";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://anchor:anchor@127.0.0.1:55432/anchor_mcp";

let reachable: boolean | undefined;

/**
 * Contract tests need a real Postgres. Locally that's `npm run db:up`; in CI it's a
 * service container bound to the same default port so no extra env wiring is needed.
 * Neither is available in every environment this suite runs in, so probe once and skip
 * the whole describe block (with a clear reason) rather than failing `npm test` outright.
 */
export async function isTestDatabaseReachable(): Promise<boolean> {
  if (reachable !== undefined) {
    return reachable;
  }

  const url = new URL(TEST_DATABASE_URL);
  const host = url.hostname;
  const port = Number(url.port || 5432);

  reachable = await new Promise<boolean>((resolve) => {
    const socket = new Socket();
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });

  if (!reachable) {
    console.warn(
      `[db contract tests] Postgres not reachable at ${TEST_DATABASE_URL}; skipping. ` +
        `Run \`npm run db:up\` to enable these tests locally.`,
    );
  }

  return reachable;
}
