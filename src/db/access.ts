export type WorkspaceRole = "owner" | "member";
export type ScopePermission = "read" | "write";

export type ScopeGrant = {
  permission: ScopePermission;
  retiredAt?: string | Date | null;
};

/**
 * Deny-by-default access resolution (M12 decision, 2026-08-08). `scope_grants` starts
 * empty: an owner has full access with no grant row at all, and a member without a live
 * grant has none — resolution is never "membership grants everything." A write grant
 * implies read; a read grant does not imply write.
 */
export function resolveScopeAccess(input: {
  role: WorkspaceRole;
  grant?: ScopeGrant | null;
  permission: ScopePermission;
}): boolean {
  if (input.role === "owner") {
    return true;
  }

  const grant = input.grant;
  if (!grant || grant.retiredAt) {
    return false;
  }

  if (input.permission === "read") {
    return grant.permission === "read" || grant.permission === "write";
  }

  return grant.permission === "write";
}
