/**
 * The shape of a record guid, defined once.
 *
 * Two copies of this regex existed, and one of them carried a comment saying it matched "the
 * shape the rest of the codebase uses" — which is exactly the claim a second copy makes false
 * the moment either moves. A guid check that disagrees with itself accepts an identifier in one
 * entry point and refuses it in another.
 */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuid(value: string): boolean {
  return GUID_PATTERN.test(value);
}
