/**
 * Shared opaque-id primitives (Goal 0 Phase 1, WP1: `goal0_semantic_substrate_implementation_plan.md`).
 *
 * `randomBase36` was originally private to `src/claims.ts` (`mintClaimId`).
 * Extracted here, byte-identical, so `src/graph/identity.ts`'s `mintAnchorId`
 * can reuse the exact same collision-growth algorithm without duplicating it
 * or creating a churny cross-import between `claims.ts` and `graph/identity.ts`.
 */

import { randomBytes } from "node:crypto";

const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Draw `length` random base36 characters using crypto-strength randomness. */
export function randomBase36(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += BASE36_ALPHABET[bytes[index] % BASE36_ALPHABET.length];
  }
  return out;
}

/**
 * Mint a new opaque id `${prefix}-` + 6 random base36 chars, grown to 8 chars
 * if that collides with `existing` (collision-checked against the full set
 * of ids already present in the tree, passed in by the caller). Opaque,
 * immutable once minted, and never content-derived. Shared by `mintClaimId`
 * (`src/claims.ts`, prefix `c`) and `mintAnchorId` (`src/graph/identity.ts`,
 * prefix `a`) so both mint algorithms stay byte-identical by construction.
 */
export function mintPrefixedId(prefix: string, existing: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${prefix}-${randomBase36(6)}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  // Six-char space exhausted after 50 tries (astronomically unlikely at any
  // real tree size) — grow to 8 chars for a much larger collision space.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${prefix}-${randomBase36(8)}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`mintPrefixedId: unable to mint a unique "${prefix}-" id after repeated attempts.`);
}
