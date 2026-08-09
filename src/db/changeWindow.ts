const RELATIVE_WINDOW = /^(\d+)([mhdw])$/;

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

/**
 * Resolve a `since` argument to the lower bound of a history query.
 *
 * Accepts a relative window (`90m`, `24h`, `7d`, `2w`) or an absolute ISO date/timestamp.
 * Returns undefined only when nothing was supplied, which means "no lower bound".
 *
 * A malformed value throws rather than degrading to undefined: silently widening a typo'd
 * `since` to all of history returns a plausible-looking wrong answer, which is worse than
 * an error naming what was accepted.
 */
export function parseChangeWindow(since: string | undefined, now: Date = new Date()): Date | undefined {
  if (since === undefined) {
    return undefined;
  }

  const trimmed = since.trim();
  if (!trimmed) {
    throw invalidSince(since);
  }

  const relative = RELATIVE_WINDOW.exec(trimmed);
  if (relative) {
    const amount = Number(relative[1]);
    if (amount <= 0) {
      throw invalidSince(since);
    }
    return new Date(now.getTime() - amount * UNIT_MS[relative[2]!]!);
  }

  // A bare date is unambiguous once we pin it to UTC ourselves.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    throw invalidSince(since);
  }

  // A timestamp must name its timezone. Without one, Node reads it as server-local, so the
  // same string would mean different instants on two machines and silently shift the bound.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(trimmed)) {
    throw new Error(
      `Invalid since value ${JSON.stringify(since)}: timestamps must carry an explicit timezone ` +
        `(for example "${trimmed}Z" or "${trimmed}+02:00"), otherwise the bound depends on server local time.`,
    );
  }

  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  throw invalidSince(since);
}

function invalidSince(since: string): Error {
  return new Error(
    `Invalid since value ${JSON.stringify(since)}: expected a relative window like "7d", "24h", "90m", or "2w", ` +
      `or an ISO date/timestamp like "2026-07-01" or "2026-07-01T00:00:00.000Z".`,
  );
}
