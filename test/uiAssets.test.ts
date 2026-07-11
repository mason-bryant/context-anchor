import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { UI_CSS, UI_HTML, UI_JS } from "../src/ui/assets.js";

type UiSuggestion = { value: string; label: string; searchText?: string };
type UiRegistry = { people: Array<Record<string, unknown>>; teams: Array<Record<string, unknown>> };

type UiClaim = {
  anchor: string;
  line: number;
  section: string;
  text: string;
  status: string;
  strength?: string;
  annotation?: { src: string; observed: string; conf: string; href?: string; kind?: string; person?: string; personName?: string };
  sources?: Array<{ src: string; observed: string; conf: string; href?: string; line?: number; inline?: boolean; kind?: string; person?: string; personName?: string }>;
  effectiveCertainty?: { certainty: number; rows: unknown[]; aggregation: string };
};

type UiAssetHooks = {
  claimStrengthValue(claim: UiClaim): string;
  claimCertaintyValue(claim: UiClaim): number | null;
  sortClaimsByCertainty(claims: UiClaim[]): UiClaim[];
  renderClaimInline(claim: UiClaim): string;
  renderClaimPopover(claim: UiClaim): string;
  claimSourceRowHtml(source: Record<string, unknown>, index: number, readOnly: boolean): string;
  neighborsPanelHtml(result: Record<string, unknown>): string;
  renderMarkdown(markdown: string, options?: Record<string, unknown>): string;
  renderMermaidDiagrams(container: { querySelectorAll(selector: string): unknown[] }): Promise<void>;
  sanitizeLinkHref(href: string): string | null;
  anchorHref(name: string): string;
  readAnchorFromLocation(): string | null;
  clearAnchorLocation(): void;
  showSelectedAnchor(): void;
  setSelectedNameForTest(name: string | null): void;
  token(): string;
  saveToken(value: string): void;
  renderAnchorGroup(group: { key: string; label: string; anchors: Array<Record<string, unknown>> }): string;
  renderAnchorRow(anchor: Record<string, unknown>): string;
  sortAnchorGroups(
    groups: Array<{ key: string; label: string; anchors: Array<Record<string, unknown>> }>,
  ): Array<{ key: string; label: string; anchors: Array<Record<string, unknown>> }>;
  setAnchorGroupSortForTest(value: string): void;
  renderPlannerItem(item: Record<string, unknown>): string;
  comparePlannerRuns(
    current: { included: Array<{ name: string }>; excluded: Array<{ name: string }>; estimatedTokens: number },
    previous: { included: Array<{ name: string }>; excluded: Array<{ name: string }>; estimatedTokens: number },
  ): {
    includedAdded: string[];
    includedRemoved: string[];
    excludedAdded: string[];
    excludedRemoved: string[];
    tokenDelta: number;
  } | null;
  proposalListWithUpdatedProposal(
    proposals: Array<Record<string, unknown>>,
    proposal: Record<string, unknown>,
  ): Array<Record<string, unknown>>;
  sortTasksForDisplay(tasks: Array<Record<string, unknown>>, sortMode: string): Array<Record<string, unknown>>;
  taskGroupsForDisplay(
    tasks: Array<Record<string, unknown>>,
    groupBy: string,
    sortMode: string,
    today: string,
    soon: string,
  ): Array<{ key?: string; label: string; cls?: string; projectPriority?: number; tasks: Array<Record<string, unknown>> }>;
  taskGroupPriority(tasks: Array<Record<string, unknown>>): number;
  taskProjectPriority(task: Record<string, unknown>): number;
  taskPriority(task: Record<string, unknown>): number;
  taskReportRanges(
    completedDaysRaw: string,
    dueDaysRaw: string,
    today: string,
  ): {
    completedDays: number | "";
    dueDays: number | "";
    completedAfter: string;
    completedBefore: string;
    dueAfter: string;
    dueBefore: string;
  };
  taskStateClass(task: Record<string, unknown>, today: string): string;
  renderTaskRow(task: Record<string, unknown>, today: string): string;
  rememberTaskOwnerMatches(matches: Array<Record<string, unknown>>): void;
  taskOwnerCachedMatches(query: string): Array<{ id: string; displayName: string; aliases: string[]; matched: string; value: string }>;
  taskOwnerAssignmentValue(value: string): string;
  peopleForDisplay(registry: UiRegistry, query: string): Array<Record<string, unknown>>;
  teamsForDisplay(registry: UiRegistry, query: string): Array<Record<string, unknown>>;
  projectSuggestionOptions(): UiSuggestion[];
  milestoneSuggestionOptions(): UiSuggestion[];
  teamSuggestionOptions(query: string): UiSuggestion[];
  resolveTeamIdsFromCsv(value: string): string[];
  setTypeaheadStateForTest(nextState: {
    anchors?: Array<Record<string, unknown>>;
    tasks?: Array<Record<string, unknown>>;
    registry?: UiRegistry | null;
  }): void;
  setTasksDisplayForTest(groupBy: string, sortMode: string): void;
  shouldHandleClientNavigation(event: Record<string, unknown>, link: { getAttribute(name: string): string | null }): boolean;
  parsePlannerLogPaste(text: unknown): Record<string, unknown> | null;
  queryFromPlannerInput(input: Record<string, unknown>): string;
  renderProjectResolution(resolution: unknown): string;
  formatPlannerStatus(plan: Record<string, unknown>): string;
  mappingCardHtml(project: unknown, index: number): string;
  mappingsForDisplay(): {
    managed: Array<{ project: string; repos: unknown[] }>;
    orphans: Array<{ project: string; repos: unknown[] }>;
  };
  setMappingsTestState(anchors: unknown[], projectMappings: unknown): void;
  buildJudgePrompt(plan: Record<string, unknown>, anchorBodies: Record<string, string>): string;
  formatPreview(preview: Record<string, unknown>): string;
  priorityLabel(priority: number): string;
  projectOf(anchor: Record<string, unknown>): string;
  isServerRuleAnchor(anchor: Record<string, unknown> | string | null): boolean;
  readOnlyDetailControlIds(): string[];
};

type TestStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function createStorage(initial: Record<string, string> = {}): TestStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function loadHooks(
  options: {
    search?: string;
    hash?: string;
    localStorage?: TestStorage;
    sessionStorage?: TestStorage;
    historyUpdates?: string[];
    mermaid?: Record<string, unknown>;
  } = {},
): UiAssetHooks {
  const hooks: Partial<UiAssetHooks> = {};
  const search = options.search ?? "";
  const hash = options.hash ?? "";
  const localStorage = options.localStorage ?? createStorage();
  const sessionStorage = options.sessionStorage ?? createStorage();

  vm.runInNewContext(UI_JS, {
    URL,
    URLSearchParams,
    decodeURIComponent,
    document: {
      querySelectorAll: () => [],
    },
    window: {
      location: {
        href: `http://localhost:3333/ui${search}${hash}`,
        search,
        hash,
        origin: "http://localhost:3333",
        pathname: "/ui",
      },
      localStorage,
      sessionStorage,
      mermaid: options.mermaid,
      history: {
        pushState: (_state: unknown, _title: string, url: string) => {
          options.historyUpdates?.push(url);
        },
      },
      __ANCHOR_MCP_UI_TEST_HOOKS__: hooks,
    },
  });

  return hooks as UiAssetHooks;
}

describe("UI browser assets", () => {
  it("provides a small monochrome icon library for core controls", () => {
    expect(UI_HTML).toContain('id="icon-home"');
    expect(UI_HTML).toContain('id="icon-anchor"');
    expect(UI_HTML).toContain('id="icon-filter"');
    expect(UI_HTML).toContain('id="icon-plan"');
    expect(UI_HTML).toContain('id="icon-save"');
    expect(UI_HTML).toContain('id="icon-object-graph"');
    expect(UI_HTML).toContain('id="icon-trash"');
    expect(UI_HTML).toContain('id="icon-pencil"');
    expect(UI_HTML).toContain('id="claim-person-suggestions"');
    expect(UI_HTML).toContain('id="claim-new-person-save"');
    expect(UI_JS).toContain("trust-me-bro");
    expect(UI_HTML).toContain('<use href="#icon-home"></use>');
    expect(UI_HTML).toContain('<use href="#icon-anchor"></use>');
    expect(UI_HTML).toContain('<use href="#icon-filter"></use>');
    expect(UI_HTML).toContain('<use href="#icon-plan"></use>');
    expect(UI_HTML).toContain('<use href="#icon-save"></use>');
    expect(UI_CSS).toContain("stroke: currentColor");
  });

  it("renders a wider claim-source modal with red icon delete actions", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState([], {
      projects: [],
      claimSourceTypes: [
        { id: "url", label: "Evidence" },
        { id: "design-doc", label: "Design Doc" },
        { id: "adr", label: "ADR" },
        { id: "misc", label: "Misc" },
        { id: "trust-me-bro", label: "trust me bro", requiresPerson: true, lockedConfidence: "high" },
      ],
    });
    const html = hooks.claimSourceRowHtml(
      {
        src: "https://example.test/source",
        kind: "source",
        observed: "2026-07-08",
        conf: "medium",
        derivedFrom: "projects/demo/b.md#c-up0001",
        contradicts: "#c-rival1",
      },
      0,
      false,
    );

    expect(UI_CSS).toContain(".claim-source-dialog");
    expect(UI_CSS).toContain("width: min(1120px, calc(100vw - 48px))");
    expect(UI_CSS).toContain(".danger-button");
    expect(UI_CSS).toContain("color: var(--block)");
    expect(html).toContain('<span class="claim-source-src-title">Evidence</span>');
    expect(html).toContain('value="url" selected');
    expect(html).toContain('class="claim-source-delete danger-button"');
    expect(html).toContain('<use href="#icon-trash"></use>');
    // WP5 edge-key inputs, pre-filled from the source row.
    expect(html).toContain('class="claim-source-derived-from"');
    expect(html).toContain('value="projects/demo/b.md#c-up0001"');
    expect(html).toContain('class="claim-source-contradicts"');
    expect(html).toContain('value="#c-rival1"');
  });

  it("labels the detail tab as a disabled selected-anchor tab", () => {
    expect(UI_HTML).toContain("Selected Anchor");
    expect(UI_HTML).toContain('data-tab="detail" type="button" disabled');
  });

  it("includes the planner tab, controls, and output regions", () => {
    expect(UI_HTML).toContain('data-tab="planner"');
    expect(UI_HTML).toContain('id="planner-task"');
    expect(UI_HTML).toContain('id="planner-project"');
    expect(UI_HTML).toContain('id="planner-category"');
    expect(UI_HTML).toContain('id="planner-tag"');
    expect(UI_HTML).toContain('id="planner-runtime"');
    expect(UI_HTML).toContain('id="planner-repo"');
    expect(UI_HTML).toContain('id="planner-filepaths"');
    expect(UI_HTML).toContain('id="planner-budget"');
    expect(UI_HTML).toContain('id="planner-max-anchors"');
    expect(UI_HTML).toContain('id="planner-load-context"');
    expect(UI_HTML).toContain('id="planner-comparison"');
    expect(UI_HTML).toContain('id="planner-raw"');
    expect(UI_HTML).toContain('id="planner-resolution-box"');
    expect(UI_HTML).toContain('id="planner-resolution"');
  });

  it("includes task grouping and due-date sort controls", () => {
    expect(UI_HTML).toContain('id="tasks-group-by"');
    expect(UI_HTML).toContain('id="tasks-sort"');
    expect(UI_HTML).toContain('id="tasks-completed-days" type="number"');
    expect(UI_HTML).toContain('id="tasks-due-days" type="number"');
    expect(UI_HTML).toContain('id="tasks-project-priority-max" type="number"');
    expect(UI_HTML).toContain('id="tasks-task-priority-max" type="number"');
    expect(UI_HTML).toContain('id="tasks-modified-after" type="date"');
    expect(UI_HTML).toContain("Project priority");
    expect(UI_HTML).toContain("Task priority");
    expect(UI_HTML).toContain("Project name");
    expect(UI_HTML).toContain("Last modified");
    expect(UI_HTML).toContain("Group: Project");
    expect(UI_HTML).toContain("Due date ascending");
    expect(UI_HTML).toContain("Active / Todo / Blocked / Done");
    expect(UI_JS).toContain('"tasksGroup"');
    expect(UI_JS).toContain('"tasksSort"');
    expect(UI_JS).toContain('"tasksCompletedDays"');
    expect(UI_JS).toContain('"tasksDueDays"');
    expect(UI_JS).toContain('"tasksProjectPriorityMax"');
    expect(UI_JS).toContain('"tasksTaskPriorityMax"');
    expect(UI_JS).toContain('"tasksModifiedAfter"');
    expect(UI_JS).toContain('"tasksPriorityMax"');
    expect(UI_JS).toContain("project-priority-badge");
    expect(UI_JS).toContain("task-priority-badge");
    expect(UI_JS).toContain("task-priority-form");
    expect(UI_JS).toContain("task-notes-form");
    expect(UI_JS).toContain("task-reopen-btn");
    expect(UI_JS).toContain("task-group-toggle");
    expect(UI_JS).toContain("milestoneUpdatedAt");
    expect(UI_JS).toContain("collapsedTaskGroups");
    expect(UI_JS).toContain("task-owner-form");
    expect(UI_JS).toContain("task-owner-suggestions");
    expect(UI_JS).toContain("task-edit-details");
    expect(UI_HTML).toContain('id="project-slug-suggestions"');
    expect(UI_HTML).toContain('id="milestone-anchor-suggestions"');
    expect(UI_HTML).toContain('id="team-id-suggestions"');
    expect(UI_HTML).toContain('id="people-search"');
    expect(UI_HTML).toContain('id="teams-search"');
    expect(UI_JS).toContain("/api/ui/task-owner");
    expect(UI_JS).toContain("/api/ui/task-priority");
    expect(UI_JS).toContain("/api/ui/task-notes");
    expect(UI_JS).toContain("/api/ui/claim-text");
    expect(UI_JS).toContain("/api/ui/task-reopen");
    expect(UI_JS).toContain("/api/ui/people-search");
    expect(UI_HTML).toContain('id="new-task-project" type="text" placeholder="anchor-mcp" list="project-slug-suggestions" autocomplete="off"');
    expect(UI_HTML).toContain('id="new-task-owner" type="text" placeholder="person or team — blank = unassigned" list="task-owner-suggestions" autocomplete="off"');
    expect(UI_HTML).toContain('id="new-task-priority" type="number"');
    expect(UI_HTML).toContain('id="new-task-milestone" type="text" placeholder="blank = project backlog" list="milestone-anchor-suggestions" autocomplete="off"');
    expect(UI_HTML).toContain('id="new-task-notes" maxlength="480"');
    expect(UI_HTML).toContain('id="new-person-teams" type="text" placeholder="platform, frontend" list="team-id-suggestions" autocomplete="off"');
    expect(UI_CSS).toContain(".project-priority-badge");
    expect(UI_CSS).toContain(".task-priority-badge");
    expect(UI_CSS).toContain(".task-row.task-state-blocked");
    expect(UI_CSS).toContain(".task-row.task-state-completed");
    expect(UI_CSS).toContain(".task-row.task-state-overdue");
    expect(UI_CSS).toContain(".task-owner-form");
    expect(UI_CSS).toContain(".task-priority-form");
    expect(UI_CSS).toContain(".task-notes-form");
    expect(UI_CSS).toContain(".task-edit-details");
    expect(UI_CSS).toContain(".task-edit-summary");
    expect(UI_CSS).toContain(".task-edit-details:not([open]) .task-edit-forms");
    expect(UI_CSS).toContain(".task-group-toggle");
    expect(UI_CSS).toContain('input[type="date"]');
    expect(UI_CSS).toContain(".registry-search");
  });

  it("collapses task edit tools by default while keeping lifecycle actions visible", () => {
    const hooks = loadHooks();
    const html = hooks.renderTaskRow(
      {
        taskId: "T-1",
        taskTitle: "Merge the people and teams PR",
        taskStatus: "todo",
        taskOwner: "alice",
        taskPriority: 1.2,
        projectPriority: 1.1,
        project: "anchor-mcp",
        milestoneName: "projects/anchor-mcp/milestones/backlog.md",
        milestoneDisplayId: "backlog",
        due: "2026-06-20",
        dateConfidence: "committed",
        milestoneUpdatedAt: "2026-06-19T12:00:00.000Z",
        notes: "Follow up after review.",
      },
      "2026-06-18",
    );

    expect(html).toContain('<button type="button" class="compact-action task-complete-btn">Complete</button>');
    expect(html).toContain('<button type="button" class="compact-action task-delete-btn">Delete</button>');
    expect(html).toContain("modified 2026-06-19");
    expect(html).toContain('<details class="task-edit-details">');
    expect(html).toContain('<summary class="task-edit-summary">Edit task</summary>');
    expect(html).not.toContain('<details class="task-edit-details" open>');
    expect(html.indexOf("task-complete-btn")).toBeLessThan(html.indexOf("task-edit-details"));
    expect(html.indexOf("task-delete-btn")).toBeLessThan(html.indexOf("task-edit-details"));
    expect(html.indexOf("task-owner-form")).toBeGreaterThan(html.indexOf("task-edit-details"));
    expect(html.indexOf("task-priority-form")).toBeGreaterThan(html.indexOf("task-edit-details"));
    expect(html.indexOf("task-due-form")).toBeGreaterThan(html.indexOf("task-edit-details"));
    expect(html.indexOf("task-notes-form")).toBeGreaterThan(html.indexOf("task-edit-details"));
  });

  it("caches the last ten task owner person matches for quick reuse", () => {
    const hooks = loadHooks();
    Array.from({ length: 12 }, (_value, index) => ({
      id: `p${index}`,
      displayName: `Person ${index}`,
      aliases: [`Alias ${index}`],
      matched: `Alias ${index}`,
      value: `Person ${index}`,
    })).forEach((match) => hooks.rememberTaskOwnerMatches([match]));

    expect(hooks.taskOwnerCachedMatches("").map((match) => match.displayName)).toEqual([
      "Person 11",
      "Person 10",
      "Person 9",
      "Person 8",
      "Person 7",
      "Person 6",
      "Person 5",
      "Person 4",
      "Person 3",
      "Person 2",
    ]);
    expect(hooks.taskOwnerCachedMatches("alias 3").map((match) => match.displayName)).toEqual(["Person 3"]);
    expect(hooks.taskOwnerAssignmentValue("Alias 3")).toBe("Person 3");
    expect(hooks.taskOwnerAssignmentValue("Unknown Alias")).toBe("Unknown Alias");
  });

  it("filters registry cards and suggests known registry/project values while typing", () => {
    const hooks = loadHooks();
    const registry: UiRegistry = {
      people: [
        {
          id: "jdoe",
          displayName: "Jane Doe",
          identities: { names: ["Janie"], emails: ["jane@example.com"] },
          teams: ["platform"],
          projects: [{ project: "alpha", role: "lead" }],
        },
        { id: "asmith", displayName: "Alice Smith", teams: ["design"] },
      ],
      teams: [
        {
          id: "platform",
          displayName: "Platform Team",
          synonyms: ["core-platform"],
          slackHandles: ["platform-team"],
          projects: [{ project: "gamma", role: "responsible" }],
        },
        { id: "design", displayName: "Design" },
      ],
    };
    hooks.setTypeaheadStateForTest({
      registry,
      anchors: [
        { name: "projects/alpha/alpha.md", projectSlug: "alpha" },
        { name: "projects/alpha/milestones/backlog.md", projectSlug: "alpha", title: "Backlog" },
      ],
      tasks: [
        {
          project: "beta",
          milestoneName: "projects/beta/milestones/m1.md",
          milestoneDisplayId: "M1",
        },
      ],
    });

    expect(hooks.peopleForDisplay(registry, "Janie").map((person) => person.id)).toEqual(["jdoe"]);
    expect(hooks.peopleForDisplay(registry, "core-platform").map((person) => person.id)).toEqual(["jdoe"]);
    expect(hooks.teamsForDisplay(registry, "Jane").map((team) => team.id)).toEqual(["platform"]);
    expect(hooks.teamSuggestionOptions("core").map((team) => team.value)).toEqual(["platform"]);
    expect(hooks.resolveTeamIdsFromCsv("Platform Team, platform-team, unknown")).toEqual(["platform", "platform", "unknown"]);
    expect(hooks.projectSuggestionOptions().map((project) => project.value)).toEqual(["alpha", "beta", "gamma"]);
    expect(hooks.milestoneSuggestionOptions().map((milestone) => milestone.value)).toEqual([
      "projects/alpha/milestones/backlog.md",
      "projects/beta/milestones/m1.md",
    ]);
  });

  it("groups tasks by project while sorting each group by due date", () => {
    const hooks = loadHooks();
    const tasks = [
      {
        taskId: "T-3",
        taskTitle: "Later beta",
        project: "beta",
        milestoneName: "projects/beta/milestones/backlog.md",
        due: "2026-08-15",
      },
      {
        taskId: "T-1",
        taskTitle: "No due alpha",
        project: "alpha",
        milestoneName: "projects/alpha/milestones/backlog.md",
      },
      {
        taskId: "T-2",
        taskTitle: "Soon alpha",
        project: "alpha",
        milestoneName: "projects/alpha/milestones/backlog.md",
        due: "2026-06-20",
      },
      {
        taskId: "T-4",
        taskTitle: "Unscoped",
        milestoneName: "shared/misc.md",
        due: "2026-06-18",
      },
    ];

    const groups = hooks.taskGroupsForDisplay(tasks, "project", "dueAsc", "2026-06-17", "2026-07-01");

    expect(groups.map((group) => group.label)).toEqual(["alpha", "beta", "No project"]);
    expect(groups.map((group) => group.key)).toEqual(["project:alpha", "project:beta", "project:No project"]);
    expect(groups[0]?.tasks.map((task) => task.taskId)).toEqual(["T-2", "T-1"]);
    expect(groups[1]?.tasks.map((task) => task.taskId)).toEqual(["T-3"]);
    expect(groups[2]?.tasks.map((task) => task.taskId)).toEqual(["T-4"]);
  });

  it("carries project priority into project task groups", () => {
    const hooks = loadHooks();
    const groups = hooks.taskGroupsForDisplay(
      [
        { taskId: "T-1", taskTitle: "First", project: "alpha", milestoneName: "m1", projectPriority: 2.045 },
        { taskId: "T-2", taskTitle: "Second", project: "alpha", milestoneName: "m1", projectPriority: 1.1 },
        { taskId: "T-3", taskTitle: "Third", project: "beta", milestoneName: "m2" },
      ],
      "project",
      "dueAsc",
      "2026-06-17",
      "2026-07-01",
    );

    expect(hooks.priorityLabel(groups[0]?.projectPriority as number)).toBe("P1.1");
    expect(Number.isNaN(groups[1]?.projectPriority as number)).toBe(true);
    expect(hooks.taskProjectPriority({ projectPriority: 2.045 })).toBe(2.045);
    expect(Number.isNaN(hooks.taskProjectPriority({}))).toBe(true);
    expect(hooks.taskPriority({ taskPriority: 3 })).toBe(3);
    expect(hooks.taskPriority({ priority: 4 })).toBe(4);
    expect(Number.isNaN(hooks.taskPriority({}))).toBe(true);
  });

  it("sorts tasks by project priority, task priority, project name, and last modified date", () => {
    const hooks = loadHooks();
    const tasks = [
      {
        taskId: "T-1",
        taskTitle: "Beta older",
        project: "beta",
        milestoneName: "projects/beta/milestones/backlog.md",
        projectPriority: 2,
        taskPriority: 4,
        milestoneUpdatedAt: "2026-06-10T10:00:00.000Z",
      },
      {
        taskId: "T-2",
        taskTitle: "Alpha newest",
        project: "alpha",
        milestoneName: "projects/alpha/milestones/backlog.md",
        projectPriority: 1,
        taskPriority: 3,
        milestoneUpdatedAt: "2026-06-20T10:00:00.000Z",
      },
      {
        taskId: "T-3",
        taskTitle: "Gamma urgent",
        project: "gamma",
        milestoneName: "projects/gamma/milestones/backlog.md",
        taskPriority: 1,
        milestoneUpdatedAt: "2026-06-15T10:00:00.000Z",
      },
    ];

    expect(hooks.sortTasksForDisplay(tasks, "projectPriority").map((task) => task.taskId)).toEqual([
      "T-2",
      "T-1",
      "T-3",
    ]);
    expect(hooks.sortTasksForDisplay(tasks, "taskPriority").map((task) => task.taskId)).toEqual([
      "T-3",
      "T-2",
      "T-1",
    ]);
    expect(hooks.sortTasksForDisplay(tasks, "projectName").map((task) => task.taskId)).toEqual([
      "T-2",
      "T-1",
      "T-3",
    ]);
    expect(hooks.sortTasksForDisplay(tasks, "modifiedDesc").map((task) => task.taskId)).toEqual([
      "T-2",
      "T-3",
      "T-1",
    ]);
  });

  it("computes task report windows and color state classes", () => {
    const hooks = loadHooks();

    expect(hooks.taskReportRanges("7", "14", "2026-06-18")).toEqual({
      completedDays: 7,
      dueDays: 14,
      completedAfter: "2026-06-11",
      completedBefore: "2026-06-19",
      dueAfter: "2026-06-18",
      dueBefore: "2026-07-03",
    });
    expect(hooks.taskStateClass({ taskStatus: "done", due: "2026-06-01" }, "2026-06-18")).toBe(
      "task-state-completed",
    );
    expect(hooks.taskStateClass({ taskStatus: "active", due: "2026-06-01" }, "2026-06-18")).toBe(
      "task-state-overdue",
    );
    expect(hooks.taskStateClass({ taskStatus: "blocked", due: "2026-06-20" }, "2026-06-18")).toBe(
      "task-state-blocked",
    );
    expect(hooks.taskStateClass({ taskStatus: "todo", due: "2026-06-20" }, "2026-06-18")).toBe("");
  });

  it("reverses due buckets when task sort is descending", () => {
    const hooks = loadHooks();
    const groups = hooks.taskGroupsForDisplay(
      [
        { taskId: "T-1", taskTitle: "Past", milestoneName: "m1", due: "2026-06-01" },
        { taskId: "T-2", taskTitle: "Soon", milestoneName: "m1", due: "2026-06-20" },
        { taskId: "T-3", taskTitle: "Later", milestoneName: "m1", due: "2026-08-15" },
        { taskId: "T-4", taskTitle: "No due", milestoneName: "m1" },
      ],
      "due",
      "dueDesc",
      "2026-06-17",
      "2026-07-01",
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Upcoming",
      "Due within 14 days",
      "Overdue",
      "No due date",
    ]);
    expect(groups.flatMap((group) => group.tasks.map((task) => task.taskId))).toEqual(["T-3", "T-2", "T-1", "T-4"]);
  });

  it("includes field editing, history, and proposal review surfaces without the edit composer", () => {
    expect(UI_HTML).toContain('data-tab="review"');
    expect(UI_HTML).toContain('id="proposal-list"');
    expect(UI_HTML).toContain('id="proposal-preview"');
    expect(UI_HTML).not.toContain('data-tab="claims"');
    expect(UI_HTML).not.toContain('id="claims-view"');
    expect(UI_HTML).not.toContain('id="claims-project-filter"');
    expect(UI_HTML).not.toContain("Edit Composer");
    expect(UI_HTML).not.toContain('id="edit-form"');
    expect(UI_HTML).not.toContain('id="stage-proposal"');
    expect(UI_HTML).not.toContain('id="commit-direct"');
    expect(UI_HTML).toContain('id="load-history"');
    expect(UI_HTML).toContain('id="rename-anchor"');
    expect(UI_HTML).toContain('id="delete-anchor"');
    expect(UI_HTML).toContain('id="priority-form"');
    expect(UI_HTML).toContain('class="priority-form"');
    expect(UI_HTML).toContain('id="priority-input" type="text" inputmode="decimal" pattern="[0-9.]*"');
    expect(UI_HTML).not.toContain('id="clear-priority"');
    expect(UI_HTML).not.toContain('id="priority-result"');
    expect(UI_HTML).not.toContain("Set a numeric priority such as 1, 1.1, or 2.045.");
    expect(UI_HTML.indexOf('class="detail-mode-row"')).toBeGreaterThan(UI_HTML.indexOf('class="detail-grid"'));
    expect(UI_HTML.indexOf('class="detail-mode-row"')).toBeLessThan(UI_HTML.indexOf('id="detail-tasks"'));
    expect(UI_HTML.indexOf('id="history-actions"')).toBeGreaterThan(UI_HTML.indexOf('id="detail-frontmatter"'));
    expect(UI_CSS).toContain(".detail-mode-row");
    expect(UI_CSS).toContain(".priority-form");
    expect(UI_CSS).toContain("#priority-input");
    expect(UI_HTML).toContain('<option value="priority">Priority</option>');
    expect(UI_JS).toContain("/api/ui/proposed-change-apply");
    expect(UI_JS).toContain("updateProposalFromMutationResult(result)");
    expect(UI_JS).not.toContain("await selectAnchor(state.selectedName");
    expect(UI_JS).toContain("/api/ui/project-priority");
    expect(UI_JS).toContain("sanitizeProjectPriorityInput");
    expect(UI_JS).toContain("replace(/[^0-9.]/g, \"\")");
    expect(UI_JS).toContain("/api/ui/anchor-versions");
    expect(UI_JS).toContain("/api/ui/anchor-delete");
  });

  it("marks built-in server rules as read-only in the detail editor", () => {
    const hooks = loadHooks();

    expect(UI_HTML).toContain('id="detail-readonly-note"');
    expect(UI_CSS).toContain(".badge.readonly");
    expect(UI_CSS).toContain(".read-only-anchor");
    expect(UI_JS).toContain("Read-only server rule");
    expect(UI_JS).toContain("assertMutableAnchor(anchor");

    expect(hooks.isServerRuleAnchor("server-rules/acceptance-criteria.md")).toBe(true);
    expect(hooks.isServerRuleAnchor({ name: "server-rules/milestone-usage.md" })).toBe(true);
    expect(hooks.isServerRuleAnchor({ name: "shared/server-rules.md", origin: "built-in" })).toBe(true);
    expect(hooks.isServerRuleAnchor({ name: "projects/demo/demo.md", origin: "repo" })).toBe(false);
    expect(hooks.readOnlyDetailControlIds()).toEqual(
      expect.arrayContaining([
        "rename-anchor",
        "delete-anchor",
      ]),
    );
    expect(hooks.readOnlyDetailControlIds()).toContain("priority-input");
    expect(hooks.readOnlyDetailControlIds()).toContain("update-priority");
    expect(hooks.readOnlyDetailControlIds()).not.toContain("clear-priority");
    expect(hooks.readOnlyDetailControlIds()).not.toContain("load-history");
    expect(hooks.readOnlyDetailControlIds()).not.toContain("edit-operation");
    expect(hooks.readOnlyDetailControlIds()).not.toContain("stage-proposal");
    expect(hooks.readOnlyDetailControlIds()).not.toContain("commit-direct");
  });

  it("keeps mutated proposals visible and updates their status in place", () => {
    const hooks = loadHooks();

    expect(
      hooks.proposalListWithUpdatedProposal(
        [{ id: "PC-1", status: "pending", summary: "Old" }],
        { id: "PC-1", status: "applied", summary: "Old" },
      ),
    ).toEqual([{ id: "PC-1", status: "applied", summary: "Old" }]);

    expect(
      hooks.proposalListWithUpdatedProposal([], { id: "PC-2", status: "applied", summary: "Inserted" }),
    ).toEqual([{ id: "PC-2", status: "applied", summary: "Inserted" }]);
  });

  it("renders numeric priorities as project badges", () => {
    const hooks = loadHooks();
    const row = hooks.renderAnchorRow({
      name: "projects/demo/demo.md",
      category: "projects",
      project: ["demo"],
      priority: 2.045,
      summary: "Demo",
      ui: { label: "Demo", health: { status: "ok" } },
    });
    const group = hooks.renderAnchorGroup({
      key: "project:demo",
      label: "demo",
      anchors: [
        {
          name: "projects/demo/demo.md",
          priority: 2.045,
          ui: { label: "Demo", health: { status: "ok" } },
        },
      ],
    });

    expect(hooks.priorityLabel(2.045)).toBe("P2.045");
    expect(row).toContain("P2.045");
    expect(group).toContain("P2.045");
  });

  it("reads project metadata from selected anchor detail front matter", () => {
    const hooks = loadHooks();

    expect(
      hooks.projectOf({
        name: "projects/demo/demo.md",
        frontmatter: { project: ["demo"] },
      }),
    ).toBe("demo");
  });

  it("requests anchor list batches with explicit limit and offset", () => {
    expect(UI_JS).toContain('params.set("limit", String(ANCHOR_BATCH_SIZE));');
    expect(UI_JS).toContain('params.set("offset", String(offset));');
    expect(UI_JS).toContain("response.nextOffset");
  });

  it("formats proposed-change previews with operation contents", () => {
    const hooks = loadHooks();
    const preview = hooks.formatPreview({
      proposal: {
        id: "PC-20260608-demo",
        status: "pending",
        target: "projects/demo/demo.md",
        ledgerName: "projects/demo/demo-proposed-changes.md",
        summary: "Add deployment fact",
        rationale: "The anchor is missing current deployment state.",
        operations: [
          {
            type: "section.append",
            heading: "Current State",
            content: "- Deployment is currently manual.",
            lastValidated: "2026-06-08",
          },
        ],
      },
      targetExists: true,
      stale: false,
      requiresApproval: false,
      warnings: [{ severity: "WARN", code: "example_warning", message: "Example warning." }],
      diff: "@@ -1 +1\\n+ - Deployment is currently manual.",
    });

    expect(preview).toContain("Summary\nAdd deployment fact");
    expect(preview).toContain("Rationale\nThe anchor is missing current deployment state.");
    expect(preview).toContain("Append to section \"Current State\"");
    expect(preview).toContain("Content:\n     - Deployment is currently manual.");
    expect(preview).toContain("[WARN] example_warning");
    expect(preview).toContain("Diff\n@@ -1 +1");
  });

  it("persists bearer tokens in localStorage for same-origin tabs", () => {
    const sharedLocalStorage = createStorage();
    const firstTab = loadHooks({ localStorage: sharedLocalStorage });
    firstTab.saveToken(" test-token ");

    const secondTab = loadHooks({ localStorage: sharedLocalStorage });

    expect(secondTab.token()).toBe("test-token");
  });

  it("migrates existing session bearer tokens to localStorage", () => {
    const localStorage = createStorage();
    const sessionStorage = createStorage({ "anchor-mcp-token": "old-session-token" });
    const hooks = loadHooks({ localStorage, sessionStorage });

    expect(hooks.token()).toBe("old-session-token");
    expect(localStorage.getItem("anchor-mcp-token")).toBe("old-session-token");
  });

  it("does not apply inline-code highlighting inside fenced code blocks", () => {
    expect(UI_CSS).toContain(".markdown pre code");
    expect(UI_CSS).toContain("background: transparent");
    expect(UI_CSS).toContain("color: inherit");
  });

  it("renders markdown pipe tables", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "| Marker | Symbol | File | Line |\n"
        + "|--------|--------|------|------|\n"
        + "| 1 | `NodeScope.__init__` | `app/hub_platform/rql_v2/translation/containers.py` | ~380 |",
    );

    expect(html).toContain('<div class="markdown-table-scroll"><table>');
    expect(html).toContain("<th>Marker</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<td><code>NodeScope.__init__</code></td>");
    expect(html).toContain("<td>~380</td>");
  });

  it("renders mermaid fences as diagram blocks and invokes the Mermaid runtime", async () => {
    const initialize = vi.fn();
    const run = vi.fn(async () => undefined);
    const hooks = loadHooks({ mermaid: { initialize, run } });
    const html = hooks.renderMarkdown("```mermaid\nflowchart TD\nA --> B\n```");
    const block = { classList: { add: vi.fn() }, title: "" };

    expect(html).toContain('<div class="mermaid">flowchart TD\nA --&gt; B</div>');
    expect(html).not.toContain("<pre><code>flowchart TD");

    await hooks.renderMermaidDiagrams({
      querySelectorAll: (selector: string) => (selector === ".mermaid" ? [block] : []),
    });

    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "default",
    });
    expect(run).toHaveBeenCalledWith({ nodes: [block], suppressErrors: true });
  });

  it("neutralizes unsafe markdown link schemes", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "[bad](javascript:alert(1)) [data](data:text/html,pwn) [protocol](//example.test) [ok](https://example.test) [mail](mailto:a@example.test) [rel](projects/demo/demo.md)",
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).not.toContain('href="//example.test');
    expect(html).toContain("Unsafe link removed");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('href="mailto:a@example.test"');
    expect(html).toContain('href="projects/demo/demo.md"');
  });

  it("treats quote-bearing markdown href values as unsafe", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown('[quoted](https://example.test/a" onclick="steal")');

    expect(html).toContain("Unsafe link removed");
    expect(html).not.toContain('<a href="https://example.test/a" onclick="steal"');
    expect(html).not.toContain("onclick=");
  });

  it("links mapped repo file references in rendered prose", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState(
      [{ name: "projects/udf-framework/udf.md", projectSlug: "udf-framework" }],
      {
        projects: [
          {
            project: "udf-framework",
            repos: [
              {
                repo: "rippling-main",
                paths: ["app/hub_platform"],
                web: { url: "https://github.com/Rippling/rippling-main", branch: "master" },
              },
            ],
          },
        ],
      },
    );

    const html = hooks.renderMarkdown(
      "Typed vtables are dynamic models (app/hub_platform/rql/docs/translation/vtables.md:5-22).",
    );

    expect(html).toContain(
      'href="https://github.com/Rippling/rippling-main/blob/master/app/hub_platform/rql/docs/translation/vtables.md#L5-L22"',
    );
    expect(html).toContain(">app/hub_platform/rql/docs/translation/vtables.md:5-22</a>");
  });

  it("links mapped repo file references inside inline code spans", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState(
      [{ name: "projects/udf-framework/udf.md", projectSlug: "udf-framework" }],
      {
        projects: [
          {
            project: "udf-framework",
            repos: [
              {
                repo: "rippling-main",
                paths: ["app"],
                web: { url: "https://github.com/Rippling/rippling-main", branch: "master" },
              },
            ],
          },
        ],
      },
    );

    const html = hooks.renderMarkdown(
      "Typed vtables are dynamic models (`app/hub_platform/rql/docs/translation/vtables.md:5-22`).",
    );

    expect(html).toContain(
      'href="https://github.com/Rippling/rippling-main/blob/master/app/hub_platform/rql/docs/translation/vtables.md#L5-L22"',
    );
    expect(html).toContain("<code>app/hub_platform/rql/docs/translation/vtables.md:5-22</code></a>");
  });

  it("links Google Docs, configured Confluence and Slack references, and mapped PRs in prose", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState(
      [{ name: "projects/reporting/context.md", projectSlug: "reporting" }],
      {
        externalLinkTemplates: {
          confluencePage: "https://acme.atlassian.net/wiki/spaces/{space}/pages/{pageId}",
          slackChannel: "https://acme.slack.com/archives/{channel}",
        },
        projects: [
          {
            project: "reporting",
            repos: [{ repo: "main", paths: [], web: { url: "https://github.com/acme/main" } }],
          },
        ],
      },
    );

    const html = hooks.renderMarkdown(
      'Google Doc "Removing Current Balance From Reports V1" (doc id 1s9cR-JFozYQzs0LGqnd4oOnn-Bp4-TY2fpnUsGdTFoo). '
      + 'Confluence PLATFORM/pages/6251708783. PR #526011. #inc-2026-07-01-current-balance-recipe-is-broken.',
    );

    expect(html).toContain('href="https://docs.google.com/document/d/1s9cR-JFozYQzs0LGqnd4oOnn-Bp4-TY2fpnUsGdTFoo/edit"');
    expect(html).toContain('href="https://acme.atlassian.net/wiki/spaces/PLATFORM/pages/6251708783"');
    expect(html).toContain('href="https://github.com/acme/main/pull/526011"');
    expect(html).toContain('href="https://acme.slack.com/archives/inc-2026-07-01-current-balance-recipe-is-broken"');
  });

  it("does not link external references through an unsafe configured template", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState(
      [{ name: "projects/reporting/context.md", projectSlug: "reporting" }],
      { externalLinkTemplates: { slackChannel: "javascript:alert({channel})" }, projects: [] },
    );

    const html = hooks.renderMarkdown("The incident is #inc-6191.");

    expect(html).not.toContain("javascript:");
    expect(html).toContain("#inc-6191");
  });

  it("links Slack channel names through Slack's default deep-link endpoint", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState([{ name: "projects/reporting/context.md", projectSlug: "reporting" }], { projects: [] });

    const html = hooks.renderMarkdown("The incident is #inc-6191.");

    expect(html).toContain('href="https://slack.com/app_redirect?channel=inc-6191"');
  });

  it("preserves encoded URL query parameters and does not treat URL fragments as Slack channels", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState([{ name: "projects/reporting/context.md", projectSlug: "reporting" }], { projects: [] });

    const html = hooks.renderMarkdown("See https://example.test/report?one=1&two=2#incident and #inc-6191.");

    expect(html).toContain('href="https://example.test/report?one=1&amp;two=2#incident"');
    expect(html).not.toContain("amp;amp;");
    expect(html).not.toContain('https://slack.com/app_redirect?channel=incident');
    expect(html).toContain('href="https://slack.com/app_redirect?channel=inc-6191"');
  });

  it("does not link repo file references when mappings are ambiguous", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState(
      [{ name: "projects/demo/demo.md", projectSlug: "demo" }],
      {
        projects: [
          {
            project: "demo",
            repos: [
              { repo: "one", paths: [], web: { url: "https://github.com/acme/one" } },
              { repo: "two", paths: [], web: { url: "https://github.com/acme/two" } },
            ],
          },
        ],
      },
    );

    const html = hooks.renderMarkdown("See app/service/file.ts:10.");

    expect(html).toContain("app/service/file.ts:10");
    expect(html).not.toContain("github.com/acme");
  });

  it("renders claim epistemology controls while hiding source annotation lines", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "## Current State\n\n- Claim text.\n  {src: PR #42; observed: 2026-07-08; conf: high}",
      {
        claimControls: true,
        lineOffset: 0,
        claims: [
          {
            anchor: "projects/demo/demo.md",
            line: 3,
            section: "Current State",
            text: "Claim text.",
            status: "annotated",
            strength: "high",
            sources: [{ src: "PR #42", observed: "2026-07-08", conf: "high", line: 4 }],
          },
        ],
      },
    );

    expect(html).toContain('use href="#icon-object-graph"');
    expect(html).toContain('use href="#icon-pencil"');
    expect(html).toContain('<li><span class="claim-inline"><span class="claim-epistemology">');
    expect(html).toContain('class="claim-text-edit-button"');
    expect(html).toContain("Claim text.");
    expect(html).toContain("Claim justification strength: high");
    expect(html).not.toContain("{src:");
  });

  it("renders edit controls for tl-dr and question bullets without claim provenance controls", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "## tl-dr\n\n"
        + "- Summary bullet.\n\n"
        + "## Open Questions\n\n"
        + "- [ ] Q-1: Should questions be editable?\n\n"
        + "## PRs\n\n"
        + "- [PR Demo - #1](https://github.com/example/repo/pull/1)",
      {
        claimControls: true,
        lineOffset: 0,
        questions: [
          {
            anchor: "projects/demo/demo.md",
            line: 7,
            section: "Open Questions",
            text: "Should questions be editable?",
            status: "open",
            id: "Q-1",
          },
        ],
      },
    );

    expect(html).toContain('class="bullet-text-edit-button" data-bullet-line="3" data-bullet-kind="bullet"');
    expect(html).toContain('data-bullet-line="7" data-bullet-kind="question"');
    expect(html).not.toContain('data-bullet-line="11"');
    expect(html).not.toContain('class="claim-epistemology-button');
  });

  it("does not render tl-dr edit controls for asterisk bullets or bullets after a top-level heading", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "## tl-dr\n\n"
        + "* Summary bullet.\n\n"
        + "# Next\n\n"
        + "- Not a tl-dr bullet.",
      {
        claimControls: true,
        lineOffset: 0,
      },
    );

    expect(html).not.toContain('data-bullet-line="3" data-bullet-kind="bullet"');
    expect(html).not.toContain('data-bullet-line="7" data-bullet-kind="bullet"');
  });

  it("treats indented tilde fences as code blocks for rendered bullets", () => {
    const hooks = loadHooks();
    const html = hooks.renderMarkdown(
      "## tl-dr\n\n"
        + "  ~~~markdown\n"
        + "  - Hidden fenced bullet.\n"
        + "  ~~~",
      {
        claimControls: true,
        lineOffset: 0,
      },
    );

    expect(html).toContain("<pre><code>  - Hidden fenced bullet.</code></pre>");
    expect(html).not.toContain('data-bullet-line="4" data-bullet-kind="bullet"');
  });

  it("rejects obfuscated unsafe link protocols", () => {
    const hooks = loadHooks();

    expect(hooks.sanitizeLinkHref("java\nscript:alert(1)")).toBeNull();
    expect(hooks.sanitizeLinkHref(" data:text/html,pwn")).toBeNull();
    expect(hooks.sanitizeLinkHref("https://example.test/path")).toBe("https://example.test/path");
  });

  it("builds and reads durable anchor query links", () => {
    const hooks = loadHooks({ search: "?anchor=server-rules%2Facceptance-criteria.md" });

    expect(hooks.anchorHref("server-rules/acceptance-criteria.md")).toBe(
      "?anchor=server-rules%2Facceptance-criteria.md",
    );
    expect(hooks.readAnchorFromLocation()).toBe("server-rules/acceptance-criteria.md");
  });

  it("preserves current filter and sort params in durable anchor links", () => {
    const hooks = loadHooks({ search: "?project=demo&sort=name&view=planner" });

    expect(hooks.anchorHref("projects/demo/demo.md")).toBe(
      "?anchor=projects%2Fdemo%2Fdemo.md&project=demo&sort=name",
    );
  });

  it("clears the anchor query when returning to context root", () => {
    const historyUpdates: string[] = [];
    const hooks = loadHooks({
      search: "?project=demo&anchor=projects%2Fdemo%2Fdemo.md",
      historyUpdates,
    });

    hooks.clearAnchorLocation();

    expect(historyUpdates).toEqual(["/ui?project=demo"]);
  });

  it("restores the selected-anchor route when returning to detail", () => {
    const historyUpdates: string[] = [];
    const hooks = loadHooks({ historyUpdates });

    hooks.showSelectedAnchor();
    expect(historyUpdates).toEqual([]);

    hooks.setSelectedNameForTest("projects/demo/demo.md");
    hooks.showSelectedAnchor();
    expect(historyUpdates).toEqual(["/ui?anchor=projects%2Fdemo%2Fdemo.md"]);
  });

  it("still reads legacy hash anchor links", () => {
    const hooks = loadHooks({ hash: "#anchor=projects%2Fdemo%2Fdemo.md" });

    expect(hooks.readAnchorFromLocation()).toBe("projects/demo/demo.md");
  });

  it("renders anchor list rows as durable links", () => {
    const hooks = loadHooks();
    const html = hooks.renderAnchorRow({
      name: "projects/demo/demo.md",
      category: "projects",
      projectSlug: "demo",
      summary: "Demo anchor summary.",
      ui: {
        label: "Demo Anchor",
        health: { status: "ok" },
      },
    });

    expect(html).toContain('<a class="anchor-row" href="?anchor=projects%2Fdemo%2Fdemo.md"');
    expect(html).toContain('<use href="#icon-anchor"></use>');
    expect(html).toContain('data-name="projects/demo/demo.md"');
    expect(html).not.toContain("<button");
  });

  it("renders sidebar project groups as closed disclosure controls by default", () => {
    const hooks = loadHooks();
    const html = hooks.renderAnchorGroup({
      key: "project:anchor-mcp",
      label: "anchor-mcp",
      anchors: [
        {
          name: "projects/anchor-mcp/anchor-mcp-roadmap.md",
          category: "projects",
          projectSlug: "anchor-mcp",
          summary: "Roadmap summary.",
          ui: {
            label: "Anchor MCP Roadmap",
            health: { status: "ok" },
          },
        },
      ],
    });

    expect(html).toContain('<details class="anchor-group" data-group-key="project:anchor-mcp">');
    expect(html).toContain('<summary class="anchor-group-title">');
    expect(html).toContain('<span class="anchor-group-label">anchor-mcp</span>');
    expect(html).toContain('<span class="anchor-group-count">1</span>');
    expect(html).not.toContain(" open>");
    expect(UI_CSS).toContain(".anchor-group-title::before");
  });

  it("includes project group sort controls", () => {
    expect(UI_HTML).toContain('id="anchor-group-sort"');
    expect(UI_HTML).toContain('<option value="priority">Priority</option>');
    expect(UI_HTML).toContain('<option value="name">Project name</option>');
    expect(UI_HTML).toContain('<option value="updated">Last update</option>');
    expect(UI_HTML).toContain('<option value="created">Created date</option>');
  });

  it("sorts sidebar project groups by name, last update, or created date", () => {
    const hooks = loadHooks();
    const groups = [
      {
        key: "project:zeta",
        label: "zeta",
        anchors: [
          { updatedAt: "2026-05-20T10:00:00.000Z", createdAt: "2026-05-01T10:00:00.000Z" },
          { updatedAt: "2026-05-21T10:00:00.000Z", createdAt: "2026-05-03T10:00:00.000Z" },
        ],
      },
      {
        key: "project:alpha",
        label: "alpha",
        anchors: [{ updatedAt: "2026-05-24T10:00:00.000Z", createdAt: "2026-05-10T10:00:00.000Z" }],
      },
      {
        key: "project:middle",
        label: "middle",
        anchors: [{ updatedAt: "2026-05-22T10:00:00.000Z", createdAt: "2026-05-18T10:00:00.000Z" }],
      },
    ];

    hooks.setAnchorGroupSortForTest("name");
    expect(hooks.sortAnchorGroups(groups).map((group) => group.label)).toEqual(["alpha", "middle", "zeta"]);

    hooks.setAnchorGroupSortForTest("updated");
    expect(hooks.sortAnchorGroups(groups).map((group) => group.label)).toEqual(["alpha", "middle", "zeta"]);

    hooks.setAnchorGroupSortForTest("created");
    expect(hooks.sortAnchorGroups(groups).map((group) => group.label)).toEqual(["middle", "alpha", "zeta"]);
  });

  it("defaults sidebar project groups to priority sort", () => {
    const hooks = loadHooks();
    const groups = [
      {
        key: "project:zeta",
        label: "zeta",
        anchors: [{ priority: 2, updatedAt: "2026-05-20T10:00:00.000Z" }],
      },
      {
        key: "project:alpha",
        label: "alpha",
        anchors: [{ priority: 1, updatedAt: "2026-05-24T10:00:00.000Z" }],
      },
    ];

    expect(hooks.sortAnchorGroups(groups).map((group) => group.label)).toEqual(["alpha", "zeta"]);
  });

  it("does not use last_validated as a created date fallback when sorting groups", () => {
    const hooks = loadHooks();
    const groups = [
      {
        key: "project:missing-created",
        label: "missing-created",
        anchors: [{ last_validated: "2026-05-24" }],
      },
      {
        key: "project:created",
        label: "created",
        anchors: [{ createdAt: "2026-05-01T10:00:00.000Z" }],
      },
    ];

    hooks.setAnchorGroupSortForTest("created");
    expect(hooks.sortAnchorGroups(groups).map((group) => group.label)).toEqual(["created", "missing-created"]);
  });

  it("renders planner items with escaped reasons and raw score data", () => {
    const hooks = loadHooks();
    const html = hooks.renderPlannerItem({
      name: "projects/demo/demo.md",
      title: "<Demo>",
      score: 42,
      estimatedTokens: 18,
      matchedTerms: ["demo", "planner"],
      reason: 'project matches "demo" <script>',
    });

    expect(html).toContain("&lt;Demo&gt;");
    expect(html).toContain("score 42");
    expect(html).toContain("project matches &quot;demo&quot; &lt;script&gt;");
    expect(html).toContain("Matched: demo, planner | Tokens: 18");
  });

  it("compares planner runs by included, excluded, and token changes", () => {
    const hooks = loadHooks();
    const diff = hooks.comparePlannerRuns(
      {
        included: [{ name: "projects/demo/demo.md" }, { name: "shared/planner.md" }],
        excluded: [{ name: "projects/other/other.md" }],
        estimatedTokens: 140,
      },
      {
        included: [{ name: "projects/demo/demo.md" }],
        excluded: [{ name: "shared/planner.md" }],
        estimatedTokens: 100,
      },
    );

    expect(diff).toEqual({
      includedAdded: ["shared/planner.md"],
      includedRemoved: [],
      excludedAdded: ["projects/other/other.md"],
      excludedRemoved: ["shared/planner.md"],
      tokenDelta: 40,
    });
  });

  it("extracts planner inputs from a pasted planContextBundle request-log line", () => {
    const hooks = loadHooks();
    const logLine = JSON.stringify({
      argumentRedaction: "none",
      arguments: {
        includeArchive: false,
        project: "anchor-mcp",
        task: "Explain how to derive a Context Bundle Planner task input from request logs.",
        budgetTokens: 4000,
        maxAnchors: 12,
      },
      durationMs: 502,
      isError: false,
      level: "info",
      log: "requests",
      message: "mcp tool call",
      outcome: "success",
      service: "anchor-mcp",
      timestamp: "2026-05-24T22:16:55.820Z",
      toolName: "planContextBundle",
    });

    const parsed = hooks.parsePlannerLogPaste(logLine);

    expect(parsed).toEqual({
      task: "Explain how to derive a Context Bundle Planner task input from request logs.",
      project: "anchor-mcp",
      includeArchive: false,
      budgetTokens: 4000,
      maxAnchors: 12,
    });
  });

  it("accepts a bare planner-arguments object pasted directly", () => {
    const hooks = loadHooks();
    const parsed = hooks.parsePlannerLogPaste(
      JSON.stringify({
        task: "Update planner UI",
        project: "anchor-mcp",
        runtime: "node",
        maxExcluded: 20,
      }),
    );

    expect(parsed).toEqual({
      task: "Update planner UI",
      project: "anchor-mcp",
      runtime: "node",
      maxExcluded: 20,
    });
  });

  it("does not intercept plain task descriptions or non-object JSON", () => {
    const hooks = loadHooks();

    expect(hooks.parsePlannerLogPaste("Update anchor-mcp planning context")).toBeNull();
    expect(hooks.parsePlannerLogPaste("")).toBeNull();
    expect(hooks.parsePlannerLogPaste('"just a json string"')).toBeNull();
    expect(hooks.parsePlannerLogPaste("42")).toBeNull();
    expect(hooks.parsePlannerLogPaste("[1, 2, 3]")).toBeNull();
    expect(hooks.parsePlannerLogPaste("{ not valid json")).toBeNull();
    expect(hooks.parsePlannerLogPaste(undefined)).toBeNull();
  });

  it("does not intercept log lines from tools other than planContextBundle", () => {
    const hooks = loadHooks();
    const readAnchorLog = JSON.stringify({
      arguments: { name: "projects/anchor-mcp/anchor-mcp-project-context.md" },
      durationMs: 29,
      isError: false,
      level: "info",
      log: "requests",
      message: "mcp tool call",
      outcome: "success",
      service: "anchor-mcp",
      timestamp: "2026-05-24T22:13:55.617Z",
      toolName: "readAnchor",
    });

    expect(hooks.parsePlannerLogPaste(readAnchorLog)).toBeNull();
  });

  it("ignores planner fields with the wrong runtime type", () => {
    const hooks = loadHooks();
    const parsed = hooks.parsePlannerLogPaste(
      JSON.stringify({
        arguments: {
          task: "Plan something",
          project: 7,
          includeArchive: "true",
          budgetTokens: "4000",
          tag: "",
        },
      }),
    );

    expect(parsed).toEqual({ task: "Plan something" });
  });

  it("wires the paste handler and parser into the planner task box", () => {
    expect(UI_JS).toContain("parsePlannerLogPaste");
    expect(UI_JS).toContain("applyPlannerLogPaste");
    expect(UI_JS).toContain('el("planner-task").addEventListener("paste"');
    expect(UI_JS).toContain("Loaded planner inputs from pasted log line.");
    expect(UI_HTML).toContain("Paste a request-log JSON line to auto-fill");
  });

  it("parses and trims repo and filePaths from a pasted planner-arguments object", () => {
    const hooks = loadHooks();
    const parsed = hooks.parsePlannerLogPaste(
      JSON.stringify({
        task: "Trace a failing charge",
        repo: "  repo-alpha  ",
        filePaths: ["  services/payments/charge.ts ", "  ", 7, "services/payments/refund.ts"],
      }),
    );

    // Trimmed to match manual input, so pasted args don't break repo/path matches.
    expect(parsed).toEqual({
      task: "Trace a failing charge",
      repo: "repo-alpha",
      filePaths: ["services/payments/charge.ts", "services/payments/refund.ts"],
    });
  });

  it("serializes repo and repeated filePaths params from planner input", () => {
    const hooks = loadHooks();
    const query = hooks.queryFromPlannerInput({
      task: "Trace a failing charge",
      repo: "repo-alpha",
      filePaths: ["services/payments/charge.ts", "services/payments/refund.ts"],
    });
    const params = new URLSearchParams(query);

    expect(params.get("task")).toBe("Trace a failing charge");
    expect(params.get("repo")).toBe("repo-alpha");
    expect(params.getAll("filePaths")).toEqual([
      "services/payments/charge.ts",
      "services/payments/refund.ts",
    ]);
  });

  it("renders project resolution candidates, boosts, reasons, and unknown repos", () => {
    const hooks = loadHooks();
    const html = hooks.renderProjectResolution({
      candidates: [
        { project: "project-one", boost: 10, reasons: ['repo "repo-alpha" maps to project "project-one"'] },
      ],
      unknownRepo: undefined,
      explanations: [],
    });

    expect(html).toContain("project-one");
    expect(html).toContain("boost 10");
    expect(html).toContain("maps to project");

    const unknown = hooks.renderProjectResolution({ candidates: [], unknownRepo: "repo-unknown", explanations: [] });
    expect(unknown).toContain("repo-unknown");
    expect(unknown).toContain("not in the configured repo map");
  });

  it("summarizes candidate projects and unknown repos in the planner status", () => {
    const hooks = loadHooks();
    const status = hooks.formatPlannerStatus({
      generatedAt: "2026-06-20T00:00:00.000Z",
      totalCandidates: 5,
      projectResolution: {
        candidates: [
          { project: "project-one", boost: 10, reasons: [] },
          { project: "project-two", boost: 10, reasons: [] },
        ],
        explanations: [],
      },
    });
    expect(status).toContain("candidate projects project-one, project-two");

    const unknownStatus = hooks.formatPlannerStatus({
      generatedAt: "2026-06-20T00:00:00.000Z",
      totalCandidates: 5,
      projectResolution: { candidates: [], unknownRepo: "repo-unknown", explanations: [] },
    });
    expect(unknownStatus).toContain("unknown repo repo-unknown");
  });

  it("includes the repo mappings tab, controls, and list region", () => {
    expect(UI_HTML).toContain('data-tab="mappings"');
    expect(UI_HTML).toContain('id="mappings-view"');
    expect(UI_HTML).toContain('id="mappings-save"');
    expect(UI_HTML).toContain('id="mappings-refresh"');
    expect(UI_HTML).toContain('id="mappings-list"');
    expect(UI_HTML).toContain('id="claim-source-types-list"');
    expect(UI_HTML).toContain('id="claim-source-type-add"');
    // No free-text "Add Project": the project list is derived from anchors.
    expect(UI_HTML).not.toContain('id="mappings-add"');
    expect(UI_JS).toContain("/api/ui/project-mappings");
    expect(UI_JS).toContain("loadProjectMappings");
    expect(UI_JS).toContain("saveProjectMappings");
    expect(UI_JS).toContain("claimSourceTypes");
  });

  it("renders a managed project mapping card with a fixed slug and clear action", () => {
    const hooks = loadHooks();
    const html = hooks.mappingCardHtml(
      { project: "payments", repos: [{ repo: "repo-alpha", paths: ["services/payments", "libs/pay"] }] },
      0,
    );
    expect(html).toContain('data-project-index="0"');
    // The slug is fixed (data attribute + name span), not an editable input.
    expect(html).toContain('data-project="payments"');
    expect(html).toContain('class="mapping-project-name">payments</span>');
    expect(html).not.toContain('class="mapping-project"');
    expect(html).toContain('class="mapping-repo"');
    expect(html).toContain('value="repo-alpha"');
    expect(html).toContain("services/payments\nlibs/pay");
    expect(html).toContain("mapping-add-repo");
    expect(html).toContain("mapping-remove-repo");
    // Managed project with a mapping gets "Clear mapping", not "Remove".
    expect(html).toContain("mapping-clear");
    expect(html).not.toContain("mapping-remove-orphan");
  });

  it("renders web (file-link) inputs with stored values", () => {
    const hooks = loadHooks();
    const html = hooks.mappingCardHtml(
      {
        project: "payments",
        repos: [
          {
            repo: "repo-alpha",
            paths: [],
            web: { url: "https://github.com/owner/repo-alpha", branch: "main" },
          },
        ],
      },
      0,
    );
    expect(html).toContain("mapping-web-url");
    expect(html).toContain('value="https://github.com/owner/repo-alpha"');
    expect(html).toContain("mapping-web-branch");
    expect(html).toContain('value="main"');
    expect(html).toContain("mapping-web-template");
    expect(html).toContain("mapping-pr-template");
  });

  it("flags an orphaned mapping (no matching anchor) with a remove action", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState([{ projectSlug: "payments" }], { projects: [] });
    const html = hooks.mappingCardHtml({ project: "ghost", repos: [{ repo: "repo-x", paths: [] }] }, 0);
    expect(html).toContain('data-project="ghost"');
    expect(html).toContain("no matching anchor");
    expect(html).toContain("mapping-remove-orphan");
    expect(html).not.toContain("mapping-clear");
  });

  it("lists every managed project and separates orphaned mappings", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState(
      [{ projectSlug: "payments" }, { projectSlug: "reporting" }, { projectSlug: "billing" }],
      {
        projects: [
          { project: "payments", repos: [{ repo: "repo-alpha", paths: [] }] },
          { project: "ghost", repos: [{ repo: "repo-x", paths: [] }] },
        ],
      },
    );
    const display = hooks.mappingsForDisplay();
    expect(display.managed.map((p) => p.project).sort()).toEqual(["billing", "payments", "reporting"]);
    // The mapped project keeps its mapping; unmapped managed projects are empty.
    expect(display.managed.find((p) => p.project === "payments")?.repos).toHaveLength(1);
    expect(display.managed.find((p) => p.project === "reporting")?.repos).toEqual([]);
    // The mapping with no matching anchor is an orphan, not a managed project.
    expect(display.orphans.map((p) => p.project)).toEqual(["ghost"]);
  });

  it("renders a whole-repo mapping with empty paths", () => {
    const hooks = loadHooks();
    const html = hooks.mappingCardHtml({ project: "billing", repos: [{ repo: "repo-beta", paths: [] }] }, 1);
    expect(html).toContain('data-project-index="1"');
    expect(html).toContain('value="repo-beta"');
    // textarea is present but empty (whole-repo entry)
    expect(html).toContain('class="mapping-paths" rows="2" placeholder="services/payments"></textarea>');
  });

  it("renders the judge-prompt button in the planner UI", () => {
    expect(UI_HTML).toContain('id="copy-judge-prompt"');
    expect(UI_HTML).toContain("Copy as judge prompt");
    expect(UI_JS).toContain('el("copy-judge-prompt").addEventListener("click"');
    expect(UI_JS).toContain("Copied judge prompt for ");
  });

  it("builds a self-contained judge prompt with task, plan JSON, and anchor bodies", () => {
    const hooks = loadHooks();
    const plan = {
      task: "Update planner UI",
      totalCandidates: 5,
      budgetTokens: 4000,
      estimatedTokens: 1200,
      included: [{ name: "projects/demo/demo.md", score: 50 }],
      excluded: [{ name: "shared/other.md", score: 5 }],
      missingContext: ["a missing signal"],
      loadContext: {
        names: ["projects/demo/demo.md", "shared/other.md"],
        includeContent: "excerpt",
        maxBytes: 16000,
      },
    };
    const anchorBodies = {
      "projects/demo/demo.md": "Demo body content.",
      "shared/other.md": "Other body.",
    };

    const prompt = hooks.buildJudgePrompt(plan, anchorBodies);

    expect(prompt.startsWith("You are evaluating a deterministic context-bundle planner")).toBe(true);
    expect(prompt).toContain("# Task\n\nUpdate planner UI");
    expect(prompt).toContain('"task": "Update planner UI"');
    expect(prompt).toContain('"totalCandidates": 5');
    expect(prompt).toContain("## projects/demo/demo.md\n\nDemo body content.");
    expect(prompt).toContain("## shared/other.md\n\nOther body.");
    expect(prompt).toContain("# Your evaluation");
    expect(prompt).toContain('"precision_proxy":');
    expect(prompt).toContain('"overall_quality":');
  });

  it("writes (body not available) when an anchor body is missing", () => {
    const hooks = loadHooks();
    const plan = {
      task: "Inspect missing body",
      totalCandidates: 1,
      budgetTokens: 1000,
      estimatedTokens: 200,
      included: [{ name: "projects/demo/demo.md", score: 10 }],
      excluded: [],
      missingContext: [],
      loadContext: {
        names: ["projects/demo/demo.md"],
        includeContent: "excerpt",
        maxBytes: 8000,
      },
    };

    const prompt = hooks.buildJudgePrompt(plan, {});

    expect(prompt).toContain("## projects/demo/demo.md\n\n(body not available)");
  });

  it("omits noisy planner fields like generatedAt from the JSON block", () => {
    const hooks = loadHooks();
    const plan = {
      task: "Strip noisy planner timestamp fields",
      generatedAt: "2026-05-24T22:16:55.813Z",
      totalCandidates: 2,
      budgetTokens: 2000,
      estimatedTokens: 400,
      included: [],
      excluded: [],
      missingContext: [],
      loadContext: { names: [], includeContent: "excerpt", maxBytes: 8000 },
    };

    const prompt = hooks.buildJudgePrompt(plan, {});

    expect(prompt).not.toContain("generatedAt");
    expect(prompt).not.toContain("2026-05-24T22:16:55.813Z");
  });

  it("only intercepts plain same-tab anchor navigation", () => {
    const hooks = loadHooks();
    const sameTabLink = { getAttribute: () => "" };
    const blankTargetLink = { getAttribute: () => "_blank" };

    expect(hooks.shouldHandleClientNavigation({ button: 0 }, sameTabLink)).toBe(true);
    expect(hooks.shouldHandleClientNavigation({ button: 1 }, sameTabLink)).toBe(false);
    expect(hooks.shouldHandleClientNavigation({ button: 0, metaKey: true }, sameTabLink)).toBe(false);
    expect(hooks.shouldHandleClientNavigation({ button: 0, ctrlKey: true }, sameTabLink)).toBe(false);
    expect(hooks.shouldHandleClientNavigation({ button: 0 }, blankTargetLink)).toBe(false);
  });
});

describe("inline claim rendering", () => {
  function claim(overrides: Partial<UiClaim>): UiClaim {
    return {
      anchor: "projects/demo/demo.md",
      line: 1,
      section: "Current State",
      text: "claim",
      status: "unannotated",
      ...overrides,
    };
  }

  it("averages multiple source strengths for display", () => {
    const hooks = loadHooks();
    const multi = claim({
      status: "annotated",
      sources: [
        { src: "a.md", observed: "2026-01-01", conf: "high" },
        { src: "b.md", observed: "2026-01-02", conf: "low" },
      ],
    });
    expect(hooks.claimStrengthValue(multi)).toBe("medium");
    expect(hooks.renderClaimInline(multi)).toContain("claim-strength-medium");
  });

  it("renders trust-me-bro developer assertion labels", () => {
    const hooks = loadHooks();
    const trusted = claim({
      status: "annotated",
      strength: "high",
      sources: [
        {
          src: "trust me bro",
          kind: "trust-me-bro",
          person: "alice",
          personName: "Alice Example",
          observed: "2026-07-08",
          conf: "high",
        },
      ],
    });
    const html = hooks.renderClaimInline(trusted);
    expect(html).toContain("trust me bro: Alice Example");
    expect(html).toContain("claim-strength-high");
  });

  it("uses configured claim source type labels in claim source display", () => {
    const hooks = loadHooks();
    hooks.setMappingsTestState([], {
      projects: [],
      claimSourceTypes: [
        { id: "url", label: "URL" },
        { id: "design-doc", label: "Design Proposal" },
        { id: "adr", label: "ADR" },
        { id: "misc", label: "Misc" },
        { id: "trust-me-bro", label: "Developer Assertion", requiresPerson: true, lockedConfidence: "high" },
      ],
    });
    const html = hooks.renderClaimInline(claim({
      status: "annotated",
      sources: [
        { src: "docs/design.md", kind: "design-doc", observed: "2026-07-08", conf: "medium" },
      ],
    }));
    expect(html).toContain("Design Proposal: docs/design.md");
  });

  it("claimCertaintyValue reads effectiveCertainty.certainty when present", () => {
    const hooks = loadHooks();
    const withCertainty = claim({
      status: "annotated",
      effectiveCertainty: { certainty: 0.42, rows: [], aggregation: "average" },
    });
    expect(hooks.claimCertaintyValue(withCertainty)).toBe(0.42);
  });

  it("claimCertaintyValue is null for a claim with no effectiveCertainty (unannotated/malformed)", () => {
    const hooks = loadHooks();
    expect(hooks.claimCertaintyValue(claim({ status: "unannotated" }))).toBeNull();
  });

  it("renderClaimPopover includes the effective certainty score when present", () => {
    const hooks = loadHooks();
    const withCertainty = claim({
      status: "annotated",
      sources: [{ src: "a.md", observed: "2026-01-01", conf: "high" }],
      effectiveCertainty: { certainty: 0.756, rows: [], aggregation: "average" },
    });
    const html = hooks.renderClaimPopover(withCertainty);
    expect(html).toContain("effective certainty 0.76");
  });

  it("renderClaimPopover omits the certainty phrase when effectiveCertainty is absent", () => {
    const hooks = loadHooks();
    const noCertainty = claim({
      status: "annotated",
      sources: [{ src: "a.md", observed: "2026-01-01", conf: "high" }],
    });
    expect(hooks.renderClaimPopover(noCertainty)).not.toContain("effective certainty");
  });

  it("sortClaimsByCertainty orders ascending, least-trustworthy first (the re-verification queue)", () => {
    const hooks = loadHooks();
    const weak = claim({
      anchor: "a.md",
      line: 1,
      text: "weak",
      status: "annotated",
      effectiveCertainty: { certainty: 0.2, rows: [], aggregation: "average" },
    });
    const strong = claim({
      anchor: "a.md",
      line: 2,
      text: "strong",
      status: "annotated",
      effectiveCertainty: { certainty: 0.9, rows: [], aggregation: "average" },
    });
    const sorted = hooks.sortClaimsByCertainty([strong, weak]);
    expect(sorted.map((c) => c.text)).toEqual(["weak", "strong"]);
  });

  it("sortClaimsByCertainty sorts unscored (unannotated/malformed) claims after every scored claim", () => {
    const hooks = loadHooks();
    const scored = claim({
      anchor: "a.md",
      line: 1,
      text: "scored",
      status: "annotated",
      effectiveCertainty: { certainty: 0.1, rows: [], aggregation: "average" },
    });
    const unscored = claim({ anchor: "a.md", line: 2, text: "unscored", status: "unannotated" });
    const sorted = hooks.sortClaimsByCertainty([unscored, scored]);
    expect(sorted.map((c) => c.text)).toEqual(["scored", "unscored"]);
  });

  it("sortClaimsByCertainty never mutates the input array", () => {
    const hooks = loadHooks();
    const weak = claim({
      anchor: "a.md",
      line: 1,
      text: "weak",
      status: "annotated",
      effectiveCertainty: { certainty: 0.2, rows: [], aggregation: "average" },
    });
    const strong = claim({
      anchor: "a.md",
      line: 2,
      text: "strong",
      status: "annotated",
      effectiveCertainty: { certainty: 0.9, rows: [], aggregation: "average" },
    });
    const original = [strong, weak];
    hooks.sortClaimsByCertainty(original);
    expect(original).toEqual([strong, weak]);
  });

  it("sortClaimsByCertainty is stable (deterministic tiebreak) for equal scores", () => {
    const hooks = loadHooks();
    const first = claim({
      anchor: "a.md",
      line: 1,
      text: "first",
      status: "annotated",
      effectiveCertainty: { certainty: 0.5, rows: [], aggregation: "average" },
    });
    const second = claim({
      anchor: "b.md",
      line: 1,
      text: "second",
      status: "annotated",
      effectiveCertainty: { certainty: 0.5, rows: [], aggregation: "average" },
    });
    const sortedOnce = hooks.sortClaimsByCertainty([second, first]);
    const sortedTwice = hooks.sortClaimsByCertainty([second, first]);
    expect(sortedOnce.map((c) => c.text)).toEqual(sortedTwice.map((c) => c.text));
    // Deterministic tiebreak by anchor#line: "a.md#1" sorts before "b.md#1".
    expect(sortedOnce.map((c) => c.text)).toEqual(["first", "second"]);
  });
});

describe("graph neighbors panel (WP5)", () => {
  it("groups edges by type and deep-links each target to its anchor", () => {
    const hooks = loadHooks();
    const html = hooks.neighborsPanelHtml({
      resolvedNode: { nodeId: "anchor:projects/demo/a.md", type: "anchor" },
      nodes: [
        { id: "anchor:projects/demo/a.md", type: "anchor", depth: 0 },
        { id: "project:demo", type: "project", display: "demo", depth: 1 },
        { id: "anchor:projects/demo/b.md", type: "anchor", display: "Anchor B", depth: 1 },
        { id: "claim:projects/demo/b.md#c-up0001", type: "claim", display: "Upstream claim", depth: 1 },
      ],
      edges: [
        { from: "anchor:projects/demo/a.md", to: "project:demo", type: "anchor_project", sourceOfTruth: "front-matter" },
        { from: "anchor:projects/demo/a.md", to: "anchor:projects/demo/b.md", type: "anchor_anchor", sourceOfTruth: "body-link" },
        {
          from: "claim:projects/demo/a.md#c-down01",
          to: "claim:projects/demo/b.md#c-up0001",
          type: "derived_from",
          sourceOfTruth: "claim-annotation",
        },
      ],
    });
    // Grouped headings, one per edge type.
    expect(html).toContain("Project");
    expect(html).toContain("Linked anchors");
    expect(html).toContain("Derived from");
    // Deep link to the linked anchor uses SPA data-anchor-name routing.
    expect(html).toContain('data-anchor-name="projects/demo/b.md"');
    expect(html).toContain("Anchor B");
    // The derived_from target is a claim node; it links to the claim's anchor.
    expect(html).toContain("Upstream claim");
    // The non-linkable project node renders its display label without a link.
    expect(html).toContain(">demo<");
  });

  it("renders an empty state when there are no edges", () => {
    const hooks = loadHooks();
    const html = hooks.neighborsPanelHtml({
      resolvedNode: { nodeId: "anchor:projects/demo/a.md", type: "anchor" },
      nodes: [{ id: "anchor:projects/demo/a.md", type: "anchor", depth: 0 }],
      edges: [],
    });
    expect(html).toContain("neighbors-empty");
    expect(html).toContain("No graph edges");
  });

  it("surfaces candidates for an ambiguous node resolution", () => {
    const hooks = loadHooks();
    const html = hooks.neighborsPanelHtml({
      candidates: [
        { nodeId: "anchor:projects/demo/a.md", type: "anchor", display: "Anchor A" },
        { nodeId: "anchor:projects/demo/aa.md", type: "anchor", display: "Anchor AA" },
      ],
    });
    expect(html).toContain("Ambiguous");
    expect(html).toContain("Anchor A");
    expect(html).toContain("Anchor AA");
  });
});

describe("legacy claims URL state", () => {
  it("drops old standalone claims filters when regenerating URLs", () => {
    const hooks = loadHooks({
      search: "?view=claims&claimsProject=demo&claimsStatus=unannotated&claimsSearch=auth&claimsSort=least-trusted",
    });
    const href = hooks.anchorHref("projects/demo/demo.md");
    expect(href).toContain("anchor=projects%2Fdemo%2Fdemo.md");
    expect(href).not.toContain("view=claims");
    expect(href).not.toContain("claimsProject");
    expect(href).not.toContain("claimsStatus");
    expect(href).not.toContain("claimsSearch");
    expect(href).not.toContain("claimsSort");
  });
});
