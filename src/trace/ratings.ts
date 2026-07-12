import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const TRACE_RATINGS_FILENAME = "anchor-mcp-trace-ratings.json";

export type TraceRatingValue = "well" | "poorly";

export type TraceRating = {
  rating: TraceRatingValue;
  note?: string;
  updatedAt: string;
};

type RatingsFile = Record<string, TraceRating>;

/**
 * One-click manual session ratings, stored separately from the immutable trace
 * event files and exempt from their rotation. The store is a single small JSON
 * file keyed by session id; writes are atomic (temp file + rename) so a crash
 * mid-write cannot corrupt the file.
 */
export class TraceRatingsStore {
  private cache: RatingsFile | undefined;
  private loadPromise: Promise<RatingsFile> | undefined;
  /** Serializes writes so overlapping set() calls cannot clobber each other. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dirname: string | undefined) {}

  get enabled(): boolean {
    return this.dirname !== undefined;
  }

  async getAll(): Promise<RatingsFile> {
    return this.ensureLoaded();
  }

  async get(sessionId: string): Promise<TraceRating | undefined> {
    const ratings = await this.ensureLoaded();
    return ratings[sessionId];
  }

  /** Set a rating for a session, or clear it entirely when `rating` is null. */
  set(sessionId: string, rating: TraceRatingValue | null, note?: string): Promise<void> {
    if (!this.dirname) {
      return Promise.reject(new Error("Trace ratings are unavailable because trace logging is disabled."));
    }
    const write = this.writeQueue.then(async () => {
      const ratings = { ...(await this.ensureLoaded()) };
      if (rating === null) {
        delete ratings[sessionId];
      } else {
        ratings[sessionId] = {
          rating,
          ...(note ? { note } : {}),
          updatedAt: new Date().toISOString(),
        };
      }
      await this.persist(ratings);
      this.cache = ratings;
    });
    // Keep the queue alive after a failed write; the failure still reaches
    // this call's returned promise.
    this.writeQueue = write.catch(() => {});
    return write;
  }

  private ensureLoaded(): Promise<RatingsFile> {
    if (this.cache) {
      return Promise.resolve(this.cache);
    }
    this.loadPromise ??= this.load();
    return this.loadPromise;
  }

  private async load(): Promise<RatingsFile> {
    if (!this.dirname) {
      this.cache = {};
      return this.cache;
    }
    try {
      const raw = await readFile(this.filePath(), "utf8");
      const parsed: unknown = JSON.parse(raw);
      this.cache = isRatingsFile(parsed) ? parsed : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async persist(ratings: RatingsFile): Promise<void> {
    const dirname = this.dirname;
    if (!dirname) {
      return;
    }
    await mkdir(dirname, { recursive: true });
    const filePath = this.filePath();
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(ratings, null, 2), "utf8");
    await rename(tmpPath, filePath);
  }

  private filePath(): string {
    return path.join(this.dirname ?? "", TRACE_RATINGS_FILENAME);
  }
}

function isRatingsFile(value: unknown): value is RatingsFile {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
