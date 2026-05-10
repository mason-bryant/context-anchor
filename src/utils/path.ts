import path from "node:path";
import { fileURLToPath } from "node:url";

export function expandHome(input: string): string {
  if (input === "~") {
    return process.env.HOME ?? input;
  }

  if (input.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", input.slice(2));
  }

  return input;
}

export function toPosix(input: string): string {
  return input.split(path.sep).join(path.posix.sep);
}

export function normalizeRelative(input: string): string {
  const normalized = path.posix.normalize(input.replaceAll("\\", "/"));
  return normalized === "." ? "" : normalized.replace(/^\/+/, "");
}

export function assertInside(parent: string, candidate: string): void {
  const relative = path.relative(parent, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes anchor repository: ${candidate}`);
  }
}

export function modulePath(importMetaUrl: string): string {
  return fileURLToPath(importMetaUrl);
}

