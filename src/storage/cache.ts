import { stat } from "node:fs/promises";

import { parseAnchor, type ParsedAnchor } from "./markdown.js";

type CacheEntry = {
  mtimeMs: number;
  parsed: ParsedAnchor;
};

export class AnchorParseCache {
  private readonly cache = new Map<string, CacheEntry>();

  async parse(filePath: string, content: string): Promise<ParsedAnchor> {
    const stats = await stat(filePath);
    const existing = this.cache.get(filePath);
    if (existing && existing.mtimeMs === stats.mtimeMs) {
      return existing.parsed;
    }

    const parsed = parseAnchor(content);
    this.cache.set(filePath, { mtimeMs: stats.mtimeMs, parsed });
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

