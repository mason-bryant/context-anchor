import type { AssociationRole, Person, PersonIdentities, PeopleRegistry, ProjectAssociation, Team } from "./types.js";

// KEEP IN SYNC with AssociationRole in src/types.ts and ASSOCIATION_ROLES in
// src/ui/assets.ts (UI dropdown). If these drift, the UI can offer a role the
// backend rejects, or vice versa.
const VALID_ROLES = new Set<string>(["responsible", "accountable", "informed", "consulted", "executive_sponsor", "stakeholder", "lead"]);

export function parsePeopleRegistry(raw: unknown): PeopleRegistry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { people: [], teams: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    people: parsePeopleArray(obj.people),
    teams: parseTeamsArray(obj.teams),
  };
}

function parsePeopleArray(raw: unknown): Person[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): Person[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    const id = stringValue(obj.id);
    const displayName = stringValue(obj.displayName);
    if (!id || !displayName) return [];

    const identities = parseIdentities(obj.identities);
    const teams = stringArrayValue(obj.teams);
    const projects = parseProjectAssociations(obj.projects);

    return [
      {
        id,
        displayName,
        ...(identities ? { identities } : {}),
        ...(teams.length > 0 ? { teams } : {}),
        ...(projects.length > 0 ? { projects } : {}),
      },
    ];
  });
}

function parseTeamsArray(raw: unknown): Team[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): Team[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    const id = stringValue(obj.id);
    const displayName = stringValue(obj.displayName);
    if (!id || !displayName) return [];

    const synonyms = stringArrayValue(obj.synonyms);
    const slackHandles = stringArrayValue(obj.slackHandles);
    const projects = parseProjectAssociations(obj.projects);

    return [
      {
        id,
        displayName,
        ...(synonyms.length > 0 ? { synonyms } : {}),
        ...(slackHandles.length > 0 ? { slackHandles } : {}),
        ...(projects.length > 0 ? { projects } : {}),
      },
    ];
  });
}

function parseProjectAssociations(raw: unknown): ProjectAssociation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ProjectAssociation[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    const project = stringValue(obj.project);
    const role = stringValue(obj.role);
    if (!project || !role || !VALID_ROLES.has(role)) return [];
    return [{ project, role: role as AssociationRole }];
  });
}

function parseIdentities(raw: unknown): PersonIdentities | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const slack = stringValue(obj.slack);
  const confluence = stringValue(obj.confluence);
  const emails = stringArrayValue(obj.emails);
  const names = stringArrayValue(obj.names);

  if (!slack && !confluence && emails.length === 0 && names.length === 0) return undefined;

  return {
    ...(slack ? { slack } : {}),
    ...(confluence ? { confluence } : {}),
    ...(emails.length > 0 ? { emails } : {}),
    ...(names.length > 0 ? { names } : {}),
  };
}

export type OwnerMatch = { kind: "person"; person: Person } | { kind: "team"; team: Team };

export type PeopleIndex = {
  resolveOwner: (owner: string) => OwnerMatch | undefined;
  getPerson: (id: string) => Person | undefined;
  getTeam: (id: string) => Team | undefined;
  /** Strict lookup by canonical id only (no aliases/emails/synonyms). */
  getPersonById: (id: string) => Person | undefined;
  /** Strict lookup by canonical id only (no synonyms/handles). */
  getTeamById: (id: string) => Team | undefined;
  getTeamMembers: (teamId: string) => Person[];
};

export function buildPeopleIndex(registry: PeopleRegistry): PeopleIndex {
  const personByKey = new Map<string, Person>();
  const teamByKey = new Map<string, Team>();

  for (const person of registry.people) {
    set(personByKey, person.id, person);
    set(personByKey, person.displayName, person);
    if (person.identities?.slack) set(personByKey, person.identities.slack, person);
    if (person.identities?.confluence) set(personByKey, person.identities.confluence, person);
    for (const email of person.identities?.emails ?? []) set(personByKey, email, person);
    for (const name of person.identities?.names ?? []) set(personByKey, name, person);
  }

  for (const team of registry.teams) {
    set(teamByKey, team.id, team);
    set(teamByKey, team.displayName, team);
    for (const synonym of team.synonyms ?? []) set(teamByKey, synonym, team);
    for (const handle of team.slackHandles ?? []) set(teamByKey, handle, team);
  }

  return {
    resolveOwner(owner: string): OwnerMatch | undefined {
      const key = owner.toLowerCase().trim();
      const person = personByKey.get(key);
      if (person) return { kind: "person", person };
      const team = teamByKey.get(key);
      if (team) return { kind: "team", team };
      return undefined;
    },
    getPerson(id: string): Person | undefined {
      return personByKey.get(id.toLowerCase().trim());
    },
    getTeam(id: string): Team | undefined {
      return teamByKey.get(id.toLowerCase().trim());
    },
    getPersonById(id: string): Person | undefined {
      const needle = id.toLowerCase().trim();
      return registry.people.find((p) => p.id.toLowerCase() === needle);
    },
    getTeamById(id: string): Team | undefined {
      const needle = id.toLowerCase().trim();
      return registry.teams.find((t) => t.id.toLowerCase() === needle);
    },
    getTeamMembers(teamId: string): Person[] {
      const needle = teamId.toLowerCase().trim();
      return registry.people.filter((p) => p.teams?.some((t) => t.toLowerCase().trim() === needle));
    },
  };
}

function set<T>(map: Map<string, T>, key: string, value: T): void {
  const k = key.toLowerCase().trim();
  if (k && !map.has(k)) map.set(k, value);
}

function stringValue(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function stringArrayValue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}
