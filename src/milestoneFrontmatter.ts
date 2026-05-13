/** `milestone_id` values that match the typed milestone schema (align with Zod overlay). */
export function normalizedMilestoneId(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  if (raw === "backlog") {
    return "backlog";
  }
  if (/^M\d+$/.test(raw)) {
    return raw;
  }
  return undefined;
}

/** Positive integer `sequence` from milestone front matter, if present and valid. */
export function normalizedSequenceFromFm(fm: Record<string, unknown>): number | undefined {
  const seqRaw = fm.sequence;
  if (typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw > 0) {
    return seqRaw;
  }
  if (typeof seqRaw === "string" && /^\d+$/.test(seqRaw)) {
    const n = parseInt(seqRaw, 10);
    if (Number.isInteger(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}
