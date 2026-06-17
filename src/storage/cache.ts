import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";

import { parseAnchor, type ParsedAnchor } from "./markdown.js";

type CacheEntry = {
  mtimeMs: number;
  size: number;
  parsed: ParsedAnchor;
};

export class AnchorParseCache {
  private readonly cache = new Map<string, CacheEntry>();

  async parse(filePath: string, content: string, knownStats?: Pick<Stats, "mtimeMs" | "size">): Promise<ParsedAnchor> {
    const stats = knownStats ?? (await stat(filePath));
    const existing = this.cache.get(filePath);
    if (existing && existing.mtimeMs === stats.mtimeMs && existing.size === stats.size) {
      return existing.parsed;
    }

    const parsed = parseAnchor(content);
    this.cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, parsed });
    return parsed;
  }

  invalidate(filePath?: string): void {
    if (filePath) {
      this.cache.delete(filePath);
      return;
    }

    this.cache.clear();
  }
}
