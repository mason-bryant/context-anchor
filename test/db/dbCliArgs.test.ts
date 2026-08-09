import { describe, expect, it } from "vitest";

import { parseDbCliArgs } from "../../src/db/cliArgs.js";

describe("parseDbCliArgs", () => {
  it("parses each known command", () => {
    expect(parseDbCliArgs(["up"])).toEqual({ command: "up" });
    expect(parseDbCliArgs(["down"])).toEqual({ command: "down" });
    expect(parseDbCliArgs(["status"])).toEqual({ command: "status" });
    expect(parseDbCliArgs(["migrate"])).toEqual({ command: "migrate" });
    expect(parseDbCliArgs(["psql"])).toEqual({ command: "psql" });
  });

  it("parses reset with the required --yes flag", () => {
    expect(parseDbCliArgs(["reset", "--yes"])).toEqual({ command: "reset", yes: true });
  });

  it("rejects reset without --yes", () => {
    expect(() => parseDbCliArgs(["reset"])).toThrow(/--yes/);
  });

  it("rejects a missing command", () => {
    expect(() => parseDbCliArgs([])).toThrow(/command/i);
  });

  it("rejects an unknown command", () => {
    expect(() => parseDbCliArgs(["frobnicate"])).toThrow(/frobnicate/);
  });

  it("rejects --yes on a command other than reset", () => {
    expect(() => parseDbCliArgs(["up", "--yes"])).toThrow(/reset/);
  });
});
