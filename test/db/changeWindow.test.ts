import { describe, expect, it } from "vitest";

import { parseChangeWindow } from "../../src/db/changeWindow.js";

const NOW = new Date("2026-08-08T12:00:00.000Z");

describe("parseChangeWindow", () => {
  it("parses day, hour, and week windows relative to now", () => {
    expect(parseChangeWindow("7d", NOW)).toEqual(new Date("2026-08-01T12:00:00.000Z"));
    expect(parseChangeWindow("24h", NOW)).toEqual(new Date("2026-08-07T12:00:00.000Z"));
    expect(parseChangeWindow("2w", NOW)).toEqual(new Date("2026-07-25T12:00:00.000Z"));
  });

  it("parses a minute window", () => {
    expect(parseChangeWindow("90m", NOW)).toEqual(new Date("2026-08-08T10:30:00.000Z"));
  });

  it("accepts an absolute ISO timestamp with an explicit timezone", () => {
    expect(parseChangeWindow("2026-07-01T00:00:00.000Z", NOW)).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(parseChangeWindow("2026-07-01T00:00:00Z", NOW)).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(parseChangeWindow("2026-07-01T02:00:00+02:00", NOW)).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("rejects a timestamp with no timezone, which Node would read as server-local time", () => {
    // The same string would mean different instants on two machines, silently shifting the
    // lower bound of a history query.
    expect(() => parseChangeWindow("2026-07-01T00:00:00", NOW)).toThrow(/timezone/i);
    expect(() => parseChangeWindow("2026-07-01T00:00:00.000", NOW)).toThrow(/timezone/i);
  });

  it("accepts a plain ISO date", () => {
    expect(parseChangeWindow("2026-07-01", NOW)).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("returns undefined when no window is supplied, meaning no lower bound", () => {
    expect(parseChangeWindow(undefined, NOW)).toBeUndefined();
  });

  it("rejects a malformed window rather than silently returning everything", () => {
    // Silently widening to "all history" would make a typo look like a quiet, wrong answer.
    expect(() => parseChangeWindow("7", NOW)).toThrow(/since/i);
    expect(() => parseChangeWindow("last week", NOW)).toThrow(/since/i);
    expect(() => parseChangeWindow("-7d", NOW)).toThrow(/since/i);
    expect(() => parseChangeWindow("0d", NOW)).toThrow(/since/i);
    expect(() => parseChangeWindow("", NOW)).toThrow(/since/i);
  });

  it("rejects a window whose unit is unknown", () => {
    expect(() => parseChangeWindow("7y", NOW)).toThrow(/since/i);
  });
});
