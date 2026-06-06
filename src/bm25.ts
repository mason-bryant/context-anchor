const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "need",
  "of",
  "on",
  "or",
  "our",
  "please",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
]);

function tokenizeTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1)
    .filter((term) => !STOPWORDS.has(term));
}

/** Deduplicated tokens for query search. */
export function bm25Tokenize(text: string): string[] {
  return [...new Set(tokenizeTerms(text))];
}

export type BM25Document = {
  id: string;
  text: string;
};

export type BM25Hit = {
  id: string;
  score: number;
};

type DocEntry = {
  termFreqs: Map<string, number>;
  length: number;
};

export class BM25Index {
  private k1: number;
  private b: number;
  private docs: Map<string, DocEntry> = new Map();
  private df: Map<string, number> = new Map();
  private totalLengthSum = 0;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  add(doc: BM25Document): void {
    if (this.docs.has(doc.id)) {
      this.remove(doc.id);
    }
    const tokens = tokenizeTerms(doc.text);
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }
    // Use unique terms for df update
    for (const term of termFreqs.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    const entry: DocEntry = { termFreqs, length: tokens.length };
    this.docs.set(doc.id, entry);
    this.totalLengthSum += tokens.length;
  }

  remove(id: string): void {
    const entry = this.docs.get(id);
    if (!entry) return;
    for (const term of entry.termFreqs.keys()) {
      const prev = this.df.get(term) ?? 0;
      if (prev <= 1) {
        this.df.delete(term);
      } else {
        this.df.set(term, prev - 1);
      }
    }
    this.totalLengthSum -= entry.length;
    this.docs.delete(id);
  }

  update(doc: BM25Document): void {
    this.remove(doc.id);
    this.add(doc);
  }

  search(query: string, topK = 20): BM25Hit[] {
    const N = this.docs.size;
    if (N === 0) return [];
    const avgdl = this.totalLengthSum / N;
    const queryTerms = bm25Tokenize(query);
    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const dfVal = this.df.get(term) ?? 0;
      if (dfVal === 0) continue;
      const idf = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1);
      for (const [docId, entry] of this.docs) {
        const tf = entry.termFreqs.get(term) ?? 0;
        if (tf === 0) continue;
        const denom = tf + this.k1 * (1 - this.b + this.b * (entry.length / avgdl));
        const contribution = idf * (tf * (this.k1 + 1)) / denom;
        scores.set(docId, (scores.get(docId) ?? 0) + contribution);
      }
    }

    return [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, topK)
      .map(([id, score]) => ({ id, score }));
  }

  size(): number {
    return this.docs.size;
  }

  clear(): void {
    this.docs.clear();
    this.df.clear();
    this.totalLengthSum = 0;
  }
}
