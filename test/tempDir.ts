import { rm } from "node:fs/promises";

/**
 * Remove a temporary directory used by a test, tolerating the races that make a plain
 * recursive `rm` flaky against a live git repository.
 *
 * Most tests here `git init` a temp dir and delete it in `afterEach`. Git can still be
 * writing inside `.git/objects/pack` at that moment — an auto-gc or a pack being finished
 * — and Node's recursive removal reads a directory, unlinks what it saw, then `rmdir`s it.
 * A file appearing in that window makes the `rmdir` fail with `ENOTEMPTY`, which is exactly
 * how this surfaced in CI:
 *
 *   Error: ENOTEMPTY: directory not empty, rmdir '/tmp/anchor-mcp-4xoURm/.git/objects/pack'
 *
 * `maxRetries`/`retryDelay` are Node's supported answer: with `recursive: true`, an
 * `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, or `EPERM` is retried with linear backoff.
 * The window is short, so a handful of retries covers it while a genuinely undeletable
 * directory still fails rather than hanging.
 *
 * Prefer this over calling `rm` directly in test teardown.
 */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
