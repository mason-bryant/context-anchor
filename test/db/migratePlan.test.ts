import { describe, expect, it } from "vitest";

import { parseMigrationFilename, planPendingMigrations } from "../../src/db/migrate.js";

describe("parseMigrationFilename", () => {
  it("parses a well-formed migration filename", () => {
    expect(parseMigrationFilename("0001_identity_and_scopes.sql")).toEqual({
      id: 1,
      name: "identity_and_scopes",
      filename: "0001_identity_and_scopes.sql",
    });
  });

  it("parses a higher-numbered migration", () => {
    expect(parseMigrationFilename("0042_add_widgets.sql")).toEqual({
      id: 42,
      name: "add_widgets",
      filename: "0042_add_widgets.sql",
    });
  });

  it("returns undefined for a non-SQL file", () => {
    expect(parseMigrationFilename("0001_identity_and_scopes.md")).toBeUndefined();
  });

  it("returns undefined for a filename missing the numeric prefix", () => {
    expect(parseMigrationFilename("identity_and_scopes.sql")).toBeUndefined();
  });

  it("returns undefined for a filename with an underscore-free suffix", () => {
    expect(parseMigrationFilename("0001.sql")).toBeUndefined();
  });

  it("returns undefined for uppercase or hyphenated names", () => {
    expect(parseMigrationFilename("0001_Identity.sql")).toBeUndefined();
    expect(parseMigrationFilename("0001-identity.sql")).toBeUndefined();
  });
});

describe("planPendingMigrations", () => {
  const files = [
    { id: 1, name: "identity_and_scopes", filename: "0001_identity_and_scopes.sql" },
    { id: 2, name: "add_widgets", filename: "0002_add_widgets.sql" },
    { id: 3, name: "add_gadgets", filename: "0003_add_gadgets.sql" },
  ];

  it("returns every file in order when nothing is applied", () => {
    expect(planPendingMigrations(files, [])).toEqual(files);
  });

  it("excludes already-applied ids", () => {
    expect(planPendingMigrations(files, [1])).toEqual([files[1], files[2]]);
  });

  it("returns an empty list when everything is applied", () => {
    expect(planPendingMigrations(files, [1, 2, 3])).toEqual([]);
  });

  it("sorts by id regardless of input order", () => {
    const shuffled = [files[2]!, files[0]!, files[1]!];
    expect(planPendingMigrations(shuffled, [])).toEqual(files);
  });

  it("ignores applied ids that do not correspond to any file", () => {
    expect(planPendingMigrations(files, [1, 99])).toEqual([files[1], files[2]]);
  });
});
