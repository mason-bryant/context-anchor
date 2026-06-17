import { describe, expect, it } from "vitest";

import { buildPeopleIndex, parsePeopleRegistry } from "../src/peopleRegistry.js";

describe("parsePeopleRegistry", () => {
  it("returns empty registry for null input", () => {
    expect(parsePeopleRegistry(null)).toEqual({ people: [], teams: [] });
  });

  it("returns empty registry for non-object input", () => {
    expect(parsePeopleRegistry("string")).toEqual({ people: [], teams: [] });
    expect(parsePeopleRegistry([])).toEqual({ people: [], teams: [] });
  });

  it("returns empty people/teams when arrays are missing", () => {
    expect(parsePeopleRegistry({})).toEqual({ people: [], teams: [] });
  });

  it("parses people with minimal fields", () => {
    const result = parsePeopleRegistry({
      people: [{ id: "jdoe", displayName: "Jane Doe" }],
      teams: [],
    });
    expect(result.people).toEqual([{ id: "jdoe", displayName: "Jane Doe" }]);
  });

  it("parses people with full identity fields", () => {
    const result = parsePeopleRegistry({
      people: [
        {
          id: "jdoe",
          displayName: "Jane Doe",
          identities: {
            slack: "U12345",
            confluence: "jdoe",
            emails: ["jane@example.com", "jdoe@work.com"],
            names: ["Jane", "J. Doe"],
          },
          teams: ["platform"],
        },
      ],
      teams: [],
    });
    expect(result.people[0]).toEqual({
      id: "jdoe",
      displayName: "Jane Doe",
      identities: {
        slack: "U12345",
        confluence: "jdoe",
        emails: ["jane@example.com", "jdoe@work.com"],
        names: ["Jane", "J. Doe"],
      },
      teams: ["platform"],
    });
  });

  it("skips people missing required fields", () => {
    const result = parsePeopleRegistry({
      people: [
        { id: "jdoe" },
        { displayName: "No ID" },
        { id: "", displayName: "Empty ID" },
        { id: "good", displayName: "Good Person" },
      ],
      teams: [],
    });
    expect(result.people).toEqual([{ id: "good", displayName: "Good Person" }]);
  });

  it("parses teams with all fields", () => {
    const result = parsePeopleRegistry({
      people: [],
      teams: [
        {
          id: "platform",
          displayName: "Platform Team",
          synonyms: ["core-platform", "platform team"],
          slackHandles: ["platform-team"],
        },
      ],
    });
    expect(result.teams[0]).toEqual({
      id: "platform",
      displayName: "Platform Team",
      synonyms: ["core-platform", "platform team"],
      slackHandles: ["platform-team"],
    });
  });

  it("skips teams missing required fields", () => {
    const result = parsePeopleRegistry({
      people: [],
      teams: [{ id: "no-name" }, { id: "good", displayName: "Good Team" }],
    });
    expect(result.teams).toEqual([{ id: "good", displayName: "Good Team" }]);
  });

  it("omits empty identities", () => {
    const result = parsePeopleRegistry({
      people: [{ id: "jdoe", displayName: "Jane Doe", identities: {} }],
      teams: [],
    });
    expect(result.people[0]).toEqual({ id: "jdoe", displayName: "Jane Doe" });
  });
});

describe("buildPeopleIndex", () => {
  const registry = parsePeopleRegistry({
    people: [
      {
        id: "jdoe",
        displayName: "Jane Doe",
        identities: {
          slack: "U12345",
          confluence: "jdoe-conf",
          emails: ["jane@example.com"],
          names: ["Jane", "J. Doe"],
        },
        teams: ["platform"],
      },
      {
        id: "asmith",
        displayName: "Alice Smith",
        teams: ["platform", "frontend"],
      },
    ],
    teams: [
      {
        id: "platform",
        displayName: "Platform Team",
        synonyms: ["core-platform", "platform team"],
        slackHandles: ["platform-eng"],
      },
      {
        id: "frontend",
        displayName: "Frontend Team",
      },
    ],
  });

  const index = buildPeopleIndex(registry);

  describe("resolveOwner", () => {
    it("resolves person by id", () => {
      const match = index.resolveOwner("jdoe");
      expect(match?.kind).toBe("person");
      expect(match?.kind === "person" && match.person.id).toBe("jdoe");
    });

    it("resolves person by display name (case-insensitive)", () => {
      const match = index.resolveOwner("Jane Doe");
      expect(match?.kind).toBe("person");
      expect(match?.kind === "person" && match.person.id).toBe("jdoe");
    });

    it("resolves person by slack id", () => {
      const match = index.resolveOwner("U12345");
      expect(match?.kind).toBe("person");
      expect(match?.kind === "person" && match.person.id).toBe("jdoe");
    });

    it("resolves person by email", () => {
      const match = index.resolveOwner("jane@example.com");
      expect(match?.kind).toBe("person");
    });

    it("resolves person by name alias", () => {
      const match = index.resolveOwner("Jane");
      expect(match?.kind).toBe("person");
    });

    it("resolves person by confluence id", () => {
      const match = index.resolveOwner("jdoe-conf");
      expect(match?.kind).toBe("person");
    });

    it("resolves team by id", () => {
      const match = index.resolveOwner("platform");
      expect(match?.kind).toBe("team");
      expect(match?.kind === "team" && match.team.id).toBe("platform");
    });

    it("resolves team by display name", () => {
      const match = index.resolveOwner("Platform Team");
      expect(match?.kind).toBe("team");
    });

    it("resolves team by synonym", () => {
      const match = index.resolveOwner("core-platform");
      expect(match?.kind).toBe("team");
      expect(match?.kind === "team" && match.team.id).toBe("platform");
    });

    it("resolves team by synonym with spaces", () => {
      const match = index.resolveOwner("platform team");
      expect(match?.kind).toBe("team");
    });

    it("resolves team by slack handle", () => {
      const match = index.resolveOwner("platform-eng");
      expect(match?.kind).toBe("team");
    });

    it("returns undefined for unknown owner", () => {
      expect(index.resolveOwner("nobody")).toBeUndefined();
    });

    it("prioritizes person over team when id matches both", () => {
      const match = index.resolveOwner("jdoe");
      expect(match?.kind).toBe("person");
    });
  });

  describe("getTeamMembers", () => {
    it("returns members for a team", () => {
      const members = index.getTeamMembers("platform");
      expect(members.map((m) => m.id).sort()).toEqual(["asmith", "jdoe"]);
    });

    it("returns subset for single-team members", () => {
      const members = index.getTeamMembers("frontend");
      expect(members.map((m) => m.id)).toEqual(["asmith"]);
    });

    it("returns empty for unknown team", () => {
      expect(index.getTeamMembers("nobody")).toEqual([]);
    });
  });

  describe("getPerson", () => {
    it("returns person by id", () => {
      expect(index.getPerson("jdoe")?.id).toBe("jdoe");
    });

    it("returns null for unknown person", () => {
      expect(index.getPerson("unknown")).toBeUndefined();
    });
  });

  describe("getTeam", () => {
    it("returns team by id", () => {
      expect(index.getTeam("platform")?.id).toBe("platform");
    });

    it("returns team by synonym", () => {
      expect(index.getTeam("core-platform")?.id).toBe("platform");
    });

    it("returns undefined for unknown team", () => {
      expect(index.getTeam("nobody")).toBeUndefined();
    });
  });

  describe("getPersonById", () => {
    it("returns person by exact id (case-insensitive)", () => {
      expect(index.getPersonById("JDOE")?.id).toBe("jdoe");
    });

    it("does not resolve a person by alias, email, or slack", () => {
      expect(index.getPersonById("Jane")).toBeUndefined();
      expect(index.getPersonById("jane@example.com")).toBeUndefined();
      expect(index.getPersonById("U12345")).toBeUndefined();
    });
  });

  describe("getTeamById", () => {
    it("returns team by exact id", () => {
      expect(index.getTeamById("platform")?.id).toBe("platform");
    });

    it("does not resolve a team by synonym or slack handle", () => {
      expect(index.getTeamById("core-platform")).toBeUndefined();
      expect(index.getTeamById("platform-eng")).toBeUndefined();
    });
  });

  describe("strict id precedence over colliding identities", () => {
    const collisionRegistry = parsePeopleRegistry({
      people: [
        { id: "alex", displayName: "Alex Real", identities: { names: ["Sam"] } },
        { id: "sam", displayName: "Sam Real" },
      ],
      teams: [],
    });
    const collisionIndex = buildPeopleIndex(collisionRegistry);

    it("returns the person whose canonical id matches, not the alias holder", () => {
      // "sam" is both the id of person 'sam' and an alias of person 'alex'.
      expect(collisionIndex.getPersonById("sam")?.id).toBe("sam");
    });
  });
});
