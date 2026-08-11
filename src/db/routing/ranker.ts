/**
 * The ranking boundary (amendment A3).
 *
 * Ranking is separated from candidate generation so it can be changed, compared, and
 * eventually computed by a model without touching retrieval. Four properties make that
 * possible, and each is a constraint rather than a preference:
 *
 * - **Generation is separate.** Deciding *which* scopes matched stays deterministic, cheap,
 *   and exhaustive. A ranker receives a bounded candidate set. Without this split a
 *   model-backed ranker would have to see every scope in the workspace on every query.
 * - **Evidence is data.** A candidate carries its signals, and a caller's `hints`, as plain
 *   values. A ranker that serializes its input into a prompt cannot read fields that a
 *   comparator happened to have in scope.
 * - **Reorder and drop, never invent.** A ranker returns a permutation of a subset of its
 *   input. This is what makes a model-backed ranker safe to adopt: it can misjudge an
 *   order, but it cannot hallucinate a scope into an answer.
 * - **Async, fallible, degrading.** A model call times out and costs money. A ranker that
 *   fails falls back to the deterministic default, and the fallback is recorded.
 */

/** Ordered strongest to weakest; the order here *is* the precedence rule. */
export const SIGNAL_KINDS = ["path-mapping", "lexical", "relation-hop"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Ordered most specific to least; the order here *is* the specificity tier. */
export const SCOPE_SPECIFICITY = ["component", "initiative", "practice", "domain", "workspace"] as const;

export type MatchSignal = {
  kind: SignalKind;
  /** Human-readable reason, surfaced as `matchReasons` and used by T8's reader to disagree with a rank. */
  reason: string;
};

export type RouteCandidate = {
  routeKey: string;
  scopeGuid: string;
  scopeSlug: string;
  scopeKind: string;
  title: string;
  /** Every distinct way this scope matched. Never empty — a candidate with no signal is not a candidate. */
  signals: MatchSignal[];
  /** Caller-supplied, opaque to the default ranker. Carried from the start so the interface does not change when a later ranker uses it. */
  hints?: Record<string, unknown>;
};

export type RankedRoute = RouteCandidate & {
  /** Zero-based, as offered. */
  offeredPosition: number;
};

export type Ranker = {
  id: string;
  version: string;
  /** False for anything whose output is not reproducible from its input — a model, or anything sampling. */
  deterministic: boolean;
  rank(candidates: RouteCandidate[]): Promise<RankedRoute[]>;
};

function strongestSignalIndex(candidate: RouteCandidate): number {
  return Math.min(...candidate.signals.map((signal) => SIGNAL_KINDS.indexOf(signal.kind)));
}

function specificityIndex(candidate: RouteCandidate): number {
  const index = (SCOPE_SPECIFICITY as readonly string[]).indexOf(candidate.scopeKind);
  // An unknown kind sorts last rather than first: a scope whose kind this build does not
  // recognize must not outrank one it does.
  return index === -1 ? SCOPE_SPECIFICITY.length : index;
}

/** Distinct signal *kinds*, not signal count — two lexical hits are one kind of evidence, not two. */
function distinctSignalCount(candidate: RouteCandidate): number {
  return new Set(candidate.signals.map((signal) => signal.kind)).size;
}

/**
 * The ordering the design specifies: number of distinct signals, then the strongest of
 * them, then scope specificity, then `scope_slug` ascending as a stable final tiebreak.
 *
 * No weights, deliberately. A weighted score would put uncalibrated magnitudes inside
 * `plannerVersion`, where changing one silently changes every answer, and precedence stays
 * explainable — `matchReasons` doubles as why a route ranked where it did.
 *
 * Whether signal *count* should outrank signal *strength* is deliberately unsettled: two
 * weak signals currently beat one strong one. That is recorded as an open question for T8
 * to answer with data, and the shadow-ranker mechanism exists so it can be.
 */
export const defaultRanker: Ranker = {
  id: "precedence",
  version: "1.0.0",
  deterministic: true,
  rank(candidates: RouteCandidate[]): Promise<RankedRoute[]> {
    const ordered = [...candidates].sort((left, right) => {
      const byCount = distinctSignalCount(right) - distinctSignalCount(left);
      if (byCount !== 0) {
        return byCount;
      }
      const byStrength = strongestSignalIndex(left) - strongestSignalIndex(right);
      if (byStrength !== 0) {
        return byStrength;
      }
      const bySpecificity = specificityIndex(left) - specificityIndex(right);
      if (bySpecificity !== 0) {
        return bySpecificity;
      }
      return left.scopeSlug.localeCompare(right.scopeSlug);
    });

    return Promise.resolve(ordered.map((candidate, index) => ({ ...candidate, offeredPosition: index })));
  },
};

export class RankerContractError extends Error {
  constructor(message: string) {
    super(`Ranker returned an invalid result: ${message}`);
    this.name = "RankerContractError";
  }
}

/**
 * Enforces "reorder and drop, never invent" on a ranker's output. A ranker is allowed to be
 * wrong about order; it is not allowed to change what is in the answer, which is the
 * property that makes an untrusted or model-backed ranker safe to run at all.
 */
export function assertRankerContract(input: RouteCandidate[], output: RankedRoute[]): void {
  const allowed = new Map(input.map((candidate) => [candidate.routeKey, candidate]));
  const seen = new Set<string>();

  for (const route of output) {
    const source = allowed.get(route.routeKey);
    if (!source) {
      throw new RankerContractError(`route ${JSON.stringify(route.routeKey)} was not among the candidates`);
    }
    if (seen.has(route.routeKey)) {
      throw new RankerContractError(`route ${JSON.stringify(route.routeKey)} appears more than once`);
    }
    // Only order may change. A ranker rewriting a record count or a scope guid would be
    // editing the answer while appearing to rank it.
    if (source.scopeGuid !== route.scopeGuid || source.scopeSlug !== route.scopeSlug) {
      throw new RankerContractError(`route ${JSON.stringify(route.routeKey)} was altered, not just reordered`);
    }
    seen.add(route.routeKey);
  }

  output.forEach((route, index) => {
    if (route.offeredPosition !== index) {
      throw new RankerContractError(
        `offeredPosition ${String(route.offeredPosition)} does not match its index ${String(index)}`,
      );
    }
  });
}

export type RankOutcome = {
  routes: RankedRoute[];
  ranker: Pick<Ranker, "id" | "version" | "deterministic">;
  /** True when the requested ranker failed or broke its contract and the default produced this order. */
  fellBack: boolean;
  fallbackReason?: string;
};

/**
 * Runs a ranker with a time budget, validating its output and degrading to the deterministic
 * default when it fails. A ranking failure must never fail the query: the caller asked for
 * routes, and a worse order is a better answer than an error.
 */
export async function rankWithFallback(
  candidates: RouteCandidate[],
  ranker: Ranker = defaultRanker,
  options: { timeoutMs?: number } = {},
): Promise<RankOutcome> {
  if (ranker === defaultRanker) {
    const routes = await defaultRanker.rank(candidates);
    return { routes, ranker: describe(defaultRanker), fellBack: false };
  }

  // A ranker receives its own copy, and the contract is checked against a baseline it
  // cannot reach. Handing over the live array let a ranker mutate a candidate and then
  // return it: the check compared the mutated objects to themselves and passed, so a
  // ranker could rewrite a route key or a record count while appearing to only reorder.
  const baseline = candidates.map((candidate) => structuredClone(candidate));
  const forRanker = candidates.map((candidate) => structuredClone(candidate));

  try {
    const proposed = await withTimeout(ranker.rank(forRanker), options.timeoutMs ?? 5_000, ranker.id);
    assertRankerContract(baseline, proposed);
    // Rebuilt from the baseline rather than from what came back, so a ranker's influence is
    // limited to order and membership even if it edited the objects it was given.
    const byKey = new Map(baseline.map((candidate) => [candidate.routeKey, candidate]));
    const routes = proposed.flatMap((route, index) => {
      const source = byKey.get(route.routeKey);
      return source ? [{ ...source, offeredPosition: index }] : [];
    });
    return { routes, ranker: describe(ranker), fellBack: false };
  } catch (error) {
    const routes = await defaultRanker.rank(candidates);
    return {
      routes,
      ranker: describe(defaultRanker),
      fellBack: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function describe(ranker: Ranker): Pick<Ranker, "id" | "version" | "deterministic"> {
  return { id: ranker.id, version: ranker.version, deterministic: ranker.deterministic };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, rankerId: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`ranker ${rankerId} exceeded ${String(timeoutMs)}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    // Or a slow ranker keeps the process alive after the response has gone out.
    if (timer) {
      clearTimeout(timer);
    }
  }
}
