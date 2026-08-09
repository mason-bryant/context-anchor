import { describe, expect, it } from "vitest";

import { resolveScopeAccess } from "../../src/db/access.js";

describe("resolveScopeAccess", () => {
  it("grants an owner read access with no grant row at all", () => {
    expect(resolveScopeAccess({ role: "owner", grant: undefined, permission: "read" })).toBe(true);
  });

  it("grants an owner write access with no grant row at all", () => {
    expect(resolveScopeAccess({ role: "owner", grant: undefined, permission: "write" })).toBe(true);
  });

  it("grants an owner access even when a grant row exists and is retired", () => {
    expect(
      resolveScopeAccess({
        role: "owner",
        grant: { permission: "read", retiredAt: new Date() },
        permission: "write",
      }),
    ).toBe(true);
  });

  it("denies a member with no grant row (deny by default)", () => {
    expect(resolveScopeAccess({ role: "member", grant: undefined, permission: "read" })).toBe(false);
    expect(resolveScopeAccess({ role: "member", grant: null, permission: "read" })).toBe(false);
  });

  it("denies a member whose grant is retired", () => {
    expect(
      resolveScopeAccess({
        role: "member",
        grant: { permission: "write", retiredAt: new Date() },
        permission: "read",
      }),
    ).toBe(false);
  });

  it("grants a member with a live read grant read access", () => {
    expect(
      resolveScopeAccess({ role: "member", grant: { permission: "read", retiredAt: null }, permission: "read" }),
    ).toBe(true);
  });

  it("denies a member with a live read grant write access", () => {
    expect(
      resolveScopeAccess({ role: "member", grant: { permission: "read", retiredAt: null }, permission: "write" }),
    ).toBe(false);
  });

  it("grants a member with a live write grant both read and write access (write implies read)", () => {
    expect(
      resolveScopeAccess({ role: "member", grant: { permission: "write", retiredAt: null }, permission: "read" }),
    ).toBe(true);
    expect(
      resolveScopeAccess({ role: "member", grant: { permission: "write", retiredAt: null }, permission: "write" }),
    ).toBe(true);
  });
});
