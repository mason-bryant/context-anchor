import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { UI_CSS, UI_HTML, UI_JS } from "../src/ui/assets.js";

type UiSuggestion = { value: string; label: string; searchText?: string };
type UiRegistry = { people: Array<Record<string, unknown>>; teams: Array<Record<string, unknown>> };

type UiAssetHooks = {
  renderMarkdown(markdown: string): string;
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
  sortTasksForDisplay(tasks: Array<Record<string, unknown>>, sortMode: string): Array<Record<string, unknown>>;
  taskGroupsForDisplay(
    tasks: Array<Record<string, unknown>>,
    groupBy: string,
    sortMode: string,
    today: string,
    soon: string,
  ): Array<{ label: string; cls?: string; projectPriority?: number; tasks: Array<Record<string, unknown>> }>;
  taskGroupPriority(tasks: Array<Record<string, unknown>>): number;
  taskProjectPriority(task: Record<string, unknown>): number;
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
  buildJudgePrompt(plan: Record<string, unknown>, anchorBodies: Record<string, string>): string;
  formatPreview(preview: Record<string, unknown>): string;
  priorityLabel(priority: number): string;
  projectOf(anchor: Record<string, unknown>): string;
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
    expect(UI_HTML).toContain('<use href="#icon-home"></use>');
    expect(UI_HTML).toContain('<use href="#icon-anchor"></use>');
    expect(UI_HTML).toContain('<use href="#icon-filter"></use>');
    expect(UI_HTML).toContain('<use href="#icon-plan"></use>');
    expect(UI_HTML).toContain('<use href="#icon-save"></use>');
    expect(UI_CSS).toContain("stroke: currentColor");
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
    expect(UI_HTML).toContain('id="planner-budget"');
    expect(UI_HTML).toContain('id="planner-max-anchors"');
    expect(UI_HTML).toContain('id="planner-load-context"');
    expect(UI_HTML).toContain('id="planner-comparison"');
    expect(UI_HTML).toContain('id="planner-raw"');
  });

  it("includes task grouping and due-date sort controls", () => {
    expect(UI_HTML).toContain('id="tasks-group-by"');
    expect(UI_HTML).toContain('id="tasks-sort"');
    expect(UI_HTML).toContain("Group: Project");
    expect(UI_HTML).toContain("Due date ascending");
    expect(UI_JS).toContain('"tasksGroup"');
    expect(UI_JS).toContain('"tasksSort"');
    expect(UI_JS).toContain("task-priority-badge");
    expect(UI_JS).toContain("task-owner-form");
    expect(UI_JS).toContain("task-owner-suggestions");
    expect(UI_HTML).toContain('id="project-slug-suggestions"');
    expect(UI_HTML).toContain('id="milestone-anchor-suggestions"');
    expect(UI_HTML).toContain('id="team-id-suggestions"');
    expect(UI_HTML).toContain('id="people-search"');
    expect(UI_HTML).toContain('id="teams-search"');
    expect(UI_JS).toContain("/api/ui/task-owner");
    expect(UI_JS).toContain("/api/ui/people-search");
    expect(UI_HTML).toContain('id="new-task-project" type="text" placeholder="anchor-mcp" list="project-slug-suggestions" autocomplete="off"');
    expect(UI_HTML).toContain('id="new-task-owner" type="text" placeholder="person or team — blank = unassigned" list="task-owner-suggestions" autocomplete="off"');
    expect(UI_HTML).toContain('id="new-task-milestone" type="text" placeholder="blank = project backlog" list="milestone-anchor-suggestions" autocomplete="off"');
    expect(UI_HTML).toContain('id="new-person-teams" type="text" placeholder="platform, frontend" list="team-id-suggestions" autocomplete="off"');
    expect(UI_CSS).toContain(".task-priority-badge");
    expect(UI_CSS).toContain(".task-owner-form");
    expect(UI_CSS).toContain(".registry-search");
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

  it("includes guarded editing and proposal review surfaces", () => {
    expect(UI_HTML).toContain('data-tab="review"');
    expect(UI_HTML).toContain('id="proposal-list"');
    expect(UI_HTML).toContain('id="proposal-preview"');
    expect(UI_HTML).toContain('id="edit-form"');
    expect(UI_HTML).toContain('id="stage-proposal"');
    expect(UI_HTML).toContain('id="commit-direct"');
    expect(UI_HTML).toContain('id="load-history"');
    expect(UI_HTML).toContain('id="rename-anchor"');
    expect(UI_HTML).toContain('id="delete-anchor"');
    expect(UI_HTML).toContain('id="priority-form"');
    expect(UI_HTML).toContain('<option value="priority">Priority</option>');
    expect(UI_JS).toContain("/api/ui/propose-change");
    expect(UI_JS).toContain("/api/ui/proposed-change-apply");
    expect(UI_JS).toContain("/api/ui/anchor-frontmatter");
    expect(UI_JS).toContain("/api/ui/project-priority");
    expect(UI_JS).toContain("/api/ui/anchor-versions");
    expect(UI_JS).toContain("/api/ui/anchor-delete");
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
