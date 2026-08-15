/**
 * Consumers that are this project measuring itself.
 *
 * The comparison gate is a person driving an instrument; a corpus run is twenty-eight questions
 * nobody asked. Counted as retrieval they answer "which routes are dead weight" with routes only
 * ever offered by the thing asking the question, and on a real workspace they outnumber genuine
 * traffic several hundred to a few dozen.
 *
 * Defined once. Two readers exclude this list now — routing diagnostics and the questions view —
 * and a second copy would drift the first time a gate tag is added, silently letting instrument
 * traffic back into one of them.
 *
 * Listed exactly rather than matched by prefix: `consumer` is caller-supplied, so a prefix rule
 * would let any agent naming itself `comparison-gate-anything` erase itself from every
 * diagnostic. The cost is that a new tag must be added here deliberately, which is the point.
 */
export const INSTRUMENT_CONSUMERS = [
  "comparison-gate",
  "comparison-gate-record-lexical",
  "routing-corpus",
];
