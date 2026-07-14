export const UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>anchor-mcp Explorer</title>
    <link rel="stylesheet" href="/ui/app.css">
  </head>
  <body>
    <svg class="icon-library" aria-hidden="true" focusable="false">
      <symbol id="icon-home" viewBox="0 0 24 24">
        <path d="M4 11.5 12 5l8 6.5"></path>
        <path d="M6.5 10.5V19h11v-8.5"></path>
        <path d="M10 19v-5h4v5"></path>
      </symbol>
      <symbol id="icon-anchor" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="2.5"></circle>
        <path d="M12 7.5V18"></path>
        <path d="M8 10h8"></path>
        <path d="M5 14c.6 3.2 3.2 5 7 5s6.4-1.8 7-5"></path>
        <path d="M5 14h3"></path>
        <path d="M19 14h-3"></path>
      </symbol>
      <symbol id="icon-filter" viewBox="0 0 24 24">
        <path d="M5 6h14"></path>
        <path d="M8 12h8"></path>
        <path d="M10.5 18h3"></path>
      </symbol>
      <symbol id="icon-plan" viewBox="0 0 24 24">
        <path d="M5 6h14"></path>
        <path d="M5 12h8"></path>
        <path d="M5 18h5"></path>
        <path d="M15 15l3 3-3 3"></path>
        <path d="M12 18h6"></path>
      </symbol>
      <symbol id="icon-save" viewBox="0 0 24 24">
        <path d="M6 4h10l2 2v14H6z"></path>
        <path d="M9 4v5h6V4"></path>
        <path d="M9 16h6"></path>
      </symbol>
      <symbol id="icon-people" viewBox="0 0 24 24">
        <circle cx="8" cy="8" r="3"></circle>
        <path d="M2 20c0-3.3 2.7-6 6-6"></path>
        <circle cx="16" cy="8" r="3"></circle>
        <path d="M22 20c0-3.3-2.7-6-6-6h-4c-3.3 0-6 2.7-6 6"></path>
      </symbol>
      <symbol id="icon-team" viewBox="0 0 24 24">
        <rect x="3" y="11" width="18" height="10" rx="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </symbol>
      <symbol id="icon-object-graph" viewBox="0 0 24 24">
        <circle cx="6" cy="12" r="2.5"></circle>
        <circle cx="16" cy="6" r="2.5"></circle>
        <circle cx="18" cy="17" r="2.5"></circle>
        <path d="M8.1 10.7 13.9 7.3"></path>
        <path d="M8.4 13.2 15.6 16.1"></path>
        <path d="M16.4 8.5 17.6 14.5"></path>
      </symbol>
      <symbol id="icon-trash" viewBox="0 0 24 24">
        <path d="M4 7h16"></path>
        <path d="M9 7V5h6v2"></path>
        <path d="M7 7l1 13h8l1-13"></path>
        <path d="M10 11v5"></path>
        <path d="M14 11v5"></path>
      </symbol>
      <symbol id="icon-pencil" viewBox="0 0 24 24">
        <path d="M4 20h4l11-11-4-4L4 16z"></path>
        <path d="M13.5 6.5l4 4"></path>
      </symbol>
    </svg>
    <div class="app-shell">
      <header class="topbar">
        <div>
          <h1>anchor-mcp</h1>
          <p>Context explorer and guarded editor</p>
        </div>
        <form id="token-form" class="token-form">
          <label for="token-input">API token</label>
          <input id="token-input" type="password" autocomplete="off" placeholder="Bearer token">
          <button type="submit"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-save"></use></svg><span>Save</span></span></button>
        </form>
      </header>

      <main class="workspace">
        <aside class="sidebar" aria-label="Filters and anchors">
          <section class="panel">
            <h2><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-filter"></use></svg><span>Filters</span></span></h2>
            <label>
              Search
              <input id="search-input" type="search" placeholder="Anchor, summary, tag">
            </label>
            <label>
              Project
              <select id="project-filter"></select>
            </label>
            <label>
              Category
              <select id="category-filter"></select>
            </label>
            <label>
              Tag
              <select id="tag-filter"></select>
            </label>
            <label class="checkbox-row">
              <input id="archive-filter" type="checkbox">
              Include archive
            </label>
          </section>

          <section class="panel anchor-list-panel">
            <div class="panel-heading">
              <h2><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-anchor"></use></svg><span>Anchors</span></span></h2>
              <div class="anchor-list-actions">
                <label class="sort-control" for="anchor-group-sort">
                  <span>Sort</span>
                  <select id="anchor-group-sort">
                    <option value="priority">Priority</option>
                    <option value="updated">Last update</option>
                    <option value="name">Project name</option>
                    <option value="created">Created date</option>
                  </select>
                </label>
                <span id="anchor-count" class="count">0</span>
              </div>
            </div>
            <div id="anchor-list" class="anchor-list"></div>
          </section>
        </aside>

        <section id="content-area" class="content-area">
          <section id="status-banner" class="status-banner" hidden></section>

          <nav class="tabs" aria-label="Primary views">
            <button class="tab active" data-tab="root" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-home"></use></svg><span>Context Root</span></span></button>
            <button class="tab" data-tab="planner" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-plan"></use></svg><span>Planner</span></span></button>
            <button class="tab" data-tab="tasks" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-filter"></use></svg><span>Tasks</span></span></button>
            <button class="tab" data-tab="people" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-people"></use></svg><span>People</span></span></button>
            <button class="tab" data-tab="teams" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-team"></use></svg><span>Teams</span></span></button>
            <button class="tab" data-tab="mappings" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-filter"></use></svg><span>Mappings</span></span></button>
            <button class="tab" data-tab="review" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-save"></use></svg><span>Review</span></span></button>
            <button class="tab" data-tab="traces" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-plan"></use></svg><span>Traces</span></span></button>
            <button class="tab" data-tab="coverage" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-object-graph"></use></svg><span>Coverage</span></span></button>
            <button class="tab" data-tab="detail" type="button" disabled><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-anchor"></use></svg><span>Selected Anchor</span></span></button>
          </nav>

          <section id="root-view" class="view active">
            <div class="view-header">
              <div>
                <h2>Context Root Preview</h2>
                <p id="root-generated">Generated root output</p>
              </div>
              <div class="segmented">
                <button class="mode active" data-root-mode="rendered" type="button">Rendered</button>
                <button class="mode" data-root-mode="raw" type="button">Raw</button>
              </div>
            </div>
            <article id="root-rendered" class="markdown"></article>
            <pre id="root-raw" class="raw-view" hidden></pre>
          </section>

          <section id="planner-view" class="view">
            <div class="view-header">
              <div>
                <h2>Context Bundle Planner</h2>
                <p id="planner-status">No plan run yet</p>
              </div>
            </div>
            <form id="planner-form" class="planner-form">
              <label class="planner-task">
                Task
                <textarea id="planner-task" rows="4" placeholder="Describe the task. Paste a request-log JSON line to auto-fill every planner field."></textarea>
              </label>
              <div class="planner-controls">
                <label>
                  Project
                  <select id="planner-project"></select>
                </label>
                <label>
                  Category
                  <select id="planner-category"></select>
                </label>
                <label>
                  Tag
                  <select id="planner-tag"></select>
                </label>
                <label>
                  Runtime
                  <input id="planner-runtime" type="text" placeholder="optional">
                </label>
                <label>
                  Repo
                  <input id="planner-repo" type="text" placeholder="optional, resolves candidate projects">
                </label>
                <label class="planner-filepaths">
                  File paths
                  <textarea id="planner-filepaths" rows="2" placeholder="optional, one path per line"></textarea>
                </label>
                <label>
                  Token budget
                  <input id="planner-budget" type="number" min="1" max="200000" value="4000">
                </label>
                <label>
                  Max anchors
                  <input id="planner-max-anchors" type="number" min="1" max="500" value="12">
                </label>
                <label>
                  Max excluded
                  <input id="planner-max-excluded" type="number" min="0" max="500" value="20">
                </label>
                <label class="checkbox-row planner-checkbox">
                  <input id="planner-archive" type="checkbox">
                  Include archive
                </label>
              </div>
              <button type="submit"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-plan"></use></svg><span>Run Plan</span></span></button>
            </form>

            <div id="planner-empty" class="empty-state">Submit a task to inspect planner output.</div>
            <div id="planner-results" class="planner-results" hidden>
              <section id="planner-summary" class="planner-summary"></section>
              <section id="planner-resolution-box" class="metadata-box" hidden>
                <h3>Project resolution</h3>
                <div id="planner-resolution" class="planner-list"></div>
              </section>
              <section class="planner-grid">
                <div class="metadata-box">
                  <h3>Included</h3>
                  <div id="planner-included" class="planner-list"></div>
                </div>
                <div class="metadata-box">
                  <h3>Excluded</h3>
                  <div id="planner-excluded" class="planner-list"></div>
                </div>
              </section>
              <section class="planner-grid">
                <div class="metadata-box">
                  <h3>Missing Context</h3>
                  <div id="planner-missing" class="planner-list"></div>
                </div>
                <div class="metadata-box">
                  <div class="panel-heading">
                    <h3>Suggested loadContext</h3>
                    <div class="planner-copy-actions">
                      <button id="copy-load-context" type="button">Copy</button>
                      <button id="copy-judge-prompt" type="button">Copy as judge prompt</button>
                    </div>
                  </div>
                  <pre id="planner-load-context" class="compact-raw"></pre>
                </div>
              </section>
              <section class="metadata-box" id="planner-comparison-box">
                <h3>Run Comparison</h3>
                <div id="planner-comparison" class="planner-list"></div>
              </section>
              <section class="metadata-box">
                <h3>Raw Result</h3>
                <pre id="planner-raw" class="compact-raw"></pre>
              </section>
            </div>
          </section>

          <section id="review-view" class="view">
            <div class="view-header">
              <div>
                <h2>Proposed Changes</h2>
                <p id="proposal-status">No proposals loaded yet</p>
              </div>
              <button id="load-proposals" type="button">Refresh</button>
            </div>
            <section class="planner-grid">
              <div class="metadata-box">
                <h3>Inbox</h3>
                <div class="proposal-filters">
                  <label>
                    Project
                    <input id="proposal-project" type="text" placeholder="optional">
                  </label>
                  <label>
                    Status
                    <select id="proposal-status-filter">
                      <option value="pending">Pending</option>
                      <option value="">All statuses</option>
                      <option value="changes_requested">Changes requested</option>
                      <option value="rejected">Rejected</option>
                      <option value="superseded">Superseded</option>
                      <option value="applied">Applied</option>
                    </select>
                  </label>
                </div>
                <div id="proposal-list" class="planner-list"></div>
              </div>
              <div class="metadata-box">
                <h3>Review Result</h3>
                <div id="proposal-actions" class="action-row" hidden>
                  <button id="apply-proposal" type="button">Apply</button>
                  <button id="request-proposal-changes" type="button">Request changes</button>
                  <button id="reject-proposal" type="button">Reject</button>
                </div>
                <pre id="proposal-preview" class="compact-raw">Select a proposal to preview validation and diff output.</pre>
              </div>
            </section>
          </section>

          <section id="tasks-view" class="view">
            <div class="view-header">
              <div>
                <h2>Tasks</h2>
                <p id="tasks-summary">Tasks across all milestones.</p>
              </div>
              <div class="tasks-filters">
                <select id="tasks-project-filter" aria-label="Filter by project">
                  <option value="">All projects</option>
                </select>
                <select id="tasks-status-filter" aria-label="Filter by status">
                  <option value="active,todo,blocked">Active / Todo / Blocked</option>
                  <option value="active,todo,blocked,done">Active / Todo / Blocked / Done</option>
                  <option value="todo">Todo only</option>
                  <option value="active">Active only</option>
                  <option value="blocked">Blocked only</option>
                  <option value="done,cancelled">Done / Cancelled</option>
                  <option value="">All statuses</option>
                </select>
                <select id="tasks-group-by" aria-label="Group tasks">
                  <option value="project">Group: Project</option>
                  <option value="due">Group: Due date</option>
                </select>
                <select id="tasks-sort" aria-label="Sort tasks">
                  <option value="projectPriority">Project priority</option>
                  <option value="taskPriority">Task priority</option>
                  <option value="projectName">Project name</option>
                  <option value="modifiedDesc">Last modified</option>
                  <option value="dueAsc">Due date ascending</option>
                  <option value="dueDesc">Due date descending</option>
                </select>
                <label class="task-report-field">Completed last<input id="tasks-completed-days" type="number" min="1" max="3650" placeholder="days"></label>
                <label class="task-report-field">Due next<input id="tasks-due-days" type="number" min="1" max="3650" placeholder="days"></label>
                <label class="task-report-field">Project P &lt;=<input id="tasks-project-priority-max" type="number" min="0" step="0.001" placeholder="any"></label>
                <label class="task-report-field">Task P &lt;=<input id="tasks-task-priority-max" type="number" min="0" step="0.001" placeholder="any"></label>
                <label class="task-report-field">Modified since<input id="tasks-modified-after" type="date"></label>
                <label class="checkbox-label"><input type="checkbox" id="tasks-no-due"> No due date only</label>
                <label class="checkbox-label"><input type="checkbox" id="tasks-unassigned"> Unassigned only</label>
                <button id="tasks-add" type="button">+ Add Task</button>
                <button id="tasks-refresh" type="button">Refresh</button>
              </div>
            </div>
            <div id="tasks-add-form" class="registry-add-form" hidden>
              <h3>New Task</h3>
              <div class="form-grid">
                <label>Project<input id="new-task-project" type="text" placeholder="anchor-mcp" list="project-slug-suggestions" autocomplete="off"></label>
                <label>Title<input id="new-task-title" type="text" placeholder="Follow up on X"></label>
                <label>Owner (optional)<input id="new-task-owner" type="text" placeholder="person or team — blank = unassigned" list="task-owner-suggestions" autocomplete="off"></label>
                <label>Priority (optional)<input id="new-task-priority" type="number" min="0" step="0.001" placeholder="1.1"></label>
                <label>Status<select id="new-task-status">
                  <option value="todo">todo</option>
                  <option value="active">active</option>
                  <option value="blocked">blocked</option>
                </select></label>
                <label>Due (optional)<input id="new-task-due" type="date"></label>
                <label>Date confidence<select id="new-task-confidence">
                  <option value="estimated">estimated</option>
                  <option value="internal_goal">internal_goal</option>
                  <option value="committed">committed</option>
                </select></label>
                <label>Milestone (optional)<input id="new-task-milestone" type="text" placeholder="blank = project backlog" list="milestone-anchor-suggestions" autocomplete="off"></label>
                <label>Notes (optional)<textarea id="new-task-notes" maxlength="480" rows="3" placeholder="Decision, context, or follow-up detail"></textarea></label>
              </div>
              <div class="action-row">
                <button id="new-task-save" type="button">Save</button>
                <button id="new-task-cancel" type="button">Cancel</button>
              </div>
              <p id="new-task-result" class="registry-result"></p>
            </div>
            <div id="tasks-empty" class="empty-state">No tasks match the current filters.</div>
            <datalist id="task-owner-suggestions"></datalist>
            <datalist id="project-slug-suggestions"></datalist>
            <datalist id="milestone-anchor-suggestions"></datalist>
            <datalist id="team-id-suggestions"></datalist>
            <datalist id="claim-person-suggestions"></datalist>
            <div id="tasks-list" hidden></div>
          </section>

          <section id="people-view" class="view">
            <div class="view-header">
              <div>
                <h2>People</h2>
                <p id="people-summary">People registry.</p>
              </div>
              <div class="action-row">
                <input id="people-search" class="registry-search" type="search" placeholder="Search people" aria-label="Search people">
                <button id="people-add" type="button">+ Add Person</button>
                <button id="people-refresh" type="button">Refresh</button>
              </div>
            </div>
            <div id="people-add-form" class="registry-add-form" hidden>
              <h3>New Person</h3>
              <div class="form-grid">
                <label>ID (slug)<input id="new-person-id" type="text" placeholder="jdoe"></label>
                <label>Display Name<input id="new-person-name" type="text" placeholder="Jane Doe"></label>
                <label>Slack ID<input id="new-person-slack" type="text" placeholder="U012345ABC"></label>
                <label>Confluence ID<input id="new-person-confluence" type="text" placeholder="jdoe"></label>
                <label>Emails (comma-separated)<input id="new-person-emails" type="text" placeholder="jane@co.com"></label>
                <label>Name aliases (comma-separated)<input id="new-person-names" type="text" placeholder="Jane, J. Doe"></label>
                <label>Teams (comma-separated)<input id="new-person-teams" type="text" placeholder="platform, frontend" list="team-id-suggestions" autocomplete="off"></label>
              </div>
              <div class="action-row">
                <button id="new-person-save" type="button">Save</button>
                <button id="new-person-cancel" type="button">Cancel</button>
              </div>
              <p id="new-person-result" class="registry-result"></p>
            </div>
            <details id="people-assoc-overview" class="assoc-overview">
              <summary>Associations by project (who's on what)</summary>
              <div class="assoc-overview-body"></div>
            </details>
            <div id="people-empty" class="empty-state" hidden>No people in registry.</div>
            <div id="people-list" class="registry-cards"></div>
          </section>

          <section id="mappings-view" class="view">
            <div class="view-header">
              <div>
                <h2>Repo Mappings</h2>
                <p id="mappings-summary">Map each project to the repositories and paths it lives in.</p>
              </div>
              <div class="action-row">
                <button id="mappings-save" type="button">Save</button>
                <button id="mappings-refresh" type="button">Refresh</button>
              </div>
            </div>
            <p class="registry-hint">Every project under management is listed below. A project can live in any number of repos; each repo can be narrowed to directory paths (one per line), or left blank to match the whole repo.</p>
            <div class="metadata-box claim-source-type-config">
              <h3>External Reference Links</h3>
              <p class="registry-hint">Google Doc IDs and Slack channel names link directly. Add a Confluence tenant URL template; optionally override Slack's default deep link with a workspace-specific one.</p>
              <div class="form-grid">
                <label>Confluence page template<input id="external-link-confluence" type="url" placeholder="https://your-domain.atlassian.net/wiki/spaces/{space}/pages/{pageId}"></label>
                <label>Slack channel template (optional)<input id="external-link-slack" type="url" placeholder="https://slack.com/app_redirect?channel={channel}&amp;team=TEAM_ID"></label>
              </div>
            </div>
            <div class="metadata-box claim-source-type-config">
              <h3>Claim Source Types</h3>
              <div id="claim-source-types-list" class="claim-source-types-list"></div>
              <button id="claim-source-type-add" type="button">+ Add Source Type</button>
            </div>
            <div id="mappings-empty" class="empty-state" hidden>No project mappings yet. Add one to map a project to its repos and paths.</div>
            <div id="mappings-list" class="registry-cards"></div>
          </section>

          <section id="teams-view" class="view">
            <div class="view-header">
              <div>
                <h2>Teams</h2>
                <p id="teams-summary">Teams registry.</p>
              </div>
              <div class="action-row">
                <input id="teams-search" class="registry-search" type="search" placeholder="Search teams" aria-label="Search teams">
                <button id="teams-add" type="button">+ Add Team</button>
                <button id="teams-refresh" type="button">Refresh</button>
              </div>
            </div>
            <div id="teams-add-form" class="registry-add-form" hidden>
              <h3>New Team</h3>
              <div class="form-grid">
                <label>ID (slug)<input id="new-team-id" type="text" placeholder="platform"></label>
                <label>Display Name<input id="new-team-name" type="text" placeholder="Platform Team"></label>
                <label>Synonyms (comma-separated)<input id="new-team-synonyms" type="text" placeholder="core-platform, platform team"></label>
                <label>Slack Handles (comma-separated)<input id="new-team-handles" type="text" placeholder="platform-team"></label>
              </div>
              <div class="action-row">
                <button id="new-team-save" type="button">Save</button>
                <button id="new-team-cancel" type="button">Cancel</button>
              </div>
              <p id="new-team-result" class="registry-result"></p>
            </div>
            <details id="teams-assoc-overview" class="assoc-overview">
              <summary>Associations by project (who's on what)</summary>
              <div class="assoc-overview-body"></div>
            </details>
            <div id="teams-empty" class="empty-state" hidden>No teams in registry.</div>
            <div id="teams-list" class="registry-cards"></div>
          </section>

          <section id="traces-view" class="view">
            <div class="view-header">
              <div>
                <h2>Context Traces</h2>
                <p id="traces-summary">Recent agent context-retrieval sessions, grouped by trace id or transport session.</p>
              </div>
              <div class="tasks-filters">
                <button id="traces-show-timeline" type="button" class="mode active" data-traces-mode="timeline">Sessions</button>
                <button id="traces-show-dry" type="button" class="mode" data-traces-mode="dry">Dry queries</button>
                <button id="traces-refresh" type="button">Refresh</button>
              </div>
            </div>
            <div id="traces-disabled" class="empty-state" hidden>
              <p>Trace logging is disabled. To record context-retrieval traces, add a <code>traces</code> block to the <code>logging</code> section of your anchor-mcp config file (the JSON file passed via <code>--config</code>, e.g. <code>anchor-mcp.config.json</code>), then restart the server:</p>
              <pre class="compact-raw trace-config-hint">{
  "logging": {
    "traces": { "enabled": true }
  }
}</pre>
              <p>Traces are written to <code>~/.anchor-mcp/logs/anchor-mcp-traces-&lt;date&gt;.log</code> with one-year retention. Optional keys: <code>dirname</code>, <code>maxFiles</code> (default <code>"365d"</code>), and <code>includeTaskText</code> (default <code>false</code>; task text is stored as a hash unless enabled). See <code>anchor-mcp.config.example.json</code> for the full block.</p>
            </div>
            <div id="traces-timeline-panel">
              <div id="traces-empty" class="empty-state" hidden>No trace sessions recorded yet. Run a context query (startTask, loadContext, searchAnchors, ...) and refresh.</div>
              <div id="traces-list" hidden></div>
            </div>
            <div id="traces-dry-panel" hidden>
              <div class="tasks-filters">
                <label><input type="checkbox" id="traces-dry-thin" /> Include thin deliveries with no follow-up</label>
              </div>
              <div id="traces-dry-empty" class="empty-state" hidden>No dry queries found.</div>
              <table id="traces-dry-table" hidden>
                <thead>
                  <tr><th>Time</th><th>Tool</th><th>Reason</th><th>Task</th><th>Project</th><th>Session</th><th>Nearest miss</th></tr>
                </thead>
                <tbody id="traces-dry-rows"></tbody>
              </table>
            </div>
          </section>

          <section id="coverage-view" class="view">
            <div class="view-header">
              <div>
                <h2>Schema Coverage</h2>
                <p id="coverage-summary">Structural coverage across every anchor and claim.</p>
              </div>
              <div class="tasks-filters">
                <button id="coverage-refresh" type="button">Refresh</button>
              </div>
            </div>
            <div id="coverage-cards" class="coverage-cards" role="group" aria-label="Coverage summary and state filters"></div>
            <div class="coverage-filters">
              <label>
                Project
                <select id="coverage-project-filter" aria-label="Filter coverage by project">
                  <option value="">All projects</option>
                </select>
              </label>
              <label>
                Anchor name contains
                <input id="coverage-text-filter" type="search" placeholder="e.g. roadmap" aria-label="Filter coverage by anchor name">
              </label>
              <button id="coverage-clear-filters" type="button">Clear filters</button>
            </div>
            <div id="coverage-empty" class="empty-state" hidden>No coverage records match the current filters.</div>
            <div class="markdown-table-scroll">
              <table id="coverage-table" hidden>
                <caption class="sr-only">Structural coverage records for anchors and claims</caption>
                <thead>
                  <tr><th scope="col">Kind</th><th scope="col">Anchor</th><th scope="col">State</th><th scope="col">Reasons</th><th scope="col">Suggested operations</th></tr>
                </thead>
                <tbody id="coverage-rows"></tbody>
              </table>
            </div>
            <p id="coverage-count" class="coverage-count" aria-live="polite"></p>
            <button id="coverage-load-more" type="button" hidden>Load more</button>
          </section>

          <section id="detail-view" class="view">
            <div class="empty-state" id="detail-empty">
              Select an anchor to inspect its metadata, required sections, and source.
            </div>
            <div id="detail-content" hidden>
              <div class="view-header">
                <div>
                  <div id="detail-badges" class="badges"></div>
                  <h2 id="detail-title"></h2>
                  <p id="detail-path"></p>
                  <p id="detail-readonly-note" class="readonly-note" hidden>Built-in server rules are read-only and ship with anchor-mcp.</p>
                </div>
              </div>
              <section class="detail-grid">
                <div class="metadata-box">
                  <h3>Anchor Structure</h3>
                  <div id="section-status" class="section-status"></div>
                </div>
                <div class="metadata-box">
                  <h3>Validation</h3>
                  <div id="validation-status"></div>
                </div>
                <div class="metadata-box">
                  <h3>Project Priority</h3>
                  <form id="priority-form" class="priority-form">
                    <label class="priority-field">
                      Priority
                      <input id="priority-input" type="text" inputmode="decimal" pattern="[0-9.]*" placeholder="1.1" aria-label="Project priority">
                    </label>
                    <button id="update-priority" type="submit">Update</button>
                  </form>
                </div>
                <div id="current-state-organization-box" class="metadata-box current-state-organization-box" hidden>
                  <h3>Current State Organization</h3>
                  <div id="current-state-organization"></div>
                </div>
              </section>
              <div class="detail-mode-row">
                <div class="segmented" aria-label="Anchor detail content format">
                  <button class="mode active" data-detail-mode="rendered" type="button">Rendered</button>
                  <button class="mode" data-detail-mode="raw" type="button">Raw</button>
                  <button class="mode" data-detail-mode="frontmatter" type="button">Front Matter</button>
                </div>
              </div>
              <div id="detail-tasks" class="detail-tasks" hidden></div>
              <article id="detail-rendered" class="markdown"></article>
              <pre id="detail-raw" class="raw-view" hidden></pre>
              <pre id="detail-frontmatter" class="raw-view" hidden></pre>
              <section id="detail-neighbors" class="metadata-box detail-neighbors">
                <h3>Graph Neighbors</h3>
                <div class="action-row">
                  <button id="load-neighbors" type="button">Load Neighbors</button>
                </div>
                <div id="neighbors-body" class="neighbors-body">Load neighbors to see this anchor's graph edges (claim provenance, derived_from / contradicts, links, structure).</div>
              </section>
              <section id="history-actions" class="metadata-box history-actions">
                <h3>History and Actions</h3>
                <div class="action-row">
                  <button id="load-history" type="button">Load History</button>
                  <button id="delete-anchor" type="button">Delete</button>
                </div>
                <div class="form-grid">
                  <label>
                    New path
                    <input id="rename-target" type="text" placeholder="projects/demo/new-name.md">
                  </label>
                  <label>
                    Action message
                    <input id="action-message" type="text" placeholder="optional">
                  </label>
                </div>
                <div class="action-row">
                  <button id="rename-anchor" type="button">Rename</button>
                </div>
                <div id="history-list" class="planner-list"></div>
                <pre id="history-diff" class="compact-raw">Load history to inspect diffs or revert.</pre>
              </section>
            </div>
          </section>
        </section>
      </main>
    </div>
    <div id="claim-source-modal" class="modal-backdrop" hidden>
      <div class="modal-dialog claim-source-dialog" role="dialog" aria-modal="true" aria-labelledby="claim-source-title">
        <div class="modal-header">
          <div>
            <h2 id="claim-source-title">Claim Sources</h2>
            <p id="claim-source-text"></p>
            <p class="claim-source-id-display">Claim ID: <code id="claim-source-id-value">Assigned by server on save</code> <span>Immutable</span></p>
          </div>
          <button id="claim-source-close" type="button" class="icon-button" aria-label="Close claim source editor">×</button>
        </div>
        <div id="claim-source-readonly" class="readonly-note" hidden>Built-in server rules are read-only and ship with anchor-mcp.</div>
        <div id="claim-source-rows" class="claim-source-rows"></div>
        <details id="claim-person-add" class="claim-person-add">
          <summary>Add Person</summary>
          <div class="claim-person-add-grid">
            <label>ID (slug)<input id="claim-new-person-id" type="text" placeholder="jdoe"></label>
            <label>Display Name<input id="claim-new-person-name" type="text" placeholder="Jane Doe"></label>
            <button id="claim-new-person-save" type="button">Save Person</button>
          </div>
        </details>
        <div class="action-row">
          <button id="claim-source-add" type="button">Add Source</button>
          <button id="claim-source-save" type="button">Save</button>
          <button id="claim-source-cancel" type="button">Cancel</button>
        </div>
        <p id="claim-source-result" class="claim-editor-result"></p>
      </div>
    </div>
    <script src="/ui/app.js"></script>
  </body>
</html>
`;

export const UI_CSS = `:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-strong: #f0f3f6;
  --text: #17202a;
  --muted: #64707d;
  --border: #d9e0e7;
  --accent: #1f6feb;
  --accent-soft: #e9f1ff;
  --ok: #1f8f5f;
  --warn: #b16a03;
  --block: #c7352d;
  --shadow: 0 10px 28px rgba(19, 32, 48, 0.08);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

button:hover {
  border-color: #aeb9c5;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.icon-library {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.icon {
  width: 16px;
  height: 16px;
  flex: none;
  display: inline-block;
  color: currentColor;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.panel h2 .icon,
.anchor-title .icon {
  color: var(--muted);
}

.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.topbar h1,
.topbar p {
  margin: 0;
}

.topbar h1 {
  font-size: 20px;
  line-height: 1.2;
}

.topbar p {
  margin-top: 3px;
  color: var(--muted);
}

.token-form {
  display: grid;
  grid-template-columns: auto minmax(220px, 320px) auto;
  align-items: center;
  gap: 8px;
}

.token-form label {
  color: var(--muted);
  font-size: 13px;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  padding: 8px 10px;
}

input:disabled,
select:disabled,
textarea:disabled {
  background: #eef1f4;
  color: var(--muted);
  cursor: not-allowed;
}

textarea {
  resize: vertical;
  min-height: 96px;
  line-height: 1.4;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  min-height: 0;
}

.sidebar {
  border-right: 1px solid var(--border);
  background: #fbfcfd;
  overflow: auto;
  padding: 16px;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  box-shadow: var(--shadow);
}

.panel + .panel {
  margin-top: 14px;
}

.panel h2 {
  margin: 0 0 12px;
  font-size: 14px;
}

.panel label {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-top: 10px;
}

.panel input,
.panel select,
.panel textarea {
  margin-top: 5px;
}

.checkbox-row {
  display: flex !important;
  align-items: center;
  gap: 8px;
}

.checkbox-row input {
  width: auto;
  margin: 0;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.planner-copy-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.anchor-list-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sort-control {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  margin: 0 !important;
  color: var(--muted);
  white-space: nowrap;
}

.sort-control select {
  width: auto;
  max-width: 142px;
  margin: 0;
  padding: 5px 28px 5px 8px;
  font-size: 12px;
}

.count {
  color: var(--muted);
  font-size: 12px;
}

.anchor-list {
  display: grid;
  gap: 8px;
}

.anchor-group {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  overflow: hidden;
}

.anchor-group-title {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  padding: 8px 10px;
  user-select: none;
}

.anchor-group-title::-webkit-details-marker {
  display: none;
}

.anchor-group-title::marker {
  content: "";
}

.anchor-group-title::before {
  content: "";
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid var(--muted);
  transition: transform 120ms ease;
}

.anchor-group[open] .anchor-group-title::before {
  transform: rotate(90deg);
}

.anchor-group-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.anchor-group-count {
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
}

.anchor-group-items {
  display: grid;
  gap: 6px;
  padding: 0 8px 8px;
}

.anchor-row {
  width: 100%;
  text-align: left;
  display: grid;
  gap: 3px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  text-decoration: none;
  padding: 8px;
  border-radius: 7px;
  cursor: pointer;
}

.anchor-row:hover {
  border-color: #aeb9c5;
}

.anchor-row.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.anchor-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-weight: 650;
  line-height: 1.25;
}

.anchor-summary {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.anchor-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.content-area {
  min-width: 0;
  overflow: auto;
  padding: 18px 22px 28px;
}

.status-banner {
  border: 1px solid var(--border);
  background: var(--panel);
  border-left: 4px solid var(--accent);
  border-radius: 8px;
  padding: 11px 13px;
  margin-bottom: 12px;
  color: var(--muted);
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.tab.active,
.mode.active {
  border-color: var(--accent);
  background: var(--accent);
  color: white;
}

.view {
  display: none;
}

.view.active {
  display: block;
}

.view-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
}

.view-header h2,
.view-header p {
  margin: 0;
}

.view-header h2 {
  font-size: 24px;
  line-height: 1.2;
}

.view-header p {
  margin-top: 5px;
  color: var(--muted);
}

.view-header .readonly-note {
  margin-top: 8px;
  max-width: 720px;
  color: #4f5f6f;
  font-size: 13px;
}

.segmented {
  display: inline-flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  flex: none;
}

.segmented button {
  border: 0;
  border-radius: 0;
}

.markdown,
.raw-view,
.empty-state,
.metadata-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.markdown {
  padding: 22px;
  line-height: 1.55;
}

.markdown h1,
.markdown h2,
.markdown h3,
.markdown h4 {
  margin: 1.25em 0 0.4em;
  line-height: 1.2;
}

.markdown h1:first-child,
.markdown h2:first-child,
.markdown h3:first-child {
  margin-top: 0;
}

.markdown h2.defined-heading-empty {
  margin: 0.85em 0 0.2em;
}

.markdown h3.defined-heading-empty {
  margin: 0.45em 0 0.12em;
}

.markdown p {
  margin: 0.55em 0;
}

.markdown ul {
  margin: 0.45em 0 0.7em 1.2em;
  padding: 0;
}

.markdown code,
.raw-view {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.markdown code {
  background: var(--panel-strong);
  border-radius: 4px;
  padding: 1px 4px;
}

.markdown pre,
.raw-view {
  overflow: auto;
  white-space: pre-wrap;
}

.markdown pre {
  background: #15202b;
  color: #eef6ff;
  padding: 13px;
  border-radius: 7px;
}

.markdown pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  border-radius: 0;
}

.markdown-table-scroll {
  overflow-x: auto;
  margin: 0.9em 0;
  border: 1px solid var(--border);
  border-radius: 7px;
}

.markdown table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
}

.markdown th,
.markdown td {
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.markdown th {
  background: var(--panel-strong);
  color: var(--text);
  font-weight: 650;
}

.markdown tr:last-child td {
  border-bottom: 0;
}

.markdown .mermaid-block {
  position: relative;
  margin: 1em 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #ffffff;
}

.markdown .mermaid-block-toolbar {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  padding: 6px 8px 0;
}

.markdown .mermaid-block .mermaid {
  overflow: auto;
  margin: 0;
  padding: 14px;
  border: 0;
  border-radius: 0 0 7px 7px;
  background: #ffffff;
  color: #1f2937;
  text-align: center;
  white-space: pre-wrap;
}

.markdown > .mermaid {
  overflow: auto;
  margin: 1em 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #ffffff;
  color: #1f2937;
  text-align: center;
  white-space: pre-wrap;
}

.markdown .mermaid svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

.markdown .mermaid.mermaid-unavailable {
  background: #15202b;
  color: #eef6ff;
  text-align: left;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.unsafe-link {
  color: var(--muted);
  text-decoration: line-through;
}

.raw-view {
  padding: 18px;
  min-height: 360px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.detail-mode-row {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 10px;
}

.metadata-box {
  padding: 14px;
}

.metadata-box h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.current-state-organization-box {
  grid-column: 1 / -1;
}

.organization-summary,
.organization-note {
  margin: 7px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.retrieval-paths {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.retrieval-path {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-strong);
  padding: 4px 7px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
}

.planner-form {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 16px;
  margin-bottom: 14px;
}

.planner-form label {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.stack-form {
  display: grid;
  gap: 10px;
}

.priority-form {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.priority-field {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}

#priority-input {
  width: 7ch;
  min-width: 7ch;
}

.read-only-anchor .history-actions,
.read-only-anchor .detail-grid .metadata-box:nth-child(3) {
  background: #f8f9fb;
  border-color: #d2d8df;
}

.read-only-anchor #priority-input:disabled,
.read-only-anchor #rename-target:disabled,
.read-only-anchor #action-message:disabled {
  border-color: #cbd3dc;
}

.history-actions {
  margin-top: 14px;
  margin-bottom: 14px;
}

.stack-form label,
.proposal-filters label {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.form-grid,
.proposal-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.planner-task {
  margin-bottom: 12px;
}

.planner-controls {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.planner-checkbox {
  align-self: end;
  min-height: 38px;
}

.planner-results {
  display: grid;
  gap: 14px;
}

.planner-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 13px;
}

.metric strong {
  display: block;
  font-size: 18px;
  line-height: 1.2;
}

.metric span {
  color: var(--muted);
  font-size: 12px;
}

.planner-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.planner-list {
  display: grid;
  gap: 8px;
}

.planner-card {
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 10px;
  background: #fbfcfd;
}

.proposal-card {
  width: 100%;
  display: block;
  text-align: left;
}

.proposal-card.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.planner-card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
  font-weight: 650;
}

.planner-card-title span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.planner-card p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.compact-raw {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  background: #15202b;
  color: #eef6ff;
  border-radius: 7px;
  padding: 12px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
}

.badges,
.section-status,
.issue-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 650;
  border: 1px solid var(--border);
  background: var(--panel-strong);
}

.badge.ok {
  color: var(--ok);
  border-color: rgba(31, 143, 95, 0.28);
  background: rgba(31, 143, 95, 0.08);
}

.badge.warn {
  color: var(--warn);
  border-color: rgba(177, 106, 3, 0.28);
  background: rgba(177, 106, 3, 0.08);
}

.badge.block {
  color: var(--block);
  border-color: rgba(199, 53, 45, 0.28);
  background: rgba(199, 53, 45, 0.08);
}

.badge.readonly {
  color: #4f5f6f;
  border-color: #c4ccd5;
  background: #eef1f4;
}

.section-info-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-left: 5px;
  border: 1px solid currentColor;
  border-radius: 50%;
  color: var(--muted);
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  vertical-align: middle;
}

.section-info-icon:focus {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.section-info-tooltip {
  position: absolute;
  z-index: 20;
  left: calc(100% + 8px);
  top: 50%;
  width: max-content;
  max-width: min(320px, 75vw);
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #15202b;
  color: #eef6ff;
  box-shadow: 0 6px 18px rgba(16, 24, 32, 0.22);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
  transform: translateX(-2px) translateY(-50%);
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
}

.section-info-icon:hover .section-info-tooltip,
.section-info-icon:focus .section-info-tooltip,
.section-info-icon:focus-within .section-info-tooltip {
  visibility: visible;
  opacity: 1;
  transform: translateX(0) translateY(-50%);
}

.section-add-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  min-width: 22px;
  margin-left: 7px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel);
  color: var(--muted);
  font-size: 17px;
  font-weight: 500;
  line-height: 1;
  vertical-align: middle;
}

.section-add-button:hover,
.section-add-button:focus {
  border-color: var(--accent);
  color: var(--accent);
}

.section-add-editor {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  flex-wrap: wrap;
  margin: 4px 0 12px;
}

.section-add-editor textarea {
  width: min(620px, calc(100vw - 180px));
  min-width: min(360px, 100%);
  min-height: 58px;
  resize: vertical;
}

.issue {
  width: 100%;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  color: var(--muted);
}

.issue.warn {
  border-color: rgba(177, 106, 3, 0.28);
}

.issue.block {
  border-color: rgba(199, 53, 45, 0.28);
}

.empty-state {
  padding: 40px;
  color: var(--muted);
  text-align: center;
}

.trace-session {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 12px;
  padding: 10px 14px;
}

.trace-session-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.trace-task {
  color: var(--muted);
  font-style: italic;
  margin: 6px 0;
}

.trace-meta {
  color: var(--muted);
  font-size: 12px;
}

.trace-badge {
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 11px;
  padding: 1px 8px;
  text-transform: uppercase;
}

.trace-badge-exact {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.trace-event {
  border-top: 1px solid var(--border);
  margin-top: 6px;
  padding-top: 6px;
}

.trace-event summary {
  cursor: pointer;
}

.trace-event-summary {
  font-size: 12px;
}

.trace-config-hint {
  display: inline-block;
  margin: 12px auto;
  text-align: left;
}

.link-button {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-decoration: underline;
}

.trace-measures {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 6px 0;
}

.trace-rating {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0;
}

.trace-rate-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  padding: 3px 9px;
}

.trace-rate-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.trace-rating-label {
  font-style: italic;
}

.trace-timeline {
  margin-top: 8px;
}

.trace-query {
  border-top: 1px solid var(--border);
  margin-top: 6px;
  padding-top: 6px;
}

.trace-query-summary {
  cursor: pointer;
}

.trace-query.expanded .trace-query-summary {
  font-weight: 600;
}

.trace-result-line {
  color: var(--muted);
  font-size: 12px;
  margin-top: 2px;
}

.trace-warning {
  color: #b16a03;
  font-size: 12px;
  margin-top: 2px;
}

.trace-marker {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 11px;
  margin-left: 6px;
  padding: 0 6px;
}

.trace-marker-zero {
  border-color: rgba(199, 53, 45, 0.4);
  color: #c7352d;
}

.trace-query-detail {
  margin-top: 8px;
}

.trace-detail-columns {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, 1fr);
}

.trace-detail-col h4 {
  font-size: 12px;
  margin: 0 0 6px;
  text-transform: uppercase;
  color: var(--muted);
}

#traces-dry-table {
  border-collapse: collapse;
  width: 100%;
}

#traces-dry-table th,
#traces-dry-table td {
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  padding: 6px 8px;
  text-align: left;
}

.trace-dry-row {
  cursor: pointer;
}

.trace-dry-row:hover {
  background: var(--panel);
}

@media (max-width: 900px) {
  .trace-detail-columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .topbar {
    align-items: stretch;
    flex-direction: column;
  }

  .token-form {
    grid-template-columns: 1fr;
  }

  .workspace {
    grid-template-columns: 1fr;
  }

  .sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
    max-height: 52vh;
  }

  .view-header,
  .detail-grid,
  .planner-controls,
  .planner-summary,
  .planner-grid,
  .form-grid,
  .proposal-filters {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}

.tasks-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.tasks-filters select,
.tasks-filters input[type="number"],
.tasks-filters input[type="date"] {
  font: inherit;
  font-size: 13px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  color: var(--text);
}

.task-report-field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text);
}

.task-report-field input {
  width: 72px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}

.task-group-header {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 16px 0 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}

.task-group-toggle {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
}

.task-group-toggle:hover {
  color: var(--text);
  border: none;
}

.task-group-triangle {
  display: block;
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid currentColor;
}

.task-group-toggle[aria-expanded="true"] .task-group-triangle {
  transform: rotate(90deg);
}

.task-group-heading {
  min-width: 0;
}

.task-group-header.overdue {
  color: var(--error, #c7352d);
}

.task-group-header.due-soon {
  color: #b16a03;
}

.task-row {
  display: grid;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--panel-strong);
}

.task-row:last-child {
  border-bottom: none;
}

.task-row.focus {
  background: var(--panel-strong);
  box-shadow: inset 3px 0 0 var(--accent);
}

.task-row.task-state-blocked,
.detail-task.task-state-blocked {
  background: rgba(177, 106, 3, 0.08);
  box-shadow: inset 3px 0 0 var(--warn);
}

.task-row.task-state-completed,
.detail-task.task-state-completed {
  background: rgba(31, 143, 95, 0.08);
  box-shadow: inset 3px 0 0 var(--ok);
}

.task-row.task-state-overdue,
.detail-task.task-state-overdue {
  background: rgba(199, 53, 45, 0.08);
  box-shadow: inset 3px 0 0 var(--block);
}

.badge.task-status-blocked {
  color: var(--warn);
  border-color: rgba(177, 106, 3, 0.28);
  background: rgba(177, 106, 3, 0.08);
}

.badge.task-status-completed {
  color: var(--ok);
  border-color: rgba(31, 143, 95, 0.28);
  background: rgba(31, 143, 95, 0.08);
}

.badge.task-status-overdue {
  color: var(--block);
  border-color: rgba(199, 53, 45, 0.28);
  background: rgba(199, 53, 45, 0.08);
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  margin-top: 3px;
}

.task-title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
}

.task-notes-preview,
.detail-task-notes {
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
  white-space: pre-wrap;
}

.project-priority-badge,
.task-priority-badge {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

.project-priority-badge.missing,
.task-priority-badge.missing {
  border-color: var(--border);
  color: var(--muted);
  font-weight: 600;
}

.claim-inline,
.editable-bullet-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.claim-epistemology {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.claim-epistemology-button {
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  border-radius: 50%;
  color: #57606a;
  background: var(--panel);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.claim-text-edit-button,
.bullet-text-edit-button,
.mermaid-text-edit-button {
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  border-radius: 50%;
  color: #57606a;
  background: var(--panel);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.claim-epistemology-button svg,
.claim-text-edit-button svg,
.bullet-text-edit-button svg,
.mermaid-text-edit-button svg {
  width: 15px;
  height: 15px;
}
.claim-text-editor {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  flex-wrap: wrap;
  max-width: 100%;
}
.claim-text-editor textarea {
  width: min(620px, calc(100vw - 180px));
  min-width: min(420px, 100%);
  min-height: 62px;
  resize: vertical;
}
.claim-text-editor-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.claim-text-editor-result {
  color: var(--muted);
  font-size: 12px;
  align-self: center;
}
.claim-strength-low {
  color: #cf222e;
  border-color: rgba(207, 34, 46, 0.45);
  background: rgba(248, 81, 73, 0.14);
}
.claim-strength-medium {
  color: #9a6700;
  border-color: rgba(154, 103, 0, 0.45);
  background: rgba(210, 153, 34, 0.18);
}
.claim-strength-high {
  color: #1a7f37;
  border-color: rgba(26, 127, 55, 0.45);
  background: rgba(46, 160, 67, 0.16);
}
.claim-popover {
  position: absolute;
  left: 0;
  top: 30px;
  z-index: 30;
  width: min(360px, calc(100vw - 48px));
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: var(--shadow);
  display: none;
  color: var(--text);
  font-size: 0.84rem;
  line-height: 1.35;
}
.claim-popover::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -6px;
  height: 6px;
}
.claim-epistemology:hover .claim-popover,
.claim-epistemology:focus-within .claim-popover {
  display: block;
}
.claim-popover-title {
  font-weight: 700;
  margin-bottom: 6px;
}
.claim-popover-row {
  display: block;
  padding: 5px 0;
  border-top: 1px solid var(--panel-strong);
}
.claim-popover-row:first-of-type {
  border-top: 0;
}
.claim-popover-meta {
  display: block;
  color: var(--muted);
  font-size: 0.78rem;
}
.claim-editor {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.claim-editor input[type="text"] {
  flex: 1;
  min-width: 240px;
}
.claim-editor-result {
  font-size: 0.85rem;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal-backdrop[hidden] {
  display: none;
}
.modal-dialog {
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 18px;
}
.claim-source-dialog {
  width: min(1120px, calc(100vw - 48px));
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.modal-header h2 {
  margin: 0;
  font-size: 20px;
}
.modal-header p {
  margin: 4px 0 0;
  color: var(--muted);
}
.icon-button {
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 20px;
  line-height: 1;
}
.danger-button {
  color: var(--block);
  border-color: rgba(199, 53, 45, 0.45);
  background: rgba(199, 53, 45, 0.08);
}
.danger-button:hover {
  border-color: var(--block);
  background: rgba(199, 53, 45, 0.14);
}
.detail-neighbors {
  margin-top: 16px;
}
.neighbors-body {
  margin-top: 8px;
  color: var(--muted);
}
.neighbors-group {
  margin-top: 12px;
}
.neighbors-group-title {
  margin: 0 0 4px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.neighbors-list {
  margin: 0;
  padding-left: 18px;
}
.neighbors-row {
  margin: 2px 0;
  color: var(--text);
}
.neighbors-empty {
  color: var(--muted);
  margin: 8px 0 0;
}
.claim-source-edge-label {
  grid-column: 1 / -1;
}
.claim-source-rows {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}
.claim-source-row {
  display: grid;
  grid-template-columns: minmax(110px, 0.75fr) minmax(260px, 2fr) minmax(140px, 0.9fr) minmax(110px, 0.7fr) minmax(92px, 0.55fr) minmax(108px, auto);
  gap: 8px;
  align-items: end;
}
.claim-source-person-label {
  display: none;
}
.claim-source-row[data-requires-person="1"] .claim-source-src-label {
  display: none;
}
.claim-source-row[data-requires-person="1"] .claim-source-person-label {
  display: block;
}
.claim-source-row label {
  min-width: 0;
}
.claim-source-row input,
.claim-source-row select {
  width: 100%;
}
.claim-source-delete {
  gap: 6px;
  white-space: nowrap;
}
.claim-source-id-display {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.claim-source-id-display code {
  color: var(--text);
}
.claim-person-add {
  margin: 6px 0 12px;
}
.claim-person-add-grid {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(180px, 1.2fr) auto;
  gap: 8px;
  align-items: end;
  margin-top: 8px;
}
.claim-source-type-config {
  margin-bottom: 14px;
}
.claim-source-types-list {
  display: grid;
  gap: 8px;
  margin: 8px 0 10px;
}
.claim-source-type-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.9fr) minmax(160px, 1.2fr) auto minmax(120px, 0.7fr) auto;
  gap: 8px;
  align-items: end;
}
.claim-source-type-row label {
  min-width: 0;
}
.claim-source-type-row input,
.claim-source-type-row select {
  width: 100%;
}
@media (max-width: 900px) {
  .claim-source-dialog {
    width: 100%;
  }
  .claim-source-row,
  .claim-person-add-grid,
  .claim-source-type-row {
    grid-template-columns: 1fr;
  }
  .claim-source-delete {
    justify-self: start;
  }
  .claim-text-editor,
  .claim-text-editor textarea {
    width: 100%;
  }
}
.detail-tasks {
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--panel-strong);
  border-radius: 8px;
  background: var(--panel-strong);
}

.detail-tasks-heading {
  margin: 0 0 8px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.detail-task {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
}

.detail-task + .detail-task {
  margin-top: 4px;
}

.detail-task.focus {
  border-color: var(--accent);
  background: var(--panel);
}

.task-row.focus,
.detail-task.focus {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.detail-task-title {
  font-size: 14px;
  font-weight: 500;
}

.detail-task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  margin-top: 4px;
}

.detail-task-edit {
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
}

.detail-task-edit:hover {
  text-decoration: underline;
}

.task-milestone-link {
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
}

.task-edit-details {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.55);
}

.task-edit-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
  list-style: none;
  padding: 7px 9px;
  user-select: none;
}

.task-edit-summary::-webkit-details-marker {
  display: none;
}

.task-edit-summary::marker {
  content: "";
}

.task-edit-summary::before {
  content: "";
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 6px solid currentColor;
  transition: transform 120ms ease;
}

.task-edit-details[open] .task-edit-summary::before {
  transform: rotate(90deg);
}

.task-edit-details[open] .task-edit-summary {
  border-bottom: 1px solid var(--border);
}

.task-edit-details:not([open]) .task-edit-forms {
  display: none;
}

.task-edit-forms {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(130px, 0.6fr) minmax(250px, 1.2fr);
  gap: 10px 12px;
  align-items: start;
  min-width: 0;
  padding: 10px;
}

.task-due-form,
.task-owner-form,
.task-priority-form,
.task-notes-form {
  display: grid;
  gap: 6px;
  align-items: end;
  width: 100%;
}

.task-owner-form,
.task-priority-form {
  grid-template-columns: minmax(0, 1fr) auto;
}

.task-due-form {
  grid-template-columns: minmax(120px, 1fr) minmax(130px, 1fr) auto;
}

.task-notes-form {
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto;
}

.task-edit-label {
  display: grid;
  gap: 3px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.2;
}

.task-due-form input[type="date"],
.task-due-form select,
.task-owner-form input[type="text"],
.task-priority-form input[type="number"],
.task-notes-form textarea {
  font: inherit;
  font-size: 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 6px;
  color: var(--text);
}

.task-owner-form input[type="text"],
.task-priority-form input[type="number"],
.task-notes-form textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}

.task-notes-form textarea {
  min-height: 64px;
  resize: vertical;
}

.task-due-controls,
.task-owner-controls,
.task-priority-controls,
.task-notes-controls {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.task-due-result,
.task-owner-result,
.task-priority-result,
.task-notes-result {
  font-size: 11px;
  color: var(--muted);
  min-height: 14px;
  text-align: left;
}

.task-owner-result,
.task-priority-result {
  grid-column: 1 / -1;
}

.task-due-result {
  grid-column: 1 / -1;
}

.task-notes-result {
  grid-column: 1 / -1;
}

@media (max-width: 900px) {
  .task-edit-forms,
  .task-owner-form,
  .task-priority-form,
  .task-due-form,
  .task-notes-form {
    grid-template-columns: 1fr;
  }

  .task-due-controls,
  .task-owner-controls,
  .task-priority-controls,
  .task-notes-controls {
    justify-content: flex-start;
  }
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.task-action-result {
  font-size: 11px;
  color: var(--muted);
}

.badge.task-unassigned {
  background: #fff7e6;
  border-color: #f0c987;
  color: #8a5a00;
}

.compact-action {
  font-size: 12px;
  padding: 3px 8px;
}

.registry-cards {
  display: grid;
  gap: 12px;
  padding: 4px 0;
}

.registry-search {
  min-width: 180px;
  max-width: 260px;
}

.registry-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

.registry-card-flash {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent);
}

.registry-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.registry-card-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.registry-card-id {
  font-size: 12px;
  color: var(--muted);
  font-family: ui-monospace, monospace;
  margin-top: 2px;
}

.registry-card-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.registry-card-actions button {
  font-size: 12px;
  padding: 4px 10px;
}

.registry-section {
  margin-top: 10px;
  font-size: 13px;
}

.registry-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: 5px;
}

.registry-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.registry-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--panel-strong);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
}

.registry-chip.link-chip {
  cursor: pointer;
  color: var(--accent);
  background: var(--accent-soft);
  border-color: #c3d9ff;
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
}

.registry-chip.link-chip:hover {
  border-color: var(--accent);
}

.registry-chip.link-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.registry-chip.role-chip {
  background: #f0f9f4;
  border-color: #b2d8c4;
  color: var(--ok);
}

.registry-chip.warn-chip {
  background: #fff7e6;
  border-color: #f0c987;
  color: #8a5a00;
}

.assoc-warn {
  color: var(--warn);
  cursor: help;
}

.assoc-overview {
  margin: 4px 0 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 6px 12px;
}

.assoc-overview > summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  padding: 4px 0;
}

.assoc-overview .assoc-overview-body {
  padding: 8px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.registry-edit-form {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.registry-edit-form .form-grid {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.registry-edit-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.registry-edit-form input,
.registry-edit-form select,
.registry-edit-form textarea {
  font-size: 13px;
  padding: 5px 8px;
}

.registry-assoc-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}

.registry-assoc-row input,
.registry-assoc-row select {
  font-size: 12px;
  padding: 4px 7px;
}

.registry-result {
  font-size: 12px;
  color: var(--muted);
  margin: 8px 0 0;
  min-height: 16px;
}

.registry-add-form {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: var(--shadow);
}

.registry-add-form h3 {
  margin: 0 0 12px;
  font-size: 14px;
}

.registry-add-form .form-grid {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.registry-add-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.coverage-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.coverage-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--panel);
  box-shadow: var(--shadow);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.coverage-card strong {
  font-size: 20px;
  line-height: 1.2;
}

.coverage-card span {
  color: var(--muted);
  font-size: 12px;
}

.coverage-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent) inset;
}

.coverage-card.coverage-card-total {
  cursor: default;
  background: var(--panel-strong);
}

.coverage-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.coverage-filters label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.coverage-filters select,
.coverage-filters input[type="search"] {
  font: inherit;
  font-size: 13px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  color: var(--text);
  min-width: 200px;
}

#coverage-table th,
#coverage-table td {
  text-align: left;
  vertical-align: top;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

#coverage-table .coverage-reason,
#coverage-table .coverage-operation {
  display: block;
  margin-bottom: 4px;
}

#coverage-table .coverage-reason:last-child,
#coverage-table .coverage-operation:last-child {
  margin-bottom: 0;
}

#coverage-table .coverage-reason-code,
#coverage-table .coverage-operation-code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  color: var(--muted);
  margin-right: 5px;
}

.coverage-count {
  font-size: 12px;
  color: var(--muted);
  margin: 10px 0;
}
`;

export const UI_JS = `(function () {
  var DEFAULT_ANCHOR_SORT = "priority";
  var DEFAULT_TASK_GROUP_BY = "project";
  var DEFAULT_TASK_SORT = "projectPriority";
  var ANCHOR_BATCH_SIZE = 50;
  var mermaidRuntimePromise = null;
  var mermaidInitialized = false;
  var KNOWN_URL_PARAMS = [
    "anchor",
    "view",
    "search",
    "project",
    "category",
    "tag",
    "includeArchive",
    "sort",
    "rootMode",
    "detailMode",
    "plannerTask",
    "plannerProject",
    "plannerCategory",
    "plannerTag",
    "plannerRuntime",
    "plannerBudget",
    "plannerMaxAnchors",
    "plannerMaxExcluded",
    "plannerArchive",
    "proposalProject",
    "proposalStatus",
    "proposal",
    "tasksProject",
    "tasksStatus",
    "tasksGroup",
    "tasksSort",
    "tasksCompletedDays",
    "tasksDueDays",
    "tasksProjectPriorityMax",
    "tasksTaskPriorityMax",
    "tasksPriorityMax",
    "tasksModifiedAfter",
    "tasksNoDue",
    "tasksUnassigned",
    "coverageProject",
    "coverageStates",
    "coverageSearch",
    // Legacy standalone Claims tab parameters; keep them here so URL rewrites
    // drop stale filters after that tab was folded into inline anchor editing.
    "claimsProject",
    "claimsStatus",
    "claimsSection",
    "claimsConf",
    "claimsSearch",
    "claimsObservedBefore",
    "claimsGroup",
    "claimsSort"
  ];

  var state = {
    anchors: [],
    anchorTotal: null,
    anchorLoading: false,
    anchorLoadId: 0,
    root: null,
    rootLoading: false,
    pendingAnchor: readAnchorFromLocation(),
    selectedName: null,
    rootMode: "rendered",
    detailMode: "rendered",
    activeTab: "root",
    plannerPlans: [],
    plannerLastLoadContext: null,
    plannerLastPlan: null,
    selectedAnchor: null,
    proposals: [],
    activeProposal: null,
    anchorVersions: [],
    expandedAnchorGroups: new Set(),
    anchorGroupSort: DEFAULT_ANCHOR_SORT,
    tasks: [],
    tasksLoading: false,
    traces: null,
    tracesLoading: false,
    tracesMode: "timeline",
    tracesExpandedQuery: null,
    dryQueries: null,
    dryQueriesLoading: false,
    dryQueriesThinNoFollowUp: false,
    pendingTaskFocus: null,
    tasksProject: "",
    tasksStatus: "active,todo,blocked",
    tasksGroupBy: DEFAULT_TASK_GROUP_BY,
    tasksSort: DEFAULT_TASK_SORT,
    tasksCompletedDays: "",
    tasksDueDays: "",
    tasksProjectPriorityMax: "",
    tasksTaskPriorityMax: "",
    tasksModifiedAfter: "",
    tasksNoDue: false,
    tasksUnassigned: false,
    collapsedTaskGroups: new Set(),
    taskOwnerMatchCache: [],
    taskOwnerSearchTimer: null,
    taskOwnerSearchSeq: 0,
    registry: null,
    registryLoading: false,
    registryFileCommit: null,
    projectMappings: null,
    projectMappingsLoading: false,
    projectMappingsFileCommit: null,
    peopleSearch: "",
    teamsSearch: "",
    selectedPersonId: null,
    selectedTeamId: null,
    claimSourceModal: null,
    claimTextEditor: null,
    bulletTextEditor: null,
    mermaidTextEditor: null,
    sectionAddEditor: null,
    claimPersonMatchCache: [],
    claimPersonSearchTimer: null,
    claimPersonSearchSeq: 0,
    claimPersonInput: null,
    coverage: null,
    coverageRecords: [],
    coverageNextCursor: null,
    coverageLoading: false,
    coverageLoadMoreLoading: false,
    coverageProject: "",
    coverageStates: [],
    coverageText: "",
    // Union of every project slug seen across any coverage load, so the
    // project filter's own option list never shrinks just because a project
    // filter is currently narrowing state.coverageRecords server-side (the
    // dropdown must still offer every other project to switch back to).
    coverageKnownProjects: []
  };

  var categories = ["", "server-rules", "agent-rules", "projects", "invariants", "conflicts", "shared", "archive"];
  var tokenStorageKey = "anchor-mcp-token";
  var SERVER_RULES_PREFIX = "server-rules/";
  var SERVER_RULE_READ_ONLY_MESSAGE = "Built-in server rules are read-only. They ship with anchor-mcp and cannot be edited from this UI.";
  var DEFAULT_CLAIM_SOURCE_TYPES = [
    { id: "url", label: "URL" },
    { id: "design-doc", label: "Design Doc" },
    { id: "adr", label: "ADR" },
    { id: "misc", label: "Misc" },
    { id: "trust-me-bro", label: "trust me bro", requiresPerson: true, lockedConfidence: "high" }
  ];
  var READ_ONLY_DETAIL_CONTROL_IDS = [
    "priority-input",
    "update-priority",
    "rename-target",
    "action-message",
    "rename-anchor",
    "delete-anchor"
  ];

  function readAnchorFromLocation() {
    var queryAnchor = new URLSearchParams(window.location.search).get("anchor");
    if (queryAnchor) {
      return queryAnchor;
    }
    var hash = window.location.hash || "";
    if (hash.indexOf("#anchor=") !== 0) {
      return null;
    }
    try {
      return decodeURIComponent(hash.slice("#anchor=".length));
    } catch (_error) {
      return hash.slice("#anchor=".length);
    }
  }

  function anchorHref(anchorName) {
    var params = paramsForState({ anchor: anchorName, view: "detail" });
    var query = params.toString();
    return query ? "?" + query : window.location.pathname;
  }

  function tasksHref() {
    var params = paramsForState({ anchor: null, view: "tasks" });
    var query = params.toString();
    return query ? "?" + query : window.location.pathname;
  }

  function updateAnchorLocation(anchorName) {
    updateLocationFromState({ anchor: anchorName, view: "detail", history: "push" });
  }

  function clearAnchorLocation() {
    updateLocationFromState({ anchor: null, view: "root", history: "push" });
  }

  function safeEl(id) {
    return document && typeof document.getElementById === "function" ? document.getElementById(id) : null;
  }

  function controlValue(id, fallback) {
    var node = safeEl(id);
    if (!node) {
      return fallback || "";
    }
    return typeof node.value === "string" ? node.value : fallback || "";
  }

  function controlChecked(id, fallback) {
    var node = safeEl(id);
    return node ? Boolean(node.checked) : Boolean(fallback);
  }

  function setControlValue(id, value) {
    var node = safeEl(id);
    if (node) {
      node.value = value || "";
    }
  }

  function setControlChecked(id, value) {
    var node = safeEl(id);
    if (node) {
      node.checked = Boolean(value);
    }
  }

  function readBooleanParam(params, key) {
    var value = params.get(key);
    return value === "1" || String(value || "").toLowerCase() === "true";
  }

  function validTab(value) {
    return value === "root" || value === "planner" || value === "tasks" || value === "traces" || value === "coverage" || value === "people" || value === "teams" || value === "mappings" || value === "review" || value === "detail" ? value : null;
  }

  function validRootMode(value) {
    return value === "raw" || value === "rendered" ? value : "rendered";
  }

  function validDetailMode(value) {
    return value === "raw" || value === "frontmatter" || value === "rendered" ? value : "rendered";
  }

  function validTasksGroupBy(value) {
    return value === "due" ? "due" : DEFAULT_TASK_GROUP_BY;
  }

  function validTasksSort(value) {
    return value === "dueAsc"
      || value === "dueDesc"
      || value === "projectPriority"
      || value === "taskPriority"
      || value === "projectName"
      || value === "modifiedDesc"
      ? value
      : DEFAULT_TASK_SORT;
  }

  // ---------------------------------------------------------------------
  // Schema Coverage tab (Goal 0 Phase 2, WP-B). Mirrors, in plain ES5, the
  // pure filtering/labeling/URL-round-trip/cursor-append semantics unit
  // tested in src/ui/viewModel.ts (that module cannot be imported into this
  // browser-served string -- see UI_JS's own module boundary -- so the
  // logic is intentionally duplicated here, the same way Tasks' group/sort
  // validators and taskGroupsForDisplay have no server-side counterpart).
  // ---------------------------------------------------------------------
  var COVERAGE_STATE_ORDER = ["malformed", "dangling", "ambiguous", "partial", "structured", "prose_only"];
  var COVERAGE_STATE_LABELS = {
    structured: "Structured",
    partial: "Partial",
    prose_only: "Prose only",
    ambiguous: "Ambiguous",
    dangling: "Dangling",
    malformed: "Malformed"
  };
  var COVERAGE_PAGE_LIMIT = 100;

  function isValidCoverageState(value) {
    return Object.prototype.hasOwnProperty.call(COVERAGE_STATE_LABELS, value);
  }

  function validCoverageStates(raw) {
    if (!raw) {
      return [];
    }
    return String(raw).split(",").map(function (value) {
      return value.trim();
    }).filter(isValidCoverageState);
  }

  // Coverage helpers below (coverageStateLabel, coverageKindLabel,
  // coverageRecordKey, appendCoverageRecords, filterCoverageRecords) are ES5
  // mirrors of the same-named unit-tested exports in src/ui/viewModel.ts;
  // behavior changes must land in both. The URL round-trip and server query
  // mirrors are annotated at their sites (coverageQueryString and the
  // coverage blocks in applyUrlStateToControls/paramsForState).
  function coverageStateLabel(state) {
    return COVERAGE_STATE_LABELS[state] || state;
  }

  function coverageKindLabel(kind) {
    return kind === "claim" ? "Claim" : "Anchor";
  }

  function coverageRecordKey(record) {
    var line = record.kind === "claim" ? record.line : -1;
    return record.kind + "\\n" + record.anchorName + "\\n" + line;
  }

  function appendCoverageRecords(existing, nextPage) {
    var seen = {};
    existing.forEach(function (record) {
      seen[coverageRecordKey(record)] = true;
    });
    var appended = nextPage.filter(function (record) {
      var key = coverageRecordKey(record);
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
    return existing.concat(appended);
  }

  function deriveCoverageProjects(records) {
    var set = {};
    records.forEach(function (record) {
      if (record.kind === "anchor" && record.projectSlug) {
        set[record.projectSlug] = true;
      }
    });
    return Object.keys(set).sort();
  }

  function currentCoverageFilters() {
    return {
      project: controlValue("coverage-project-filter", state.coverageProject),
      states: state.coverageStates || [],
      text: controlValue("coverage-text-filter", state.coverageText).trim().toLowerCase()
    };
  }

  function filterCoverageRecords(records, filters) {
    var stateSet = filters.states && filters.states.length > 0 ? {} : null;
    if (stateSet) {
      filters.states.forEach(function (value) { stateSet[value] = true; });
    }
    var text = filters.text;
    // Project scoping is server-side only (the project= query param): claim
    // records carry no projectSlug, so a client-side project comparison
    // would silently drop every claim row. Mirrors filterCoverageRecords in
    // src/ui/viewModel.ts.
    return records.filter(function (record) {
      if (stateSet && !stateSet[record.state]) {
        return false;
      }
      if (text && record.anchorName.toLowerCase().indexOf(text) === -1) {
        return false;
      }
      return true;
    });
  }

  // Mirrors coverageQueryParams in src/ui/viewModel.ts.
  function coverageQueryString(filters, cursor) {
    var qs = [];
    if (filters.project) qs.push("project=" + encodeURIComponent(filters.project));
    if (filters.states && filters.states.length > 0) qs.push("states=" + encodeURIComponent(filters.states.join(",")));
    qs.push("limit=" + COVERAGE_PAGE_LIMIT);
    if (cursor) qs.push("cursor=" + encodeURIComponent(cursor));
    return qs.join("&");
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function addIsoDays(isoDate, days) {
    var date = new Date(String(isoDate) + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function positiveIntegerValue(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : "";
  }

  function finiteNumberValue(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    var parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : "";
  }

  function taskReportRanges(completedDaysRaw, dueDaysRaw, today) {
    var base = today || todayIso();
    var completedDays = positiveIntegerValue(completedDaysRaw);
    var dueDays = positiveIntegerValue(dueDaysRaw);
    return {
      completedDays: completedDays,
      dueDays: dueDays,
      completedAfter: completedDays ? addIsoDays(base, -completedDays) : "",
      completedBefore: completedDays ? addIsoDays(base, 1) : "",
      dueAfter: dueDays ? base : "",
      dueBefore: dueDays ? addIsoDays(base, dueDays + 1) : ""
    };
  }

  function applyUrlStateToControls() {
    var params = new URLSearchParams(window.location.search);
    state.pendingAnchor = readAnchorFromLocation();
    state.anchorGroupSort = validAnchorGroupSort(params.get("sort") || DEFAULT_ANCHOR_SORT);
    state.rootMode = validRootMode(params.get("rootMode"));
    state.detailMode = validDetailMode(params.get("detailMode"));
    state.activeTab = validTab(params.get("view")) || (state.pendingAnchor ? "detail" : "root");

    setControlValue("search-input", params.get("search") || "");
    setSelectValueAllowingNew("project-filter", params.get("project") || "");
    setSelectValueAllowingNew("category-filter", params.get("category") || "");
    setSelectValueAllowingNew("tag-filter", params.get("tag") || "");
    setControlChecked("archive-filter", readBooleanParam(params, "includeArchive"));
    setControlValue("anchor-group-sort", state.anchorGroupSort);

    setControlValue("planner-task", params.get("plannerTask") || "");
    setSelectValueAllowingNew("planner-project", params.get("plannerProject") || "");
    setSelectValueAllowingNew("planner-category", params.get("plannerCategory") || "");
    setSelectValueAllowingNew("planner-tag", params.get("plannerTag") || "");
    setControlValue("planner-runtime", params.get("plannerRuntime") || "");
    setControlValue("planner-repo", params.get("plannerRepo") || "");
    setControlValue("planner-filepaths", params.get("plannerFilePaths") || "");
    setControlValue("planner-budget", params.get("plannerBudget") || controlValue("planner-budget", "4000"));
    setControlValue("planner-max-anchors", params.get("plannerMaxAnchors") || controlValue("planner-max-anchors", "12"));
    setControlValue("planner-max-excluded", params.get("plannerMaxExcluded") || controlValue("planner-max-excluded", "20"));
    setControlChecked("planner-archive", readBooleanParam(params, "plannerArchive"));

    setControlValue("proposal-project", params.get("proposalProject") || "");
    if (params.get("proposalStatus") === "all") {
      setControlValue("proposal-status-filter", "");
    } else {
      setControlValue("proposal-status-filter", params.get("proposalStatus") || controlValue("proposal-status-filter", "pending"));
    }

    state.tasksProject = params.get("tasksProject") || "";
    state.tasksStatus = params.get("tasksStatus") || "active,todo,blocked";
    state.tasksGroupBy = validTasksGroupBy(params.get("tasksGroup"));
    state.tasksSort = validTasksSort(params.get("tasksSort"));
    state.tasksCompletedDays = params.get("tasksCompletedDays") || "";
    state.tasksDueDays = params.get("tasksDueDays") || "";
    state.tasksProjectPriorityMax = params.get("tasksProjectPriorityMax") || params.get("tasksPriorityMax") || "";
    state.tasksTaskPriorityMax = params.get("tasksTaskPriorityMax") || "";
    state.tasksModifiedAfter = params.get("tasksModifiedAfter") || "";
    state.tasksNoDue = params.get("tasksNoDue") === "true";
    state.tasksUnassigned = params.get("tasksUnassigned") === "true";
    setSelectValueAllowingNew("tasks-project-filter", state.tasksProject);
    setControlValue("tasks-status-filter", state.tasksStatus);
    setControlValue("tasks-group-by", state.tasksGroupBy);
    setControlValue("tasks-sort", state.tasksSort);
    setControlValue("tasks-completed-days", state.tasksCompletedDays);
    setControlValue("tasks-due-days", state.tasksDueDays);
    setControlValue("tasks-project-priority-max", state.tasksProjectPriorityMax);
    setControlValue("tasks-task-priority-max", state.tasksTaskPriorityMax);
    setControlValue("tasks-modified-after", state.tasksModifiedAfter);
    setControlChecked("tasks-no-due", state.tasksNoDue);
    setControlChecked("tasks-unassigned", state.tasksUnassigned);

    // Mirrors coverageFiltersFromUrlParams in src/ui/viewModel.ts (the URL
    // round-trip runs through this generic tab URL wiring, not a dedicated
    // coverage function).
    state.coverageProject = params.get("coverageProject") || "";
    state.coverageStates = validCoverageStates(params.get("coverageStates"));
    state.coverageText = params.get("coverageSearch") || "";
    setSelectValueAllowingNew("coverage-project-filter", state.coverageProject);
    setControlValue("coverage-text-filter", state.coverageText);
  }

  function urlForState(overrides) {
    var params = paramsForState(overrides || {});
    var query = params.toString();
    return window.location.pathname + (query ? "?" + query : "");
  }

  function paramsForState(overrides) {
    var sourceParams = new URLSearchParams(window.location.search);
    var params = new URLSearchParams(window.location.search);
    KNOWN_URL_PARAMS.forEach(function (key) {
      params.delete(key);
    });

    var anchor = Object.prototype.hasOwnProperty.call(overrides, "anchor")
      ? overrides.anchor
      : state.activeTab === "detail" ? state.selectedName : null;
    var view = overrides.view || state.activeTab || "root";

    if (anchor) {
      params.set("anchor", anchor);
      view = view || "detail";
    }
    if (view && !(view === "root" && !anchor) && !(view === "detail" && anchor)) {
      params.set("view", view);
    }

    setParam(params, "search", controlValue("search-input", sourceParams.get("search") || ""));
    setParam(params, "project", controlValue("project-filter", sourceParams.get("project") || ""));
    setParam(params, "category", controlValue("category-filter", sourceParams.get("category") || ""));
    setParam(params, "tag", controlValue("tag-filter", sourceParams.get("tag") || ""));
    if (controlChecked("archive-filter", readBooleanParam(sourceParams, "includeArchive"))) {
      params.set("includeArchive", "true");
    }
    var sortControl = safeEl("anchor-group-sort");
    var effectiveSort = sortControl
      ? validAnchorGroupSort(sortControl.value)
      : state.anchorGroupSort === DEFAULT_ANCHOR_SORT && sourceParams.get("sort")
        ? validAnchorGroupSort(sourceParams.get("sort"))
        : state.anchorGroupSort;
    if (effectiveSort !== DEFAULT_ANCHOR_SORT) {
      params.set("sort", effectiveSort);
    }
    if (state.rootMode !== "rendered") {
      params.set("rootMode", state.rootMode);
    }
    if (state.detailMode !== "rendered") {
      params.set("detailMode", state.detailMode);
    }

    setParam(params, "plannerTask", controlValue("planner-task", sourceParams.get("plannerTask") || ""));
    setParam(params, "plannerProject", controlValue("planner-project", sourceParams.get("plannerProject") || ""));
    setParam(params, "plannerCategory", controlValue("planner-category", sourceParams.get("plannerCategory") || ""));
    setParam(params, "plannerTag", controlValue("planner-tag", sourceParams.get("plannerTag") || ""));
    setParam(params, "plannerRuntime", controlValue("planner-runtime", sourceParams.get("plannerRuntime") || ""));
    setParam(params, "plannerRepo", controlValue("planner-repo", sourceParams.get("plannerRepo") || ""));
    setParam(params, "plannerFilePaths", controlValue("planner-filepaths", sourceParams.get("plannerFilePaths") || ""));
    setNonDefaultParam(params, "plannerBudget", controlValue("planner-budget", sourceParams.get("plannerBudget") || ""), "4000");
    setNonDefaultParam(params, "plannerMaxAnchors", controlValue("planner-max-anchors", sourceParams.get("plannerMaxAnchors") || ""), "12");
    setNonDefaultParam(params, "plannerMaxExcluded", controlValue("planner-max-excluded", sourceParams.get("plannerMaxExcluded") || ""), "20");
    if (controlChecked("planner-archive", readBooleanParam(sourceParams, "plannerArchive"))) {
      params.set("plannerArchive", "true");
    }

    setParam(params, "proposalProject", controlValue("proposal-project", sourceParams.get("proposalProject") || ""));
    var proposalStatus = controlValue("proposal-status-filter", sourceParams.get("proposalStatus") || "pending");
    if (proposalStatus && proposalStatus !== "pending") {
      params.set("proposalStatus", proposalStatus);
    } else if (!proposalStatus) {
      params.set("proposalStatus", "all");
    }
    if ((overrides.view || state.activeTab) === "review" && state.activeProposal && state.activeProposal.id) {
      params.set("proposal", state.activeProposal.id);
    }

    setParam(params, "tasksProject", controlValue("tasks-project-filter", sourceParams.get("tasksProject") || ""));
    var tasksStatus = controlValue("tasks-status-filter", sourceParams.get("tasksStatus") || "active,todo,blocked");
    setNonDefaultParam(params, "tasksStatus", tasksStatus, "active,todo,blocked");
    var tasksGroupBy = validTasksGroupBy(controlValue("tasks-group-by", sourceParams.get("tasksGroup") || DEFAULT_TASK_GROUP_BY));
    setNonDefaultParam(params, "tasksGroup", tasksGroupBy, DEFAULT_TASK_GROUP_BY);
    var tasksSort = validTasksSort(controlValue("tasks-sort", sourceParams.get("tasksSort") || DEFAULT_TASK_SORT));
    setNonDefaultParam(params, "tasksSort", tasksSort, DEFAULT_TASK_SORT);
    setParam(params, "tasksCompletedDays", controlValue("tasks-completed-days", sourceParams.get("tasksCompletedDays") || ""));
    setParam(params, "tasksDueDays", controlValue("tasks-due-days", sourceParams.get("tasksDueDays") || ""));
    setParam(params, "tasksProjectPriorityMax", controlValue("tasks-project-priority-max", sourceParams.get("tasksProjectPriorityMax") || sourceParams.get("tasksPriorityMax") || ""));
    setParam(params, "tasksTaskPriorityMax", controlValue("tasks-task-priority-max", sourceParams.get("tasksTaskPriorityMax") || ""));
    setParam(params, "tasksModifiedAfter", controlValue("tasks-modified-after", sourceParams.get("tasksModifiedAfter") || ""));
    if (controlChecked("tasks-no-due", state.tasksNoDue)) {
      params.set("tasksNoDue", "true");
    }
    if (controlChecked("tasks-unassigned", state.tasksUnassigned)) {
      params.set("tasksUnassigned", "true");
    }

    // Mirrors coverageUrlParamsFromFilters in src/ui/viewModel.ts (see the
    // matching read-side note in applyUrlStateToControls).
    setParam(params, "coverageProject", controlValue("coverage-project-filter", sourceParams.get("coverageProject") || ""));
    if (state.coverageStates && state.coverageStates.length > 0) {
      params.set("coverageStates", state.coverageStates.join(","));
    }
    setParam(params, "coverageSearch", controlValue("coverage-text-filter", sourceParams.get("coverageSearch") || ""));

    return params;
  }

  function setParam(params, key, value) {
    if (value) {
      params.set(key, value);
    }
  }

  function setNonDefaultParam(params, key, value, defaultValue) {
    if (value && value !== defaultValue) {
      params.set(key, value);
    }
  }

  function updateLocationFromState(options) {
    if (!window.history || (!window.history.pushState && !window.history.replaceState)) {
      return;
    }
    var opts = options || {};
    var next = urlForState(opts);
    var current = window.location.pathname + window.location.search;
    if (next === current) {
      return;
    }
    var useReplace = opts.history === "replace" && window.history.replaceState;
    var method = useReplace ? "replaceState" : "pushState";
    window.history[method](null, "", next);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readTokenFromStorage(storage) {
    try {
      return storage ? storage.getItem(tokenStorageKey) || "" : "";
    } catch (_error) {
      return "";
    }
  }

  function writeTokenToStorage(storage, value) {
    try {
      if (!storage) {
        return false;
      }
      if (value) {
        storage.setItem(tokenStorageKey, value);
      } else {
        storage.removeItem(tokenStorageKey);
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  function token() {
    var localToken = readTokenFromStorage(window.localStorage);
    if (localToken) {
      return localToken;
    }
    var sessionToken = readTokenFromStorage(window.sessionStorage);
    if (sessionToken) {
      writeTokenToStorage(window.localStorage, sessionToken);
    }
    return sessionToken;
  }

  function saveToken(value) {
    var nextToken = String(value || "").trim();
    if (writeTokenToStorage(window.localStorage, nextToken)) {
      writeTokenToStorage(window.sessionStorage, "");
      return;
    }
    writeTokenToStorage(window.sessionStorage, nextToken);
  }

  function setBanner(message, tone) {
    var banner = el("status-banner");
    if (!message) {
      banner.hidden = true;
      banner.textContent = "";
      return;
    }
    banner.hidden = false;
    banner.textContent = message;
    banner.style.borderLeftColor = tone === "error" ? "var(--block)" : tone === "warn" ? "var(--warn)" : "var(--accent)";
  }

  async function api(path) {
    var headers = {};
    if (token()) {
      headers.Authorization = "Bearer " + token();
    }
    var response = await fetch(path, { headers: headers });
    if (!response.ok) {
      var text = await response.text();
      var err = new Error(response.status + " " + response.statusText + ": " + text);
      err.status = response.status;
      throw err;
    }
    return response.json();
  }

  async function apiPost(path, body) {
    var headers = { "content-type": "application/json" };
    if (token()) {
      headers.Authorization = "Bearer " + token();
    }
    var response = await fetch(path, { method: "POST", headers: headers, body: JSON.stringify(body || {}) });
    if (!response.ok) {
      var text = await response.text();
      var err = new Error(response.status + " " + response.statusText + ": " + text);
      err.status = response.status;
      throw err;
    }
    return response.json();
  }

  function optionList(values, label) {
    var html = "<option value=\\"\\">" + escapeHtml(label) + "</option>";
    values.forEach(function (value) {
      html += "<option value=\\"" + escapeHtml(value) + "\\">" + escapeHtml(value) + "</option>";
    });
    return html;
  }

  function uniqueSorted(items) {
    var set = new Set();
    items.forEach(function (item) {
      if (item) {
        set.add(item);
      }
    });
    return Array.from(set).sort();
  }

  function tagsOf(anchor) {
    return Array.isArray(anchor.tags) ? anchor.tags.filter(function (tag) { return typeof tag === "string"; }) : [];
  }

  function projectOf(anchor) {
    if (!anchor) {
      return "";
    }
    if (anchor.projectSlug) {
      return anchor.projectSlug;
    }
    if (Array.isArray(anchor.project) && typeof anchor.project[0] === "string") {
      return anchor.project[0];
    }
    if (typeof anchor.project === "string") {
      return anchor.project;
    }
    if (anchor.frontmatter && Array.isArray(anchor.frontmatter.project) && typeof anchor.frontmatter.project[0] === "string") {
      return anchor.frontmatter.project[0];
    }
    if (anchor.frontmatter && typeof anchor.frontmatter.project === "string") {
      return anchor.frontmatter.project;
    }
    return "";
  }

  function initialLoadErrorMessage(error) {
    var message = error && error.message ? error.message : String(error);
    return error && (error.status === 401 || error.status === 403)
      ? "Enter the HTTP auth token to load anchors. " + message
      : "Could not load UI data. " + message;
  }

  function isServerRuleAnchor(anchor) {
    if (!anchor) {
      return false;
    }
    var name = typeof anchor === "string" ? anchor : anchor.name;
    return (anchor.origin === "built-in")
      || (typeof name === "string" && name.indexOf(SERVER_RULES_PREFIX) === 0);
  }

  function assertMutableAnchor(anchor, action) {
    if (isServerRuleAnchor(anchor)) {
      throw new Error("Server rules are read-only; you cannot " + action + " from this UI.");
    }
  }

  function setDetailReadOnlyState(readOnly) {
    var detailContent = safeEl("detail-content");
    if (detailContent && detailContent.classList) {
      detailContent.classList.toggle("read-only-anchor", readOnly);
    }
    var note = safeEl("detail-readonly-note");
    if (note) {
      note.hidden = !readOnly;
      note.textContent = SERVER_RULE_READ_ONLY_MESSAGE;
    }
    READ_ONLY_DETAIL_CONTROL_IDS.forEach(function (id) {
      var control = safeEl(id);
      if (!control) {
        return;
      }
      control.disabled = readOnly;
      control.title = readOnly ? SERVER_RULE_READ_ONLY_MESSAGE : "";
      if (readOnly && control.setAttribute) {
        control.setAttribute("aria-disabled", "true");
      } else if (control.removeAttribute) {
        control.removeAttribute("aria-disabled");
      }
    });
  }

  function categoryLabel(category) {
    return String(category || "other").replace(/-/g, " ");
  }

  function groupForAnchor(anchor) {
    if (anchor.category === "projects" && projectOf(anchor)) {
      var project = projectOf(anchor);
      return { key: "project:" + project, label: project };
    }
    var category = anchor.category || "other";
    return { key: "category:" + category, label: categoryLabel(category) };
  }

  function validAnchorGroupSort(value) {
    return value === "updated" || value === "created" || value === "name" || value === "priority" ? value : DEFAULT_ANCHOR_SORT;
  }

  function currentFilters() {
    return {
      search: el("search-input").value.trim().toLowerCase(),
      project: el("project-filter").value,
      category: el("category-filter").value,
      tag: el("tag-filter").value,
      includeArchive: el("archive-filter").checked
    };
  }

  function queryFromFilters(filters) {
    var params = new URLSearchParams();
    if (filters.project) {
      params.set("project", filters.project);
    }
    if (filters.category) {
      params.set("category", filters.category);
    }
    if (filters.tag) {
      params.set("tag", filters.tag);
    }
    if (filters.includeArchive) {
      params.set("includeArchive", "true");
    }
    return params.toString();
  }

  function splitFilePaths(value) {
    if (typeof value !== "string") {
      return [];
    }
    return value.split(/\\r?\\n/).map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line.length > 0;
    });
  }

  function currentPlannerInput() {
    return {
      task: el("planner-task").value.trim(),
      project: el("planner-project").value,
      category: el("planner-category").value,
      tag: el("planner-tag").value,
      runtime: el("planner-runtime").value.trim(),
      repo: el("planner-repo").value.trim(),
      filePaths: splitFilePaths(el("planner-filepaths").value),
      includeArchive: el("planner-archive").checked,
      budgetTokens: el("planner-budget").value.trim(),
      maxAnchors: el("planner-max-anchors").value.trim(),
      maxExcluded: el("planner-max-excluded").value.trim()
    };
  }

  function parsePlannerLogPaste(text) {
    if (typeof text !== "string") {
      return null;
    }
    var trimmed = text.trim();
    if (!trimmed || trimmed.charAt(0) !== "{") {
      return null;
    }
    var parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    var source = parsed;
    if (parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)) {
      source = parsed.arguments;
    }
    if (typeof source.task !== "string" || !source.task.trim()) {
      return null;
    }
    var result = { task: source.task };
    if (typeof source.project === "string" && source.project) {
      result.project = source.project;
    }
    if (typeof source.category === "string" && source.category) {
      result.category = source.category;
    }
    if (typeof source.tag === "string" && source.tag) {
      result.tag = source.tag;
    }
    if (typeof source.runtime === "string") {
      result.runtime = source.runtime;
    }
    if (typeof source.repo === "string") {
      result.repo = source.repo.trim();
    }
    if (Array.isArray(source.filePaths)) {
      result.filePaths = source.filePaths
        .filter(function (filePath) {
          return typeof filePath === "string" && filePath.trim().length > 0;
        })
        .map(function (filePath) {
          return filePath.trim();
        });
    }
    if (typeof source.includeArchive === "boolean") {
      result.includeArchive = source.includeArchive;
    }
    if (typeof source.budgetTokens === "number" && Number.isFinite(source.budgetTokens)) {
      result.budgetTokens = source.budgetTokens;
    }
    if (typeof source.maxAnchors === "number" && Number.isFinite(source.maxAnchors)) {
      result.maxAnchors = source.maxAnchors;
    }
    if (typeof source.maxExcluded === "number" && Number.isFinite(source.maxExcluded)) {
      result.maxExcluded = source.maxExcluded;
    }
    return result;
  }

  function setSelectValueAllowingNew(id, value) {
    if (typeof value !== "string" || !value) {
      return;
    }
    var select = el(id);
    if (!select) {
      return;
    }
    var options = select.options || [];
    var found = false;
    for (var i = 0; i < options.length; i += 1) {
      if (options[i].value === value) {
        found = true;
        break;
      }
    }
    if (!found) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = value;
  }

  function applyPlannerLogPaste(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    el("planner-task").value = parsed.task;
    setSelectValueAllowingNew("planner-project", parsed.project);
    setSelectValueAllowingNew("planner-category", parsed.category);
    setSelectValueAllowingNew("planner-tag", parsed.tag);
    if (Object.prototype.hasOwnProperty.call(parsed, "runtime")) {
      el("planner-runtime").value = parsed.runtime;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "repo")) {
      el("planner-repo").value = parsed.repo;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "filePaths")) {
      el("planner-filepaths").value = parsed.filePaths.join("\\n");
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "includeArchive")) {
      el("planner-archive").checked = Boolean(parsed.includeArchive);
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "budgetTokens")) {
      el("planner-budget").value = String(parsed.budgetTokens);
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "maxAnchors")) {
      el("planner-max-anchors").value = String(parsed.maxAnchors);
    }
    if (Object.prototype.hasOwnProperty.call(parsed, "maxExcluded")) {
      el("planner-max-excluded").value = String(parsed.maxExcluded);
    }
  }

  function handlePlannerTaskPaste(event) {
    var clipboard = event.clipboardData || (typeof window !== "undefined" ? window.clipboardData : null);
    if (!clipboard || typeof clipboard.getData !== "function") {
      return;
    }
    var text = clipboard.getData("text") || clipboard.getData("text/plain") || "";
    var parsed = parsePlannerLogPaste(text);
    if (!parsed) {
      return;
    }
    event.preventDefault();
    applyPlannerLogPaste(parsed);
    updateLocationFromState({ view: "planner", history: "replace" });
    setBanner("Loaded planner inputs from pasted log line.", "info");
  }

  function queryFromPlannerInput(input) {
    var params = new URLSearchParams();
    params.set("task", input.task);
    ["project", "category", "tag", "runtime", "repo", "budgetTokens", "maxAnchors", "maxExcluded"].forEach(function (key) {
      if (input[key]) {
        params.set(key, input[key]);
      }
    });
    if (Array.isArray(input.filePaths)) {
      input.filePaths.forEach(function (filePath) {
        if (filePath) {
          params.append("filePaths", filePath);
        }
      });
    }
    if (input.includeArchive) {
      params.set("includeArchive", "true");
    }
    return params.toString();
  }

  async function load() {
    var filters = currentFilters();
    var query = queryFromFilters(filters);
    var suffix = query ? "?" + query : "";
    var loadId = beginAnchorLoad();
    state.root = null;
    state.rootLoading = true;
    renderRoot();
    setBanner("Loading anchors...", "info");
    if (state.pendingAnchor && state.activeTab === "detail") {
      var requestedAnchor = state.pendingAnchor;
      state.pendingAnchor = null;
      selectAnchor(requestedAnchor, { skipLocationUpdate: true }).catch(function (error) {
        setBanner(error.message, "error");
      });
    }

    var rootPromise = api("/api/ui/context-root" + suffix).then(function (rootResponse) {
      if (loadId !== state.anchorLoadId) {
        return;
      }
      state.root = rootResponse;
      state.rootLoading = false;
      renderRoot();
    }, function (error) {
      if (loadId !== state.anchorLoadId) {
        return;
      }
      state.rootLoading = false;
      renderRoot();
      setBanner(error.message, "error");
    });

    try {
      await loadAnchorPages(query, loadId);
    } catch (error) {
      if (loadId === state.anchorLoadId) {
        state.anchorLoading = false;
        renderAnchorList();
      }
      throw error;
    }
    await rootPromise;
    if (state.activeTab === "review") {
      await loadProposals();
    }
    if (state.activeTab === "tasks") {
      await loadTasks();
    }
    if (state.activeTab === "traces" && !state.traces) {
      await loadTraces();
    }
    if (state.activeTab === "coverage" && !state.coverage) {
      await loadCoverage();
    }
    // Anchors are now loaded; re-render the registry views so soft project-slug
    // validation (which reads state.anchors) runs even when the user landed
    // directly on the People/Teams tab before anchors finished loading.
    if ((state.activeTab === "people" || state.activeTab === "teams") && state.registry) {
      renderPeople();
      renderTeams();
      renderProjectAssociations();
    }
    var proposalId = new URLSearchParams(window.location.search).get("proposal");
    if (state.activeTab === "review" && proposalId) {
      await selectProposal(proposalId);
    }
  }

  function beginAnchorLoad() {
    state.anchorLoadId += 1;
    state.anchors = [];
    state.anchorTotal = null;
    state.anchorLoading = true;
    populateFilterOptions();
    renderAnchorList();
    return state.anchorLoadId;
  }

  async function reloadAnchorsOnly() {
    var query = queryFromFilters(currentFilters());
    var loadId = beginAnchorLoad();
    setBanner("Loading anchors...", "info");
    try {
      await loadAnchorPages(query, loadId);
    } catch (error) {
      if (loadId === state.anchorLoadId) {
        state.anchorLoading = false;
        renderAnchorList();
      }
      throw error;
    }
  }

  async function loadAnchorPages(query, loadId) {
    var offset = 0;
    for (;;) {
      if (loadId !== state.anchorLoadId) {
        return;
      }

      var params = new URLSearchParams(query || "");
      params.set("sort", state.anchorGroupSort);
      params.set("limit", String(ANCHOR_BATCH_SIZE));
      params.set("offset", String(offset));

      var response = await api("/api/ui/anchors?" + params.toString());
      if (loadId !== state.anchorLoadId) {
        return;
      }

      var anchors = response.anchors || [];
      if (typeof response.total === "number") {
        state.anchorTotal = response.total;
      }

      if (response.projectFilter && response.projectFilter.via === "alias") {
        setSelectValueAllowingNew("project-filter", response.projectFilter.resolved);
      }

      mergeAnchorPage(anchors);
      if (typeof response.total !== "number" && !response.nextOffset) {
        state.anchorTotal = state.anchors.length;
      }
      populateFilterOptions();
      renderAnchorList();
      openPendingAnchor();
      // Keep the managed-project list in the Repo Mappings tab current as
      // anchors stream in, since it lists every known project.
      if (state.projectMappings) {
        renderMappings();
      }

      if (!response.nextOffset) {
        break;
      }

      offset = response.nextOffset;
      setBanner(anchorLoadingMessage(), "info");
      await nextFrame();
    }

    state.anchorLoading = false;
    renderAnchorList();
    setBanner("", "info");
    if (state.pendingAnchor && state.activeTab === "detail") {
      openPendingAnchor();
    }
  }

  function anchorLoadingMessage() {
    if (state.anchorTotal !== null) {
      return "Loaded " + state.anchors.length + " of " + state.anchorTotal + " anchors...";
    }
    return "Loaded " + state.anchors.length + " anchors...";
  }

  function mergeAnchorPage(anchors) {
    var byName = new Map(state.anchors.map(function (anchor) {
      return [anchor.name, anchor];
    }));
    anchors.forEach(function (anchor) {
      byName.set(anchor.name, anchor);
    });
    state.anchors = sortAnchors(Array.from(byName.values()));
  }

  function nextFrame() {
    return new Promise(function (resolve) {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(function () { resolve(); });
        return;
      }
      setTimeout(resolve, 0);
    });
  }

  function populateFilterOptions() {
    var projects = uniqueSorted(state.anchors.map(projectOf));
    var tags = uniqueSorted(state.anchors.flatMap(tagsOf));
    var projectSelect = el("project-filter");
    var tagSelect = el("tag-filter");
    var categorySelect = el("category-filter");
    var plannerProjectSelect = el("planner-project");
    var plannerTagSelect = el("planner-tag");
    var plannerCategorySelect = el("planner-category");
    var currentProject = projectSelect.value;
    var currentTag = tagSelect.value;
    var currentCategory = categorySelect.value;
    var currentPlannerProject = plannerProjectSelect.value;
    var currentPlannerTag = plannerTagSelect.value;
    var currentPlannerCategory = plannerCategorySelect.value;
    var tasksProjectSelect = el("tasks-project-filter");
    var currentTasksProject = tasksProjectSelect.value;
    projects = uniqueSorted(projects.concat([currentProject, currentPlannerProject, currentTasksProject]));
    tags = uniqueSorted(tags.concat([currentTag, currentPlannerTag]));
    projectSelect.innerHTML = optionList(projects, "All projects");
    tagSelect.innerHTML = optionList(tags, "All tags");
    categorySelect.innerHTML = optionList(categories.slice(1), "All categories");
    plannerProjectSelect.innerHTML = optionList(projects, "All projects");
    plannerTagSelect.innerHTML = optionList(tags, "All tags");
    plannerCategorySelect.innerHTML = optionList(categories.slice(1), "All categories");
    tasksProjectSelect.innerHTML = optionList(projects, "All projects");
    projectSelect.value = currentProject && projects.includes(currentProject) ? currentProject : "";
    tagSelect.value = currentTag && tags.includes(currentTag) ? currentTag : "";
    categorySelect.value = categories.includes(currentCategory) ? currentCategory : "";
    plannerProjectSelect.value = currentPlannerProject && projects.includes(currentPlannerProject) ? currentPlannerProject : "";
    plannerTagSelect.value = currentPlannerTag && tags.includes(currentPlannerTag) ? currentPlannerTag : "";
    plannerCategorySelect.value = categories.includes(currentPlannerCategory) ? currentPlannerCategory : "";
    tasksProjectSelect.value = currentTasksProject && projects.includes(currentTasksProject) ? currentTasksProject : "";
    refreshTypeaheadOptions();
  }

  function filteredAnchors() {
    var filters = currentFilters();
    return state.anchors.filter(function (anchor) {
      if (!filters.search) {
        return true;
      }
      var haystack = [
        anchor.name,
        anchor.title,
        anchor.summary,
        anchor.category,
        projectOf(anchor),
        tagsOf(anchor).join(" "),
        Array.isArray(anchor.read_this_if) ? anchor.read_this_if.join(" ") : ""
      ].join(" ").toLowerCase();
      return haystack.indexOf(filters.search) >= 0;
    });
  }

  function sortAnchors(anchors) {
    return anchors.slice().sort(compareAnchors);
  }

  function compareAnchors(left, right) {
    var sort = validAnchorGroupSort(state.anchorGroupSort);
    if (sort === "updated") {
      return compareTimestamps(anchorTimestamp(right, "updatedAt"), anchorTimestamp(left, "updatedAt"))
        || compareAnchorLabels(left, right);
    }
    if (sort === "created") {
      return compareTimestamps(anchorTimestamp(right, "createdAt"), anchorTimestamp(left, "createdAt"))
        || compareAnchorLabels(left, right);
    }
    if (sort === "priority") {
      return comparePriority(anchorPriority(left), anchorPriority(right)) || compareAnchorLabels(left, right);
    }
    return compareAnchorLabels(left, right);
  }

  function compareAnchorLabels(left, right) {
    var leftLabel = left && left.ui && left.ui.label ? left.ui.label : left.name || "";
    var rightLabel = right && right.ui && right.ui.label ? right.ui.label : right.name || "";
    return String(leftLabel).localeCompare(String(rightLabel)) || String(left.name || "").localeCompare(String(right.name || ""));
  }

  function healthBadge(health) {
    var status = health && health.status ? health.status : "ok";
    var label = status === "block" ? "Block" : status === "warn" ? "Warn" : "OK";
    return "<span class=\\"badge " + status + "\\">" + label + "</span>";
  }

  function renderAnchorList() {
    var list = el("anchor-list");
    var anchors = filteredAnchors();
    el("anchor-count").textContent = state.anchorLoading && state.anchorTotal !== null
      ? anchors.length + "/" + state.anchorTotal
      : String(anchors.length);
    if (!anchors.length) {
      list.innerHTML = "<div class=\\"empty-state\\">" + (state.anchorLoading ? "Loading anchors..." : "No anchors match the current filters.") + "</div>";
      return;
    }
    var groups = new Map();
    anchors.forEach(function (anchor) {
      var group = groupForAnchor(anchor);
      if (!groups.has(group.key)) {
        groups.set(group.key, { key: group.key, label: group.label, anchors: [] });
      }
      groups.get(group.key).anchors.push(anchor);
    });
    var loading = state.anchorLoading
      ? "<div class=\\"empty-state\\">Loading more anchors...</div>"
      : "";
    list.innerHTML = sortAnchorGroups(Array.from(groups.values())).map(renderAnchorGroup).join("") + loading;
    bindAnchorGroupToggles(list);
  }

  function sortAnchorGroups(groups) {
    return groups.slice().sort(compareAnchorGroups);
  }

  function compareAnchorGroups(left, right) {
    var sort = validAnchorGroupSort(state.anchorGroupSort);
    if (sort === "updated") {
      return compareTimestamps(groupTimestamp(right, "updatedAt", "max"), groupTimestamp(left, "updatedAt", "max"))
        || compareGroupLabels(left, right);
    }
    if (sort === "created") {
      return compareTimestamps(groupTimestamp(right, "createdAt", "min"), groupTimestamp(left, "createdAt", "min"))
        || compareGroupLabels(left, right);
    }
    if (sort === "priority") {
      return comparePriority(groupPriority(left), groupPriority(right)) || compareGroupLabels(left, right);
    }
    return compareGroupLabels(left, right);
  }

  function compareGroupLabels(left, right) {
    return String(left.label || "").localeCompare(String(right.label || ""));
  }

  function compareTimestamps(left, right) {
    var leftTime = Number.isFinite(left) ? left : 0;
    var rightTime = Number.isFinite(right) ? right : 0;
    return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
  }

  function comparePriority(left, right) {
    var leftPriority = Number.isFinite(left) ? left : Infinity;
    var rightPriority = Number.isFinite(right) ? right : Infinity;
    return leftPriority === rightPriority ? 0 : leftPriority < rightPriority ? -1 : 1;
  }

  function anchorPriority(anchor) {
    var direct = anchor && anchor.priority;
    if (typeof direct === "number" && Number.isFinite(direct)) {
      return direct;
    }
    var frontmatter = anchor && anchor.frontmatter;
    var fromFrontmatter = frontmatter && frontmatter.priority;
    return typeof fromFrontmatter === "number" && Number.isFinite(fromFrontmatter) ? fromFrontmatter : NaN;
  }

  function priorityLabel(priority) {
    return Number.isFinite(priority) ? "P" + String(priority) : "";
  }

  function groupPriority(group) {
    var anchors = Array.isArray(group.anchors) ? group.anchors : [];
    var priorities = anchors.map(anchorPriority).filter(function (priority) {
      return Number.isFinite(priority);
    });
    return priorities.length ? Math.min.apply(null, priorities) : NaN;
  }

  function groupTimestamp(group, field, mode) {
    var anchors = Array.isArray(group.anchors) ? group.anchors : [];
    var times = anchors.map(function (anchor) {
      return anchorTimestamp(anchor, field);
    }).filter(function (time) {
      return Number.isFinite(time);
    });
    if (!times.length) {
      return 0;
    }
    return mode === "min" ? Math.min.apply(null, times) : Math.max.apply(null, times);
  }

  function anchorTimestamp(anchor, field) {
    var raw = anchor && anchor[field];
    if (!raw && field !== "createdAt") {
      raw = anchor && anchor.last_validated;
    }
    var time = Date.parse(raw);
    return Number.isNaN(time) ? NaN : time;
  }

  function renderAnchorGroup(group) {
    var open = state.expandedAnchorGroups.has(group.key) ? " open" : "";
    var priority = priorityLabel(groupPriority(group));
    var count = priority ? priority + " · " + group.anchors.length : String(group.anchors.length);
    return "<details class=\\"anchor-group\\" data-group-key=\\"" + escapeHtml(group.key) + "\\"" + open + ">"
      + "<summary class=\\"anchor-group-title\\">"
      + "<span class=\\"anchor-group-label\\">" + escapeHtml(group.label) + "</span>"
      + "<span class=\\"anchor-group-count\\">" + escapeHtml(count) + "</span>"
      + "</summary>"
      + "<div class=\\"anchor-group-items\\">" + group.anchors.map(renderAnchorRow).join("") + "</div>"
      + "</details>";
  }

  function bindAnchorGroupToggles(list) {
    list.querySelectorAll("details[data-group-key]").forEach(function (details) {
      details.addEventListener("toggle", function () {
        if (details.open) {
          state.expandedAnchorGroups.add(details.dataset.groupKey);
        } else {
          state.expandedAnchorGroups.delete(details.dataset.groupKey);
        }
      });
    });
  }

  function renderAnchorRow(anchor) {
      var active = anchor.name === state.selectedName ? " active" : "";
      var priority = priorityLabel(anchorPriority(anchor));
      var meta = [priority, anchor.category, projectOf(anchor)].filter(Boolean).map(function (item) {
        return "<span class=\\"badge\\">" + escapeHtml(item) + "</span>";
      }).join("");
      return "<a class=\\"anchor-row" + active + "\\" href=\\"" + escapeHtml(anchorHref(anchor.name)) + "\\" data-name=\\"" + escapeHtml(anchor.name) + "\\">"
        + "<span class=\\"anchor-title\\"><svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-anchor\\"></use></svg><span>" + escapeHtml(anchor.ui.label) + "</span></span>"
        + "<span class=\\"anchor-summary\\">" + escapeHtml(anchor.summary || anchor.name) + "</span>"
        + "<span class=\\"anchor-meta\\">" + healthBadge(anchor.ui.health) + meta + "</span>"
        + "</a>";
  }

  function renderRoot() {
    var markdown = state.root && state.root.markdown ? state.root.markdown : "";
    if (state.rootLoading) {
      el("root-generated").textContent = "Generating context root...";
      el("root-rendered").innerHTML = "<div class=\\"empty-state\\">Context root is loading.</div>";
      el("root-raw").textContent = "";
      showRootMode(state.rootMode);
      return;
    }
    el("root-generated").textContent = state.root ? "Generated " + state.root.generatedAt + " from " + state.root.entries.length + " entries" : "Generated root output";
    el("root-rendered").innerHTML = renderMarkdown(markdown);
    decorateAnchorLinks(el("root-rendered"));
    renderMermaidDiagrams(el("root-rendered"));
    el("root-raw").textContent = markdown;
    showRootMode(state.rootMode);
  }

  async function runPlanner() {
    var input = currentPlannerInput();
    if (!input.task) {
      setBanner("Planner task is required.", "warn");
      return;
    }

    updateLocationFromState({ view: "planner", history: "push" });
    setBanner("Planning context bundle...", "info");
    var plan = await api("/api/ui/context-plan?" + queryFromPlannerInput(input));
    state.plannerPlans.unshift(plan);
    state.plannerPlans = state.plannerPlans.slice(0, 2);
    state.plannerLastLoadContext = plan.loadContext;
    state.plannerLastPlan = plan;
    renderPlanner(plan, state.plannerPlans[1]);
    if (plan.projectFilter && plan.projectFilter.via === "alias") {
      setSelectValueAllowingNew("planner-project", plan.projectFilter.resolved);
      setBanner(
        "Resolved project alias " + plan.projectFilter.requested + " to " + plan.projectFilter.resolved + ".",
        "info",
      );
    } else if (plan.projectResolution && plan.projectResolution.unknownRepo && plan.projectResolution.candidates.length === 0) {
      setBanner(
        "Repository " + plan.projectResolution.unknownRepo + " did not resolve to any candidate projects.",
        "warn",
      );
    } else if (plan.projectResolution && plan.projectResolution.candidates.length) {
      setBanner(
        "Resolved candidate projects: " + plan.projectResolution.candidates.map(function (candidate) {
          return candidate.project;
        }).join(", ") + ".",
        "info",
      );
    } else {
      setBanner("", "info");
    }
    showTab("planner");
  }

  function formatPlannerStatus(plan) {
    var status = "Generated " + plan.generatedAt + " from " + plan.totalCandidates + " candidates";
    if (plan.projectFilter && plan.projectFilter.via === "alias") {
      status += " · project alias " + plan.projectFilter.requested + " → " + plan.projectFilter.resolved;
    }
    if (plan.projectResolution) {
      var resolved = plan.projectResolution.candidates.map(function (candidate) {
        return candidate.project;
      });
      if (resolved.length) {
        status += " · candidate projects " + resolved.join(", ");
      }
      if (plan.projectResolution.unknownRepo) {
        status += " · unknown repo " + plan.projectResolution.unknownRepo;
      }
    }
    return status;
  }

  function renderProjectResolution(resolution) {
    if (!resolution) {
      return "";
    }
    var cards = resolution.candidates.map(function (candidate) {
      var reasons = Array.isArray(candidate.reasons) ? candidate.reasons.join("; ") : "";
      return "<div class=\\"planner-card\\">"
        + "<div class=\\"planner-card-title\\"><span>" + escapeHtml(candidate.project) + "</span>"
        + "<span class=\\"badge\\">boost " + escapeHtml(candidate.boost) + "</span></div>"
        + "<p>" + escapeHtml(reasons) + "</p>"
        + "</div>";
    });
    if (resolution.unknownRepo) {
      cards.push(
        "<div class=\\"planner-card\\"><p>" + escapeHtml(
          "Repository \\"" + resolution.unknownRepo + "\\" is not in the configured repo map.",
        ) + "</p></div>",
      );
    }
    if (cards.length === 0) {
      cards.push("<div class=\\"planner-card\\"><p>No candidate projects resolved.</p></div>");
    }
    return cards.join("");
  }

  function renderPlanner(plan, previous) {
    el("planner-empty").hidden = true;
    el("planner-results").hidden = false;
    el("planner-status").textContent = formatPlannerStatus(plan);
    var summaryMetrics = [
      renderMetric(plan.included.length, "included"),
      renderMetric(plan.excluded.length, "excluded shown"),
      renderMetric(plan.estimatedTokens + " / " + plan.budgetTokens, "estimated tokens"),
      renderMetric(plan.missingContext.length, "missing signals")
    ];
    if (plan.projectResolution) {
      summaryMetrics.push(renderMetric(plan.projectResolution.candidates.length, "candidate projects"));
    }
    el("planner-summary").innerHTML = summaryMetrics.join("");
    el("planner-resolution-box").hidden = !plan.projectResolution;
    el("planner-resolution").innerHTML = plan.projectResolution
      ? renderProjectResolution(plan.projectResolution)
      : "";
    el("planner-included").innerHTML = renderPlannerItems(plan.included, "No anchors selected.");
    el("planner-excluded").innerHTML = renderPlannerItems(plan.excluded, "No excluded anchors returned.");
    el("planner-missing").innerHTML = renderMissingContext(plan.missingContext);
    el("planner-load-context").textContent = JSON.stringify(plan.loadContext, null, 2);
    el("planner-raw").textContent = JSON.stringify(plan, null, 2);
    el("planner-comparison").innerHTML = renderPlanComparison(plan, previous);
  }

  function renderMetric(value, label) {
    return "<div class=\\"metric\\"><strong>" + escapeHtml(value) + "</strong><span>" + escapeHtml(label) + "</span></div>";
  }

  function renderPlannerItems(items, emptyText) {
    if (!Array.isArray(items) || items.length === 0) {
      return "<div class=\\"planner-card\\"><p>" + escapeHtml(emptyText) + "</p></div>";
    }
    return items.map(renderPlannerItem).join("");
  }

  function renderPlannerItem(item) {
    var title = item.title || item.name;
    var terms = Array.isArray(item.matchedTerms) && item.matchedTerms.length
      ? item.matchedTerms.join(", ")
      : "none";
    return "<div class=\\"planner-card\\">"
      + "<div class=\\"planner-card-title\\"><span>" + escapeHtml(title) + "</span><span class=\\"badge\\">score " + escapeHtml(item.score) + "</span></div>"
      + "<p>" + escapeHtml(item.name) + "</p>"
      + "<p>" + escapeHtml(item.reason || "No reason returned.") + "</p>"
      + "<p>Matched: " + escapeHtml(terms) + " | Tokens: " + escapeHtml(item.estimatedTokens) + "</p>"
      + "</div>";
  }

  function renderMissingContext(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return "<span class=\\"badge ok\\">No missing-context signals</span>";
    }
    return items.map(function (item) {
      return "<div class=\\"planner-card\\"><p>" + escapeHtml(item) + "</p></div>";
    }).join("");
  }

  function comparePlannerRuns(current, previous) {
    if (!current || !previous) {
      return null;
    }
    return {
      includedAdded: namesAdded(current.included, previous.included),
      includedRemoved: namesAdded(previous.included, current.included),
      excludedAdded: namesAdded(current.excluded, previous.excluded),
      excludedRemoved: namesAdded(previous.excluded, current.excluded),
      tokenDelta: current.estimatedTokens - previous.estimatedTokens
    };
  }

  function namesAdded(left, right) {
    var rightNames = new Set((right || []).map(function (item) { return item.name; }));
    return (left || []).map(function (item) { return item.name; }).filter(function (name) { return !rightNames.has(name); });
  }

  function renderPlanComparison(current, previous) {
    var diff = comparePlannerRuns(current, previous);
    if (!diff) {
      return "<div class=\\"planner-card\\"><p>No previous planner run in this session.</p></div>";
    }
    return [
      renderComparisonCard("Included added", diff.includedAdded),
      renderComparisonCard("Included removed", diff.includedRemoved),
      renderComparisonCard("Excluded added", diff.excludedAdded),
      renderComparisonCard("Excluded removed", diff.excludedRemoved),
      "<div class=\\"planner-card\\"><div class=\\"planner-card-title\\"><span>Token delta</span><span class=\\"badge\\">" + escapeHtml(signedNumber(diff.tokenDelta)) + "</span></div></div>"
    ].join("");
  }

  function renderComparisonCard(title, names) {
    return "<div class=\\"planner-card\\"><div class=\\"planner-card-title\\"><span>" + escapeHtml(title) + "</span><span class=\\"badge\\">" + escapeHtml(names.length) + "</span></div><p>" + escapeHtml(names.length ? names.join(", ") : "None") + "</p></div>";
  }

  function signedNumber(value) {
    return value > 0 ? "+" + value : String(value);
  }

  async function copyLoadContext() {
    if (!state.plannerLastLoadContext) {
      return;
    }
    var text = JSON.stringify(state.plannerLastLoadContext, null, 2);
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      await window.navigator.clipboard.writeText(text);
      setBanner("Copied suggested loadContext call.", "info");
      return;
    }
    setBanner("Clipboard unavailable; inspect the suggested loadContext JSON.", "warn");
  }

  function buildJudgePrompt(plan, anchorBodies) {
    var safePlan = plan && typeof plan === "object" ? plan : {};
    var loadContext = safePlan.loadContext && typeof safePlan.loadContext === "object" ? safePlan.loadContext : {};
    var includedNames = Array.isArray(loadContext.names) ? loadContext.names : [];
    var bodies = anchorBodies && typeof anchorBodies === "object" ? anchorBodies : {};
    var trimmedPlan = {
      task: typeof safePlan.task === "string" ? safePlan.task : "",
      budgetTokens: safePlan.budgetTokens,
      estimatedTokens: safePlan.estimatedTokens,
      totalCandidates: safePlan.totalCandidates,
      included: Array.isArray(safePlan.included) ? safePlan.included : [],
      excluded: Array.isArray(safePlan.excluded) ? safePlan.excluded : [],
      missingContext: Array.isArray(safePlan.missingContext) ? safePlan.missingContext : [],
      loadContext: {
        names: includedNames,
        includeContent: loadContext.includeContent,
        maxBytes: loadContext.maxBytes
      }
    };
    var fence = String.fromCharCode(96, 96, 96);
    var sections = [];
    sections.push(
      "You are evaluating a deterministic context-bundle planner. Judge the quality of its anchor selection for the task below. The planner picks anchor documents from a fixed corpus and returns scored included and excluded sets with reasons."
    );
    sections.push("# Task\\n\\n" + trimmedPlan.task);
    sections.push(
      "# Planner output\\n\\n" + fence + "json\\n" + JSON.stringify(trimmedPlan, null, 2) + "\\n" + fence
    );
    var bodyBlocks = includedNames.map(function (name) {
      var body = typeof bodies[name] === "string" ? bodies[name] : "";
      var content = body && body.length > 0 ? body : "(body not available)";
      return "## " + name + "\\n\\n" + content;
    });
    sections.push("# Anchor body excerpts\\n\\n" + bodyBlocks.join("\\n\\n"));
    var instructions = [
      "For each INCLUDED anchor, rate relevance to the task on this scale:",
      "  0 = irrelevant",
      "  1 = tangential (could be skipped without harm)",
      "  2 = relevant (genuinely useful)",
      "  3 = essential (task can't be done well without it)",
      "One-sentence justification each.",
      "",
      "For each EXCLUDED anchor, mark whether it should actually have been included: yes / no / maybe. One-sentence justification each.",
      "",
      "Then return a JSON object with:",
      "{",
      "  \\"included_ratings\\": { \\"<anchor-name>\\": { \\"score\\": 0-3, \\"why\\": \\"...\\" } },",
      "  \\"excluded_judgments\\": { \\"<anchor-name>\\": { \\"should_include\\": \\"yes|no|maybe\\", \\"why\\": \\"...\\" } },",
      "  \\"precision_proxy\\": <fraction of included rated >= 2, 0.0-1.0>,",
      "  \\"missed_relevant\\": <count of excluded marked \\"yes\\">,",
      "  \\"overall_quality\\": <1-5>,",
      "  \\"improvement\\": \\"<one sentence: what change to task wording or filters would most improve this bundle?>\\"",
      "}"
    ].join("\\n");
    sections.push("# Your evaluation\\n\\n" + instructions);
    return sections.join("\\n\\n");
  }

  async function copyJudgePrompt() {
    if (!state.plannerLastPlan) {
      return;
    }
    var loadContext = state.plannerLastPlan.loadContext || {};
    var names = Array.isArray(loadContext.names) ? loadContext.names : [];
    setBanner("Loading anchor bodies for judge prompt...", "info");
    var anchorBodies = {};
    var fetches = names.map(function (name) {
      return api("/api/ui/anchor?name=" + encodeURIComponent(name)).then(function (detail) {
        var content = detail && detail.anchor && detail.anchor.content ? detail.anchor.content : "";
        anchorBodies[name] = markdownBody(content);
      }, function (error) {
        anchorBodies[name] = "(failed to load: " + error.message + ")";
      });
    });
    await Promise.all(fetches);
    var prompt = buildJudgePrompt(state.plannerLastPlan, anchorBodies);
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      await window.navigator.clipboard.writeText(prompt);
      setBanner("Copied judge prompt for " + names.length + " anchors.", "info");
      return;
    }
    setBanner("Clipboard unavailable; judge prompt assembled in console.", "warn");
    console.log(prompt);
  }

  function showReview(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "review", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("review");
    if (!state.proposals.length) {
      loadProposals().catch(function (error) { setBanner(error.message, "error"); });
    }
  }

  function queryFromProposalFilters() {
    var params = new URLSearchParams();
    var project = el("proposal-project").value.trim();
    var status = el("proposal-status-filter").value;
    if (project) {
      params.set("project", project);
    }
    if (status) {
      params.set("status", status);
    }
    return params.toString();
  }

  async function loadProposals() {
    setBanner("Loading proposed changes...", "info");
    var query = queryFromProposalFilters();
    var suffix = query ? "?" + query : "";
    var response = await api("/api/ui/proposed-changes" + suffix);
    state.proposals = response.proposals || [];
    el("proposal-status").textContent = state.proposals.length + " proposal" + (state.proposals.length === 1 ? "" : "s") + " loaded";
    renderProposalList();
    setBanner("", "info");
  }

  function renderProposalList() {
    var list = el("proposal-list");
    if (!state.proposals.length) {
      list.innerHTML = "<div class=\\"empty-state\\">No proposals match the current filters.</div>";
      return;
    }
    list.innerHTML = state.proposals.map(renderProposalItem).join("");
  }

  function renderProposalItem(proposal) {
    var active = state.activeProposal && state.activeProposal.id === proposal.id ? " active" : "";
    var operationSummary = proposalListOperationSummary(proposal.operations);
    return "<button class=\\"planner-card proposal-card" + active + "\\" type=\\"button\\" data-proposal-id=\\"" + escapeHtml(proposal.id) + "\\">"
      + "<div class=\\"planner-card-title\\"><span>" + escapeHtml(proposal.summary || proposal.id) + "</span><span class=\\"badge\\">" + escapeHtml(proposal.status) + "</span></div>"
      + "<p>" + escapeHtml(proposal.target || "No target") + "</p>"
      + "<p>" + escapeHtml(operationSummary) + "</p>"
      + "<p>" + escapeHtml(proposal.id) + "</p>"
      + "</button>";
  }

  function proposalListWithUpdatedProposal(proposals, proposal) {
    if (!proposal || !proposal.id) {
      return proposals || [];
    }
    var updated = false;
    var next = (proposals || []).map(function (item) {
      if (item && item.id === proposal.id) {
        updated = true;
        return proposal;
      }
      return item;
    });
    if (!updated) {
      next.unshift(proposal);
    }
    return next;
  }

  function updateProposalFromMutationResult(result) {
    var proposal = result && result.proposal;
    if (!proposal || !proposal.id) {
      return;
    }
    state.activeProposal = proposal;
    state.proposals = proposalListWithUpdatedProposal(state.proposals, proposal);
    el("proposal-status").textContent = "Proposal " + proposal.id + " is " + proposal.status + ".";
    el("proposal-actions").hidden = proposal.status !== "pending";
    renderProposalList();
    updateLocationFromState({ anchor: null, view: "review", history: "replace" });
    showTab("review");
  }

  async function selectProposal(id) {
    var proposal = state.proposals.find(function (item) { return item.id === id; });
    if (!proposal) {
      var read = await api("/api/ui/proposed-change?id=" + encodeURIComponent(id));
      proposal = read.proposal;
    }
    state.activeProposal = proposal;
    updateLocationFromState({ anchor: null, view: "review", history: "replace" });
    renderProposalList();
    await previewProposal(id);
    showTab("review");
  }

  async function previewProposal(id) {
    setBanner("Previewing proposed change...", "info");
    var preview = await api("/api/ui/proposed-change-preview?id=" + encodeURIComponent(id));
    state.activeProposal = preview.proposal;
    el("proposal-actions").hidden = preview.proposal.status !== "pending";
    el("proposal-preview").textContent = formatPreview(preview);
    setBanner("", "info");
  }

  function formatPreview(preview) {
    var proposal = preview.proposal || {};
    var operations = Array.isArray(proposal.operations) ? proposal.operations : [];
    var metadata = [
      ["ID", proposal.id],
      ["Status", proposal.status],
      ["Target", proposal.target],
      ["Ledger", proposal.ledgerName],
      ["Created", proposal.createdAt],
      ["Updated", proposal.updatedAt],
      ["Base commit", preview.baseFileCommit || proposal.baseFileCommit],
      ["Target commit", preview.targetFileCommit],
      ["Target exists", preview.targetExists],
      ["Stale target", preview.stale],
      ["Requires approval", preview.requiresApproval]
    ].filter(function (pair) {
      return pair[1] !== undefined && pair[1] !== null && pair[1] !== "";
    }).map(function (pair) {
      return pair[0] + ": " + String(pair[1]);
    }).join("\\n");

    var sections = [
      "Summary\\n" + (proposal.summary || "(no summary returned)"),
      "Metadata\\n" + (metadata || "(no metadata returned)"),
      "Operations (" + operations.length + ")\\n" + formatProposalOperations(operations),
      "Warnings\\n" + formatWarnings(preview.warnings || []),
      "Diff\\n" + (preview.diff && String(preview.diff).trim() ? String(preview.diff) : "(no diff returned)")
    ];
    if (proposal.rationale) {
      sections.splice(1, 0, "Rationale\\n" + proposal.rationale);
    }
    if (proposal.reviews && proposal.reviews.length) {
      sections.splice(sections.length - 1, 0, "Reviews\\n" + JSON.stringify(proposal.reviews, null, 2));
    }
    return sections.join("\\n\\n");
  }

  function proposalListOperationSummary(operations) {
    if (!Array.isArray(operations) || !operations.length) {
      return "No operation payload returned";
    }
    var labels = operations.slice(0, 2).map(proposalOperationLabel);
    if (operations.length > labels.length) {
      labels.push("+" + (operations.length - labels.length) + " more");
    }
    return labels.join("; ");
  }

  function proposalOperationLabel(operation) {
    if (!operation || !operation.type) {
      return "Unknown operation";
    }
    if (operation.type === "frontmatter.merge") {
      return "Merge front matter";
    }
    if (operation.type === "section.replace") {
      return "Replace section \\"" + (operation.heading || "unknown") + "\\"";
    }
    if (operation.type === "section.append") {
      return "Append to section \\"" + (operation.heading || "unknown") + "\\"";
    }
    if (operation.type === "section.delete") {
      return "Delete section \\"" + (operation.heading || "unknown") + "\\"";
    }
    if (operation.type === "anchor.create") {
      return "Create anchor";
    }
    if (operation.type === "document.replace") {
      return "Replace full document";
    }
    return String(operation.type);
  }

  function formatProposalOperations(operations) {
    if (!operations.length) {
      return "No operation payload returned.";
    }
    return operations.map(function (operation, index) {
      var lines = [
        String(index + 1) + ". " + proposalOperationLabel(operation),
        "   Type: " + String(operation && operation.type ? operation.type : "unknown")
      ];
      if (operation && operation.heading) {
        lines.push("   Heading: " + operation.heading);
      }
      if (operation && operation.lastValidated) {
        lines.push("   last_validated: " + operation.lastValidated);
      }
      if (operation && operation.updates !== undefined) {
        lines.push("   Updates:");
        lines.push(indentBlock(JSON.stringify(operation.updates, null, 2), "     "));
      }
      if (operation && operation.content !== undefined) {
        lines.push("   Content:");
        lines.push(indentBlock(operation.content || "(empty)", "     "));
      }
      return lines.join("\\n");
    }).join("\\n\\n");
  }

  function formatWarnings(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) {
      return "None.";
    }
    return warnings.map(function (warning, index) {
      var label = "[" + (warning.severity || "WARN") + "] " + (warning.code || "warning");
      var path = warning.path ? " (" + warning.path + ")" : "";
      return String(index + 1) + ". " + label + path + "\\n   " + (warning.message || "");
    }).join("\\n");
  }

  function indentBlock(value, prefix) {
    return String(value == null ? "" : value).split("\\n").map(function (line) {
      return prefix + line;
    }).join("\\n");
  }

  async function applyActiveProposal() {
    if (!state.activeProposal) {
      return;
    }
    if (!window.confirm("Apply this proposal as a committed anchor change?")) {
      return;
    }
    var result = await apiPost("/api/ui/proposed-change-apply", {
      id: state.activeProposal.id,
      approved: true,
      expectedLedgerFileCommit: state.activeProposal.ledgerFileCommit
    });
    el("proposal-preview").textContent = formatWriteResult(result);
    updateProposalFromMutationResult(result);
  }

  async function reviewActiveProposal(status) {
    if (!state.activeProposal) {
      return;
    }
    var note = window.prompt("Review note", "") || "";
    var result = await apiPost("/api/ui/proposed-change-review", {
      id: state.activeProposal.id,
      status: status,
      note: note,
      expectedLedgerFileCommit: state.activeProposal.ledgerFileCommit
    });
    el("proposal-preview").textContent = formatWriteResult(result);
    updateProposalFromMutationResult(result);
  }

  function formatWriteResult(result) {
    return JSON.stringify(result, null, 2);
  }

  function sanitizeProjectPriorityValue(value) {
    return String(value || "").replace(/[^0-9.]/g, "");
  }

  function sanitizeProjectPriorityInput() {
    var input = el("priority-input");
    var clean = sanitizeProjectPriorityValue(input.value);
    if (input.value !== clean) {
      input.value = clean;
    }
  }

  function warningSummary(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) {
      return "";
    }
    return warnings.map(function (warning) {
      return warning.message || warning.code || "Warning";
    }).join("; ");
  }

  async function updateProjectPriorityFromDetail() {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      throw new Error("Select a project anchor before updating priority.");
    }
    assertMutableAnchor(anchor, "update their project priority");
    var project = projectOf(anchor);
    if (!project) {
      throw new Error("Selected anchor is not associated with a project.");
    }
    var raw = el("priority-input").value.trim();
    var priority = null;
    if (raw) {
      if (!/^[0-9.]+$/.test(raw)) {
        throw new Error("Project priority can only contain digits and periods.");
      }
      priority = Number(raw);
      if (!Number.isFinite(priority)) {
        throw new Error("Priority must be a finite number.");
      }
    }
    var label = raw ? "set this project priority to P" + String(priority) : "clear this project priority";
    if (!window.confirm("Explicitly approve and " + label + "?")) {
      return;
    }
    var result = await apiPost("/api/ui/project-priority", {
      project: project,
      name: anchor.name,
      priority: priority,
      approved: true,
      expectedFileCommit: anchor.fileCommit
    });
    if (result.version) {
      setBanner(raw ? "Project priority updated." : "Project priority cleared.", "info");
      await load();
      await selectAnchor(anchor.name, { skipLocationUpdate: true });
      return;
    }
    var warnings = warningSummary(result.warnings);
    if (warnings) {
      setBanner(warnings, (result.warnings || []).some(function (warning) { return warning.severity === "BLOCK"; }) ? "error" : "warn");
      return;
    }
    setBanner("Project priority update returned without a new version.", "warn");
  }

  async function loadAnchorHistory() {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      throw new Error("Select an anchor before loading history.");
    }
    var response = await api("/api/ui/anchor-versions?name=" + encodeURIComponent(anchor.name) + "&limit=20");
    state.anchorVersions = response.versions || [];
    renderAnchorHistory();
  }

  function renderAnchorHistory() {
    var list = el("history-list");
    var readOnly = isServerRuleAnchor(state.selectedAnchor);
    if (!state.anchorVersions.length) {
      list.innerHTML = "<div class=\\"empty-state\\">No versions returned.</div>";
      return;
    }
    list.innerHTML = state.anchorVersions.map(function (version, index) {
      var previous = state.anchorVersions[index + 1];
      var diffButton = previous
        ? "<button type=\\"button\\" data-diff-index=\\"" + index + "\\">Diff previous</button>"
        : "";
      var revertButton = readOnly
        ? ""
        : "<button type=\\"button\\" data-revert-version=\\"" + escapeHtml(version.version) + "\\">Revert</button>";
      return "<div class=\\"planner-card\\">"
        + "<div class=\\"planner-card-title\\"><span>" + escapeHtml(version.message || version.version) + "</span><span class=\\"badge\\">" + escapeHtml(version.date || "") + "</span></div>"
        + "<p>" + escapeHtml(version.version) + "</p>"
        + "<p>" + escapeHtml(version.author || "") + "</p>"
        + "<div class=\\"action-row\\">" + diffButton + revertButton + "</div>"
        + "</div>";
    }).join("");
  }

  async function diffHistoryIndex(index) {
    var anchor = state.selectedAnchor;
    var current = state.anchorVersions[index];
    var previous = state.anchorVersions[index + 1];
    if (!anchor || !current || !previous) {
      return;
    }
    var response = await api("/api/ui/anchor-diff?name=" + encodeURIComponent(anchor.name)
      + "&fromVersion=" + encodeURIComponent(previous.version)
      + "&toVersion=" + encodeURIComponent(current.version));
    el("history-diff").textContent = response.patch || "(empty diff)";
  }

  async function revertAnchorVersion(version) {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      return;
    }
    assertMutableAnchor(anchor, "revert them");
    if (!window.confirm("Revert " + anchor.name + " to " + version + " as a new commit?")) {
      return;
    }
    var result = await apiPost("/api/ui/anchor-revert", {
      name: anchor.name,
      toVersion: version,
      message: el("action-message").value.trim() || undefined
    });
    el("history-diff").textContent = formatWriteResult(result);
    await load();
    await selectAnchor(anchor.name, { skipLocationUpdate: true });
  }

  async function renameSelectedAnchor() {
    var anchor = state.selectedAnchor;
    var to = el("rename-target").value.trim();
    if (!anchor || !to) {
      throw new Error("Rename requires a selected anchor and a target path.");
    }
    assertMutableAnchor(anchor, "rename them");
    if (!window.confirm("Rename " + anchor.name + " to " + to + "?")) {
      return;
    }
    var result = await apiPost("/api/ui/anchor-rename", {
      from: anchor.name,
      to: to,
      approved: true,
      message: el("action-message").value.trim() || undefined,
      expectedFileCommit: anchor.fileCommit
    });
    el("history-diff").textContent = formatWriteResult(result);
    if (result.version) {
      state.selectedName = to;
      await load();
      await selectAnchor(to, { skipLocationUpdate: true });
    }
  }

  async function deleteSelectedAnchor() {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      throw new Error("Select an anchor before deleting.");
    }
    assertMutableAnchor(anchor, "delete them");
    var typed = window.prompt("Type the full anchor name to delete it.", "");
    if (typed !== anchor.name) {
      setBanner("Delete cancelled; anchor name did not match.", "warn");
      return;
    }
    var result = await apiPost("/api/ui/anchor-delete", {
      name: anchor.name,
      approved: true,
      message: el("action-message").value.trim() || undefined,
      expectedFileCommit: anchor.fileCommit
    });
    el("history-diff").textContent = formatWriteResult(result);
    if (result.version) {
      state.selectedName = null;
      state.selectedAnchor = null;
      await load();
      showRoot();
    }
  }

  function showRootMode(mode) {
    state.rootMode = mode;
    document.querySelectorAll("[data-root-mode]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.rootMode === mode);
    });
    el("root-rendered").hidden = mode !== "rendered";
    el("root-raw").hidden = mode !== "raw";
    updateLocationFromState({ view: state.activeTab, history: "replace" });
  }

  function showDetailMode(mode) {
    state.detailMode = mode;
    document.querySelectorAll("[data-detail-mode]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.detailMode === mode);
    });
    el("detail-rendered").hidden = mode !== "rendered";
    var tasksBlock = safeEl("detail-tasks");
    if (tasksBlock) {
      tasksBlock.hidden = mode !== "rendered" || !tasksBlock.innerHTML;
    }
    el("detail-raw").hidden = mode !== "raw";
    el("detail-frontmatter").hidden = mode !== "frontmatter";
    updateLocationFromState({ view: state.activeTab, history: "replace" });
  }

  function showTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll(".tab").forEach(function (button) {
      if (button.dataset.tab === "detail") {
        button.disabled = !state.selectedName;
      }
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    document.querySelectorAll(".view").forEach(function (view) {
      view.classList.toggle("active", view.id === tab + "-view");
    });
  }

  function showSelectedAnchor() {
    if (!state.selectedName) {
      return;
    }
    updateAnchorLocation(state.selectedName);
    showTab("detail");
  }

  function showRoot(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "root", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("root");
  }

  function showPlanner(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "planner", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("planner");
  }

  function showTasksView(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "tasks", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("tasks");
    if (state.tasks.length === 0 && !state.tasksLoading) {
      loadTasks();
    }
  }

  function showTracesView(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "traces", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("traces");
    if (!state.traces && !state.tracesLoading) {
      loadTraces();
    }
  }

  function showCoverageView(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "coverage", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("coverage");
    if (!state.coverage && !state.coverageLoading) {
      loadCoverage();
    } else {
      renderCoverage();
    }
  }

  // Switch to the tasks view (where tasks are editable) and focus a specific
  // task, used by the detail-view "Edit in tasks" links. loadTasks re-renders
  // and applies the focus; if tasks are already loaded we apply it directly.
  function openTasksForEditing(taskId) {
    state.pendingTaskFocus = taskId || null;
    var alreadyLoaded = state.tasks.length > 0;
    showTasksView();
    if (alreadyLoaded) {
      applyPendingTaskFocus();
    }
  }

  function wireClaimEpistemologyControls(container, anchor, readOnly) {
    var claims = (anchor.ui && anchor.ui.claims) || [];
    container.querySelectorAll(".claim-epistemology-button[data-claim-line]").forEach(function (button) {
      button.addEventListener("click", function () {
        var line = Number(button.dataset.claimLine || "0");
        var claim = claims.find(function (entry) { return entry.line === line; });
        if (claim) {
          openClaimSourceModal(claim, readOnly, anchor);
        }
      });
    });
    container.querySelectorAll(".claim-text-edit-button[data-claim-line]").forEach(function (button) {
      button.disabled = !!readOnly;
      button.title = readOnly ? SERVER_RULE_READ_ONLY_MESSAGE : "Edit claim text";
      button.addEventListener("click", function () {
        if (readOnly) return;
        var line = Number(button.dataset.claimLine || "0");
        var claim = claims.find(function (entry) { return entry.line === line; });
        if (claim) {
          openClaimTextEditor(button, claim, anchor);
        }
      });
    });
  }

  function wireMermaidBlockControls(container, anchor, readOnly) {
    var blocks = (anchor.ui && anchor.ui.mermaidBlocks) || [];
    container.querySelectorAll(".mermaid-source-button[data-mermaid-line]").forEach(function (button) {
      button.addEventListener("click", function () {
        var line = Number(button.dataset.mermaidLine || "0");
        var block = blocks.find(function (entry) { return entry.line === line; });
        if (block) {
          openMermaidSourceModal(block, readOnly, anchor);
        }
      });
    });
    container.querySelectorAll(".mermaid-text-edit-button[data-mermaid-line]").forEach(function (button) {
      button.disabled = !!readOnly;
      button.title = readOnly ? SERVER_RULE_READ_ONLY_MESSAGE : "Edit Mermaid diagram";
      button.addEventListener("click", function () {
        if (readOnly) return;
        var line = Number(button.dataset.mermaidLine || "0");
        var block = blocks.find(function (entry) { return entry.line === line; });
        if (block) {
          openMermaidTextEditor(button, block, anchor);
        }
      });
    });
  }

  function closeClaimTextEditor() {
    var editor = state.claimTextEditor;
    if (!editor) return;
    if (editor.textEl) editor.textEl.hidden = false;
    if (editor.editorEl && editor.editorEl.parentNode) {
      editor.editorEl.parentNode.removeChild(editor.editorEl);
    }
    if (editor.button) editor.button.disabled = false;
    state.claimTextEditor = null;
  }

  function closeMermaidTextEditor() {
    var editor = state.mermaidTextEditor;
    if (!editor) return;
    if (editor.diagramEl) editor.diagramEl.hidden = false;
    if (editor.editorEl && editor.editorEl.parentNode) {
      editor.editorEl.parentNode.removeChild(editor.editorEl);
    }
    if (editor.button) editor.button.disabled = false;
    state.mermaidTextEditor = null;
  }

  function closeBulletTextEditor() {
    var editor = state.bulletTextEditor;
    if (!editor) return;
    if (editor.textEl) editor.textEl.hidden = false;
    if (editor.editorEl && editor.editorEl.parentNode) {
      editor.editorEl.parentNode.removeChild(editor.editorEl);
    }
    if (editor.button) editor.button.disabled = false;
    state.bulletTextEditor = null;
  }

  function closeSectionAddEditor() {
    var editor = state.sectionAddEditor;
    if (!editor) return;
    if (editor.editorEl && editor.editorEl.parentNode) {
      editor.editorEl.parentNode.removeChild(editor.editorEl);
    }
    if (editor.button) editor.button.disabled = false;
    state.sectionAddEditor = null;
  }

  function wireSectionAddControls(container, anchor, readOnly) {
    container.querySelectorAll(".section-add-button[data-section-heading]").forEach(function (button) {
      button.disabled = !!readOnly;
      button.addEventListener("click", function () {
        if (readOnly) return;
        openSectionAddEditor(button, anchor);
      });
    });
  }

  function openSectionAddEditor(button, anchor) {
    closeClaimTextEditor();
    closeBulletTextEditor();
    closeMermaidTextEditor();
    closeSectionAddEditor();
    var headingEl = button.closest("h2, h3");
    if (!headingEl) return;
    button.disabled = true;
    var section = button.dataset.sectionHeading || "section";
    var editorEl = document.createElement("div");
    editorEl.className = "section-add-editor";
    editorEl.innerHTML = "<textarea class=\\"section-add-input\\" rows=\\"2\\" placeholder=\\"Add one bullet to "
      + escapeHtml(section) + "\\"></textarea>"
      + "<span class=\\"claim-text-editor-actions\\">"
      + "<button type=\\"button\\" class=\\"section-add-save\\">Add</button>"
      + "<button type=\\"button\\" class=\\"section-add-cancel\\">Cancel</button>"
      + "<span class=\\"claim-text-editor-result\\"></span>"
      + "</span>";
    headingEl.insertAdjacentElement("afterend", editorEl);
    state.sectionAddEditor = { anchor: anchor, section: section, button: button, editorEl: editorEl };
    var input = editorEl.querySelector(".section-add-input");
    input.focus();
    editorEl.querySelector(".section-add-cancel").addEventListener("click", closeSectionAddEditor);
    editorEl.querySelector(".section-add-save").addEventListener("click", function () {
      saveSectionAddEditor().catch(function (error) {
        editorEl.querySelector(".claim-text-editor-result").textContent = error.message;
      });
    });
  }

  async function saveSectionAddEditor() {
    var editor = state.sectionAddEditor;
    if (!editor) return;
    var resultEl = editor.editorEl.querySelector(".claim-text-editor-result");
    var input = editor.editorEl.querySelector(".section-add-input");
    var text = (input.value || "").trim();
    if (!text) {
      resultEl.textContent = "Content is required.";
      return;
    }
    if (/[\\r\\n]/.test(text)) {
      resultEl.textContent = "Add one bullet at a time.";
      return;
    }
    resultEl.textContent = "Adding...";
    var payload = {
      name: editor.anchor.name,
      heading: editor.section,
      text: text,
      approved: true
    };
    if (editor.anchor.fileCommit) payload.expectedFileCommit = editor.anchor.fileCommit;
    var res = await apiPost("/api/ui/anchor-structured-content", payload);
    if (res.warnings && res.warnings.some(function (warning) { return warning.severity === "BLOCK"; })) {
      resultEl.textContent = res.warnings.map(function (warning) { return warning.message; }).join("; ");
      return;
    }
    var anchorName = editor.anchor.name;
    closeSectionAddEditor();
    if (state.selectedName === anchorName) {
      selectAnchor(anchorName, { skipLocationUpdate: true });
    }
  }

  function openMermaidTextEditor(button, block, anchor) {
    closeClaimTextEditor();
    closeBulletTextEditor();
    closeMermaidTextEditor();
    var wrapper = button.closest(".mermaid-block");
    var diagramEl = wrapper ? wrapper.querySelector(".mermaid") : null;
    if (!wrapper || !diagramEl) return;
    button.disabled = true;
    diagramEl.hidden = true;
    var editorEl = document.createElement("div");
    editorEl.className = "claim-text-editor";
    editorEl.innerHTML = "<textarea class=\\"claim-text-input\\" rows=\\"8\\"></textarea>"
      + "<span class=\\"claim-text-editor-actions\\">"
      + "<button type=\\"button\\" class=\\"mermaid-text-update\\">Update</button>"
      + "<button type=\\"button\\" class=\\"mermaid-text-cancel\\">Cancel</button>"
      + "<span class=\\"claim-text-editor-result\\"></span>"
      + "</span>";
    wrapper.appendChild(editorEl);
    var input = editorEl.querySelector(".claim-text-input");
    input.value = block.text || "";
    input.focus();
    input.select();
    state.mermaidTextEditor = { anchor: anchor, block: block, button: button, diagramEl: diagramEl, editorEl: editorEl };
    editorEl.querySelector(".mermaid-text-cancel").addEventListener("click", closeMermaidTextEditor);
    editorEl.querySelector(".mermaid-text-update").addEventListener("click", function () {
      saveMermaidTextEditor().catch(function (error) {
        editorEl.querySelector(".claim-text-editor-result").textContent = error.message;
      });
    });
  }

  async function saveMermaidTextEditor() {
    var editor = state.mermaidTextEditor;
    if (!editor) return;
    var resultEl = editor.editorEl.querySelector(".claim-text-editor-result");
    var input = editor.editorEl.querySelector(".claim-text-input");
    var nextText = (input.value || "").trim();
    if (!nextText) {
      resultEl.textContent = "Mermaid diagram text is required.";
      return;
    }
    resultEl.textContent = "Updating...";
    var payload = {
      name: editor.anchor.name,
      line: editor.block.line,
      text: nextText,
      approved: true
    };
    if (editor.anchor.fileCommit) payload.expectedFileCommit = editor.anchor.fileCommit;
    var res = await apiPost("/api/ui/mermaid-text", payload);
    if (res.warnings && res.warnings.some(function (warning) { return warning.severity === "BLOCK"; })) {
      resultEl.textContent = res.warnings.map(function (warning) { return warning.message; }).join("; ");
      return;
    }
    closeMermaidTextEditor();
    if (state.selectedName === editor.anchor.name) {
      selectAnchor(editor.anchor.name, { skipLocationUpdate: true });
    }
  }

  function openClaimTextEditor(button, claim, anchor) {
    closeClaimTextEditor();
    closeBulletTextEditor();
    var inline = button.closest(".claim-inline");
    var textEl = inline ? inline.querySelector(".claim-inline-text") : null;
    if (!inline || !textEl) return;
    button.disabled = true;
    textEl.hidden = true;
    var editorEl = document.createElement("span");
    editorEl.className = "claim-text-editor";
    editorEl.innerHTML = "<textarea class=\\"claim-text-input\\" rows=\\"3\\"></textarea>"
      + "<span class=\\"claim-text-editor-actions\\">"
      + "<button type=\\"button\\" class=\\"claim-text-update\\">Update</button>"
      + "<button type=\\"button\\" class=\\"claim-text-cancel\\">Cancel</button>"
      + "<button type=\\"button\\" class=\\"claim-text-delete danger-button\\"><span class=\\"icon-label\\"><svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-trash\\"></use></svg><span>Delete</span></span></button>"
      + "<span class=\\"claim-text-editor-result\\"></span>"
      + "</span>";
    inline.insertBefore(editorEl, textEl.nextSibling);
    var input = editorEl.querySelector(".claim-text-input");
    input.value = claim.text || "";
    input.focus();
    input.select();
    state.claimTextEditor = { anchor: anchor, claim: claim, button: button, textEl: textEl, editorEl: editorEl };
    editorEl.querySelector(".claim-text-cancel").addEventListener("click", closeClaimTextEditor);
    editorEl.querySelector(".claim-text-update").addEventListener("click", function () {
      saveClaimTextEditor(false).catch(function (error) {
        editorEl.querySelector(".claim-text-editor-result").textContent = error.message;
      });
    });
    editorEl.querySelector(".claim-text-delete").addEventListener("click", function () {
      var ok = !window.confirm || window.confirm("Delete this claim and its provenance sources?");
      if (!ok) return;
      saveClaimTextEditor(true).catch(function (error) {
        editorEl.querySelector(".claim-text-editor-result").textContent = error.message;
      });
    });
  }

  async function saveClaimTextEditor(remove) {
    var editor = state.claimTextEditor;
    if (!editor) return;
    var resultEl = editor.editorEl.querySelector(".claim-text-editor-result");
    var input = editor.editorEl.querySelector(".claim-text-input");
    var nextText = (input.value || "").trim();
    if (!remove && !nextText) {
      resultEl.textContent = "Claim text is required.";
      return;
    }
    if (!remove && /[\\r\\n]/.test(nextText)) {
      resultEl.textContent = "Claim text must be a single line.";
      return;
    }
    resultEl.textContent = remove ? "Deleting..." : "Updating...";
    var payload = {
      name: editor.anchor.name,
      line: editor.claim.line,
      claim: editor.claim.text,
      delete: !!remove,
      approved: true
    };
    if (!remove) payload.text = nextText;
    if (editor.anchor.fileCommit) payload.expectedFileCommit = editor.anchor.fileCommit;
    var res = await apiPost("/api/ui/claim-text", payload);
    if (res.warnings && res.warnings.some(function (warning) { return warning.severity === "BLOCK"; })) {
      resultEl.textContent = res.warnings.map(function (warning) { return warning.message; }).join("; ");
      return;
    }
    closeClaimTextEditor();
    if (state.selectedName === editor.anchor.name) {
      selectAnchor(editor.anchor.name, { skipLocationUpdate: true });
    }
  }

  function wireEditableBulletControls(container, anchor, readOnly) {
    var questions = (anchor.ui && anchor.ui.questions) || [];
    container.querySelectorAll(".bullet-text-edit-button[data-bullet-line]").forEach(function (button) {
      button.disabled = !!readOnly;
      button.title = readOnly ? SERVER_RULE_READ_ONLY_MESSAGE : (button.getAttribute("title") || "Edit bullet text");
      button.addEventListener("click", function () {
        if (readOnly) return;
        var line = Number(button.dataset.bulletLine || "0");
        var kind = button.dataset.bulletKind || "bullet";
        var question = questions.find(function (entry) { return entry.line === line; });
        var bullet = {
          line: line,
          kind: kind,
          text: question ? question.text || "" : button.dataset.bulletText || "",
          id: question ? question.id : undefined
        };
        openBulletTextEditor(button, bullet, anchor);
      });
    });
  }

  function openBulletTextEditor(button, bullet, anchor) {
    closeClaimTextEditor();
    closeBulletTextEditor();
    var inline = button.closest(".editable-bullet-inline");
    var textEl = inline ? inline.querySelector(".editable-bullet-inline-text") : null;
    if (!inline || !textEl) return;
    button.disabled = true;
    textEl.hidden = true;
    var editorEl = document.createElement("span");
    editorEl.className = "claim-text-editor";
    editorEl.innerHTML = "<textarea class=\\"claim-text-input\\" rows=\\"3\\"></textarea>"
      + "<span class=\\"claim-text-editor-actions\\">"
      + "<button type=\\"button\\" class=\\"bullet-text-update\\">Update</button>"
      + "<button type=\\"button\\" class=\\"bullet-text-cancel\\">Cancel</button>"
      + "<button type=\\"button\\" class=\\"bullet-text-delete danger-button\\"><span class=\\"icon-label\\"><svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-trash\\"></use></svg><span>Delete</span></span></button>"
      + "<span class=\\"claim-text-editor-result\\"></span>"
      + "</span>";
    inline.insertBefore(editorEl, textEl.nextSibling);
    var input = editorEl.querySelector(".claim-text-input");
    input.value = bullet.text || "";
    input.focus();
    input.select();
    state.bulletTextEditor = { anchor: anchor, bullet: bullet, button: button, textEl: textEl, editorEl: editorEl };
    editorEl.querySelector(".bullet-text-cancel").addEventListener("click", closeBulletTextEditor);
    editorEl.querySelector(".bullet-text-update").addEventListener("click", function () {
      saveBulletTextEditor(false).catch(function (error) {
        editorEl.querySelector(".claim-text-editor-result").textContent = error.message;
      });
    });
    editorEl.querySelector(".bullet-text-delete").addEventListener("click", function () {
      var label = bullet.kind === "question" ? "question" : "bullet";
      var ok = !window.confirm || window.confirm("Delete this " + label + "?");
      if (!ok) return;
      saveBulletTextEditor(true).catch(function (error) {
        editorEl.querySelector(".claim-text-editor-result").textContent = error.message;
      });
    });
  }

  async function saveBulletTextEditor(remove) {
    var editor = state.bulletTextEditor;
    if (!editor) return;
    var resultEl = editor.editorEl.querySelector(".claim-text-editor-result");
    var input = editor.editorEl.querySelector(".claim-text-input");
    var nextText = (input.value || "").trim();
    var label = editor.bullet.kind === "question" ? "Question" : "Bullet";
    if (!remove && !nextText) {
      resultEl.textContent = label + " text is required.";
      return;
    }
    if (!remove && /[\\r\\n]/.test(nextText)) {
      resultEl.textContent = label + " text must be a single line.";
      return;
    }
    resultEl.textContent = remove ? "Deleting..." : "Updating...";
    var payload = {
      name: editor.anchor.name,
      line: editor.bullet.line,
      delete: !!remove,
      approved: true
    };
    if (editor.bullet.kind === "question" && editor.bullet.id) payload.id = editor.bullet.id;
    if (!remove) payload.text = nextText;
    if (editor.anchor.fileCommit) payload.expectedFileCommit = editor.anchor.fileCommit;
    var endpoint = editor.bullet.kind === "question" ? "/api/ui/question-text" : "/api/ui/bullet-text";
    var res = await apiPost(endpoint, payload);
    if (res.warnings && res.warnings.some(function (warning) { return warning.severity === "BLOCK"; })) {
      resultEl.textContent = res.warnings.map(function (warning) { return warning.message; }).join("; ");
      return;
    }
    closeBulletTextEditor();
    if (state.selectedName === editor.anchor.name) {
      selectAnchor(editor.anchor.name, { skipLocationUpdate: true });
    }
  }

  function openClaimSourceModal(claim, readOnly, anchor) {
    state.claimSourceModal = {
      claim: claim,
      readOnly: !!readOnly,
      anchorName: anchor && anchor.name ? anchor.name : claim.anchor,
      expectedFileCommit: anchor && anchor.fileCommit ? anchor.fileCommit : undefined
    };
    el("claim-source-title").textContent = "Claim Sources";
    el("claim-source-text").textContent = claim.text || "";
    el("claim-source-id-value").textContent = claim.id || "Assigned by server on save";
    el("claim-source-readonly").hidden = !readOnly;
    el("claim-source-result").textContent = readOnly ? SERVER_RULE_READ_ONLY_MESSAGE : "";
    el("claim-source-add").disabled = !!readOnly;
    el("claim-source-save").disabled = !!readOnly;
    renderClaimSourceRows(claimSources(claim), !!readOnly);
    renderClaimPersonSuggestions("", []);
    if (!state.projectMappings && !state.projectMappingsLoading) {
      loadProjectMappings().then(function () {
        if (state.claimSourceModal && state.claimSourceModal.claim === claim) {
          renderClaimSourceRows(claimSources(claim), !!readOnly);
        }
      }).catch(function (error) { setBanner(error.message, "error"); });
    }
    if (!state.registry && !state.registryLoading) {
      loadRegistry().catch(function (error) { setBanner(error.message, "error"); });
    }
    el("claim-source-modal").hidden = false;
  }

  function closeClaimSourceModal() {
    state.claimSourceModal = null;
    state.claimPersonInput = null;
    el("claim-source-modal").hidden = true;
    el("claim-source-result").textContent = "";
  }

  function renderClaimSourceRows(sources, readOnly) {
    var rows = sources.length ? sources : [{ src: "", observed: todayIso(), conf: "medium" }];
    el("claim-source-rows").innerHTML = rows.map(function (source, index) {
      return claimSourceRowHtml(source, index, readOnly);
    }).join("");
    wireClaimSourceRows();
  }

  function claimSourceRowHtml(source, index, readOnly) {
    var disabled = readOnly ? " disabled" : "";
    var kind = claimSourceKind(source);
    var type = claimSourceTypeById(kind);
    var personValue = source.personName || source.person || "";
    return "<div class=\\"claim-source-row\\" data-source-index=\\"" + index + "\\" data-kind=\\"" + escapeHtml(kind) + "\\" data-readonly=\\"" + (readOnly ? "1" : "0") + "\\">"
      + "<label>Type<select class=\\"claim-source-kind\\"" + disabled + ">"
      + claimSourceTypeOptionsHtml(type.id)
      + "</select></label>"
      + "<label class=\\"claim-source-src-label\\"><span class=\\"claim-source-src-title\\">" + escapeHtml(claimSourceValueLabel(type)) + "</span><input class=\\"claim-source-src\\" type=\\"text\\" value=\\"" + escapeHtml(source.src || "") + "\\" placeholder=\\"" + escapeHtml(claimSourceValuePlaceholder(type)) + "\\"" + disabled + "></label>"
      + "<label class=\\"claim-source-person-label\\">Developer<input class=\\"claim-source-person\\" type=\\"text\\" value=\\"" + escapeHtml(personValue) + "\\" placeholder=\\"Search people\\" list=\\"claim-person-suggestions\\" autocomplete=\\"off\\"" + disabled + "></label>"
      + "<label>Last checked<input class=\\"claim-source-observed\\" type=\\"date\\" value=\\"" + escapeHtml(source.observed || todayIso()) + "\\"" + disabled + "></label>"
      + "<label>Strength<select class=\\"claim-source-conf\\"" + disabled + ">"
      + ["high", "medium", "low"].map(function (value) {
        return "<option value=\\"" + value + "\\"" + (source.conf === value ? " selected" : "") + ">" + value + "</option>";
      }).join("")
      + "</select></label>"
      + "<label class=\\"claim-source-edge-label\\">Derived from<input class=\\"claim-source-derived-from\\" type=\\"text\\" value=\\"" + escapeHtml(source.derivedFrom || "") + "\\" placeholder=\\"anchor#claim-id or #claim-id\\"" + disabled + "></label>"
      + "<label class=\\"claim-source-edge-label\\">Contradicts<input class=\\"claim-source-contradicts\\" type=\\"text\\" value=\\"" + escapeHtml(source.contradicts || "") + "\\" placeholder=\\"anchor#claim-id or #claim-id\\"" + disabled + "></label>"
      + "<button class=\\"claim-source-delete danger-button\\" type=\\"button\\"" + disabled + "><span class=\\"icon-label\\"><svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-trash\\"></use></svg><span>Delete</span></span></button>"
      + "</div>";
  }

  function wireClaimSourceRows() {
    el("claim-source-rows").querySelectorAll(".claim-source-row").forEach(function (row) {
      updateClaimSourceRowKind(row);
      var kindSelect = row.querySelector(".claim-source-kind");
      if (kindSelect && !kindSelect.dataset.wired) {
        kindSelect.dataset.wired = "1";
        kindSelect.addEventListener("change", function () {
          updateClaimSourceRowKind(row);
        });
      }
      var personInput = row.querySelector(".claim-source-person");
      if (personInput && !personInput.dataset.wired) {
        personInput.dataset.wired = "1";
        personInput.addEventListener("focus", function () {
          state.claimPersonInput = personInput;
          renderClaimPersonSuggestions(personInput.value || "", []);
          if (!state.registry && !state.registryLoading) {
            loadRegistry().catch(function (error) { setBanner(error.message, "error"); });
          }
        });
        personInput.addEventListener("input", function () {
          state.claimPersonInput = personInput;
          queueClaimPersonSearch(personInput);
        });
      }
    });
    el("claim-source-rows").querySelectorAll(".claim-source-delete").forEach(function (button) {
      if (button.dataset.wired) return;
      button.dataset.wired = "1";
      button.addEventListener("click", function () {
        button.closest(".claim-source-row").remove();
      });
    });
  }

  function updateClaimSourceRowKind(row) {
    if (!row) return;
    var kindSelect = row.querySelector(".claim-source-kind");
    var srcInput = row.querySelector(".claim-source-src");
    var srcTitle = row.querySelector(".claim-source-src-title");
    var confSelect = row.querySelector(".claim-source-conf");
    var kind = normalizeClaimSourceTypeId(kindSelect ? kindSelect.value : "url") || "url";
    var type = claimSourceTypeById(kind);
    var readOnly = row.dataset.readonly === "1";
    row.dataset.kind = type.id;
    row.dataset.requiresPerson = type.requiresPerson ? "1" : "0";
    if (srcTitle) srcTitle.textContent = claimSourceValueLabel(type);
    if (srcInput) srcInput.placeholder = claimSourceValuePlaceholder(type);
    if (type.requiresPerson) {
      if (srcInput) srcInput.value = type.id === "trust-me-bro" ? "trust me bro" : type.id;
    }
    if (type.lockedConfidence) {
      if (confSelect) {
        confSelect.value = type.lockedConfidence;
        confSelect.disabled = true;
      }
    } else if (confSelect) {
      confSelect.disabled = readOnly;
    }
  }

  function addClaimSourceRow() {
    var container = el("claim-source-rows");
    var temp = document.createElement("div");
    temp.innerHTML = claimSourceRowHtml({ src: "", observed: todayIso(), conf: "medium" }, container.children.length, false);
    container.appendChild(temp.firstChild);
    wireClaimSourceRows();
  }

  function collectClaimSourceRows() {
    var sources = [];
    var rows = el("claim-source-rows").querySelectorAll(".claim-source-row");
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      updateClaimSourceRowKind(row);
      var kind = normalizeClaimSourceTypeId((row.querySelector(".claim-source-kind") || {}).value || "url") || "url";
      var type = claimSourceTypeById(kind);
      var src = (row.querySelector(".claim-source-src").value || "").trim();
      var personRaw = (row.querySelector(".claim-source-person").value || "").trim();
      var observed = row.querySelector(".claim-source-observed").value || "";
      var conf = row.querySelector(".claim-source-conf").value || "medium";
      var derivedFromEl = row.querySelector(".claim-source-derived-from");
      var contradictsEl = row.querySelector(".claim-source-contradicts");
      var derivedFrom = (derivedFromEl && derivedFromEl.value || "").trim();
      var contradicts = (contradictsEl && contradictsEl.value || "").trim();
      if (!type.requiresPerson && !src && !observed && !derivedFrom && !contradicts) {
        continue;
      }
      var edges = {};
      if (derivedFrom) edges.derivedFrom = derivedFrom;
      if (contradicts) edges.contradicts = contradicts;
      if (type.requiresPerson) {
        var person = claimPersonAssignmentValue(personRaw);
        if (!person) {
          return { ok: false, message: "Person is required for every " + type.label + " row." };
        }
        if (!observed) {
          return { ok: false, message: "Last checked is required for every row." };
        }
        sources.push(Object.assign({
          src: kind === "trust-me-bro" ? "trust me bro" : kind,
          kind: kind,
          person: person,
          observed: observed,
          conf: type.lockedConfidence || conf
        }, edges));
        continue;
      }
      if (!src) {
        return { ok: false, message: claimSourceValueLabel(type) + " is required for every row." };
      }
      if (!observed) {
        return { ok: false, message: "Last checked is required for every row." };
      }
      sources.push(Object.assign({ src: src, kind: kind, observed: observed, conf: type.lockedConfidence || conf }, edges));
    }
    return { ok: true, sources: sources };
  }

  function claimSourceKind(source) {
    var kind = normalizeClaimSourceTypeId(source && source.kind);
    var src = String((source && source.src) || "").toLowerCase().trim();
    if (src === "trust me bro") return "trust-me-bro";
    return kind || "url";
  }

  function claimSourceValueLabel(type) {
    return type && type.label ? type.label : "Source";
  }

  function claimSourceValuePlaceholder(type) {
    if (type && type.id === "url") return "https://example.com/source";
    if (type && type.id === "misc") return "Reference, note, or other source";
    return "PR #42, src/file.ts#L12, URL, anchor, or person:id";
  }

  function claimSourceTypeOptionsHtml(selected) {
    return claimSourceTypes().map(function (type) {
      return "<option value=\\"" + escapeHtml(type.id) + "\\"" + (type.id === selected ? " selected" : "") + ">" + escapeHtml(type.label) + "</option>";
    }).join("");
  }

  function queueClaimPersonSearch(input) {
    if (state.claimPersonSearchTimer) {
      clearTimeout(state.claimPersonSearchTimer);
    }
    state.claimPersonSearchTimer = setTimeout(function () {
      searchClaimPeople(input);
    }, 120);
  }

  async function searchClaimPeople(input) {
    var query = (input && input.value ? input.value : "").trim();
    renderClaimPersonSuggestions(query, []);
    if (!query || !document.body.contains(input)) {
      return;
    }
    var seq = ++state.claimPersonSearchSeq;
    try {
      var result = await api("/api/ui/people-search?q=" + encodeURIComponent(query) + "&limit=10");
      if (seq !== state.claimPersonSearchSeq || !document.body.contains(input)) {
        return;
      }
      var matches = normalizeTaskOwnerMatches(result.people || []);
      rememberClaimPersonMatches(matches);
      renderClaimPersonSuggestions(query, matches);
    } catch (_error) {
      renderClaimPersonSuggestions(query, []);
    }
  }

  function rememberClaimPersonMatches(matches) {
    normalizeTaskOwnerMatches(matches).slice().reverse().forEach(function (match) {
      var key = claimPersonMatchKey(match);
      state.claimPersonMatchCache = state.claimPersonMatchCache.filter(function (cached) {
        return claimPersonMatchKey(cached) !== key;
      });
      state.claimPersonMatchCache.unshift(match);
    });
    state.claimPersonMatchCache = state.claimPersonMatchCache.slice(0, 10);
  }

  function claimPersonCachedMatches(query) {
    var needle = String(query || "").toLowerCase().trim();
    return state.claimPersonMatchCache.filter(function (match) {
      if (!needle) return true;
      return taskOwnerSearchText(match).indexOf(needle) >= 0;
    });
  }

  function claimPersonRegistryMatches(query) {
    var needle = String(query || "").toLowerCase().trim();
    if (!state.registry) return [];
    return (state.registry.people || []).filter(function (person) {
      return !needle || personSearchText(person, state.registry).indexOf(needle) >= 0;
    }).map(function (person) {
      return {
        id: person.id,
        displayName: person.displayName,
        aliases: person.identities && Array.isArray(person.identities.names) ? person.identities.names : [],
        matched: person.displayName,
        value: person.displayName
      };
    });
  }

  function renderClaimPersonSuggestions(query, matches) {
    var datalist = safeEl("claim-person-suggestions");
    if (!datalist) return;
    var seen = new Set();
    var options = claimPersonCachedMatches(query)
      .concat(normalizeTaskOwnerMatches(matches))
      .concat(claimPersonRegistryMatches(query))
      .filter(function (match) {
        var key = claimPersonMatchKey(match);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 10);
    datalist.innerHTML = options.map(function (match) {
      var value = match.value || match.displayName || match.id;
      var labelParts = [match.id];
      if (match.matched && match.matched !== match.displayName && match.matched !== match.id) {
        labelParts.push("matched " + match.matched);
      }
      return "<option value=\\"" + escapeHtml(value) + "\\" label=\\"" + escapeHtml(labelParts.filter(Boolean).join(" · ")) + "\\"></option>";
    }).join("");
  }

  function claimPersonAssignmentValue(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return "";
    var needle = trimmed.toLowerCase();
    var match = state.claimPersonMatchCache.find(function (cached) {
      return taskOwnerExactValues(cached).some(function (candidate) {
        return candidate.toLowerCase() === needle;
      });
    });
    if (match && match.id) {
      return match.id;
    }
    if (state.registry) {
      var person = (state.registry.people || []).find(function (candidate) {
        var values = [candidate.id, candidate.displayName].concat(candidate.identities && Array.isArray(candidate.identities.names) ? candidate.identities.names : []);
        return values.filter(Boolean).some(function (candidateValue) {
          return String(candidateValue).toLowerCase() === needle;
        });
      });
      if (person) {
        return person.id;
      }
    }
    return trimmed;
  }

  function claimPersonMatchKey(match) {
    return String((match && (match.id || match.value || match.displayName)) || "").toLowerCase().trim();
  }

  async function saveClaimPersonFromModal() {
    var id = (el("claim-new-person-id").value || "").trim();
    var name = (el("claim-new-person-name").value || "").trim();
    if (!id) { el("claim-source-result").textContent = "Person ID is required."; return; }
    if (!name) { el("claim-source-result").textContent = "Display name is required."; return; }
    if (!state.registry && !state.registryLoading) {
      await loadRegistry();
    }
    if (!state.registry) {
      state.registry = { people: [], teams: [] };
    }
    if ((state.registry.people || []).some(function (person) { return person.id.toLowerCase() === id.toLowerCase(); })) {
      el("claim-source-result").textContent = "A person with that ID already exists.";
      return;
    }
    var person = { id: id, displayName: name };
    state.registry.people.push(person);
    el("claim-source-result").textContent = "Saving person...";
    try {
      await apiPost("/api/ui/people-registry", {
        registry: state.registry,
        message: "chore: add person " + id,
        expectedFileCommit: state.registryFileCommit || undefined
      });
      await loadRegistry();
      rememberClaimPersonMatches([{ id: id, displayName: name, aliases: [], matched: name, value: name }]);
      renderClaimPersonSuggestions(name, state.claimPersonMatchCache);
      if (state.claimPersonInput && document.body.contains(state.claimPersonInput)) {
        state.claimPersonInput.value = name;
      }
      el("claim-new-person-id").value = "";
      el("claim-new-person-name").value = "";
      el("claim-person-add").open = false;
      el("claim-source-result").textContent = "Person added.";
    } catch (error) {
      el("claim-source-result").textContent = error.message;
      await loadRegistry();
    }
  }

  function slugifyPersonId(value) {
    return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  async function saveClaimSourcesFromModal() {
    var modal = state.claimSourceModal;
    if (!modal || modal.readOnly) {
      return;
    }
    var collected = collectClaimSourceRows();
    if (!collected.ok) {
      el("claim-source-result").textContent = collected.message;
      return;
    }
    el("claim-source-result").textContent = "Saving...";
    var payload = {
      name: modal.anchorName,
      line: modal.claim.line,
      claim: modal.claim.text,
      sources: collected.sources,
      approved: true
    };
    if (modal.expectedFileCommit) {
      payload.expectedFileCommit = modal.expectedFileCommit;
    }
    try {
      var res = await apiPost("/api/ui/claim-sources", payload);
      if (res.warnings && res.warnings.some(function (warning) { return warning.severity === "BLOCK"; })) {
        el("claim-source-result").textContent = res.warnings.map(function (warning) { return warning.message; }).join("; ");
        return;
      }
      closeClaimSourceModal();
      if (state.selectedName === modal.anchorName) {
        selectAnchor(modal.anchorName, { skipLocationUpdate: true });
      }
    } catch (error) {
      el("claim-source-result").textContent = error.message;
    }
  }

  async function loadTraces() {
    state.tracesLoading = true;
    try {
      var result = await api("/api/ui/traces?limit=50");
      state.traces = result;
      renderTraces();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.tracesLoading = false;
    }
  }

  async function loadDryQueries() {
    state.dryQueriesLoading = true;
    try {
      var qs = "?limit=200" + (state.dryQueriesThinNoFollowUp ? "&thinNoFollowUp=true" : "");
      var result = await api("/api/ui/trace-dry-queries" + qs);
      state.dryQueries = result;
      renderDryQueries();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.dryQueriesLoading = false;
    }
  }

  function traceEventResultLine(ev) {
    var parts = [];
    var consideredCount = (ev.included ? ev.included.length : 0) + (ev.excluded ? ev.excluded.length : 0);
    if (consideredCount > 0) {
      parts.push("considered " + consideredCount + " | selected " + (ev.included ? ev.included.length : 0));
    }
    if (ev.delivered && ev.delivered.length) {
      var modeCounts = {};
      ev.delivered.forEach(function (d) {
        modeCounts[d.mode] = (modeCounts[d.mode] || 0) + 1;
      });
      var modeSummary = Object.keys(modeCounts).map(function (mode) {
        return modeCounts[mode] + " " + mode;
      }).join(", ");
      parts.push("delivered " + ev.delivered.length + " (" + modeSummary + ")");
    } else if (ev.tool !== "planContextBundle" && !ev.zeroHit && !(ev.structured && ev.structured.ids.length)) {
      parts.push("delivered none");
    }
    if (ev.listed && ev.listed.length) parts.push("listed " + ev.listed.length);
    if (ev.structured) parts.push(ev.structured.kind + " x" + ev.structured.ids.length);
    if (ev.estimatedTokens !== undefined) {
      parts.push((ev.budgetTokens !== undefined ? ev.budgetTokens + " token budget" : "budget") + ", ~" + ev.estimatedTokens + " est tokens");
    }
    if (ev.zeroHit) parts.push("ZERO HIT");
    if (ev.cursor === "continuation") parts.push("pagination");
    if (ev.truncated) parts.push("truncated");
    if (ev.error) parts.push("error: " + ev.error.message);
    return parts.join(" | ");
  }

  function traceBudgetWarning(ev) {
    var excluded = Array.isArray(ev.excluded) ? ev.excluded : [];
    var displaced = excluded.filter(function (item) {
      return item.reason && item.reason.indexOf("outside token budget") !== -1;
    });
    if (!displaced.length) {
      return "";
    }
    var top = displaced[0];
    var detail = [];
    if (top.score !== undefined) detail.push("score " + top.score);
    if (top.estimatedTokens !== undefined) detail.push("needed ~" + top.estimatedTokens);
    return "budget " + (ev.budgetTokens !== undefined ? ev.budgetTokens + " tokens" : "") + ": "
      + escapeHtml(top.name) + " excluded" + (detail.length ? " (" + detail.join(", ") + ")" : "")
      + (displaced.length > 1 ? " and " + (displaced.length - 1) + " more" : "");
  }

  function formatTraceTime(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    return isNaN(date.getTime()) ? iso : date.toLocaleString();
  }

  function traceQueryKey(sessionId, ordinal) {
    return sessionId + "#" + ordinal;
  }

  function renderTraces() {
    var data = state.traces;
    if (!data) {
      return;
    }
    var enabled = !!data.enabled;
    var sessions = data.sessions || [];
    el("traces-disabled").hidden = enabled;
    el("traces-empty").hidden = !enabled || sessions.length > 0;
    var listEl = el("traces-list");
    listEl.hidden = !enabled || sessions.length === 0;
    el("traces-summary").textContent = enabled
      ? sessions.length + " session(s), newest first. Click a query to inspect considered, selected, and delivered content."
      : "Trace logging is disabled.";
    if (listEl.hidden) {
      listEl.innerHTML = "";
      return;
    }
    listEl.innerHTML = sessions.map(renderTraceSession).join("");
    wireTraceSessionEvents(listEl, sessions);
  }

  function renderTraceSession(session) {
    var measures = session.measures || {};
    var head = '<div class="trace-session-head"><span class="trace-badge trace-badge-' + escapeHtml(session.correlation) + '">' + escapeHtml(session.correlation) + '</span> <code>' + escapeHtml(session.id) + '</code>'
      + ' <span class="trace-meta">' + escapeHtml(session.transport) + ' | ' + session.eventCount + ' event(s) | ' + escapeHtml(formatTraceTime(session.startedAt)) + (session.endedAt !== session.startedAt ? " - " + escapeHtml(formatTraceTime(session.endedAt)) : "") + '</span>'
      + (session.project ? ' <span class="trace-meta">project: ' + escapeHtml(session.project) + '</span>' : "")
      + '</div>'
      + (session.taskText || session.taskSha256 ? '<div class="trace-task">' + escapeHtml(session.taskText || "task sha256 " + session.taskSha256.slice(0, 12) + "...") + '</div>' : "");

    var measureLine = '<div class="trace-measures">'
      + '<span class="trace-meta">follow-ups ' + measures.followUpCount + '</span>'
      + '<span class="trace-meta">semantic ' + measures.semanticFollowUpCount + '</span>'
      + '<span class="trace-meta">pagination ' + measures.paginationCount + '</span>'
      + '<span class="trace-meta">zero-hit ' + measures.zeroHitCount + '</span>'
      + '<span class="trace-meta">delivered items ' + measures.deliveredItemCount + '</span>'
      + '<span class="trace-meta">full-read conversions ' + measures.fullReadConversions + '</span>'
      + '</div>';

    var rating = session.rating;
    var ratingLabel = rating ? ("Rated: " + (rating.rating === "well" ? "went well" : "went poorly") + (rating.note ? " (" + escapeHtml(rating.note) + ")" : "")) : "No rating yet.";
    var ratingRow = '<div class="trace-rating" data-session-id="' + escapeHtml(session.id) + '">'
      + '<button type="button" class="trace-rate-btn' + (rating && rating.rating === "well" ? " active" : "") + '" data-rate="well">\u{1F44D} well</button>'
      + '<button type="button" class="trace-rate-btn' + (rating && rating.rating === "poorly" ? " active" : "") + '" data-rate="poorly">\u{1F44E} poorly</button>'
      + (rating ? '<button type="button" class="trace-rate-btn" data-rate="clear">Clear</button>' : "")
      + '<span class="trace-meta trace-rating-label">' + ratingLabel + '</span>'
      + '</div>';

    var events = (session.events || []).map(function (ev, index) {
      return renderTraceQueryRow(session, ev, index);
    }).join("");

    return '<div class="trace-session" data-session-id="' + escapeHtml(session.id) + '">' + head + measureLine + ratingRow + '<div class="trace-timeline">' + events + '</div></div>';
  }

  function renderTraceQueryRow(session, ev, index) {
    var key = traceQueryKey(session.id, ev.ordinal !== undefined ? ev.ordinal : index);
    var expanded = state.tracesExpandedQuery === key;
    var warning = traceBudgetWarning(ev);
    var markers = [];
    if (ev.zeroHit) markers.push('<span class="trace-marker trace-marker-zero">zero-hit</span>');
    if (ev.cursor === "continuation") markers.push('<span class="trace-marker">pagination</span>');
    var summary = '<div class="trace-query-summary" role="button" tabindex="0" aria-expanded="' + (expanded ? "true" : "false") + '">'
      + '<code>' + escapeHtml(ev.tool) + '</code>'
      + ' <span class="trace-meta">' + escapeHtml(formatTraceTime(ev.timestamp)) + ' | ' + ev.durationMs + 'ms | ' + escapeHtml(ev.outcome) + '</span>'
      + markers.join(" ")
      + '<div class="trace-result-line">' + escapeHtml(traceEventResultLine(ev)) + '</div>'
      + (warning ? '<div class="trace-warning">⚠ ' + warning + '</div>' : '')
      + '</div>';

    var detail = "";
    if (expanded) {
      detail = '<div class="trace-query-detail">'
        + '<div class="trace-detail-columns">'
        + '<div class="trace-detail-col"><h4>Considered</h4>' + renderConsideredList(ev) + '</div>'
        + '<div class="trace-detail-col"><h4>Selected / Delivered</h4>' + renderDeliveredList(ev) + '</div>'
        + '<div class="trace-detail-col"><h4>Raw event</h4><pre class="compact-raw">' + escapeHtml(JSON.stringify(ev, null, 2)) + '</pre></div>'
        + '</div>'
        + '</div>';
    }

    return '<div class="trace-query' + (expanded ? " expanded" : "") + '" data-query-key="' + escapeHtml(key) + '">' + summary + detail + '</div>';
  }

  function renderConsideredList(ev) {
    var included = (ev.included || []).map(function (item) { return traceConsideredCard(item, true); });
    var excluded = (ev.excluded || []).map(function (item) { return traceConsideredCard(item, false); });
    var all = included.concat(excluded);
    if (!all.length) {
      return '<p class="trace-meta">No scored items reported.</p>';
    }
    return all.join("");
  }

  function traceConsideredCard(item, wasIncluded) {
    return '<div class="planner-card">'
      + '<div class="planner-card-title"><span>' + escapeHtml(item.name) + '</span><span class="badge">' + (wasIncluded ? "selected" : "excluded") + (item.score !== undefined ? ", score " + escapeHtml(item.score) : "") + '</span></div>'
      + (item.reason ? '<p>' + escapeHtml(item.reason) + '</p>' : '')
      + (item.estimatedTokens !== undefined ? '<p>Tokens: ' + escapeHtml(item.estimatedTokens) + '</p>' : '')
      + '</div>';
  }

  function renderDeliveredList(ev) {
    var delivered = ev.delivered || [];
    var structured = ev.structured;
    var listed = ev.listed || [];
    var cards = delivered.map(function (item) {
      var degraded = item.requestedMode && item.requestedMode !== item.mode;
      return '<div class="planner-card">'
        + '<div class="planner-card-title"><span>' + escapeHtml(item.name) + '</span><span class="badge">' + escapeHtml(item.mode) + '</span></div>'
        + (degraded ? '<p>Requested ' + escapeHtml(item.requestedMode) + ', delivered ' + escapeHtml(item.mode) + (item.degradation ? " (" + escapeHtml(item.degradation) + ")" : "") + '</p>' : '')
        + (item.bytes !== undefined ? '<p>' + escapeHtml(item.bytes) + ' bytes</p>' : '')
        + (item.sections && item.sections.length ? '<p>Sections: ' + escapeHtml(item.sections.join(", ")) + '</p>' : '')
        + (item.warningCount ? '<p>' + escapeHtml(item.warningCount) + ' warning(s)</p>' : '')
        + '</div>';
    });
    if (structured) {
      cards.push('<div class="planner-card"><div class="planner-card-title"><span>' + escapeHtml(structured.kind) + '</span><span class="badge">structured x' + structured.ids.length + '</span></div><p>' + escapeHtml(structured.ids.join(", ")) + '</p></div>');
    }
    if (listed.length && !delivered.length) {
      cards.push('<div class="planner-card"><div class="planner-card-title"><span>Listed (metadata only)</span><span class="badge">' + listed.length + '</span></div><p>' + escapeHtml(listed.join(", ")) + '</p></div>');
    }
    if (!cards.length) {
      return '<p class="trace-meta">Nothing delivered.</p>';
    }
    return cards.join("");
  }

  function wireTraceSessionEvents(listEl, sessions) {
    listEl.querySelectorAll(".trace-query-summary").forEach(function (summaryEl) {
      var toggle = function () {
        var queryEl = summaryEl.parentElement;
        var key = queryEl.dataset.queryKey;
        state.tracesExpandedQuery = state.tracesExpandedQuery === key ? null : key;
        renderTraces();
        // renderTraces rebuilds the list's DOM, which would drop keyboard
        // focus to the document; restore it to this query's new summary.
        var queries = document.querySelectorAll("#traces-list .trace-query");
        for (var i = 0; i < queries.length; i++) {
          if (queries[i].dataset.queryKey === key) {
            var restored = queries[i].querySelector(".trace-query-summary");
            if (restored) restored.focus();
            break;
          }
        }
      };
      summaryEl.addEventListener("click", toggle);
      summaryEl.addEventListener("keydown", function (event) {
        if (event.repeat) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    });
    listEl.querySelectorAll(".trace-rating").forEach(function (ratingEl) {
      var sessionId = ratingEl.dataset.sessionId;
      ratingEl.querySelectorAll(".trace-rate-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          rateTraceSession(sessionId, btn.dataset.rate);
        });
      });
    });
  }

  async function rateTraceSession(sessionId, action) {
    var rating = null;
    var note;
    if (action === "well" || action === "poorly") {
      rating = action;
      note = window.prompt("Optional note about this session (max 500 chars)", "") || undefined;
      if (note && note.length > 500) {
        note = note.slice(0, 500);
      }
    }
    try {
      await apiPost("/api/ui/trace-rating", { sessionId: sessionId, rating: rating, note: note });
      state.traces = null;
      await loadTraces();
    } catch (error) {
      setBanner(error.message, "error");
    }
  }

  function renderDryQueries() {
    var data = state.dryQueries;
    if (!data) {
      return;
    }
    var enabled = !!data.enabled;
    var rows = data.dryQueries || [];
    el("traces-disabled").hidden = enabled;
    el("traces-dry-empty").hidden = !enabled || rows.length > 0;
    var tableEl = el("traces-dry-table");
    tableEl.hidden = !enabled || rows.length === 0;
    var bodyEl = el("traces-dry-rows");
    if (tableEl.hidden) {
      bodyEl.innerHTML = "";
      return;
    }
    bodyEl.innerHTML = rows.map(function (row) {
      var task = row.taskText || (row.taskSha256 ? "sha256 " + row.taskSha256.slice(0, 10) + "..." : "");
      var nearestMiss = row.nearestMiss ? row.nearestMiss.name + (row.nearestMiss.reason ? " (" + row.nearestMiss.reason + ")" : "") : "";
      return "<tr class=\\"trace-dry-row\\" data-session-id=\\"" + escapeHtml(row.sessionId) + "\\">"
        + "<td><button type=\\"button\\" class=\\"trace-dry-open link-button\\" aria-label=\\"Open session timeline for " + escapeHtml(row.tool) + " query in session " + escapeHtml(row.sessionId) + "\\">" + escapeHtml(formatTraceTime(row.timestamp)) + "</button></td>"
        + "<td><code>" + escapeHtml(row.tool) + "</code></td>"
        + "<td>" + escapeHtml(row.reason) + "</td>"
        + "<td>" + escapeHtml(task) + "</td>"
        + "<td>" + escapeHtml(row.project || "") + "</td>"
        + "<td><code>" + escapeHtml(row.sessionId) + "</code></td>"
        + "<td>" + escapeHtml(nearestMiss) + "</td>"
        + "</tr>";
    }).join("");
    // The row stays a plain table row for assistive technology; the real
    // interactive control is the button in the first cell. Row click is kept
    // as a mouse convenience only.
    bodyEl.querySelectorAll(".trace-dry-row").forEach(function (rowEl) {
      var open = function () {
        openDrySessionTimeline(rowEl.dataset.sessionId);
      };
      rowEl.addEventListener("click", open);
      var button = rowEl.querySelector(".trace-dry-open");
      if (button) {
        button.addEventListener("click", function (event) {
          event.stopPropagation();
          open();
        });
      }
    });
  }

  function mergeCoverageKnownProjects(records) {
    var seen = {};
    state.coverageKnownProjects.forEach(function (project) { seen[project] = true; });
    deriveCoverageProjects(records).forEach(function (project) { seen[project] = true; });
    state.coverageKnownProjects = Object.keys(seen).sort();
  }

  async function loadCoverage() {
    state.coverageLoading = true;
    var filters = currentCoverageFilters();
    try {
      var result = await api("/api/ui/graph-coverage?" + coverageQueryString(filters));
      state.coverage = result;
      state.coverageRecords = result.records || [];
      state.coverageNextCursor = result.nextCursor || null;
      mergeCoverageKnownProjects(state.coverageRecords);
      renderCoverage();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.coverageLoading = false;
    }
  }

  async function loadMoreCoverage() {
    if (!state.coverageNextCursor || state.coverageLoadMoreLoading) {
      return;
    }
    state.coverageLoadMoreLoading = true;
    var filters = currentCoverageFilters();
    try {
      var result = await api("/api/ui/graph-coverage?" + coverageQueryString(filters, state.coverageNextCursor));
      state.coverageRecords = appendCoverageRecords(state.coverageRecords, result.records || []);
      state.coverageNextCursor = result.nextCursor || null;
      mergeCoverageKnownProjects(result.records || []);
      renderCoverage();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.coverageLoadMoreLoading = false;
    }
  }

  function coverageReasonsHtml(reasons) {
    if (!reasons || reasons.length === 0) {
      return "<span>None</span>";
    }
    return reasons.map(function (reason) {
      var location = reason.line ? " (line " + escapeHtml(String(reason.line)) + ")" : "";
      return "<span class=\\"coverage-reason\\"><span class=\\"coverage-reason-code\\">" + escapeHtml(reason.code) + "</span>" + escapeHtml(reason.message) + escapeHtml(location) + "</span>";
    }).join("");
  }

  function coverageOperationsHtml(operations) {
    if (!operations || operations.length === 0) {
      return "<span>None</span>";
    }
    // Inert labels only -- there is no write tooling yet, so these are never
    // rendered as buttons that pretend to migrate anything.
    return operations.map(function (operation) {
      return "<span class=\\"coverage-operation\\"><span class=\\"coverage-operation-code\\">" + escapeHtml(operation.code) + "</span>" + escapeHtml(operation.message) + "</span>";
    }).join("");
  }

  function coverageRowHtml(record) {
    var anchorLink = "<a href=\\"" + escapeHtml(anchorHref(record.anchorName)) + "\\" data-anchor-name=\\"" + escapeHtml(record.anchorName) + "\\">" + escapeHtml(record.anchorName) + "</a>";
    var lineSuffix = record.kind === "claim" ? " (line " + escapeHtml(String(record.line)) + ")" : "";
    return "<tr>"
      + "<td>" + escapeHtml(coverageKindLabel(record.kind)) + "</td>"
      + "<td>" + anchorLink + lineSuffix + "</td>"
      + "<td><span class=\\"badge\\">" + escapeHtml(coverageStateLabel(record.state)) + "</span></td>"
      + "<td>" + coverageReasonsHtml(record.reasons) + "</td>"
      + "<td>" + coverageOperationsHtml(record.suggestedOperations) + "</td>"
      + "</tr>";
  }

  function coverageCardHtml(key, count, label, active, isTotal) {
    var classes = "coverage-card" + (active ? " active" : "") + (isTotal ? " coverage-card-total" : "");
    var tag = isTotal ? "div" : "button";
    var typeAttr = isTotal ? "" : " type=\\"button\\"";
    var pressedAttr = isTotal ? "" : " aria-pressed=\\"" + (active ? "true" : "false") + "\\"";
    var dataAttr = isTotal ? "" : " data-coverage-state=\\"" + escapeHtml(key) + "\\"";
    return "<" + tag + " class=\\"" + classes + "\\"" + typeAttr + pressedAttr + dataAttr + ">"
      + "<strong>" + escapeHtml(String(count)) + "</strong><span>" + escapeHtml(label) + "</span>"
      + "</" + tag + ">";
  }

  function renderCoverageCards() {
    var data = state.coverage;
    var container = el("coverage-cards");
    if (!data) {
      container.innerHTML = "";
      return;
    }
    var summary = data.summary || { totalAnchors: 0, totalClaims: 0, byState: {} };
    var activeStates = {};
    (state.coverageStates || []).forEach(function (value) { activeStates[value] = true; });
    var cards = [];
    cards.push(coverageCardHtml("total", summary.totalAnchors + summary.totalClaims, "Total anchors + claims", false, true));
    COVERAGE_STATE_ORDER.forEach(function (stateKey) {
      var count = (summary.byState && summary.byState[stateKey]) || 0;
      cards.push(coverageCardHtml(stateKey, count, coverageStateLabel(stateKey), !!activeStates[stateKey], false));
    });
    var duplicateCount = (data.duplicateAnchorIds || []).length;
    if (duplicateCount > 0) {
      cards.push(coverageCardHtml("duplicate", duplicateCount, "Duplicate anchor_id", false, true));
    }
    container.innerHTML = cards.join("");
    container.querySelectorAll("[data-coverage-state]").forEach(function (button) {
      button.addEventListener("click", function () {
        toggleCoverageStateFilter(button.dataset.coverageState);
      });
    });
  }

  function toggleCoverageStateFilter(stateKey) {
    var current = state.coverageStates || [];
    var idx = current.indexOf(stateKey);
    if (idx === -1) {
      state.coverageStates = current.concat([stateKey]);
    } else {
      state.coverageStates = current.slice(0, idx).concat(current.slice(idx + 1));
    }
    updateLocationFromState({ anchor: null, view: "coverage", history: "push" });
    state.coverage = null;
    state.coverageRecords = [];
    state.coverageNextCursor = null;
    loadCoverage();
  }

  function refreshCoverageProjectOptions() {
    var select = el("coverage-project-filter");
    var current = controlValue("coverage-project-filter", state.coverageProject);
    var projects = state.coverageKnownProjects || [];
    select.innerHTML = optionList(projects, "All projects");
    setSelectValueAllowingNew("coverage-project-filter", current);
  }

  function renderCoverage() {
    renderCoverageCards();
    refreshCoverageProjectOptions();
    var filters = currentCoverageFilters();
    var filtered = filterCoverageRecords(state.coverageRecords, filters);
    var tableEl = el("coverage-table");
    var emptyEl = el("coverage-empty");
    var bodyEl = el("coverage-rows");
    var countEl = el("coverage-count");
    var loadMoreEl = el("coverage-load-more");
    var summaryEl = el("coverage-summary");

    if (state.coverage && state.coverage.summary) {
      var summary = state.coverage.summary;
      summaryEl.textContent = summary.totalAnchors + " anchor" + (summary.totalAnchors === 1 ? "" : "s") + " · " + summary.totalClaims + " claim" + (summary.totalClaims === 1 ? "" : "s") + " across the tree.";
    }

    if (filtered.length === 0) {
      tableEl.hidden = true;
      emptyEl.hidden = false;
      bodyEl.innerHTML = "";
    } else {
      emptyEl.hidden = true;
      tableEl.hidden = false;
      bodyEl.innerHTML = filtered.map(coverageRowHtml).join("");
    }

    var totalMatching = state.coverage ? state.coverage.totalMatching : 0;
    countEl.textContent = "Showing " + filtered.length + " of " + (state.coverageRecords || []).length + " loaded record" + ((state.coverageRecords || []).length === 1 ? "" : "s") + " (" + totalMatching + " match the server-side filters" + (state.coverageNextCursor ? "; more available" : "") + ").";

    loadMoreEl.hidden = !state.coverageNextCursor;
    loadMoreEl.disabled = !!state.coverageLoadMoreLoading;
    loadMoreEl.textContent = state.coverageLoadMoreLoading ? "Loading..." : "Load more";
  }

  async function openDrySessionTimeline(sessionId) {
    state.tracesMode = "timeline";
    var loaded = function () {
      return state.traces && (state.traces.sessions || []).some(function (s) { return s.id === sessionId; });
    };
    if (!loaded()) {
      await loadTraces();
    }
    if (!loaded()) {
      // Dry queries are unlimited but the session list is recency-capped, so
      // an old session may not be in the newest page. Fetch it by id and
      // splice it in so the click-through always lands.
      try {
        var result = await api("/api/ui/traces?sessionId=" + encodeURIComponent(sessionId));
        if (result.sessions && result.sessions.length && state.traces) {
          state.traces.sessions = (state.traces.sessions || []).concat(result.sessions);
        }
      } catch (error) {
        setBanner(error.message, "error");
      }
    }
    renderTracesModeButtons();
    renderTraces();
    var sessionEls = document.querySelectorAll("#traces-list .trace-session");
    for (var i = 0; i < sessionEls.length; i++) {
      if (sessionEls[i].dataset.sessionId === sessionId) {
        sessionEls[i].scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }

  function renderTracesModeButtons() {
    el("traces-show-timeline").classList.toggle("active", state.tracesMode === "timeline");
    el("traces-show-dry").classList.toggle("active", state.tracesMode === "dry");
    el("traces-timeline-panel").hidden = state.tracesMode !== "timeline";
    el("traces-dry-panel").hidden = state.tracesMode !== "dry";
  }

  function showTracesMode(mode) {
    state.tracesMode = mode === "dry" ? "dry" : "timeline";
    renderTracesModeButtons();
    if (state.tracesMode === "dry" && !state.dryQueries && !state.dryQueriesLoading) {
      loadDryQueries();
    }
  }

  async function loadTasks() {
    state.tasksLoading = true;
    var project = controlValue("tasks-project-filter", state.tasksProject);
    var statusVal = controlValue("tasks-status-filter", state.tasksStatus);
    var noDue = controlChecked("tasks-no-due", state.tasksNoDue);
    var unassigned = controlChecked("tasks-unassigned", state.tasksUnassigned);
    var reportRanges = taskReportRanges(
      controlValue("tasks-completed-days", state.tasksCompletedDays),
      controlValue("tasks-due-days", state.tasksDueDays),
      todayIso()
    );
    var maxProjectPriority = finiteNumberValue(controlValue("tasks-project-priority-max", state.tasksProjectPriorityMax));
    var maxTaskPriority = finiteNumberValue(controlValue("tasks-task-priority-max", state.tasksTaskPriorityMax));
    var modifiedAfter = controlValue("tasks-modified-after", state.tasksModifiedAfter);
    var qs = [];
    if (project) qs.push("project=" + encodeURIComponent(project));
    if ((reportRanges.completedDays || reportRanges.dueDays) && statusVal === "active,todo,blocked") {
      statusVal = "active,todo,blocked,done";
    }
    if (statusVal) qs.push("status=" + encodeURIComponent(statusVal));
    if (reportRanges.completedAfter) qs.push("completedAfter=" + encodeURIComponent(reportRanges.completedAfter));
    if (reportRanges.completedBefore) qs.push("completedBefore=" + encodeURIComponent(reportRanges.completedBefore));
    if (reportRanges.dueAfter) qs.push("dueAfter=" + encodeURIComponent(reportRanges.dueAfter));
    if (reportRanges.dueBefore) qs.push("dueBefore=" + encodeURIComponent(reportRanges.dueBefore));
    if (maxProjectPriority !== "") qs.push("maxProjectPriority=" + encodeURIComponent(String(maxProjectPriority)));
    if (maxTaskPriority !== "") qs.push("maxTaskPriority=" + encodeURIComponent(String(maxTaskPriority)));
    if (modifiedAfter) qs.push("modifiedAfter=" + encodeURIComponent(modifiedAfter));
    if (noDue) qs.push("noDue=true");
    if (unassigned) qs.push("unassigned=true");
    var url = "/api/ui/tasks-due" + (qs.length ? "?" + qs.join("&") : "");
    try {
      var result = await api(url);
      state.tasks = result.tasks || [];
      refreshTypeaheadOptions();
      renderTasks();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.tasksLoading = false;
    }
  }

  async function saveNewTask() {
    var resultEl = el("new-task-result");
    var project = (el("new-task-project").value || "").trim();
    var title = (el("new-task-title").value || "").trim();
    if (!project) { resultEl.textContent = "Project is required."; return; }
    if (!title) { resultEl.textContent = "Title is required."; return; }
    var ownerInput = el("new-task-owner");
    var rawOwner = ownerInput.value || "";
    if (rawOwner.trim()) resultEl.textContent = "Resolving owner...";
    var owner = await resolveTaskOwnerAssignmentValue(rawOwner);
    if (ownerInput.value.trim() !== owner) ownerInput.value = owner;
    var due = (el("new-task-due").value || "").trim();
    var confidence = el("new-task-confidence").value;
    var status = el("new-task-status").value;
    var priorityRaw = (el("new-task-priority").value || "").trim();
    var priority = finiteNumberValue(priorityRaw);
    if (priorityRaw && priority === "") {
      resultEl.textContent = "Priority must be a finite number.";
      return;
    }
    var milestone = (el("new-task-milestone").value || "").trim();
    var notes = (el("new-task-notes").value || "").trim();
    var payload = { project: project, title: title, status: status, approved: true };
    if (owner) payload.owner = owner;
    if (priority !== "") payload.priority = priority;
    if (milestone) payload.milestone = milestone;
    if (notes) payload.notes = notes;
    if (due) {
      payload.due = due;
      payload.dateConfidence = confidence;
    }
    resultEl.textContent = "Saving...";
    var res = await apiPost("/api/ui/task-create", payload);
    if (res.warnings && res.warnings.some(function (w) { return w.severity === "BLOCK"; })) {
      resultEl.textContent = res.warnings.map(function (w) { return w.message; }).join("; ");
      return;
    }
    resultEl.textContent = "Created " + (res.taskId || "task") + ".";
    if (owner) rememberTaskOwnerName(owner);
    ["new-task-title", "new-task-owner", "new-task-priority", "new-task-due", "new-task-milestone", "new-task-notes"].forEach(function (id) { el(id).value = ""; });
    el("tasks-add-form").hidden = true;
    state.tasks = [];
    loadTasks();
  }

  function renderTasks() {
    var list = el("tasks-list");
    var emptyEl = el("tasks-empty");
    var summary = el("tasks-summary");
    var groupBy = validTasksGroupBy(controlValue("tasks-group-by", state.tasksGroupBy));
    var sortMode = validTasksSort(controlValue("tasks-sort", state.tasksSort));

    if (!state.tasks || state.tasks.length === 0) {
      list.hidden = true;
      emptyEl.hidden = false;
      summary.textContent = "No tasks match the current filters.";
      return;
    }

    emptyEl.hidden = true;
    list.hidden = false;

    var today = todayIso();
    var reportRanges = taskReportRanges(
      controlValue("tasks-completed-days", state.tasksCompletedDays),
      controlValue("tasks-due-days", state.tasksDueDays),
      today
    );
    var dueSoonDays = reportRanges.dueDays || 14;
    var soon = addIsoDays(today, dueSoonDays);
    var groups = taskGroupsForDisplay(state.tasks, groupBy, sortMode, today, soon, "Due within " + dueSoonDays + " days");
    var overdue = state.tasks.filter(function (task) { return task.due && task.due < today; });
    var noDue = state.tasks.filter(function (task) { return !task.due; });
    var completed = state.tasks.filter(function (task) { return task.taskStatus === "done"; });
    var blocked = state.tasks.filter(function (task) { return task.taskStatus === "blocked"; });
    var maxProjectPriority = finiteNumberValue(controlValue("tasks-project-priority-max", state.tasksProjectPriorityMax));
    var maxTaskPriority = finiteNumberValue(controlValue("tasks-task-priority-max", state.tasksTaskPriorityMax));
    var modifiedAfter = controlValue("tasks-modified-after", state.tasksModifiedAfter);

    var html = "";

    function renderGroup(group) {
      var label = group.label;
      var tasks = group.tasks;
      var cls = group.cls || "";
      if (tasks.length === 0) return "";
      var priority = Number.isFinite(group.projectPriority) ? priorityLabel(group.projectPriority) : "";
      var heading = priority ? priority + " · " + label : label;
      var groupKey = taskGroupKey(groupBy, group);
      var canCollapse = groupBy === "project";
      var collapsed = canCollapse && state.collapsedTaskGroups.has(groupKey);
      var toggle = canCollapse
        ? "<button type=\\"button\\" class=\\"task-group-toggle\\" data-task-group-key=\\"" + escapeHtml(groupKey) + "\\" aria-expanded=\\"" + (!collapsed ? "true" : "false") + "\\" title=\\"" + escapeHtml(collapsed ? "Expand project tasks" : "Collapse project tasks") + "\\"><span class=\\"task-group-triangle\\" aria-hidden=\\"true\\"></span></button>"
        : "";
      var out = "<div class=\\"task-group-header " + (cls || "") + "\\">" + toggle + "<span class=\\"task-group-heading\\">" + escapeHtml(heading) + " (" + tasks.length + ")</span></div>";
      if (collapsed) {
        return out;
      }
      tasks.forEach(function (task) {
        out += renderTaskRow(task, today);
      });
      return out;
    }

    groups.forEach(function (group) {
      html += renderGroup(group);
    });

    list.innerHTML = html;

    list.querySelectorAll(".task-group-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var groupKey = btn.dataset.taskGroupKey;
        if (!groupKey) return;
        if (state.collapsedTaskGroups.has(groupKey)) {
          state.collapsedTaskGroups.delete(groupKey);
        } else {
          state.collapsedTaskGroups.add(groupKey);
        }
        renderTasks();
      });
    });

    var total = state.tasks.length;
    var reportBits = [];
    if (reportRanges.completedDays) reportBits.push("completed last " + reportRanges.completedDays + " days");
    if (reportRanges.dueDays) reportBits.push("due next " + reportRanges.dueDays + " days");
    if (maxProjectPriority !== "") reportBits.push("project P <= " + maxProjectPriority);
    if (maxTaskPriority !== "") reportBits.push("task P <= " + maxTaskPriority);
    if (modifiedAfter) reportBits.push("modified since " + modifiedAfter);
    summary.textContent = total + " task" + (total === 1 ? "" : "s")
      + " · " + overdue.length + " overdue"
      + " · " + blocked.length + " blocked"
      + " · " + completed.length + " completed"
      + " · " + noDue.length + " without due date"
      + " · grouped by " + (groupBy === "project" ? "project" : "due date")
      + " · sorted by " + tasksSortLabel(sortMode)
      + (reportBits.length ? " · " + reportBits.join(" · ") : "");

    list.querySelectorAll(".task-milestone-link").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (!shouldHandleClientNavigation(event, link)) {
          return;
        }
        event.preventDefault();
        selectAnchor(link.dataset.anchor, { focusTask: link.dataset.taskId });
      });
    });

    wireGotoChips(list);

    list.querySelectorAll(".task-complete-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".task-actions");
        runTaskLifecycle("/api/ui/task-complete", row, "Completing...");
      });
    });
    list.querySelectorAll(".task-reopen-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".task-actions");
        runTaskLifecycle("/api/ui/task-reopen", row, "Reopening...");
      });
    });
    list.querySelectorAll(".task-delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest(".task-actions");
        if (!window.confirm("Delete task " + row.dataset.taskId + "?")) return;
        runTaskLifecycle("/api/ui/task-delete", row, "Deleting...");
      });
    });

    list.querySelectorAll(".task-owner-form").forEach(function (form) {
      wireTaskOwnerSearch(form);
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var taskId = form.dataset.taskId;
        var milestoneName = form.dataset.milestoneName;
        var ownerInput = form.querySelector(".task-owner-input");
        var resultEl = form.querySelector(".task-owner-result");
        var rawOwner = ownerInput ? ownerInput.value : "";
        if (rawOwner.trim()) resultEl.textContent = "Resolving owner...";
        var owner = await resolveTaskOwnerAssignmentValue(rawOwner);
        if (ownerInput && ownerInput.value.trim() !== owner) ownerInput.value = owner;
        resultEl.textContent = owner ? "Assigning..." : "Clearing...";
        try {
          var res = await apiPost("/api/ui/task-owner", {
            name: milestoneName,
            taskId: taskId,
            owner: owner || null,
            approved: true
          });
          if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
            resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
          } else {
            resultEl.textContent = owner ? "Assigned." : "Cleared.";
            if (owner) rememberTaskOwnerName(owner);
            state.tasks = [];
            loadTasks();
          }
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
      var clearOwnerBtn = form.querySelector(".task-owner-clear");
      if (clearOwnerBtn) {
        clearOwnerBtn.addEventListener("click", async function () {
          var taskId = form.dataset.taskId;
          var milestoneName = form.dataset.milestoneName;
          var ownerInput = form.querySelector(".task-owner-input");
          var resultEl = form.querySelector(".task-owner-result");
          if (ownerInput) ownerInput.value = "";
          resultEl.textContent = "Clearing...";
          try {
            var res = await apiPost("/api/ui/task-owner", { name: milestoneName, taskId: taskId, owner: null, approved: true });
            if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
              resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
            } else {
              resultEl.textContent = "Cleared.";
              state.tasks = [];
              loadTasks();
            }
          } catch (err) {
            resultEl.textContent = err.message;
          }
        });
      }
    });

    list.querySelectorAll(".task-priority-form").forEach(function (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var taskId = form.dataset.taskId;
        var milestoneName = form.dataset.milestoneName;
        var priorityInput = form.querySelector(".task-priority-input");
        var resultEl = form.querySelector(".task-priority-result");
        var rawPriority = priorityInput ? priorityInput.value.trim() : "";
        var priority = finiteNumberValue(rawPriority);
        if (rawPriority && priority === "") {
          resultEl.textContent = "Enter a finite priority.";
          return;
        }
        resultEl.textContent = rawPriority ? "Saving..." : "Clearing...";
        try {
          var res = await apiPost("/api/ui/task-priority", {
            name: milestoneName,
            taskId: taskId,
            priority: rawPriority ? priority : null,
            approved: true
          });
          if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
            resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
          } else {
            resultEl.textContent = rawPriority ? "Updated." : "Cleared.";
            state.tasks = [];
            loadTasks();
          }
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
      var clearPriorityBtn = form.querySelector(".task-priority-clear");
      if (clearPriorityBtn) {
        clearPriorityBtn.addEventListener("click", async function () {
          var taskId = form.dataset.taskId;
          var milestoneName = form.dataset.milestoneName;
          var priorityInput = form.querySelector(".task-priority-input");
          var resultEl = form.querySelector(".task-priority-result");
          if (priorityInput) priorityInput.value = "";
          resultEl.textContent = "Clearing...";
          try {
            var res = await apiPost("/api/ui/task-priority", { name: milestoneName, taskId: taskId, priority: null, approved: true });
            if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
              resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
            } else {
              resultEl.textContent = "Cleared.";
              state.tasks = [];
              loadTasks();
            }
          } catch (err) {
            resultEl.textContent = err.message;
          }
        });
      }
    });

    list.querySelectorAll(".task-notes-form").forEach(function (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var taskId = form.dataset.taskId;
        var milestoneName = form.dataset.milestoneName;
        var notesInput = form.querySelector(".task-notes-input");
        var resultEl = form.querySelector(".task-notes-result");
        var notes = notesInput ? notesInput.value.trim() : "";
        if (notes.length > 480) {
          resultEl.textContent = "Notes must be 480 characters or fewer.";
          return;
        }
        resultEl.textContent = notes ? "Saving..." : "Clearing...";
        try {
          var res = await apiPost("/api/ui/task-notes", {
            name: milestoneName,
            taskId: taskId,
            notes: notes || null,
            approved: true
          });
          if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
            resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
          } else {
            resultEl.textContent = notes ? "Updated." : "Cleared.";
            state.tasks = [];
            loadTasks();
          }
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
      var clearNotesBtn = form.querySelector(".task-notes-clear");
      if (clearNotesBtn) {
        clearNotesBtn.addEventListener("click", async function () {
          var taskId = form.dataset.taskId;
          var milestoneName = form.dataset.milestoneName;
          var notesInput = form.querySelector(".task-notes-input");
          var resultEl = form.querySelector(".task-notes-result");
          if (notesInput) notesInput.value = "";
          resultEl.textContent = "Clearing...";
          try {
            var res = await apiPost("/api/ui/task-notes", { name: milestoneName, taskId: taskId, notes: null, approved: true });
            if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
              resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
            } else {
              resultEl.textContent = "Cleared.";
              state.tasks = [];
              loadTasks();
            }
          } catch (err) {
            resultEl.textContent = err.message;
          }
        });
      }
    });

    list.querySelectorAll(".task-due-form").forEach(function (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var taskId = form.dataset.taskId;
        var milestoneName = form.dataset.milestoneName;
        var dateInput = form.querySelector(".task-due-date");
        var confidenceInput = form.querySelector(".task-due-confidence");
        var resultEl = form.querySelector(".task-due-result");
        var due = dateInput ? dateInput.value.trim() : "";
        var confidence = confidenceInput ? confidenceInput.value : "";
        if (due && !confidence) {
          resultEl.textContent = "Select a date confidence.";
          return;
        }
        resultEl.textContent = "Saving...";
        try {
          var payload = {
            name: milestoneName,
            taskId: taskId,
            due: due || null,
            approved: true
          };
          if (due && confidence) {
            payload.dateConfidence = confidence;
          }
          var res = await apiPost("/api/ui/task-due", payload);
          if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
            resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
          } else {
            resultEl.textContent = due ? "Updated." : "Cleared.";
            state.tasks = [];
            loadTasks();
          }
        } catch (err) {
          resultEl.textContent = err.message;
        }
      });
      var clearBtn = form.querySelector(".task-due-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", async function () {
          var taskId = form.dataset.taskId;
          var milestoneName = form.dataset.milestoneName;
          var resultEl = form.querySelector(".task-due-result");
          resultEl.textContent = "Clearing...";
          try {
            var res = await apiPost("/api/ui/task-due", { name: milestoneName, taskId: taskId, due: null, approved: true });
            if (res.warnings && res.warnings.some(function(w) { return w.severity === "BLOCK"; })) {
              resultEl.textContent = res.warnings.map(function(w) { return w.message; }).join("; ");
            } else {
              resultEl.textContent = "Cleared.";
              state.tasks = [];
              loadTasks();
            }
          } catch (err) {
            resultEl.textContent = err.message;
          }
        });
      }
    });

    applyPendingTaskFocus();
  }

  // Scroll to and highlight the task row matching state.pendingTaskFocus when
  // arriving from a detail-view "Edit in tasks" link. Clears any prior focus so
  // only one row is highlighted; no-op if the task is filtered out of the view.
  function applyPendingTaskFocus() {
    if (!state.pendingTaskFocus) {
      return;
    }
    var targetId = state.pendingTaskFocus;
    state.pendingTaskFocus = null;
    var list = safeEl("tasks-list");
    if (!list || list.hidden) {
      return;
    }
    var rows = list.querySelectorAll(".task-row");
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove("focus");
    }
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].dataset.taskId === targetId) {
        rows[j].classList.add("focus");
        if (rows[j].scrollIntoView) {
          rows[j].scrollIntoView({ block: "center" });
        }
        break;
      }
    }
  }

  function taskGroupsForDisplay(tasks, groupBy, sortMode, today, soon, soonLabel) {
    var sorted = sortTasksForDisplay(tasks, sortMode);
    if (groupBy === "project") {
      return projectTaskGroups(sorted, sortMode);
    }
    return dueTaskGroups(sorted, today, soon, sortMode, soonLabel);
  }

  function taskGroupKey(groupBy, group) {
    if (group && group.key) {
      return String(group.key);
    }
    return String(groupBy || "group") + ":" + String((group && group.label) || "");
  }

  function sortTasksForDisplay(tasks, sortMode) {
    var mode = validTasksSort(sortMode);
    return (tasks || []).slice().sort(function (left, right) {
      var primary = 0;
      if (mode === "projectPriority") {
        primary = comparePriority(taskProjectPriority(left), taskProjectPriority(right));
      } else if (mode === "taskPriority") {
        primary = comparePriority(taskPriority(left), taskPriority(right));
      } else if (mode === "projectName") {
        primary = compareTaskProjects(left, right);
      } else if (mode === "modifiedDesc") {
        primary = compareTimestamps(taskModifiedTimestamp(right), taskModifiedTimestamp(left));
      } else {
        primary = compareTaskDue(left, right, mode);
      }
      return primary
        || compareTaskDue(left, right, "dueAsc")
        || compareTaskProjects(left, right)
        || taskStableLabel(left).localeCompare(taskStableLabel(right));
    });
  }

  function compareTaskDue(left, right, sortMode) {
    var leftDue = left && left.due ? String(left.due) : "";
    var rightDue = right && right.due ? String(right.due) : "";
    if (leftDue && rightDue) {
      return sortMode === "dueDesc" ? rightDue.localeCompare(leftDue) : leftDue.localeCompare(rightDue);
    }
    if (leftDue) {
      return -1;
    }
    if (rightDue) {
      return 1;
    }
    return 0;
  }

  function taskStableLabel(task) {
    return [
      task && task.project ? task.project : "",
      task && task.milestoneName ? task.milestoneName : "",
      task && task.taskId ? task.taskId : "",
      task && task.taskTitle ? task.taskTitle : ""
    ].join("\\u0000");
  }

  function compareTaskProjects(left, right) {
    return taskProjectLabel(left).localeCompare(taskProjectLabel(right));
  }

  function taskProjectLabel(task) {
    return String((task && task.project) || "No project");
  }

  function dueTaskGroups(sortedTasks, today, soon, sortMode, soonLabel) {
    var overdue = [];
    var dueSoon = [];
    var upcoming = [];
    var noDue = [];
    var dueSoonLabel = soonLabel || "Due within 14 days";

    sortedTasks.forEach(function (task) {
      if (!task.due) {
        noDue.push(task);
      } else if (task.due < today) {
        overdue.push(task);
      } else if (task.due <= soon) {
        dueSoon.push(task);
      } else {
        upcoming.push(task);
      }
    });

    var groups = sortMode === "dueDesc"
      ? [
        { label: "Upcoming", tasks: upcoming },
        { label: dueSoonLabel, tasks: dueSoon, cls: "due-soon" },
        { label: "Overdue", tasks: overdue, cls: "overdue" },
        { label: "No due date", tasks: noDue }
      ]
      : [
        { label: "Overdue", tasks: overdue, cls: "overdue" },
        { label: dueSoonLabel, tasks: dueSoon, cls: "due-soon" },
        { label: "Upcoming", tasks: upcoming },
        { label: "No due date", tasks: noDue }
      ];
    return groups.filter(function (group) { return group.tasks.length > 0; });
  }

  function projectTaskGroups(sortedTasks, sortMode) {
    var byProject = new Map();
    sortedTasks.forEach(function (task) {
      var project = taskProjectLabel(task);
      if (!byProject.has(project)) {
        byProject.set(project, []);
      }
      byProject.get(project).push(task);
    });
    return Array.from(byProject.entries()).sort(function (left, right) {
      return compareProjectTaskGroups(left, right, sortMode);
    }).map(function (entry) {
      return { key: "project:" + entry[0], label: entry[0], tasks: entry[1], projectPriority: taskGroupPriority(entry[1]) };
    });
  }

  function compareProjectTaskGroups(left, right, sortMode) {
    if (left[0] === "No project") return 1;
    if (right[0] === "No project") return -1;
    var mode = validTasksSort(sortMode);
    if (mode === "projectPriority") {
      return comparePriority(taskGroupPriority(left[1]), taskGroupPriority(right[1])) || left[0].localeCompare(right[0]);
    }
    if (mode === "taskPriority") {
      return comparePriority(taskGroupTaskPriority(left[1]), taskGroupTaskPriority(right[1])) || left[0].localeCompare(right[0]);
    }
    if (mode === "modifiedDesc") {
      return compareTimestamps(taskGroupModifiedTimestamp(right[1]), taskGroupModifiedTimestamp(left[1])) || left[0].localeCompare(right[0]);
    }
    return left[0].localeCompare(right[0]);
  }

  function taskGroupPriority(tasks) {
    var priorities = tasks.map(function (task) {
      return taskProjectPriority(task);
    }).filter(function (priority) {
      return Number.isFinite(priority);
    });
    return priorities.length ? Math.min.apply(null, priorities) : NaN;
  }

  function taskGroupTaskPriority(tasks) {
    var priorities = tasks.map(function (task) {
      return taskPriority(task);
    }).filter(function (priority) {
      return Number.isFinite(priority);
    });
    return priorities.length ? Math.min.apply(null, priorities) : NaN;
  }

  function taskGroupModifiedTimestamp(tasks) {
    var times = tasks.map(taskModifiedTimestamp).filter(function (time) {
      return Number.isFinite(time);
    });
    return times.length ? Math.max.apply(null, times) : NaN;
  }

  function taskProjectPriority(task) {
    var priority = task && task.projectPriority;
    return typeof priority === "number" && Number.isFinite(priority) ? priority : NaN;
  }

  function taskPriority(task) {
    var priority = task && (task.taskPriority !== undefined ? task.taskPriority : task.priority);
    return typeof priority === "number" && Number.isFinite(priority) ? priority : NaN;
  }

  function taskModifiedTimestamp(task) {
    var raw = task && (task.milestoneUpdatedAt || task.updatedAt || task.lastModifiedAt || task.modifiedAt);
    var time = Date.parse(raw);
    return Number.isNaN(time) ? NaN : time;
  }

  function taskModifiedDate(task) {
    var raw = task && (task.milestoneUpdatedAt || task.updatedAt || task.lastModifiedAt || task.modifiedAt);
    return raw ? String(raw).slice(0, 10) : "";
  }

  function tasksSortLabel(sortMode) {
    var mode = validTasksSort(sortMode);
    if (mode === "projectPriority") return "project priority";
    if (mode === "taskPriority") return "task priority";
    if (mode === "projectName") return "project name";
    if (mode === "modifiedDesc") return "last modified";
    return mode === "dueDesc" ? "due date descending" : "due date ascending";
  }

  function wireTaskOwnerSearch(form) {
    wireTaskOwnerInput(form.querySelector(".task-owner-input"));
  }

  function wireTaskOwnerInput(input) {
    if (!input) return;
    input.addEventListener("focus", function () {
      renderTaskOwnerSuggestions(input.value || "", []);
    });
    input.addEventListener("input", function () {
      queueTaskOwnerSearch(input);
    });
  }

  function queueTaskOwnerSearch(input) {
    if (state.taskOwnerSearchTimer) {
      clearTimeout(state.taskOwnerSearchTimer);
    }
    state.taskOwnerSearchTimer = setTimeout(function () {
      searchTaskOwners(input);
    }, 120);
  }

  async function searchTaskOwners(input) {
    var query = (input && input.value ? input.value : "").trim();
    renderTaskOwnerSuggestions(query, []);
    if (!query || !document.body.contains(input)) {
      return;
    }
    var seq = ++state.taskOwnerSearchSeq;
    try {
      var result = await api("/api/ui/people-search?q=" + encodeURIComponent(query) + "&limit=10");
      if (seq !== state.taskOwnerSearchSeq || !document.body.contains(input)) {
        return;
      }
      var matches = normalizeTaskOwnerMatches(result.people || []);
      rememberTaskOwnerMatches(matches);
      renderTaskOwnerSuggestions(query, matches);
    } catch (_error) {
      renderTaskOwnerSuggestions(query, []);
    }
  }

  function normalizeTaskOwnerMatches(items) {
    return (items || []).map(function (item) {
      return {
        id: String(item.id || ""),
        displayName: String(item.displayName || item.value || item.id || ""),
        aliases: Array.isArray(item.aliases) ? item.aliases.filter(Boolean).map(String) : [],
        matched: String(item.matched || item.displayName || item.value || item.id || ""),
        value: String(item.value || item.displayName || item.id || "")
      };
    }).filter(function (item) {
      return item.displayName || item.value;
    });
  }

  function rememberTaskOwnerName(name) {
    var trimmed = String(name || "").trim();
    if (!trimmed) return;
    rememberTaskOwnerMatches([{ id: trimmed, displayName: trimmed, aliases: [], matched: trimmed, value: trimmed }]);
  }

  function rememberTaskOwnerMatches(matches) {
    normalizeTaskOwnerMatches(matches).slice().reverse().forEach(function (match) {
      var key = taskOwnerMatchKey(match);
      state.taskOwnerMatchCache = state.taskOwnerMatchCache.filter(function (cached) {
        return taskOwnerMatchKey(cached) !== key;
      });
      state.taskOwnerMatchCache.unshift(match);
    });
    state.taskOwnerMatchCache = state.taskOwnerMatchCache.slice(0, 10);
  }

  function taskOwnerCachedMatches(query) {
    var needle = String(query || "").toLowerCase().trim();
    return state.taskOwnerMatchCache.filter(function (match) {
      if (!needle) return true;
      return taskOwnerSearchText(match).indexOf(needle) >= 0;
    });
  }

  function taskOwnerAssignmentValue(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return "";
    var needle = trimmed.toLowerCase();
    var match = state.taskOwnerMatchCache.find(function (cached) {
      return taskOwnerExactValues(cached).some(function (candidate) {
        return candidate.toLowerCase() === needle;
      });
    });
    return match ? (match.value || match.displayName || match.id || trimmed) : trimmed;
  }

  async function resolveTaskOwnerAssignmentValue(value) {
    var resolved = taskOwnerAssignmentValue(value);
    var trimmed = String(value || "").trim();
    if (!trimmed || resolved !== trimmed) {
      return resolved;
    }
    try {
      var result = await api("/api/ui/people-search?q=" + encodeURIComponent(trimmed) + "&limit=10");
      rememberTaskOwnerMatches(result.people || []);
      return taskOwnerAssignmentValue(trimmed);
    } catch (_error) {
      return trimmed;
    }
  }

  function taskOwnerExactValues(match) {
    return [
      match && match.id,
      match && match.displayName,
      match && match.value,
      match && match.matched
    ].concat(match && Array.isArray(match.aliases) ? match.aliases : []).filter(Boolean).map(String);
  }

  function renderTaskOwnerSuggestions(query, matches) {
    var datalist = safeEl("task-owner-suggestions");
    if (!datalist) return;
    var seen = new Set();
    var options = taskOwnerCachedMatches(query).concat(normalizeTaskOwnerMatches(matches)).filter(function (match) {
      var key = taskOwnerMatchKey(match);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
    datalist.innerHTML = options.map(function (match) {
      var value = match.value || match.displayName || match.id;
      var labelParts = [match.id];
      if (match.matched && match.matched !== match.displayName && match.matched !== match.id) {
        labelParts.push("matched " + match.matched);
      }
      return "<option value=\\"" + escapeHtml(value) + "\\" label=\\"" + escapeHtml(labelParts.filter(Boolean).join(" · ")) + "\\"></option>";
    }).join("");
  }

  function taskOwnerMatchKey(match) {
    return String((match && (match.value || match.displayName || match.id)) || "").toLowerCase().trim();
  }

  function taskOwnerSearchText(match) {
    return [
      match && match.id,
      match && match.displayName,
      match && match.matched,
      match && Array.isArray(match.aliases) ? match.aliases.join(" ") : ""
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function normalizedTaskStatus(task) {
    return String((task && (task.taskStatus || task.status)) || "");
  }

  function taskStateClass(task, today) {
    var status = normalizedTaskStatus(task);
    var due = task && task.due ? String(task.due) : "";
    var base = today || todayIso();
    if (status === "done") {
      return "task-state-completed";
    }
    if (due && due < base && status !== "cancelled") {
      return "task-state-overdue";
    }
    if (status === "blocked") {
      return "task-state-blocked";
    }
    return "";
  }

  function taskStatusBadgeClass(task, today) {
    var stateClass = taskStateClass(task, today);
    if (stateClass === "task-state-completed") return " task-status-completed";
    if (stateClass === "task-state-overdue") return " task-status-overdue";
    if (stateClass === "task-state-blocked") return " task-status-blocked";
    return "";
  }

  function renderTaskRow(task, today) {
    var stateClass = taskStateClass(task, today);
    var statusBadge = "<span class=\\"badge" + taskStatusBadgeClass(task, today) + "\\">" + escapeHtml(task.taskStatus) + "</span>";
    var ownerBadge = renderTaskOwner(task);
    var projectBadge = task.project ? "<span class=\\"badge\\">" + escapeHtml(task.project) + "</span>" : "";
    var projectPriority = priorityLabel(taskProjectPriority(task));
    var projectPriorityBadge = "<span class=\\"badge project-priority-badge" + (projectPriority ? "" : " missing") + "\\" title=\\"Project priority\\">" + escapeHtml(projectPriority ? "Project " + projectPriority : "No project priority") + "</span>";
    var taskPriorityValue = priorityLabel(taskPriority(task));
    var taskPriorityBadge = "<span class=\\"badge task-priority-badge" + (taskPriorityValue ? "" : " missing") + "\\" title=\\"Task priority\\">" + escapeHtml(taskPriorityValue ? "Task " + taskPriorityValue : "No task priority") + "</span>";
    var milestoneLabel = task.milestoneDisplayId || task.milestoneName.split("/").pop().replace(/\\.md$/, "");
    var milestoneBtn = "<a class=\\"task-milestone-link\\" href=\\"" + escapeHtml(anchorHref(task.milestoneName)) + "\\" data-anchor=\\"" + escapeHtml(task.milestoneName) + "\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\" title=\\"Open milestone anchor\\">" + escapeHtml(milestoneLabel) + "</a>";
    var currentDue = task.due || "";
    var currentConf = task.dateConfidence || "estimated";
    var currentOwner = task.taskOwner || "";
    var currentPriority = Number.isFinite(taskPriority(task)) ? String(taskPriority(task)) : "";
    var currentNotes = task.notes || "";
    var modifiedDate = taskModifiedDate(task);
    var confSelected = ["committed", "internal_goal", "estimated"].map(function(c) {
      return "<option value=\\"" + c + "\\"" + (c === currentConf ? " selected" : "") + ">" + c + "</option>";
    }).join("");
    var ownerForm = "<form class=\\"task-owner-form\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\" data-milestone-name=\\"" + escapeHtml(task.milestoneName) + "\\">"
      + "<label class=\\"task-edit-label\\">Owner<input class=\\"task-owner-input\\" type=\\"text\\" value=\\"" + escapeHtml(currentOwner) + "\\" placeholder=\\"person or team\\" aria-label=\\"Task owner\\" list=\\"task-owner-suggestions\\" autocomplete=\\"off\\"></label>"
      + "<div class=\\"task-owner-controls\\">"
      + "<button type=\\"submit\\" class=\\"compact-action\\">Assign</button>"
      + (currentOwner ? "<button type=\\"button\\" class=\\"compact-action task-owner-clear\\">Clear</button>" : "")
      + "</div>"
      + "<div class=\\"task-owner-result\\"></div>"
      + "</form>";
    var priorityForm = "<form class=\\"task-priority-form\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\" data-milestone-name=\\"" + escapeHtml(task.milestoneName) + "\\">"
      + "<label class=\\"task-edit-label\\">Priority<input class=\\"task-priority-input\\" type=\\"number\\" min=\\"0\\" step=\\"0.001\\" value=\\"" + escapeHtml(currentPriority) + "\\" placeholder=\\"priority\\" aria-label=\\"Task priority\\"></label>"
      + "<div class=\\"task-priority-controls\\">"
      + "<button type=\\"submit\\" class=\\"compact-action\\">Set</button>"
      + (currentPriority ? "<button type=\\"button\\" class=\\"compact-action task-priority-clear\\">Clear</button>" : "")
      + "</div>"
      + "<div class=\\"task-priority-result\\"></div>"
      + "</form>";
    var notesForm = "<form class=\\"task-notes-form\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\" data-milestone-name=\\"" + escapeHtml(task.milestoneName) + "\\">"
      + "<label class=\\"task-edit-label\\">Note<textarea class=\\"task-notes-input\\" maxlength=\\"480\\" rows=\\"3\\" placeholder=\\"note\\" aria-label=\\"Task notes\\">" + escapeHtml(currentNotes) + "</textarea></label>"
      + "<div class=\\"task-notes-controls\\">"
      + "<button type=\\"submit\\" class=\\"compact-action\\">Save note</button>"
      + (currentNotes ? "<button type=\\"button\\" class=\\"compact-action task-notes-clear\\">Clear</button>" : "")
      + "</div>"
      + "<div class=\\"task-notes-result\\"></div>"
      + "</form>";
    var form = "<form class=\\"task-due-form\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\" data-milestone-name=\\"" + escapeHtml(task.milestoneName) + "\\">"
      + "<label class=\\"task-edit-label\\">Due<input class=\\"task-due-date\\" type=\\"date\\" value=\\"" + escapeHtml(currentDue) + "\\" aria-label=\\"Due date\\"></label>"
      + "<label class=\\"task-edit-label\\">Confidence<select class=\\"task-due-confidence\\" aria-label=\\"Date confidence\\">" + confSelected + "</select></label>"
      + "<div class=\\"task-due-controls\\">"
      + "<button type=\\"submit\\" class=\\"compact-action\\">Set</button>"
      + (currentDue ? "<button type=\\"button\\" class=\\"compact-action task-due-clear\\">Clear</button>" : "")
      + "</div>"
      + "<div class=\\"task-due-result\\"></div>"
      + "</form>";
    var lifecycle = "<div class=\\"task-actions\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\" data-milestone-name=\\"" + escapeHtml(task.milestoneName) + "\\">"
      + (task.taskStatus !== "done" && task.taskStatus !== "cancelled"
        ? "<button type=\\"button\\" class=\\"compact-action task-complete-btn\\">Complete</button>" : "")
      + (task.taskStatus === "done" ? "<button type=\\"button\\" class=\\"compact-action task-reopen-btn\\">Reopen</button>" : "")
      + "<button type=\\"button\\" class=\\"compact-action task-delete-btn\\">Delete</button>"
      + "<span class=\\"task-action-result\\"></span>"
      + "</div>";
    var editDetails = "<details class=\\"task-edit-details\\">"
      + "<summary class=\\"task-edit-summary\\">Edit task</summary>"
      + "<div class=\\"task-edit-forms\\">" + ownerForm + priorityForm + form + notesForm + "</div>"
      + "</details>";
    return "<div class=\\"task-row" + (stateClass ? " " + stateClass : "") + "\\" data-task-id=\\"" + escapeHtml(task.taskId) + "\\">"
      + "<div>"
      + "<div class=\\"task-title-line\\">" + projectPriorityBadge + taskPriorityBadge + "<span>" + escapeHtml(task.taskId) + " — " + escapeHtml(task.taskTitle) + "</span></div>"
      + (currentNotes ? "<div class=\\"task-notes-preview\\">" + escapeHtml(currentNotes) + "</div>" : "")
      + "<div class=\\"task-meta\\">" + statusBadge + ownerBadge + projectBadge + milestoneBtn
      + (task.due ? "<span class=\\"badge\\">due " + escapeHtml(task.due) + "</span>" : "")
      + (task.completedOn ? "<span class=\\"badge\\">completed " + escapeHtml(task.completedOn) + "</span>" : "")
      + (modifiedDate ? "<span class=\\"badge\\">modified " + escapeHtml(modifiedDate) + "</span>" : "")
      + "</div>"
      + lifecycle
      + editDetails
      + "</div>"
      + "</div>";
  }

  // Render a task's owner. Resolved people/teams are clickable cross-links to
  // their registry entry; an unresolved string shows as-is; no owner shows
  // a distinct "Unassigned" badge.
  function renderTaskOwner(task) {
    if (task.resolvedPerson) {
      return linkChip("person", task.resolvedPerson.id, "👤 " + task.resolvedPerson.displayName);
    }
    if (task.resolvedTeam) {
      return linkChip("team", task.resolvedTeam.id, "👥 " + task.resolvedTeam.displayName);
    }
    if (task.taskOwner) {
      return "<span class=\\"badge\\">" + escapeHtml(task.taskOwner) + "</span>";
    }
    return "<span class=\\"badge task-unassigned\\">Unassigned</span>";
  }

  async function runTaskLifecycle(path, row, pendingLabel) {
    if (!row) return;
    var resultEl = row.querySelector(".task-action-result");
    if (resultEl) resultEl.textContent = pendingLabel;
    try {
      var res = await apiPost(path, {
        taskId: row.dataset.taskId,
        name: row.dataset.milestoneName,
        approved: true
      });
      if (res.warnings && res.warnings.some(function (w) { return w.severity === "BLOCK"; })) {
        if (resultEl) resultEl.textContent = res.warnings.map(function (w) { return w.message; }).join("; ");
        return;
      }
      state.tasks = [];
      loadTasks();
    } catch (err) {
      if (resultEl) resultEl.textContent = err.message;
    }
  }

  // KEEP IN SYNC with AssociationRole (src/types.ts) and VALID_ROLES
  // (src/peopleRegistry.ts). This UI bundle is a static string and cannot import
  // them, so update all three together when roles change; backend write
  // validation (parsePeopleRegistry) is the source of truth and will reject
  // any role missing from VALID_ROLES.
  var ASSOCIATION_ROLES = ["responsible", "accountable", "informed", "consulted", "executive_sponsor", "stakeholder", "lead"];

  function showPeopleView(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "people", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("people");
    if (!state.registry && !state.registryLoading) {
      loadRegistry();
    }
  }

  function showTeamsView(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "teams", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("teams");
    if (!state.registry && !state.registryLoading) {
      loadRegistry();
    }
  }

  async function loadRegistry() {
    state.registryLoading = true;
    try {
      var result = await api("/api/ui/people-registry");
      state.registry = { people: result.people || [], teams: result.teams || [] };
      state.registryFileCommit = result.fileCommit || null;
      refreshTypeaheadOptions();
      renderPeople();
      renderTeams();
      renderProjectAssociations();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.registryLoading = false;
    }
  }

  async function saveRegistry(message) {
    if (!state.registry) return;
    try {
      await apiPost("/api/ui/people-registry", {
        registry: state.registry,
        message: message || undefined,
        expectedFileCommit: state.registryFileCommit || undefined
      });
      await loadRegistry();
    } catch (error) {
      // Re-sync from the server so the local optimistic edit never lingers
      // when the write was rejected (conflict, validation, network).
      if (error && error.status === 409) {
        setBanner("The registry changed since you loaded it. Reloading the latest version — please re-apply your edit.", "warn");
      } else {
        setBanner(error.message, "error");
      }
      await loadRegistry();
    }
  }

  function splitCsv(str) {
    return String(str || "").split(",").map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
  }

  function showMappingsView(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      updateLocationFromState({ anchor: null, view: "mappings", history: "push" });
    }
    state.pendingAnchor = null;
    showTab("mappings");
    if (!state.projectMappings && !state.projectMappingsLoading) {
      loadProjectMappings();
    }
  }

  async function loadProjectMappings() {
    state.projectMappingsLoading = true;
    try {
      var result = await api("/api/ui/project-mappings");
      state.projectMappings = {
        projects: result.projects || [],
        claimSourceTypes: normalizeClaimSourceTypes(result.claimSourceTypes),
        externalLinkTemplates: result.externalLinkTemplates || undefined
      };
      state.projectMappingsFileCommit = result.fileCommit || null;
      renderMappings();
    } catch (error) {
      setBanner(error.message, "error");
    } finally {
      state.projectMappingsLoading = false;
    }
  }

  function knownProjectDisplaySlugs() {
    var byLower = {};
    (state.anchors || []).forEach(function (anchor) {
      var slug = projectOf(anchor);
      if (slug) {
        var lower = String(slug).toLowerCase();
        if (!byLower[lower]) { byLower[lower] = String(slug); }
      }
    });
    var slugs = Object.keys(byLower).map(function (lower) { return byLower[lower]; });
    slugs.sort(function (a, b) {
      var al = a.toLowerCase();
      var bl = b.toLowerCase();
      return al < bl ? -1 : al > bl ? 1 : 0;
    });
    return slugs;
  }

  // Split projects into managed (anchor-backed) and orphaned (a stored mapping
  // whose project has no matching anchor — e.g. left behind by a rename/delete).
  // The managed list is derived from anchors so a mapping can never be created
  // for a project that does not exist; orphans only surface for cleanup. Before
  // anchors load (no known slugs) we cannot classify, so everything stays managed.
  function mappingsForDisplay() {
    var stored = state.projectMappings && state.projectMappings.projects
      ? state.projectMappings.projects
      : [];
    var knownSlugs = knownProjectDisplaySlugs();
    if (knownSlugs.length === 0) {
      return { managed: stored.slice(), orphans: [] };
    }
    var storedByLower = {};
    stored.forEach(function (project) {
      if (project && project.project) { storedByLower[String(project.project).toLowerCase()] = project; }
    });
    var managed = knownSlugs.map(function (slug) {
      return storedByLower[slug.toLowerCase()] || { project: slug, repos: [] };
    });
    var known = knownProjectSlugs();
    var orphans = stored.filter(function (project) {
      return project && project.project && !known.has(String(project.project).toLowerCase());
    });
    return { managed: managed, orphans: orphans };
  }

  function renderMappings() {
    if (!state.projectMappings) {
      return;
    }
    renderClaimSourceTypeRows();
    renderExternalLinkTemplateInputs();
    var display = mappingsForDisplay();
    el("mappings-empty").hidden = display.managed.length + display.orphans.length > 0;
    var html = "";
    display.managed.forEach(function (project, i) { html += mappingCardHtml(project, i); });
    if (display.orphans.length) {
      html += "<h3 class=\\"mappings-orphan-heading\\">Orphaned mappings (no matching anchor)</h3>";
      display.orphans.forEach(function (project, j) {
        html += mappingCardHtml(project, display.managed.length + j);
      });
    }
    el("mappings-list").innerHTML = html;
    var mappedCount = display.managed.filter(function (project) {
      return project.repos && project.repos.length > 0;
    }).length;
    el("mappings-summary").textContent = mappedCount + " of " + display.managed.length
      + " projects mapped to repos and paths"
      + (display.orphans.length ? " · " + display.orphans.length + " orphaned" : "") + ".";
  }

  function renderExternalLinkTemplateInputs() {
    if (!state.projectMappings) return;
    var templates = state.projectMappings.externalLinkTemplates || {};
    el("external-link-confluence").value = templates.confluencePage || "";
    el("external-link-slack").value = templates.slackChannel || "";
  }

  function normalizeClaimSourceTypes(types) {
    var byId = {};
    DEFAULT_CLAIM_SOURCE_TYPES.forEach(function (type) {
      byId[type.id] = Object.assign({}, type);
    });
    (Array.isArray(types) ? types : []).forEach(function (type) {
      var id = normalizeClaimSourceTypeId(type && type.id);
      var label = String((type && type.label) || "").trim();
      if (!id || !label) return;
      if (id === "url" && label.toLowerCase() === "source") label = "URL";
      byId[id] = {
        id: id,
        label: label,
        requiresPerson: type.requiresPerson === true,
        lockedConfidence: ["high", "medium", "low"].indexOf(type.lockedConfidence) >= 0 ? type.lockedConfidence : undefined
      };
    });
    byId["trust-me-bro"] = Object.assign({}, byId["trust-me-bro"] || { id: "trust-me-bro", label: "trust me bro" }, {
      requiresPerson: true,
      lockedConfidence: "high"
    });
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function claimSourceTypes() {
    return normalizeClaimSourceTypes(state.projectMappings && state.projectMappings.claimSourceTypes);
  }

  function claimSourceTypeById(kind) {
    var id = normalizeClaimSourceTypeId(kind || "url") || "url";
    var types = claimSourceTypes();
    return types.find(function (type) { return type.id === id; }) || { id: id, label: id };
  }

  function normalizeClaimSourceTypeId(value) {
    var normalized = String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized === "source" || normalized === "evidence" ? "url" : normalized;
  }

  function renderClaimSourceTypeRows() {
    var container = safeEl("claim-source-types-list");
    if (!container || !state.projectMappings) return;
    container.innerHTML = claimSourceTypes().map(function (type, index) {
      return claimSourceTypeRowHtml(type, index);
    }).join("");
  }

  function claimSourceTypeRowHtml(type, index) {
    var locked = type.id === "trust-me-bro";
    var disabled = locked ? " disabled" : "";
    var confidence = type.lockedConfidence || "";
    return "<div class=\\"claim-source-type-row\\" data-source-type-index=\\"" + index + "\\">"
      + "<label>ID<input class=\\"claim-source-type-id\\" type=\\"text\\" value=\\"" + escapeHtml(type.id || "") + "\\"" + disabled + "></label>"
      + "<label>Label<input class=\\"claim-source-type-label\\" type=\\"text\\" value=\\"" + escapeHtml(type.label || "") + "\\"></label>"
      + "<label><input class=\\"claim-source-type-person\\" type=\\"checkbox\\"" + (type.requiresPerson ? " checked" : "") + (locked ? " disabled" : "") + "> Person</label>"
      + "<label>Locked strength<select class=\\"claim-source-type-confidence\\"" + (locked ? " disabled" : "") + ">"
      + ["", "high", "medium", "low"].map(function (value) {
        return "<option value=\\"" + value + "\\"" + (confidence === value ? " selected" : "") + ">" + (value || "none") + "</option>";
      }).join("")
      + "</select></label>"
      + (locked ? "<span class=\\"badge\\">required</span>" : "<button class=\\"claim-source-type-remove\\" type=\\"button\\" data-source-type-index=\\"" + index + "\\">Remove</button>")
      + "</div>";
  }

  function mappingCardHtml(project, pi) {
    var slug = project && project.project ? project.project : "";
    var repos = project && Array.isArray(project.repos) ? project.repos : [];
    var known = knownProjectSlugs();
    var orphan = slug && known.size > 0 && !known.has(slug.toLowerCase());
    var repoRows = repos.map(function (repo, ri) {
      return mappingRepoRowHtml(repo, pi, ri);
    }).join("");
    // The project slug is fixed (derived from an anchor, or a stale orphan): it
    // is carried in data-project rather than an editable input, so the UI can
    // never mint a mapping for a project that does not exist.
    var action = orphan
      ? "<span class=\\"badge warn\\">no matching anchor</span>"
        + "<button class=\\"mapping-remove-orphan\\" type=\\"button\\" data-pi=\\"" + pi + "\\">Remove</button>"
      : (repos.length > 0
        ? "<button class=\\"mapping-clear\\" type=\\"button\\" data-pi=\\"" + pi + "\\">Clear mapping</button>"
        : "");
    return "<div class=\\"registry-card\\" data-project-index=\\"" + pi + "\\" data-project=\\"" + escapeHtml(slug) + "\\">"
      + "<div class=\\"action-row\\">"
      + "<span class=\\"mapping-project-name\\">" + escapeHtml(slug) + "</span>"
      + action
      + "</div>"
      + "<div class=\\"mapping-repos\\">" + repoRows + "</div>"
      + "<button class=\\"mapping-add-repo\\" type=\\"button\\" data-pi=\\"" + pi + "\\">+ Add repo</button>"
      + "</div>";
  }

  function mappingRepoRowHtml(repo, pi, ri) {
    var repoName = repo && repo.repo ? repo.repo : "";
    var paths = repo && Array.isArray(repo.paths) ? repo.paths.join("\\n") : "";
    var web = repo && repo.web ? repo.web : {};
    var webUrl = web.url || "";
    var webBranch = web.branch || "";
    var webTemplate = web.fileTemplate || "";
    var pullRequestTemplate = web.pullRequestTemplate || "";
    return "<div class=\\"mapping-repo-row\\" data-pi=\\"" + pi + "\\" data-ri=\\"" + ri + "\\">"
      + "<label>Repo<input class=\\"mapping-repo\\" type=\\"text\\" value=\\"" + escapeHtml(repoName) + "\\" placeholder=\\"repo-name\\"></label>"
      + "<label>Paths (one per line; blank = whole repo)<textarea class=\\"mapping-paths\\" rows=\\"2\\" placeholder=\\"services/payments\\">" + escapeHtml(paths) + "</textarea></label>"
      + "<label>Web URL (optional, for file links)<input class=\\"mapping-web-url\\" type=\\"text\\" value=\\"" + escapeHtml(webUrl) + "\\" placeholder=\\"https://github.com/owner/repo\\"></label>"
      + "<label>Branch<input class=\\"mapping-web-branch\\" type=\\"text\\" value=\\"" + escapeHtml(webBranch) + "\\" placeholder=\\"main\\"></label>"
      + "<label>File URL template (optional)<input class=\\"mapping-web-template\\" type=\\"text\\" value=\\"" + escapeHtml(webTemplate) + "\\" placeholder=\\"{url}/blob/{branch}/{path}\\"></label>"
      + "<label>PR URL template (optional)<input class=\\"mapping-pr-template\\" type=\\"text\\" value=\\"" + escapeHtml(pullRequestTemplate) + "\\" placeholder=\\"{url}/pull/{number}\\"></label>"
      + "<button class=\\"mapping-remove-repo\\" type=\\"button\\" data-pi=\\"" + pi + "\\" data-ri=\\"" + ri + "\\">Remove repo</button>"
      + "</div>";
  }

  function splitLines(value) {
    return String(value || "").split(/\\r?\\n/).map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line.length > 0;
    });
  }

  function readRowValue(row, selector) {
    var input = row.querySelector(selector);
    return input ? (input.value || "").trim() : "";
  }

  function readMappingsFromDom() {
    var projects = [];
    var cards = el("mappings-list").querySelectorAll(".registry-card");
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      // The slug is fixed; read it from the card rather than an editable input.
      var slug = (card.getAttribute("data-project") || "").trim();
      var repos = [];
      var rows = card.querySelectorAll(".mapping-repo-row");
      for (var j = 0; j < rows.length; j += 1) {
        var repoInput = rows[j].querySelector(".mapping-repo");
        var pathsInput = rows[j].querySelector(".mapping-paths");
        var webUrl = readRowValue(rows[j], ".mapping-web-url");
        var entry = {
          repo: repoInput ? (repoInput.value || "").trim() : "",
          paths: pathsInput ? splitLines(pathsInput.value) : []
        };
        if (webUrl) {
          var webBranch = readRowValue(rows[j], ".mapping-web-branch");
          var webTemplate = readRowValue(rows[j], ".mapping-web-template");
          var pullRequestTemplate = readRowValue(rows[j], ".mapping-pr-template");
          entry.web = { url: webUrl };
          if (webBranch) { entry.web.branch = webBranch; }
          if (webTemplate) { entry.web.fileTemplate = webTemplate; }
          if (pullRequestTemplate) { entry.web.pullRequestTemplate = pullRequestTemplate; }
        }
        repos.push(entry);
      }
      projects.push({ project: slug, repos: repos });
    }
    var confluencePage = (el("external-link-confluence").value || "").trim();
    var slackChannel = (el("external-link-slack").value || "").trim();
    var externalLinkTemplates = {};
    if (confluencePage) { externalLinkTemplates.confluencePage = confluencePage; }
    if (slackChannel) { externalLinkTemplates.slackChannel = slackChannel; }
    return Object.assign(
      { projects: projects, claimSourceTypes: readClaimSourceTypesFromDom() },
      Object.keys(externalLinkTemplates).length ? { externalLinkTemplates: externalLinkTemplates } : {}
    );
  }

  function readClaimSourceTypesFromDom() {
    var rows = safeEl("claim-source-types-list") ? el("claim-source-types-list").querySelectorAll(".claim-source-type-row") : [];
    var types = [];
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var id = normalizeClaimSourceTypeId(readRowValue(row, ".claim-source-type-id"));
      var label = readRowValue(row, ".claim-source-type-label");
      var personInput = row.querySelector(".claim-source-type-person");
      var confidence = readRowValue(row, ".claim-source-type-confidence");
      if (!id || !label) continue;
      types.push(Object.assign(
        { id: id, label: label },
        personInput && personInput.checked ? { requiresPerson: true } : {},
        confidence ? { lockedConfidence: confidence } : {}
      ));
    }
    return normalizeClaimSourceTypes(types);
  }

  function syncMappingsFromDom() {
    state.projectMappings = readMappingsFromDom();
  }

  // Clear a managed project's mapping (repos). The row stays listed because the
  // project still exists; on save the now repo-less project is dropped from storage.
  function clearMapping(pi) {
    syncMappingsFromDom();
    var project = state.projectMappings.projects[pi];
    if (project) {
      project.repos = [];
      renderMappings();
    }
  }

  // Delete an orphaned mapping outright (its project has no anchor).
  function removeOrphanMapping(pi) {
    syncMappingsFromDom();
    state.projectMappings.projects.splice(pi, 1);
    renderMappings();
  }

  function addMappingRepo(pi) {
    syncMappingsFromDom();
    var project = state.projectMappings.projects[pi];
    if (project) {
      project.repos.push({ repo: "", paths: [] });
      renderMappings();
    }
  }

  function addClaimSourceType() {
    syncMappingsFromDom();
    var types = normalizeClaimSourceTypes(state.projectMappings.claimSourceTypes);
    var existing = new Set(types.map(function (type) { return type.id; }));
    var base = "custom-source";
    var id = base;
    var suffix = 2;
    while (existing.has(id)) {
      id = base + "-" + suffix;
      suffix += 1;
    }
    state.projectMappings.claimSourceTypes = types.concat([{ id: id, label: "Custom Source" }]);
    renderMappings();
  }

  function removeClaimSourceType(index) {
    syncMappingsFromDom();
    var types = normalizeClaimSourceTypes(state.projectMappings.claimSourceTypes);
    if (types[index] && types[index].id !== "trust-me-bro") {
      types.splice(index, 1);
      state.projectMappings.claimSourceTypes = types;
      renderMappings();
    }
  }

  function removeMappingRepo(pi, ri) {
    syncMappingsFromDom();
    var project = state.projectMappings.projects[pi];
    if (project && project.repos) {
      project.repos.splice(ri, 1);
      renderMappings();
    }
  }

  async function saveProjectMappings() {
    syncMappingsFromDom();
    try {
      await apiPost("/api/ui/project-mappings", {
        mappings: state.projectMappings,
        expectedFileCommit: state.projectMappingsFileCommit || undefined
      });
      setBanner("Saved project mappings.", "info");
      await loadProjectMappings();
    } catch (error) {
      if (error && error.status === 409) {
        setBanner("The mappings changed since you loaded them. Reloading the latest version — please re-apply your edit.", "warn");
      } else {
        setBanner(error.message, "error");
      }
      await loadProjectMappings();
    }
  }

  // Project slugs known from loaded anchors, used for soft referential
  // validation of associations. Empty when anchors are not yet loaded, in
  // which case we suppress warnings rather than emit false positives.
  function knownProjectSlugs() {
    var set = new Set();
    (state.anchors || []).forEach(function(a) {
      var p = projectOf(a);
      if (p) set.add(String(p).toLowerCase());
    });
    return set;
  }

  function teamIdSet(registry) {
    var set = new Set();
    (registry.teams || []).forEach(function(t) { set.add(String(t.id).toLowerCase()); });
    return set;
  }

  function addSuggestion(map, value, label, searchText) {
    var normalizedValue = String(value || "").trim();
    if (!normalizedValue) return;
    var key = normalizedValue.toLowerCase();
    if (map.has(key)) return;
    map.set(key, {
      value: normalizedValue,
      label: label || normalizedValue,
      searchText: String(searchText || label || normalizedValue).toLowerCase()
    });
  }

  function projectSuggestionOptions() {
    var map = new Map();
    (state.anchors || []).forEach(function(anchor) {
      var project = projectOf(anchor);
      if (project) addSuggestion(map, project, project);
    });
    (state.tasks || []).forEach(function(task) {
      if (task.project) addSuggestion(map, task.project, task.project);
    });
    if (state.registry) {
      (state.registry.people || []).forEach(function(person) {
        (person.projects || []).forEach(function(assoc) { addSuggestion(map, assoc.project, assoc.project); });
      });
      (state.registry.teams || []).forEach(function(team) {
        (team.projects || []).forEach(function(assoc) { addSuggestion(map, assoc.project, assoc.project); });
      });
    }
    return Array.from(map.values()).sort(function(left, right) {
      return left.value.localeCompare(right.value);
    });
  }

  function milestoneSuggestionOptions() {
    var map = new Map();
    (state.anchors || []).forEach(function(anchor) {
      var name = anchor.name || anchor.path || "";
      if (name.indexOf("/milestones/") < 0) return;
      var project = projectOf(anchor);
      var fallback = name.split("/").pop().replace(/\\.md$/, "");
      var label = [project, anchor.title || fallback].filter(Boolean).join(" · ");
      addSuggestion(map, name, label || name, name + " " + label);
    });
    (state.tasks || []).forEach(function(task) {
      if (!task.milestoneName) return;
      var label = [task.project, task.milestoneDisplayId || task.milestoneName.split("/").pop().replace(/\\.md$/, "")].filter(Boolean).join(" · ");
      addSuggestion(map, task.milestoneName, label || task.milestoneName, task.milestoneName + " " + label);
    });
    return Array.from(map.values()).sort(function(left, right) {
      return left.value.localeCompare(right.value);
    });
  }

  function teamSuggestionOptions(query) {
    var needle = String(query || "").toLowerCase().trim();
    if (!state.registry) return [];
    return (state.registry.teams || []).map(function(team) {
      var search = teamSearchText(team, state.registry);
      return {
        value: team.id,
        label: [team.displayName, (team.synonyms || []).join(", ")].filter(Boolean).join(" · "),
        searchText: search
      };
    }).filter(function(option) {
      return !needle || option.searchText.indexOf(needle) >= 0;
    }).sort(function(left, right) {
      return String(left.value).localeCompare(String(right.value));
    });
  }

  function renderDatalist(id, options) {
    var datalist = safeEl(id);
    if (!datalist) return;
    datalist.innerHTML = (options || []).slice(0, 80).map(function(option) {
      return "<option value=\\"" + escapeHtml(option.value) + "\\" label=\\"" + escapeHtml(option.label || option.value) + "\\"></option>";
    }).join("");
  }

  function refreshTypeaheadOptions() {
    renderDatalist("project-slug-suggestions", projectSuggestionOptions());
    renderDatalist("milestone-anchor-suggestions", milestoneSuggestionOptions());
    renderTeamIdSuggestions(null);
  }

  function wireTeamCsvInputs(container) {
    (container || document).querySelectorAll("[list=\\"team-id-suggestions\\"]").forEach(function(input) {
      wireTeamCsvInput(input);
    });
  }

  function wireTeamCsvInput(input) {
    if (!input || input.dataset.teamSuggestWired) return;
    input.dataset.teamSuggestWired = "1";
    input.addEventListener("focus", function() { renderTeamIdSuggestions(input); });
    input.addEventListener("input", function() { renderTeamIdSuggestions(input); });
  }

  function renderTeamIdSuggestions(input) {
    var token = csvActiveToken(input ? input.value : "");
    var suffix = token.prefix ? token.prefix + (/\\s$/.test(token.prefix) ? "" : " ") : "";
    var options = teamSuggestionOptions(token.value).map(function(option) {
      return {
        value: suffix + option.value,
        label: option.label || option.value,
        searchText: option.searchText
      };
    });
    renderDatalist("team-id-suggestions", options);
  }

  function csvActiveToken(value) {
    var raw = String(value || "");
    var commaIndex = raw.lastIndexOf(",");
    if (commaIndex < 0) return { prefix: "", value: raw.trim() };
    return {
      prefix: raw.slice(0, commaIndex + 1),
      value: raw.slice(commaIndex + 1).trim()
    };
  }

  function resolveTeamIdsFromCsv(value) {
    return splitCsv(value).map(resolveTeamId);
  }

  function resolveTeamId(value) {
    var raw = String(value || "").trim();
    var needle = raw.toLowerCase();
    if (!needle || !state.registry) return raw;
    var match = (state.registry.teams || []).find(function(team) {
      return teamExactValues(team).some(function(candidate) {
        return candidate.toLowerCase() === needle;
      });
    });
    return match ? match.id : raw;
  }

  function teamExactValues(team) {
    return [
      team && team.id,
      team && team.displayName
    ].concat(team && Array.isArray(team.synonyms) ? team.synonyms : [])
      .concat(team && Array.isArray(team.slackHandles) ? team.slackHandles : [])
      .filter(Boolean).map(String);
  }

  // A clickable cross-link rendered as a real <button> so it is reachable by
  // keyboard and exposed to assistive tech (chips were previously inert spans).
  function linkChip(kind, id, label) {
    return "<button type=\\"button\\" class=\\"registry-chip link-chip\\" data-goto-" + kind + "=\\"" + escapeHtml(id) + "\\">"
      + escapeHtml(label) + "</button>";
  }

  function warnChip(text) {
    return "<span class=\\"registry-chip warn-chip\\" title=\\"" + escapeHtml(text) + "\\">⚠ " + escapeHtml(text) + "</span>";
  }

  function assocChips(projects, knownProjects) {
    return (projects || []).map(function(a) {
      var unknown = knownProjects.size > 0 && !knownProjects.has(String(a.project).toLowerCase());
      return "<span class=\\"registry-chip\\"><span class=\\"registry-chip role-chip\\">" + escapeHtml(a.role) + "</span> "
        + escapeHtml(a.project)
        + (unknown ? " <span class=\\"assoc-warn\\" title=\\"No loaded anchor matches this project slug\\">⚠</span>" : "")
        + "</span>";
    }).join("");
  }

  // Wires cross-link buttons (data-goto-person / data-goto-team) within any
  // container: switch to the target tab and scroll/flash the entry.
  function wireGotoChips(container) {
    container.querySelectorAll("[data-goto-team]").forEach(function(chip) {
      chip.addEventListener("click", function() {
        showTeamsView();
        scrollToRegistryCard("team-id", chip.dataset.gotoTeam);
      });
    });
    container.querySelectorAll("[data-goto-person]").forEach(function(chip) {
      chip.addEventListener("click", function() {
        showPeopleView();
        scrollToRegistryCard("person-id", chip.dataset.gotoPerson);
      });
    });
  }

  // Reverse view: group every person/team association by project slug so a
  // reader can answer "who is on project X" without scanning every card.
  function renderProjectAssociations() {
    var registry = state.registry;
    if (!registry) return;
    var known = knownProjectSlugs();
    var byProject = {};
    function add(project, role, kind, id, label) {
      if (!byProject[project]) byProject[project] = [];
      byProject[project].push({ role: role, kind: kind, id: id, label: label });
    }
    (registry.people || []).forEach(function(p) {
      (p.projects || []).forEach(function(a) { add(a.project, a.role, "person", p.id, p.displayName); });
    });
    (registry.teams || []).forEach(function(t) {
      (t.projects || []).forEach(function(a) { add(a.project, a.role, "team", t.id, t.displayName); });
    });
    var slugs = Object.keys(byProject).sort();
    var html;
    if (slugs.length === 0) {
      html = "<p class=\\"registry-result\\">No project associations yet. Edit a person or team to add one.</p>";
    } else {
      html = slugs.map(function(slug) {
        var unknown = known.size > 0 && !known.has(String(slug).toLowerCase());
        var rows = byProject[slug].map(function(e) {
          return "<span class=\\"registry-chip\\"><span class=\\"registry-chip role-chip\\">" + escapeHtml(e.role) + "</span> "
            + linkChip(e.kind, e.id, e.label) + "</span>";
        }).join("");
        return "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">" + escapeHtml(slug)
          + (unknown ? " <span class=\\"assoc-warn\\" title=\\"No loaded anchor matches this project slug\\">⚠</span>" : "")
          + "</div><div class=\\"registry-chips\\">" + rows + "</div></div>";
      }).join("");
    }
    ["people-assoc-overview", "teams-assoc-overview"].forEach(function(id) {
      var box = el(id);
      if (!box) return;
      var body = box.querySelector(".assoc-overview-body");
      if (!body) return;
      body.innerHTML = html;
      wireGotoChips(body);
    });
  }

  function peopleForDisplay(registry, query) {
    var people = (registry && registry.people) || [];
    return people.filter(function(person) {
      return searchTextMatches(personSearchText(person, registry), query);
    });
  }

  function teamsForDisplay(registry, query) {
    var teams = (registry && registry.teams) || [];
    return teams.filter(function(team) {
      return searchTextMatches(teamSearchText(team, registry), query);
    });
  }

  function searchTextMatches(text, query) {
    var terms = String(query || "").toLowerCase().trim().split(/\\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    var haystack = String(text || "").toLowerCase();
    return terms.every(function(term) {
      return haystack.indexOf(term) >= 0;
    });
  }

  function personSearchText(person, registry) {
    var identities = person.identities || {};
    var teamValues = (person.teams || []).flatMap(function(teamId) {
      var team = ((registry && registry.teams) || []).find(function(t) { return t.id === teamId; });
      return team ? [team.id, team.displayName].concat(team.synonyms || [], team.slackHandles || []) : [teamId];
    });
    var projectValues = (person.projects || []).flatMap(function(assoc) {
      return [assoc.project, assoc.role];
    });
    return [
      person.id,
      person.displayName,
      identities.slack,
      identities.confluence
    ].concat(identities.emails || [], identities.names || [], teamValues, projectValues).filter(Boolean).join(" ");
  }

  function teamSearchText(team, registry) {
    var memberValues = ((registry && registry.people) || []).filter(function(person) {
      return (person.teams || []).some(function(teamId) { return teamId === team.id; });
    }).flatMap(function(person) {
      return [person.id, person.displayName];
    });
    var projectValues = (team.projects || []).flatMap(function(assoc) {
      return [assoc.project, assoc.role];
    });
    return [
      team.id,
      team.displayName
    ].concat(team.synonyms || [], team.slackHandles || [], memberValues, projectValues).filter(Boolean).join(" ").toLowerCase();
  }

  function renderPeople() {
    var registry = state.registry;
    var list = el("people-list");
    var emptyEl = el("people-empty");
    var summary = el("people-summary");
    if (!registry || !registry.people) return;
    var query = controlValue("people-search", state.peopleSearch).trim();
    state.peopleSearch = query;
    var allPeople = registry.people;
    var people = peopleForDisplay(registry, query);
    summary.textContent = people.length + " of " + allPeople.length + " person" + (allPeople.length === 1 ? "" : "s") + " shown.";
    if (allPeople.length === 0) {
      emptyEl.textContent = "No people in registry.";
      emptyEl.hidden = false;
      list.innerHTML = "";
      return;
    }
    if (people.length === 0) {
      emptyEl.textContent = "No people match the current search.";
      emptyEl.hidden = false;
      list.innerHTML = "";
      return;
    }
    emptyEl.hidden = true;
    list.innerHTML = people.map(function(person) {
      return renderPersonCard(person, registry);
    }).join("");
    wirePersonCards(list, registry);
  }

  function renderPersonCard(person, registry) {
    var teams = (person.teams || []).map(function(teamId) {
      var team = (registry.teams || []).find(function(t) { return t.id === teamId; });
      if (team) return linkChip("team", team.id, team.displayName);
      return warnChip(teamId + " — unknown team");
    }).join("");
    var idents = [];
    if (person.identities) {
      if (person.identities.slack) idents.push("<span class=\\"registry-chip\\">Slack: " + escapeHtml(person.identities.slack) + "</span>");
      if (person.identities.confluence) idents.push("<span class=\\"registry-chip\\">Confluence: " + escapeHtml(person.identities.confluence) + "</span>");
      (person.identities.emails || []).forEach(function(e) { idents.push("<span class=\\"registry-chip\\">✉ " + escapeHtml(e) + "</span>"); });
      (person.identities.names || []).forEach(function(n) { idents.push("<span class=\\"registry-chip\\">aka " + escapeHtml(n) + "</span>"); });
    }
    var assocs = assocChips(person.projects, knownProjectSlugs());
    var isEditing = state.selectedPersonId === person.id;
    return "<div class=\\"registry-card\\" data-person-id=\\"" + escapeHtml(person.id) + "\\">"
      + "<div class=\\"registry-card-header\\">"
      + "<div><div class=\\"registry-card-title\\">" + escapeHtml(person.displayName) + "</div>"
      + "<div class=\\"registry-card-id\\">" + escapeHtml(person.id) + "</div></div>"
      + "<div class=\\"registry-card-actions\\">"
      + "<button type=\\"button\\" class=\\"person-edit-btn\\" data-person-id=\\"" + escapeHtml(person.id) + "\\">" + (isEditing ? "Close" : "Edit") + "</button>"
      + "<button type=\\"button\\" class=\\"person-delete-btn\\" data-person-id=\\"" + escapeHtml(person.id) + "\\">Delete</button>"
      + "</div></div>"
      + (idents.length ? "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">Identities</div><div class=\\"registry-chips\\">" + idents.join("") + "</div></div>" : "")
      + (teams ? "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">Teams</div><div class=\\"registry-chips\\">" + teams + "</div></div>" : "")
      + (assocs ? "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">Project Associations</div><div class=\\"registry-chips\\">" + assocs + "</div></div>" : "")
      + (isEditing ? renderPersonEditForm(person) : "")
      + "</div>";
  }

  function renderPersonEditForm(person) {
    var idents = person.identities || {};
    var assocRows = (person.projects || []).map(function(a, i) {
      return renderAssocRow("person", i, a.project, a.role);
    }).join("") + renderAssocRow("person", (person.projects || []).length, "", "");
    return "<div class=\\"registry-edit-form\\">"
      + "<div class=\\"form-grid\\">"
      + "<label>Display Name<input id=\\"edit-person-name\\" type=\\"text\\" value=\\"" + escapeHtml(person.displayName) + "\\"></label>"
      + "<label>Slack ID<input id=\\"edit-person-slack\\" type=\\"text\\" value=\\"" + escapeHtml(idents.slack || "") + "\\"></label>"
      + "<label>Confluence ID<input id=\\"edit-person-confluence\\" type=\\"text\\" value=\\"" + escapeHtml(idents.confluence || "") + "\\"></label>"
      + "<label>Emails (comma-separated)<input id=\\"edit-person-emails\\" type=\\"text\\" value=\\"" + escapeHtml((idents.emails || []).join(", ")) + "\\"></label>"
      + "<label>Name aliases (comma-separated)<input id=\\"edit-person-names\\" type=\\"text\\" value=\\"" + escapeHtml((idents.names || []).join(", ")) + "\\"></label>"
      + "<label>Teams (comma-separated)<input id=\\"edit-person-teams\\" type=\\"text\\" value=\\"" + escapeHtml((person.teams || []).join(", ")) + "\\" list=\\"team-id-suggestions\\" autocomplete=\\"off\\"></label>"
      + "</div>"
      + "<div class=\\"registry-section-label\\" style=\\"margin-bottom:6px\\">Project Associations</div>"
      + "<div id=\\"edit-person-assocs\\">" + assocRows + "</div>"
      + "<div class=\\"action-row\\">"
      + "<button type=\\"button\\" class=\\"person-save-btn\\" data-person-id=\\"" + escapeHtml(person.id) + "\\">Save</button>"
      + "<button type=\\"button\\" class=\\"person-edit-btn\\" data-person-id=\\"" + escapeHtml(person.id) + "\\">Cancel</button>"
      + "</div>"
      + "<p class=\\"registry-result\\" id=\\"edit-person-result\\"></p>"
      + "</div>";
  }

  function renderAssocRow(kind, index, project, role) {
    var roleOptions = [""].concat(ASSOCIATION_ROLES).map(function(r) {
      return "<option value=\\"" + r + "\\"" + (r === role ? " selected" : "") + ">" + (r || "-- role --") + "</option>";
    }).join("");
    return "<div class=\\"registry-assoc-row\\" data-assoc-index=\\"" + index + "\\">"
      + "<input type=\\"text\\" placeholder=\\"project-slug\\" value=\\"" + escapeHtml(project) + "\\" class=\\"assoc-project\\" list=\\"project-slug-suggestions\\" autocomplete=\\"off\\">"
      + "<select class=\\"assoc-role\\">" + roleOptions + "</select>"
      + (project ? "<button type=\\"button\\" class=\\"assoc-remove compact-action\\">✕</button>" : "<button type=\\"button\\" class=\\"assoc-add compact-action\\">+</button>")
      + "</div>";
  }

  function collectAssocRows(container) {
    var rows = container.querySelectorAll(".registry-assoc-row");
    var assocs = [];
    rows.forEach(function(row) {
      var proj = (row.querySelector(".assoc-project") || {}).value || "";
      var role = (row.querySelector(".assoc-role") || {}).value || "";
      if (proj.trim() && role) {
        assocs.push({ project: proj.trim(), role: role });
      }
    });
    return assocs;
  }

  function wirePersonCards(container, registry) {
    container.querySelectorAll(".person-edit-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        state.selectedPersonId = state.selectedPersonId === btn.dataset.personId ? null : btn.dataset.personId;
        renderPeople();
        if (state.selectedPersonId) {
          var card = findByDataAttr(container, "person-id", btn.dataset.personId);
          if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    });
    container.querySelectorAll(".person-delete-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var id = btn.dataset.personId;
        if (!window.confirm("Delete person " + id + " from registry?")) return;
        state.registry.people = state.registry.people.filter(function(p) { return p.id !== id; });
        saveRegistry("chore: remove person " + id).catch(function(e) { setBanner(e.message, "error"); });
      });
    });
    container.querySelectorAll(".person-save-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var id = btn.dataset.personId;
        var person = state.registry.people.find(function(p) { return p.id === id; });
        if (!person) return;
        var name = (el("edit-person-name") || {}).value || "";
        if (!name.trim()) { if (el("edit-person-result")) el("edit-person-result").textContent = "Display name is required."; return; }
        var slack = (el("edit-person-slack") || {}).value || "";
        var confluence = (el("edit-person-confluence") || {}).value || "";
        var emails = splitCsv((el("edit-person-emails") || {}).value);
        var names = splitCsv((el("edit-person-names") || {}).value);
        var teams = resolveTeamIdsFromCsv((el("edit-person-teams") || {}).value);
        var assocContainer = el("edit-person-assocs");
        var projects = assocContainer ? collectAssocRows(assocContainer) : (person.projects || []);
        var identities = {};
        if (slack.trim()) identities.slack = slack.trim();
        if (confluence.trim()) identities.confluence = confluence.trim();
        if (emails.length) identities.emails = emails;
        if (names.length) identities.names = names;
        person.displayName = name.trim();
        person.identities = Object.keys(identities).length ? identities : undefined;
        person.teams = teams.length ? teams : undefined;
        person.projects = projects.length ? projects : undefined;
        state.selectedPersonId = null;
        saveRegistry("chore: update person " + id).catch(function(e) { setBanner(e.message, "error"); });
      });
    });
    wireGotoChips(container);
    wireAssocRows(container);
    wireTeamCsvInputs(container);
  }

  // Find an element by a data attribute without interpolating the (user-provided)
  // value into a CSS selector — ids may contain quotes/brackets/backslashes that
  // would make querySelector throw or match the wrong node.
  function findByDataAttr(root, attr, value) {
    var nodes = (root || document).querySelectorAll("[data-" + attr + "]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-" + attr) === value) return nodes[i];
    }
    return null;
  }

  function scrollToRegistryCard(attr, id) {
    setTimeout(function() {
      var card = findByDataAttr(document, attr, id);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("registry-card-flash");
      setTimeout(function() { card.classList.remove("registry-card-flash"); }, 1200);
    }, 60);
  }

  function wireAssocRows(container) {
    // Guard against duplicate listeners: wireAssocRows runs on every render and
    // again after each "+" click, so only bind buttons not already wired.
    container.querySelectorAll(".assoc-add").forEach(function(btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function() {
        var row = btn.closest(".registry-assoc-row");
        if (!row) return;
        btn.outerHTML = "<button type=\\"button\\" class=\\"assoc-remove compact-action\\">✕</button>";
        var newRow = document.createElement("div");
        newRow.className = "registry-assoc-row";
        newRow.dataset.assocIndex = "new";
        newRow.innerHTML = "<input type=\\"text\\" placeholder=\\"project-slug\\" value=\\"\\" class=\\"assoc-project\\" list=\\"project-slug-suggestions\\" autocomplete=\\"off\\">"
          + "<select class=\\"assoc-role\\">" + [""].concat(ASSOCIATION_ROLES).map(function(r) { return "<option value=\\"" + r + "\\">" + (r || "-- role --") + "</option>"; }).join("") + "</select>"
          + "<button type=\\"button\\" class=\\"assoc-add compact-action\\">+</button>";
        row.parentNode.appendChild(newRow);
        wireAssocRows(row.parentNode);
      });
    });
    container.querySelectorAll(".assoc-remove").forEach(function(btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function() {
        var row = btn.closest(".registry-assoc-row");
        if (row) row.remove();
      });
    });
  }

  function renderTeams() {
    var registry = state.registry;
    var list = el("teams-list");
    var emptyEl = el("teams-empty");
    var summary = el("teams-summary");
    if (!registry || !registry.teams) return;
    var query = controlValue("teams-search", state.teamsSearch).trim();
    state.teamsSearch = query;
    var allTeams = registry.teams;
    var teams = teamsForDisplay(registry, query);
    summary.textContent = teams.length + " of " + allTeams.length + " team" + (allTeams.length === 1 ? "" : "s") + " shown.";
    if (allTeams.length === 0) {
      emptyEl.textContent = "No teams in registry.";
      emptyEl.hidden = false;
      list.innerHTML = "";
      return;
    }
    if (teams.length === 0) {
      emptyEl.textContent = "No teams match the current search.";
      emptyEl.hidden = false;
      list.innerHTML = "";
      return;
    }
    emptyEl.hidden = true;
    list.innerHTML = teams.map(function(team) {
      return renderTeamCard(team, registry);
    }).join("");
    wireTeamCards(list, registry);
  }

  function renderTeamCard(team, registry) {
    var members = (registry.people || []).filter(function(p) {
      return (p.teams || []).some(function(t) { return t === team.id; });
    });
    var memberChips = members.map(function(p) {
      return linkChip("person", p.id, p.displayName);
    }).join("");
    var synonymChips = (team.synonyms || []).map(function(s) {
      return "<span class=\\"registry-chip\\">" + escapeHtml(s) + "</span>";
    }).join("");
    var handleChips = (team.slackHandles || []).map(function(h) {
      return "<span class=\\"registry-chip\\">slack: " + escapeHtml(h) + "</span>";
    }).join("");
    var assocs = assocChips(team.projects, knownProjectSlugs());
    var isEditing = state.selectedTeamId === team.id;
    return "<div class=\\"registry-card\\" data-team-id=\\"" + escapeHtml(team.id) + "\\">"
      + "<div class=\\"registry-card-header\\">"
      + "<div><div class=\\"registry-card-title\\">" + escapeHtml(team.displayName) + "</div>"
      + "<div class=\\"registry-card-id\\">" + escapeHtml(team.id) + "</div></div>"
      + "<div class=\\"registry-card-actions\\">"
      + "<button type=\\"button\\" class=\\"team-edit-btn\\" data-team-id=\\"" + escapeHtml(team.id) + "\\">" + (isEditing ? "Close" : "Edit") + "</button>"
      + "<button type=\\"button\\" class=\\"team-delete-btn\\" data-team-id=\\"" + escapeHtml(team.id) + "\\">Delete</button>"
      + "</div></div>"
      + (synonymChips || handleChips ? "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">Identifiers</div><div class=\\"registry-chips\\">" + synonymChips + handleChips + "</div></div>" : "")
      + (memberChips ? "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">Members (" + members.length + ")</div><div class=\\"registry-chips\\">" + memberChips + "</div></div>" : "")
      + (assocs ? "<div class=\\"registry-section\\"><div class=\\"registry-section-label\\">Project Associations</div><div class=\\"registry-chips\\">" + assocs + "</div></div>" : "")
      + (isEditing ? renderTeamEditForm(team) : "")
      + "</div>";
  }

  function renderTeamEditForm(team) {
    var assocRows = (team.projects || []).map(function(a, i) {
      return renderAssocRow("team", i, a.project, a.role);
    }).join("") + renderAssocRow("team", (team.projects || []).length, "", "");
    return "<div class=\\"registry-edit-form\\">"
      + "<div class=\\"form-grid\\">"
      + "<label>Display Name<input id=\\"edit-team-name\\" type=\\"text\\" value=\\"" + escapeHtml(team.displayName) + "\\"></label>"
      + "<label>Synonyms (comma-separated)<input id=\\"edit-team-synonyms\\" type=\\"text\\" value=\\"" + escapeHtml((team.synonyms || []).join(", ")) + "\\"></label>"
      + "<label>Slack Handles (comma-separated)<input id=\\"edit-team-handles\\" type=\\"text\\" value=\\"" + escapeHtml((team.slackHandles || []).join(", ")) + "\\"></label>"
      + "</div>"
      + "<div class=\\"registry-section-label\\" style=\\"margin-bottom:6px\\">Project Associations</div>"
      + "<div id=\\"edit-team-assocs\\">" + assocRows + "</div>"
      + "<div class=\\"action-row\\">"
      + "<button type=\\"button\\" class=\\"team-save-btn\\" data-team-id=\\"" + escapeHtml(team.id) + "\\">Save</button>"
      + "<button type=\\"button\\" class=\\"team-edit-btn\\" data-team-id=\\"" + escapeHtml(team.id) + "\\">Cancel</button>"
      + "</div>"
      + "<p class=\\"registry-result\\" id=\\"edit-team-result\\"></p>"
      + "</div>";
  }

  function wireTeamCards(container, registry) {
    container.querySelectorAll(".team-edit-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        state.selectedTeamId = state.selectedTeamId === btn.dataset.teamId ? null : btn.dataset.teamId;
        renderTeams();
        if (state.selectedTeamId) {
          var card = findByDataAttr(container, "team-id", btn.dataset.teamId);
          if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    });
    container.querySelectorAll(".team-delete-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var id = btn.dataset.teamId;
        if (!window.confirm("Delete team " + id + " from registry?")) return;
        state.registry.teams = state.registry.teams.filter(function(t) { return t.id !== id; });
        saveRegistry("chore: remove team " + id).catch(function(e) { setBanner(e.message, "error"); });
      });
    });
    container.querySelectorAll(".team-save-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var id = btn.dataset.teamId;
        var team = state.registry.teams.find(function(t) { return t.id === id; });
        if (!team) return;
        var name = (el("edit-team-name") || {}).value || "";
        if (!name.trim()) { if (el("edit-team-result")) el("edit-team-result").textContent = "Display name is required."; return; }
        var synonyms = splitCsv((el("edit-team-synonyms") || {}).value);
        var handles = splitCsv((el("edit-team-handles") || {}).value);
        var assocContainer = el("edit-team-assocs");
        var projects = assocContainer ? collectAssocRows(assocContainer) : (team.projects || []);
        team.displayName = name.trim();
        team.synonyms = synonyms.length ? synonyms : undefined;
        team.slackHandles = handles.length ? handles : undefined;
        team.projects = projects.length ? projects : undefined;
        state.selectedTeamId = null;
        saveRegistry("chore: update team " + id).catch(function(e) { setBanner(e.message, "error"); });
      });
    });
    wireGotoChips(container);
    wireAssocRows(container);
  }

  async function selectAnchor(name, options) {
    var opts = options || {};
    state.selectedName = name;
    state.pendingAnchor = null;
    if (!opts.skipLocationUpdate) {
      updateAnchorLocation(name);
    }
    renderAnchorList();
    showTab("detail");
    setBanner("Loading anchor detail...", "info");
    try {
      if (!state.projectMappings && !state.projectMappingsLoading) {
        await loadProjectMappings();
      }
      var detail = await api("/api/ui/anchor?name=" + encodeURIComponent(name));
      if (detail.anchor.ui.designHeader && detail.anchor.ui.designHeader.applies
          && (!detail.anchor.ui.designHeader.isAtTop
            || Object.keys(detail.anchor.ui.designHeader.sections).some(function (key) { return !detail.anchor.ui.designHeader.sections[key]; })
            || Object.keys(detail.anchor.ui.designHeader.introduction).some(function (key) { return !detail.anchor.ui.designHeader.introduction[key]; }))) {
        var migration = await apiPost("/api/ui/anchor-design-header", { name: name });
        if (migration.migrated) {
          detail = await api("/api/ui/anchor?name=" + encodeURIComponent(name));
        }
      }
      renderDetail(detail.anchor, { focusTask: opts.focusTask });
      setBanner("", "info");
    } catch (error) {
      setBanner(error.message, "error");
    }
  }

  function openPendingAnchor() {
    if (!state.pendingAnchor) {
      return;
    }
    var requested = state.pendingAnchor;
    var match = state.anchors.find(function (anchor) {
      return anchor.name === requested || anchor.path === requested;
    });
    if (!match) {
      return;
    }
    state.pendingAnchor = null;
    selectAnchor(match.name, { skipLocationUpdate: true });
  }

  function renderDetail(anchor, options) {
    var detailOpts = options || {};
    var readOnly = isServerRuleAnchor(anchor);
    state.selectedAnchor = anchor;
    state.anchorVersions = [];
    el("detail-empty").hidden = true;
    el("detail-content").hidden = false;
    setDetailReadOnlyState(readOnly);
    el("detail-title").textContent = anchor.ui.label;
    el("detail-path").textContent = anchor.name;
    el("detail-badges").innerHTML = healthBadge(anchor.ui.health)
      + (readOnly ? "<span class=\\"badge readonly\\">Read-only server rule</span>" : "")
      + "<span class=\\"badge\\">" + escapeHtml(anchor.frontmatter.type || "unknown type") + "</span>"
      + (priorityLabel(anchorPriority(anchor)) ? "<span class=\\"badge\\">" + escapeHtml(priorityLabel(anchorPriority(anchor))) + "</span>" : "");
    var designHeader = anchor.ui.designHeader || { applies: false, sections: {}, introduction: {} };
    var designBadges = designHeader.applies
      ? Object.keys(designHeader.sections).concat(Object.keys(designHeader.introduction)).map(function (section) {
          var ok = Object.prototype.hasOwnProperty.call(designHeader.sections, section)
            ? designHeader.sections[section]
            : designHeader.introduction[section];
          return "<span class=\\"badge " + (ok ? "ok" : "warn") + "\\">" + escapeHtml(section) + "</span>";
        }).join("")
      : "";
    el("section-status").innerHTML = designBadges + Object.keys(anchor.ui.sections).map(function (section) {
      var ok = anchor.ui.sections[section];
      return "<span class=\\"badge " + (ok ? "ok" : "block") + "\\">" + escapeHtml(section) + "</span>";
    }).join("");
    el("validation-status").innerHTML = renderIssues(anchor.ui.health);
    var organizationBox = el("current-state-organization-box");
    var organization = anchor.ui.currentStateOrganization || { applies: false };
    organizationBox.hidden = !organization.applies;
    el("current-state-organization").innerHTML = currentStateOrganizationHtml(organization);
    renderDetailTasks(anchor, detailOpts.focusTask);
    var body = markdownBody(anchor.content || "");
    el("detail-rendered").innerHTML = renderMarkdown(body, {
      claims: anchor.ui.claims || [],
      questions: anchor.ui.questions || [],
      mermaidBlocks: anchor.ui.mermaidBlocks || [],
      lineOffset: markdownBodyLineOffset(anchor.content || ""),
      claimControls: true,
      sectionAddControls: !readOnly,
      sectionDefinitions: anchor.ui.sectionDefinitions || {}
    });
    decorateAnchorLinks(el("detail-rendered"));
    wireSectionAddControls(el("detail-rendered"), anchor, readOnly);
    wireClaimEpistemologyControls(el("detail-rendered"), anchor, readOnly);
    wireMermaidBlockControls(el("detail-rendered"), anchor, readOnly);
    wireEditableBulletControls(el("detail-rendered"), anchor, readOnly);
    renderMermaidDiagrams(el("detail-rendered"));
    el("detail-raw").textContent = anchor.content || "";
    el("detail-frontmatter").textContent = JSON.stringify(anchor.frontmatter || {}, null, 2);
    el("priority-input").value = priorityLabel(anchorPriority(anchor)).replace(/^P/, "");
    el("rename-target").value = anchor.name;
    el("action-message").value = "";
    el("history-list").innerHTML = "";
    el("history-diff").textContent = readOnly
      ? "Load history to inspect diffs. Built-in server rules cannot be renamed, deleted, edited, or reverted."
      : "Load history to inspect diffs or revert.";
    resetNeighborsPanel();
    showDetailMode(state.detailMode);
  }

  function currentStateOrganizationHtml(organization) {
    if (!organization || !organization.applies) return "";
    var needsAttention = organization.status === "needs-attention";
    var label = needsAttention
      ? "Needs organization"
      : organization.status === "organized" ? "Topic-oriented" : "Concise";
    var html = "<span class=\\"badge " + (needsAttention ? "warn" : "ok") + "\\">" + escapeHtml(label) + "</span>";
    html += "<p class=\\"organization-summary\\">" + escapeHtml(String(organization.claimCount || 0)) + " claims";
    if (organization.ungroupedClaimCount) {
      html += " · " + escapeHtml(String(organization.ungroupedClaimCount)) + " ungrouped";
    }
    if (organization.historyClaimCount) {
      html += " · " + escapeHtml(String(organization.historyClaimCount)) + " release-history-style";
    }
    html += "</p>";

    var topics = Array.isArray(organization.topics) ? organization.topics : [];
    var paths = topics.map(function (topic) { return topic.path; });
    if (paths.length) {
      html += "<p class=\\"organization-note\\">Retrievable topic paths</p>";
    } else if (needsAttention) {
      paths = (organization.suggestedTopics || []).map(function (topic) { return "Current State > " + topic; });
      html += "<p class=\\"organization-note\\">Suggested topic paths for a substantial Current State</p>";
    } else {
      html += "<p class=\\"organization-note\\">This concise Current State does not need topic headings yet.</p>";
    }
    if (paths.length) {
      html += "<div class=\\"retrieval-paths\\">" + paths.map(function (path) {
        return "<code class=\\"retrieval-path\\">" + escapeHtml(path) + "</code>";
      }).join("") + "</div>";
    }
    if (needsAttention) {
      html += "<p class=\\"organization-note\\">Keep present behavior in Current State and chronological delivery history in PRs.</p>";
    }
    return html;
  }

  // ---------------------------------------------------------------------------
  // Graph neighbors panel (WP5): a navigable "what is connected and why" list
  // for the selected anchor, grouped by edge type, backed by
  // /api/ui/graph-neighbors. No graph drawing — deep links only.
  // ---------------------------------------------------------------------------

  function resetNeighborsPanel() {
    var body = safeEl("neighbors-body");
    if (body) {
      body.innerHTML = "Load neighbors to see this anchor's graph edges (claim provenance, derived_from / contradicts, links, structure).";
    }
    var button = safeEl("load-neighbors");
    if (button) {
      button.disabled = false;
    }
  }

  // Human-readable label for each edge type the graph produces (WP1-WP5).
  var NEIGHBOR_EDGE_LABELS = {
    anchor_project: "Project",
    milestone_anchor: "Milestone anchor",
    milestone_goal: "Milestone → goal",
    roadmap_goal: "Roadmap goals",
    milestone_task: "Tasks",
    task_owner: "Task owners",
    person_project: "People → project",
    team_project: "Teams → project",
    project_repo: "Project repos",
    repo_path: "Repo paths",
    anchor_anchor: "Linked anchors",
    claim_source: "Claim sources",
    claim_person: "Claim people",
    claim_section: "Claim sections",
    section_anchor: "Section anchors",
    derived_from: "Derived from",
    contradicts: "Contradicts"
  };

  function neighborEdgeLabel(type) {
    return NEIGHBOR_EDGE_LABELS[type] || String(type || "related");
  }

  // Turn a canonical node id into a UI deep link where one exists (anchor,
  // milestone, section, and claim nodes all resolve to an anchor page; other
  // node kinds have no first-party page yet and render as plain text).
  function neighborNodeHref(nodeId) {
    var raw = String(nodeId || "");
    if (raw.indexOf("anchor:") === 0) {
      return anchorHref(raw.slice("anchor:".length));
    }
    if (raw.indexOf("milestone:") === 0) {
      return anchorHref(raw.slice("milestone:".length));
    }
    if (raw.indexOf("section:") === 0) {
      var afterSection = raw.slice("section:".length);
      var sectionHash = afterSection.indexOf("#");
      return anchorHref(sectionHash === -1 ? afterSection : afterSection.slice(0, sectionHash));
    }
    if (raw.indexOf("claim:") === 0) {
      var afterClaim = raw.slice("claim:".length);
      var claimHash = afterClaim.indexOf("#");
      return anchorHref(claimHash === -1 ? afterClaim : afterClaim.slice(0, claimHash));
    }
    return null;
  }

  // The anchor name a node's deep link targets, so the click handler can route
  // through selectAnchor (SPA navigation) instead of a full page load.
  function neighborNodeAnchorName(nodeId) {
    var raw = String(nodeId || "");
    if (raw.indexOf("anchor:") === 0) return raw.slice("anchor:".length);
    if (raw.indexOf("milestone:") === 0) return raw.slice("milestone:".length);
    if (raw.indexOf("section:") === 0 || raw.indexOf("claim:") === 0) {
      var body = raw.slice(raw.indexOf(":") + 1);
      var hash = body.indexOf("#");
      return hash === -1 ? body : body.slice(0, hash);
    }
    return null;
  }

  function neighborNodeLabel(node, nodeId) {
    if (node && node.display) {
      return node.display;
    }
    if (node && node.claim && node.claim.text) {
      return node.claim.text;
    }
    return String(nodeId || "");
  }

  function nodeDepth(nodeById, nodeId) {
    var node = nodeById[nodeId];
    return node && typeof node.depth === "number" ? node.depth : -1;
  }

  // The endpoint of an edge to display: the one that is NOT the origin (depth 1
  // case), else whichever endpoint the traversal discovered farther from the
  // origin, so a row always points away from the anchor being inspected.
  function farEndpoint(edge, originId, nodeById) {
    if (edge.from === originId) return edge.to;
    if (edge.to === originId) return edge.from;
    return nodeDepth(nodeById, edge.to) >= nodeDepth(nodeById, edge.from) ? edge.to : edge.from;
  }

  // Pure view-model: build the grouped-by-edge-type neighbors HTML from a
  // /api/ui/graph-neighbors response. Exposed as a test hook.
  function neighborsPanelHtml(result) {
    if (result && result.candidates) {
      if (!result.candidates.length) {
        return "<p class=\\"neighbors-empty\\">No graph node matched this anchor.</p>";
      }
      return "<p class=\\"neighbors-empty\\">Ambiguous node; candidates: "
        + result.candidates.map(function (candidate) {
          return escapeHtml((candidate && (candidate.display || candidate.nodeId)) || "");
        }).join(", ")
        + "</p>";
    }
    var edges = (result && result.edges) || [];
    var nodes = (result && result.nodes) || [];
    if (!edges.length) {
      return "<p class=\\"neighbors-empty\\">No graph edges for this anchor.</p>";
    }
    var originId = result && result.resolvedNode ? result.resolvedNode.nodeId : "";
    var nodeById = {};
    for (var n = 0; n < nodes.length; n += 1) {
      if (nodes[n] && nodes[n].id) {
        nodeById[nodes[n].id] = nodes[n];
      }
    }

    // Group edges by type, preserving first-seen type order.
    var groupOrder = [];
    var groups = {};
    for (var e = 0; e < edges.length; e += 1) {
      var edge = edges[e];
      if (!edge || !edge.type) continue;
      if (!groups[edge.type]) {
        groups[edge.type] = [];
        groupOrder.push(edge.type);
      }
      // Show the endpoint FARTHER from the origin so every row links away from
      // the anchor being inspected. At depth 1 the origin is one endpoint; on
      // deeper hops neither endpoint is the origin, so fall back to the node
      // with the greater discovered depth (ties / unknowns pick the "to" side).
      groups[edge.type].push(farEndpoint(edge, originId, nodeById));
    }

    var html = "";
    for (var g = 0; g < groupOrder.length; g += 1) {
      var type = groupOrder[g];
      var targets = groups[type];
      var seen = {};
      var rows = "";
      for (var t = 0; t < targets.length; t += 1) {
        var targetNodeId = targets[t];
        if (seen[targetNodeId]) continue;
        seen[targetNodeId] = true;
        var node = nodeById[targetNodeId];
        var label = neighborNodeLabel(node, targetNodeId);
        var href = neighborNodeHref(targetNodeId);
        var anchorName = neighborNodeAnchorName(targetNodeId);
        if (href) {
          rows += "<li class=\\"neighbors-row\\"><a href=\\"" + escapeHtml(href) + "\\""
            + (anchorName ? " data-anchor-name=\\"" + escapeHtml(anchorName) + "\\"" : "")
            + ">" + escapeHtml(label) + "</a></li>";
        } else {
          rows += "<li class=\\"neighbors-row\\"><span>" + escapeHtml(label) + "</span></li>";
        }
      }
      html += "<div class=\\"neighbors-group\\"><h4 class=\\"neighbors-group-title\\">"
        + escapeHtml(neighborEdgeLabel(type)) + "</h4><ul class=\\"neighbors-list\\">" + rows + "</ul></div>";
    }
    return html;
  }

  async function loadAnchorNeighbors(anchorName) {
    var body = safeEl("neighbors-body");
    var button = safeEl("load-neighbors");
    if (!anchorName) {
      return;
    }
    if (body) {
      body.textContent = "Loading neighbors...";
    }
    if (button) {
      button.disabled = true;
    }
    try {
      var result = await api("/api/ui/graph-neighbors?node=" + encodeURIComponent(anchorName) + "&depth=1&limit=200");
      if (state.selectedName !== anchorName) {
        return;
      }
      if (body) {
        body.innerHTML = neighborsPanelHtml(result);
        decorateAnchorLinks(body);
      }
    } catch (error) {
      if (body) {
        body.textContent = error.message;
      }
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  // Render the milestone's structured tasks frontmatter as a readable block,
  // since markdownBody strips frontmatter and the rendered body would
  // otherwise show no task details. Highlights and scrolls to focusTaskId when
  // arriving from a task row's milestone link.
  function renderDetailTasks(anchor, focusTaskId) {
    var container = safeEl("detail-tasks");
    if (!container) {
      return;
    }
    var tasks = anchor && anchor.frontmatter && Array.isArray(anchor.frontmatter.tasks)
      ? anchor.frontmatter.tasks
      : [];
    if (tasks.length === 0) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }
    var today = todayIso();
    var rows = tasks.map(function (task) {
      var id = task && task.id ? String(task.id) : "";
      var isFocus = focusTaskId && id === String(focusTaskId);
      var badges = "";
      if (task && task.status) {
        badges += "<span class=\\"badge" + taskStatusBadgeClass(task, today) + "\\">" + escapeHtml(String(task.status)) + "</span>";
      }
      var owner = task && (task.owner || task.assignee);
      badges += "<span class=\\"badge\\">" + escapeHtml(owner ? String(owner) : "Unassigned") + "</span>";
      var taskPriorityValue = priorityLabel(taskPriority(task));
      if (taskPriorityValue) {
        badges += "<span class=\\"badge task-priority-badge\\" title=\\"Task priority\\">" + escapeHtml("Task " + taskPriorityValue) + "</span>";
      }
      if (task && task.due) {
        badges += "<span class=\\"badge\\">due " + escapeHtml(String(task.due))
          + (task.date_confidence ? " · " + escapeHtml(String(task.date_confidence)) : "") + "</span>";
      }
      if (task && task.completed_on) {
        badges += "<span class=\\"badge\\">completed " + escapeHtml(String(task.completed_on)) + "</span>";
      }
      var title = task && task.title ? String(task.title) : "(untitled task)";
      var editLink = "<a class=\\"detail-task-edit\\" href=\\"" + escapeHtml(tasksHref()) + "\\""
        + (id ? " data-task-id=\\"" + escapeHtml(id) + "\\"" : "")
        + " title=\\"Edit this task on the Tasks page\\">Edit in tasks →</a>";
      var stateClass = taskStateClass(task, today);
      var notes = task && task.notes ? String(task.notes) : "";
      return "<div class=\\"detail-task" + (stateClass ? " " + stateClass : "") + (isFocus ? " focus" : "") + "\\"" + (id ? " data-task-id=\\"" + escapeHtml(id) + "\\"" : "") + ">"
        + "<div class=\\"detail-task-title\\">" + escapeHtml(id ? id + " — " + title : title) + "</div>"
        + "<div class=\\"detail-task-meta\\">" + badges + editLink + "</div>"
        + (notes ? "<div class=\\"detail-task-notes\\">" + escapeHtml(notes) + "</div>" : "")
        + "</div>";
    }).join("");
    container.innerHTML = "<h3 class=\\"detail-tasks-heading\\">Tasks</h3>" + rows;
    container.hidden = false;
    container.querySelectorAll(".detail-task-edit").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (!shouldHandleClientNavigation(event, link)) {
          return;
        }
        event.preventDefault();
        openTasksForEditing(link.dataset.taskId);
      });
    });
    if (focusTaskId) {
      var focused = container.querySelector(".detail-task.focus");
      if (focused && focused.scrollIntoView) {
        focused.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function renderIssues(health) {
    if (!health || !health.issues || health.issues.length === 0) {
      return "<span class=\\"badge ok\\">No obvious validation issues</span>";
    }
    return "<div class=\\"issue-list\\">" + health.issues.map(function (issue) {
      var severity = issue.severity === "BLOCK" ? "block" : "warn";
      return "<div class=\\"issue " + severity + "\\"><strong>" + escapeHtml(issue.code) + "</strong>: " + escapeHtml(issue.message) + "</div>";
    }).join("") + "</div>";
  }

  function renderMarkdown(markdown, options) {
    var opts = options || {};
    var lines = String(markdown || "").split(/\\r?\\n/);
    var lineOffset = opts.lineOffset || 0;
    var claimsByLine = {};
    var questionsByLine = {};
    var mermaidByLine = {};
    var sourceLines = {};
    (opts.claims || []).forEach(function (claim) {
      claimsByLine[claim.line] = claim;
      claimSources(claim).forEach(function (source) {
        if (source.line && !source.inline) {
          sourceLines[source.line] = true;
        }
      });
      (claim.sourceErrors || []).forEach(function (entry) {
        if (entry.line && !entry.inline) {
          sourceLines[entry.line] = true;
        }
      });
    });
    (opts.questions || []).forEach(function (question) {
      questionsByLine[question.line] = question;
    });
    (opts.mermaidBlocks || []).forEach(function (block) {
      mermaidByLine[block.line] = block;
      claimSources(block).forEach(function (source) {
        if (source.line && !source.inline) {
          sourceLines[source.line] = true;
        }
      });
      (block.sourceErrors || []).forEach(function (entry) {
        if (entry.line && !entry.inline) {
          sourceLines[entry.line] = true;
        }
      });
    });
    var html = "";
    var paragraph = [];
    var inList = false;
    var inCode = false;
    var codeFence = null;
    var code = [];
    var codeLanguage = "";
    var codeStartLine = 0;
    var currentSection = "";

    function flushParagraph() {
      if (paragraph.length) {
        html += "<p>" + inlineMarkdown(paragraph.join(" ")) + "</p>";
        paragraph = [];
      }
    }
    function closeList() {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    }
    function flushCode() {
      if (code.length || inCode) {
        var codeText = code.join("\\n");
        if (codeLanguage === "mermaid") {
          html += renderMermaidBlock(codeText, mermaidByLine[codeStartLine], opts);
        } else {
          html += "<pre><code>" + escapeHtml(codeText) + "</code></pre>";
        }
        code = [];
        codeLanguage = "";
        codeStartLine = 0;
      }
    }

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var originalLine = lineOffset + index + 1;
      if (opts.claimControls && sourceLines[originalLine]) {
        continue;
      }
      var fence = markdownFence(line);
      if (fence && (!inCode || markdownFenceCloses(line, codeFence))) {
        if (inCode) {
          flushCode();
          inCode = false;
          codeFence = null;
        } else {
          flushParagraph();
          closeList();
          inCode = true;
          codeFence = fence;
          codeLanguage = firstFenceLanguage(fence.info);
          codeStartLine = originalLine;
        }
        continue;
      }
      if (inCode) {
        code.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      if (isTableStart(lines, index, opts, sourceLines, lineOffset)) {
        flushParagraph();
        closeList();
        var table = renderMarkdownTable(lines, index);
        html += table.html;
        index = table.nextIndex - 1;
        continue;
      }
      var heading = line.match(/^(#{1,4})\\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        var level = heading[1].length;
        var headingTitle = stripClosingHeadingHashes(heading[2]);
        if (level === 1) {
          currentSection = "";
        } else if (level === 2) {
          currentSection = headingTitle;
        }
        var definitionInfo = level === 2 || level === 3
          ? sectionDefinitionInfo(headingTitle, opts.sectionDefinitions || {})
          : "";
        var addControl = definitionInfo && opts.sectionAddControls
          ? sectionAddButton(headingTitle)
          : "";
        var emptyDefinedClass = definitionInfo && !markdownHeadingHasContent(lines, index, level)
          ? " class=\\"defined-heading-empty\\""
          : "";
        html += "<h" + level + emptyDefinedClass + ">" + inlineMarkdown(heading[2]) + definitionInfo + addControl + "</h" + level + ">";
        continue;
      }
      var bullet = line.match(/^([-*])\\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        var claim = opts.claimControls ? claimsByLine[originalLine] : null;
        var question = opts.claimControls ? questionsByLine[originalLine] : null;
        var renderedBullet = inlineMarkdown(bullet[2]);
        if (claim) {
          renderedBullet = renderClaimInline(claim);
        } else if (question) {
          renderedBullet = renderEditableBulletInline({
            line: originalLine,
            kind: "question",
            text: question.text || "",
            label: "Edit question text",
            displayHtml: renderedBullet
          });
        } else if (opts.claimControls && bullet[1] === "-" && isEditableRenderedBulletSection(currentSection)) {
          renderedBullet = renderEditableBulletInline({
            line: originalLine,
            kind: "bullet",
            text: bullet[2],
            label: "Edit bullet text",
            displayHtml: renderedBullet
          });
        }
        html += "<li>" + renderedBullet + "</li>";
        continue;
      }
      paragraph.push(line.trim());
    }
    flushParagraph();
    closeList();
    if (inCode) {
      flushCode();
    }
    return html;
  }

  function sectionDefinitionInfo(section, definitions) {
    var definition = definitions && definitions[section];
    if (!definition) return "";
    return "<span class=\\"section-info-icon\\" tabindex=\\"0\\" role=\\"img\\" aria-label=\\"About "
      + escapeHtml(section) + ": " + escapeHtml(definition) + "\\">i"
      + "<span class=\\"section-info-tooltip\\" role=\\"tooltip\\">" + escapeHtml(definition) + "</span></span>";
  }

  function sectionAddButton(section) {
    var label = "Add content to " + section;
    return "<button type=\\"button\\" class=\\"section-add-button\\" data-section-heading=\\""
      + escapeHtml(section) + "\\" aria-label=\\"" + escapeHtml(label) + "\\" title=\\"" + escapeHtml(label) + "\\">+</button>";
  }

  function markdownHeadingHasContent(lines, headingIndex, headingLevel) {
    for (var index = headingIndex + 1; index < lines.length; index += 1) {
      var line = String(lines[index] || "");
      if (!line.trim()) continue;
      var nextHeading = line.match(/^(#{1,4})\\s+(.+)$/);
      if (!nextHeading) return true;
      return nextHeading[1].length > headingLevel;
    }
    return false;
  }

  function renderMermaidBlock(codeText, block, opts) {
    if (!opts.claimControls || !block) {
      return "<div class=\\"mermaid\\">" + escapeHtml(codeText) + "</div>";
    }
    var strength = claimStrengthValue(block);
    var count = claimSources(block).length;
    var title = count ? count + " source" + (count === 1 ? "" : "s") + ", " + strength + " strength" : "No provenance sources";
    return "<div class=\\"mermaid-block\\" data-mermaid-line=\\"" + escapeHtml(String(block.line)) + "\\">"
      + "<div class=\\"mermaid-block-toolbar\\">"
      + "<button type=\\"button\\" class=\\"claim-epistemology-button mermaid-source-button claim-strength-" + escapeHtml(strength) + "\\" data-mermaid-line=\\"" + escapeHtml(String(block.line)) + "\\" title=\\"" + escapeHtml(title) + "\\" aria-label=\\"Edit diagram sources\\">"
      + "<svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-object-graph\\"></use></svg>"
      + "</button>"
      + "<button type=\\"button\\" class=\\"mermaid-text-edit-button\\" data-mermaid-line=\\"" + escapeHtml(String(block.line)) + "\\" title=\\"Edit Mermaid diagram\\" aria-label=\\"Edit Mermaid diagram\\">"
      + "<svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-pencil\\"></use></svg>"
      + "</button>"
      + "</div>"
      + "<div class=\\"mermaid\\">" + escapeHtml(codeText) + "</div>"
      + "</div>";
  }

  function firstFenceLanguage(info) {
    var first = String(info || "").trim().split(/\\s+/)[0] || "";
    return first.toLowerCase();
  }

  function markdownFence(line) {
    var tick = String.fromCharCode(96);
    var match = new RegExp("^(\\\\s*)((?:" + tick + "{3,})|(?:~{3,}))(.*)$").exec(String(line || ""));
    if (!match) {
      return null;
    }
    return { char: match[2].charAt(0), len: match[2].length, info: match[3] || "" };
  }

  function markdownFenceCloses(line, fence) {
    if (!fence) {
      return false;
    }
    var pattern = fence.char === String.fromCharCode(96) ? String.fromCharCode(96) : "~";
    return new RegExp("^\\\\s*" + pattern + "{" + fence.len + ",}\\\\s*$").test(String(line || ""));
  }

  function stripClosingHeadingHashes(text) {
    return String(text || "").replace(/\\s+#+\\s*$/, "").trim();
  }

  function isEditableRenderedBulletSection(section) {
    var normalized = String(section || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized === "tl-dr" || normalized === "tldr";
  }

  function isTableStart(lines, index, opts, sourceLines, lineOffset) {
    var current = lines[index] || "";
    var next = lines[index + 1] || "";
    if (!looksLikeTableRow(current) || !isTableSeparator(next)) {
      return false;
    }
    var nextLine = lineOffset + index + 2;
    return !(opts.claimControls && sourceLines[nextLine]);
  }

  function renderMarkdownTable(lines, startIndex) {
    var headers = splitTableRow(lines[startIndex]);
    var alignments = tableAlignments(lines[startIndex + 1], headers.length);
    var rows = [];
    var index = startIndex + 2;
    while (index < lines.length && looksLikeTableRow(lines[index]) && !isTableSeparator(lines[index])) {
      rows.push(splitTableRow(lines[index]));
      index += 1;
    }
    var html = "<div class=\\"markdown-table-scroll\\"><table><thead><tr>"
      + headers.map(function (cell, cellIndex) {
        return "<th" + tableAlignAttribute(alignments[cellIndex]) + ">" + inlineMarkdown(cell) + "</th>";
      }).join("")
      + "</tr></thead><tbody>"
      + rows.map(function (row) {
        return "<tr>" + headers.map(function (_header, cellIndex) {
          return "<td" + tableAlignAttribute(alignments[cellIndex]) + ">" + inlineMarkdown(row[cellIndex] || "") + "</td>";
        }).join("") + "</tr>";
      }).join("")
      + "</tbody></table></div>";
    return { html: html, nextIndex: index };
  }

  function looksLikeTableRow(line) {
    var trimmed = String(line || "").trim();
    return trimmed.indexOf("|") >= 0 && splitTableRow(trimmed).length > 1;
  }

  function isTableSeparator(line) {
    var cells = splitTableRow(line);
    return cells.length > 1 && cells.every(function (cell) {
      return /^:?-{3,}:?$/.test(cell.replace(/\\s+/g, ""));
    });
  }

  function tableAlignments(separatorLine, count) {
    var cells = splitTableRow(separatorLine);
    var alignments = [];
    for (var index = 0; index < count; index += 1) {
      var cell = (cells[index] || "").replace(/\\s+/g, "");
      alignments.push(cell.charAt(0) === ":" && cell.charAt(cell.length - 1) === ":"
        ? "center"
        : cell.charAt(cell.length - 1) === ":"
          ? "right"
          : "");
    }
    return alignments;
  }

  function tableAlignAttribute(alignment) {
    return alignment ? " style=\\"text-align: " + alignment + "\\"" : "";
  }

  function splitTableRow(line) {
    var tick = String.fromCharCode(96);
    var text = String(line || "").trim();
    if (text.charAt(0) === "|") {
      text = text.slice(1);
    }
    if (text.charAt(text.length - 1) === "|" && text.charAt(text.length - 2) !== "\\\\") {
      text = text.slice(0, -1);
    }
    var cells = [];
    var cell = "";
    var inCode = false;
    for (var index = 0; index < text.length; index += 1) {
      var char = text.charAt(index);
      if (char === tick) {
        inCode = !inCode;
        cell += char;
        continue;
      }
      if (char === "\\\\" && text.charAt(index + 1) === "|") {
        cell += "|";
        index += 1;
        continue;
      }
      if (char === "|" && !inCode) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
      cell += char;
    }
    cells.push(cell.trim());
    return cells;
  }

  function loadMermaidRuntime() {
    var runtime = window.mermaid && (window.mermaid.default || window.mermaid);
    if (runtime) {
      return Promise.resolve(runtime);
    }
    if (!mermaidRuntimePromise) {
      mermaidRuntimePromise = import("/ui/vendor/mermaid/mermaid.esm.min.mjs").then(function (module) {
        var loaded = module.default || module;
        window.mermaid = loaded;
        return loaded;
      }).catch(function (error) {
        mermaidRuntimePromise = null;
        throw error;
      });
    }
    return mermaidRuntimePromise;
  }

  function renderMermaidDiagrams(container) {
    if (!container || !container.querySelectorAll) {
      return Promise.resolve();
    }
    var blocks = Array.prototype.slice.call(container.querySelectorAll(".mermaid"));
    if (!blocks.length) {
      return Promise.resolve();
    }
    return loadMermaidRuntime().then(function (mermaid) {
      if (!mermaidInitialized && mermaid.initialize) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "default"
        });
        mermaidInitialized = true;
      }
      if (mermaid.run) {
        return mermaid.run({ nodes: blocks, suppressErrors: true });
      }
      if (mermaid.init) {
        return mermaid.init(undefined, blocks);
      }
      markMermaidUnavailable(blocks);
      return undefined;
    }).catch(function () {
      markMermaidUnavailable(blocks);
    });
  }

  function markMermaidUnavailable(blocks) {
    blocks.forEach(function (block) {
      if (block.classList) {
        block.classList.add("mermaid-unavailable");
      }
      block.title = "Mermaid rendering unavailable";
    });
  }

  function markdownBody(markdown) {
    var text = String(markdown || "");
    if (text.slice(0, 4) !== "---\\n") {
      return text;
    }
    var end = text.indexOf("\\n---", 4);
    if (end < 0) {
      return text;
    }
    var after = text.indexOf("\\n", end + 4);
    return after < 0 ? "" : text.slice(after + 1);
  }

  function markdownBodyLineOffset(markdown) {
    var text = String(markdown || "");
    if (text.slice(0, 4) !== "---\\n") {
      return 0;
    }
    var end = text.indexOf("\\n---", 4);
    if (end < 0) {
      return 0;
    }
    var after = text.indexOf("\\n", end + 4);
    if (after < 0) {
      return text.split(/\\r?\\n/).length;
    }
    return text.slice(0, after + 1).split(/\\r?\\n/).length - 1;
  }

  function claimSources(claim) {
    if (claim && Array.isArray(claim.sources)) {
      return claim.sources;
    }
    return claim && claim.annotation ? [claim.annotation] : [];
  }

  function claimStrengthValue(claim) {
    if (claim && (claim.strength === "high" || claim.strength === "medium" || claim.strength === "low")) {
      return claim.strength;
    }
    var sources = claimSources(claim);
    if (!sources.length) {
      return "low";
    }
    var total = sources.reduce(function (sum, source) {
      return sum + (source.conf === "high" ? 3 : source.conf === "medium" ? 2 : 1);
    }, 0);
    var average = total / sources.length;
    return average < 1.5 ? "low" : average < 2.5 ? "medium" : "high";
  }

  // WP6 (effective certainty): claims returned by listClaims / the /api/ui/claims
  // and /api/ui/anchor routes carry a computed effectiveCertainty.certainty
  // (base(conf) x decay x liveness, averaged across source rows) alongside the
  // stated strength. Null for unannotated/malformed claims, which have no
  // evidence to score.
  function claimCertaintyValue(claim) {
    if (!claim || !claim.effectiveCertainty || typeof claim.effectiveCertainty.certainty !== "number") {
      return null;
    }
    return claim.effectiveCertainty.certainty;
  }

  // Ascending-certainty sort — the re-verification queue: least-trustworthy
  // scored claims first, with unscored (null) claims sorted last. Mirrors
  // sortTasksForDisplay's style: a
  // .slice().sort() that never mutates the input, primary key first, then a
  // deterministic tiebreak so repeated sorts of the same data are stable.
  function sortClaimsByCertainty(claims) {
    return (claims || []).slice().sort(function (left, right) {
      var leftScore = claimCertaintyValue(left);
      var rightScore = claimCertaintyValue(right);
      if (leftScore === null && rightScore === null) {
        return claimStableSortLabel(left).localeCompare(claimStableSortLabel(right));
      }
      if (leftScore === null) {
        return 1;
      }
      if (rightScore === null) {
        return -1;
      }
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return claimStableSortLabel(left).localeCompare(claimStableSortLabel(right));
    });
  }

  function claimStableSortLabel(claim) {
    return ((claim && claim.anchor) || "") + "#" + ((claim && claim.line) || 0);
  }

  function renderClaimInline(claim) {
    var strength = claimStrengthValue(claim);
    var count = claimSources(claim).length;
    var title = count ? count + " source" + (count === 1 ? "" : "s") + ", " + strength + " strength" : "No provenance sources";
    return "<span class=\\"claim-inline\\">"
      + "<span class=\\"claim-epistemology\\">"
      + "<button type=\\"button\\" class=\\"claim-epistemology-button claim-strength-" + escapeHtml(strength) + "\\" data-claim-line=\\"" + escapeHtml(String(claim.line)) + "\\" title=\\"" + escapeHtml(title) + "\\" aria-label=\\"Edit claim sources\\">"
      + "<svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-object-graph\\"></use></svg>"
      + "</button>"
      + renderClaimPopover(claim)
      + "</span>"
      + "<button type=\\"button\\" class=\\"claim-text-edit-button\\" data-claim-line=\\"" + escapeHtml(String(claim.line)) + "\\" title=\\"Edit claim text\\" aria-label=\\"Edit claim text\\">"
      + "<svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-pencil\\"></use></svg>"
      + "</button>"
      + "<span class=\\"claim-inline-text\\">" + inlineMarkdown(claim.text || "") + "</span>"
      + "</span>";
  }

  function renderEditableBulletInline(bullet) {
    return "<span class=\\"editable-bullet-inline\\">"
      + "<button type=\\"button\\" class=\\"bullet-text-edit-button\\" data-bullet-line=\\"" + escapeHtml(String(bullet.line)) + "\\" data-bullet-kind=\\"" + escapeHtml(bullet.kind) + "\\" data-bullet-text=\\"" + escapeHtml(bullet.text || "") + "\\" title=\\"" + escapeHtml(bullet.label) + "\\" aria-label=\\"" + escapeHtml(bullet.label) + "\\">"
      + "<svg class=\\"icon\\" aria-hidden=\\"true\\"><use href=\\"#icon-pencil\\"></use></svg>"
      + "</button>"
      + "<span class=\\"editable-bullet-inline-text\\">" + bullet.displayHtml + "</span>"
      + "</span>";
  }

  function renderClaimPopover(claim) {
    var sources = claimSources(claim);
    var strength = claimStrengthValue(claim);
    var certainty = claimCertaintyValue(claim);
    var certaintyMeta = certainty === null ? "" : " · effective certainty " + certainty.toFixed(2);
    if (!sources.length) {
      return "<span class=\\"claim-popover\\" role=\\"tooltip\\"><span class=\\"claim-popover-title\\">No provenance sources</span><span class=\\"claim-popover-meta\\">Claim justification strength: " + escapeHtml(strength) + "</span></span>";
    }
    return "<span class=\\"claim-popover\\" role=\\"tooltip\\">"
      + "<span class=\\"claim-popover-title\\">Claim justification strength: " + escapeHtml(strength) + escapeHtml(certaintyMeta) + "</span>"
      + sources.map(function (source) {
        return "<span class=\\"claim-popover-row\\">"
          + renderSourceLabel(source)
          + "<span class=\\"claim-popover-meta\\">Last checked " + escapeHtml(source.observed || "unknown") + " · " + escapeHtml(source.conf || "unknown") + "</span>"
          + "</span>";
      }).join("")
      + "</span>";
  }

  function renderSourceLabel(source) {
    var label = escapeHtml(claimSourceDisplayLabel(source));
    var href = source.href ? sanitizeLinkHref(source.href) : null;
    if (!href) {
      return "<span>" + label + "</span>";
    }
    var anchor = sourceHrefAnchorName(href);
    if (anchor) {
      return "<a href=\\"" + escapeHtml(anchorHref(anchor)) + "\\" data-anchor-name=\\"" + escapeHtml(anchor) + "\\">" + label + "</a>";
    }
    return "<a href=\\"" + escapeHtml(href) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + label + "</a>";
  }

  function claimSourceDisplayLabel(source) {
    var type = claimSourceTypeById(claimSourceKind(source));
    if (type.requiresPerson) {
      return type.label + ": " + (source.personName || source.person || "(unknown person)");
    }
    var label = source.src || "(missing source)";
    return type.id === "source" ? label : type.label + ": " + label;
  }

  function sourceHrefAnchorName(href) {
    try {
      var parsed = new URL(href, window.location.href);
      if (parsed.origin !== window.location.origin || parsed.pathname !== "/ui") {
        return null;
      }
      return parsed.searchParams.get("anchor");
    } catch (_error) {
      return null;
    }
  }

  function inlineMarkdown(value) {
    var tick = String.fromCharCode(96);
    return linkifyTextReferences(linkifyRepoFileReferences(escapeHtml(value)
      .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
      .replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), function (_match, code) {
        var linked = repoFileReferenceLink(code);
        return linked || "<code>" + code + "</code>";
      })
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function (_match, label, href) {
        var safeHref = sanitizeLinkHref(href);
        if (!safeHref) {
          return "<span class=\\"unsafe-link\\" title=\\"Unsafe link removed\\">" + label + "</span>";
        }
        return "<a href=\\"" + escapeHtml(safeHref) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + label + "</a>";
      })));
  }

  // Link recognizable references only in text nodes so user-authored Markdown
  // links and inline-code spans never get nested or rewritten.
  function linkifyTextReferences(html) {
    var insideAnchor = false;
    var insideCode = false;
    return String(html || "").split(/(<[^>]+>)/).map(function (part) {
      if (part.charAt(0) === "<") {
        if (/^<a(?:\\s|>)/i.test(part)) insideAnchor = true;
        if (/^<\\/a\\s*>/i.test(part)) insideAnchor = false;
        if (/^<code(?:\\s|>)/i.test(part)) insideCode = true;
        if (/^<\\/code\\s*>/i.test(part)) insideCode = false;
        return part;
      }
      return insideAnchor || insideCode ? part : linkifyReferenceText(part);
    }).join("");
  }

  function linkifyReferenceText(text) {
    return String(text || "").split(/(https?:\\/\\/[^\\s<]+)/gi).map(function (part, index) {
      return index % 2 === 1 ? linkifyBareUrl(part) : linkifyNonUrlReferences(part);
    }).join("");
  }

  function linkifyNonUrlReferences(text) {
    return String(text || "")
      .replace(/(Google Doc\\s+&quot;.+?&quot;\\s+\\(doc id\\s+)([A-Za-z0-9_-]+)(\\))/gi, function (_match, prefix, docId, suffix) {
        return externalReferenceAnchor(googleDocHref(docId), prefix + docId) + suffix;
      })
      .replace(/(Confluence\\s+)([A-Za-z0-9_-]+)\\/pages\\/(\\d+)/gi, function (match, prefix, space, pageId) {
        var href = externalTemplateHref("confluencePage", { space: space, pageId: pageId });
        return href ? prefix + externalReferenceAnchor(href, space + "/pages/" + pageId) : match;
      })
      .replace(/\\bPR\\s+#(\\d+)\\b/gi, function (match, number) {
        var href = mappedPullRequestHref(Number(number));
        return href ? externalReferenceAnchor(href, match) : match;
      })
      .replace(/(^|[^A-Za-z0-9_])#([A-Za-z][A-Za-z0-9_-]*)\\b/g, function (match, prefix, channel) {
        var href = externalTemplateHref("slackChannel", { channel: channel });
        return href ? prefix + externalReferenceAnchor(href, "#" + channel) : match;
      });
  }

  function linkifyBareUrl(encodedUrl) {
    var trailing = encodedUrl.match(/[.,;:!?]+$/);
    var label = trailing ? encodedUrl.slice(0, -trailing[0].length) : encodedUrl;
    var href = decodeHtmlEntities(label);
    return externalReferenceAnchor(sanitizeLinkHref(href), label) + (trailing ? trailing[0] : "");
  }

  function decodeHtmlEntities(value) {
    return String(value || "").replace(/&amp;/gi, "&");
  }

  function externalReferenceAnchor(href, label) {
    return href ? "<a href=\\\"" + escapeHtml(href) + "\\\" target=\\\"_blank\\\" rel=\\\"noreferrer\\\">" + label + "</a>" : label;
  }

  function googleDocHref(docId) {
    return "https://docs.google.com/document/d/" + encodeURIComponent(docId) + "/edit";
  }

  function externalTemplateHref(templateName, values) {
    var templates = state.projectMappings && state.projectMappings.externalLinkTemplates;
    var template = templates && templates[templateName];
    if (!template && templateName === "slackChannel") {
      template = "https://slack.com/app_redirect?channel={channel}";
    }
    if (!template) return null;
    var href = String(template).replace(/\\{(space|pageId|channel)\\}/g, function (_match, key) {
      return encodeURIComponent(values[key] || "");
    });
    return sanitizeLinkHref(href);
  }

  function mappedPullRequestHref(number) {
    var project = projectOf(state.selectedAnchor);
    if (!project || !state.projectMappings || !Array.isArray(state.projectMappings.projects)) return null;
    var mapping = state.projectMappings.projects.find(function (entry) {
      return entry && String(entry.project || "").toLowerCase() === String(project).toLowerCase();
    });
    var repo = mapping && selectMappedWebRepo(mapping.repos || []);
    if (!repo || !repo.web || !repo.web.url || !Number.isFinite(number) || number <= 0) return null;
    var base = String(repo.web.url).trim().replace(/\\/+$/, "");
    var template = String(repo.web.pullRequestTemplate || "{url}/pull/{number}").trim();
    return sanitizeLinkHref(template.replace(/\\{url\\}/g, base).replace(/\\{number\\}/g, String(Math.floor(number))));
  }

  function repoFileReferenceLink(label) {
    var match = /^((?:\\.\\/)?(?:[A-Za-z0-9_.-]+\\/)+[A-Za-z0-9_.-]+\\.[A-Za-z0-9_.-]+):(\\d+)(?:-(\\d+))?$/.exec(String(label || ""));
    if (!match) {
      return null;
    }
    var href = repoFileReferenceHref(match[1], match[2], match[3]);
    if (!href) {
      return null;
    }
    return "<a href=\\"" + escapeHtml(href) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\"><code>" + escapeHtml(label) + "</code></a>";
  }

  function linkifyRepoFileReferences(html) {
    if (!state.projectMappings || !state.selectedAnchor) {
      return html;
    }
    return String(html || "").replace(/(^|[\\s(])((?:\\.\\/)?(?:[A-Za-z0-9_.-]+\\/)+[A-Za-z0-9_.-]+\\.[A-Za-z0-9_.-]+):(\\d+)(?:-(\\d+))?(?=([\\s).,;:]|$))/g, function (match, prefix, path, start, end) {
      var href = repoFileReferenceHref(path, start, end);
      if (!href) {
        return match;
      }
      var label = path + ":" + start + (end ? "-" + end : "");
      return prefix + "<a href=\\"" + escapeHtml(href) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + escapeHtml(label) + "</a>";
    });
  }

  function repoFileReferenceHref(path, start, end) {
    var project = projectOf(state.selectedAnchor);
    if (!project || !state.projectMappings || !Array.isArray(state.projectMappings.projects)) {
      return null;
    }
    var mapping = state.projectMappings.projects.find(function (entry) {
      return entry && String(entry.project || "").toLowerCase() === String(project).toLowerCase();
    });
    if (!mapping || !Array.isArray(mapping.repos)) {
      return null;
    }
    var repo = selectMappedWebRepo(mapping.repos, path);
    if (!repo) {
      return null;
    }
    return repoFileUrl(repo, path, Number(start), end ? Number(end) : undefined);
  }

  function selectMappedWebRepo(repos, filePath) {
    var webRepos = repos.filter(function (repo) {
      return repo && repo.web && repo.web.url;
    });
    if (!webRepos.length) {
      return null;
    }
    var pathMatches = webRepos.filter(function (repo) {
      return Array.isArray(repo.paths) && repo.paths.length > 0 && repo.paths.some(function (dirPath) {
        return isWithinPath(filePath, dirPath);
      });
    });
    if (pathMatches.length === 1) {
      return pathMatches[0];
    }
    return webRepos.length === 1 ? webRepos[0] : null;
  }

  function repoFileUrl(repo, filePath, startLine, endLine) {
    var web = repo && repo.web;
    if (!web || !web.url) {
      return null;
    }
    var cleanPath = String(filePath || "").trim().replace(/^\\.\\/+/, "").replace(/^\\/+/, "");
    if (!cleanPath) {
      return null;
    }
    var base = String(web.url || "").trim().replace(/\\/+$/, "");
    var branch = String(web.branch || "main").trim() || "main";
    var template = String(web.fileTemplate || "{url}/blob/{branch}/{path}").trim();
    var url = template
      .replace(/\\{url\\}/g, base)
      .replace(/\\{branch\\}/g, encodeRefOrPath(branch))
      .replace(/\\{path\\}/g, encodeRefOrPath(cleanPath));
    if (Number.isFinite(startLine) && startLine > 0) {
      url += "#L" + Math.floor(startLine);
      if (Number.isFinite(endLine) && endLine > startLine) {
        url += "-L" + Math.floor(endLine);
      }
    }
    return url;
  }

  function encodeRefOrPath(value) {
    return String(value || "").split("/").map(function (segment) {
      return encodeURIComponent(segment);
    }).join("/");
  }

  function isWithinPath(filePath, dirPath) {
    var file = normalizePathForMatch(filePath);
    var dir = normalizePathForMatch(dirPath);
    return !!dir && (file === dir || file.indexOf(dir + "/") === 0);
  }

  function normalizePathForMatch(value) {
    return String(value || "").trim().replace(/^\\.\\/+/, "").replace(/^\\/+/, "").replace(/\\/+$/, "").toLowerCase();
  }

  function sanitizeLinkHref(href) {
    var value = String(href || "").trim();
    if (!value || value.indexOf("//") === 0) {
      return null;
    }
    if (
      value.indexOf('"') >= 0
      || value.indexOf("'") >= 0
      || value.indexOf("<") >= 0
      || value.indexOf(">") >= 0
      || value.indexOf(String.fromCharCode(96)) >= 0
      || /&(quot|#34|#39|lt|gt|#x27|#x60);/i.test(value)
    ) {
      return null;
    }
    var schemeProbe = value.replace(/[\\u0000-\\u001f\\u007f\\s]+/g, "");
    var scheme = schemeProbe.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
    if (!scheme) {
      return value;
    }
    var protocol = scheme[1].toLowerCase();
    return protocol === "http" || protocol === "https" || protocol === "mailto" ? value : null;
  }

  function decorateAnchorLinks(container) {
    container.querySelectorAll("a[href]").forEach(function (link) {
      var anchorName = resolveAnchorHref(link.getAttribute("href") || "");
      if (!anchorName) {
        return;
      }
      link.dataset.anchorName = anchorName;
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.setAttribute("href", anchorHref(anchorName));
      link.setAttribute("title", "Open anchor detail");
    });
  }

  function shouldHandleClientNavigation(event, link) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }
    if (typeof event.button === "number" && event.button !== 0) {
      return false;
    }
    var target = (link.getAttribute("target") || "").toLowerCase();
    return !target || target === "_self";
  }

  function resolveAnchorHref(href) {
    if (!href || href.charAt(0) === "#") {
      return null;
    }

    var raw = href;
    try {
      var parsed = new URL(href, window.location.href);
      if (parsed.origin !== window.location.origin) {
        return null;
      }
      raw = parsed.pathname;
    } catch (_error) {
      raw = href;
    }

    raw = raw.split("#", 1)[0].split("?", 1)[0];
    try {
      raw = decodeURIComponent(raw);
    } catch (_error) {
      // Keep the original value if it was not valid URI-encoded text.
    }
    raw = raw.replace(/^\\/+/, "").replace(/^\\.\\//, "");

    var match = state.anchors.find(function (anchor) {
      return anchor.name === raw || anchor.path === raw;
    });
    return match ? match.name : null;
  }

  function debounce(fn, delay) {
    var handle;
    return function () {
      clearTimeout(handle);
      handle = setTimeout(fn, delay);
    };
  }

  function handleLocationAnchorChange() {
    applyUrlStateToControls();
    if (state.activeTab === "planner") {
      showPlanner({ skipLocationUpdate: true });
    } else if (state.activeTab === "tasks") {
      showTasksView({ skipLocationUpdate: true });
    } else if (state.activeTab === "coverage") {
      showCoverageView({ skipLocationUpdate: true });
    } else if (state.activeTab === "people") {
      showPeopleView({ skipLocationUpdate: true });
    } else if (state.activeTab === "teams") {
      showTeamsView({ skipLocationUpdate: true });
    } else if (state.activeTab === "review") {
      showReview({ skipLocationUpdate: true });
    } else if (state.activeTab === "detail" && state.pendingAnchor) {
      var requestedAnchor = state.pendingAnchor;
      state.pendingAnchor = null;
      selectAnchor(requestedAnchor, { skipLocationUpdate: true }).catch(function (error) {
        setBanner(error.message, "error");
      });
    } else {
      showRoot({ skipLocationUpdate: true });
    }
    load().catch(function (error) { setBanner(error.message, "error"); });
  }

  function bind() {
    el("token-input").value = token();
    el("token-form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveToken(el("token-input").value);
      load().catch(function (error) { setBanner(error.message, "error"); });
    });
    ["project-filter", "category-filter", "tag-filter", "archive-filter"].forEach(function (id) {
      el(id).addEventListener("change", function () {
        updateLocationFromState({ history: "push" });
        load().catch(function (error) { setBanner(error.message, "error"); });
      });
    });
    el("anchor-group-sort").addEventListener("change", function () {
      state.anchorGroupSort = validAnchorGroupSort(el("anchor-group-sort").value);
      el("anchor-group-sort").value = state.anchorGroupSort;
      updateLocationFromState({ history: "push" });
      reloadAnchorsOnly().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("planner-form").addEventListener("submit", function (event) {
      event.preventDefault();
      runPlanner().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("planner-task").addEventListener("paste", handlePlannerTaskPaste);
    el("copy-load-context").addEventListener("click", function () {
      copyLoadContext().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("copy-judge-prompt").addEventListener("click", function () {
      copyJudgePrompt().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("load-proposals").addEventListener("click", function () {
      loadProposals().catch(function (error) { setBanner(error.message, "error"); });
    });
    ["proposal-project", "proposal-status-filter"].forEach(function (id) {
      el(id).addEventListener("change", function () {
        updateLocationFromState({ anchor: null, view: "review", history: "push" });
        loadProposals().catch(function (error) { setBanner(error.message, "error"); });
      });
    });
    el("claim-source-close").addEventListener("click", closeClaimSourceModal);
    el("claim-source-cancel").addEventListener("click", closeClaimSourceModal);
    el("claim-source-add").addEventListener("click", addClaimSourceRow);
    el("claim-source-save").addEventListener("click", function () {
      saveClaimSourcesFromModal().catch(function (error) { el("claim-source-result").textContent = error.message; });
    });
    el("claim-new-person-save").addEventListener("click", function () {
      saveClaimPersonFromModal().catch(function (error) { el("claim-source-result").textContent = error.message; });
    });
    el("claim-new-person-name").addEventListener("input", function () {
      if (!el("claim-new-person-id").value.trim()) {
        el("claim-new-person-id").value = slugifyPersonId(el("claim-new-person-name").value);
      }
    });
    el("claim-source-modal").addEventListener("click", function (event) {
      if (event.target === el("claim-source-modal")) {
        closeClaimSourceModal();
      }
    });
    document.addEventListener("click", function (event) {
      if (!state.claimTextEditor && !state.bulletTextEditor && !state.sectionAddEditor) return;
      var target = event.target;
      if (target && target.closest && (
        target.closest(".claim-text-editor")
        || target.closest(".claim-text-edit-button")
        || target.closest(".bullet-text-edit-button")
        || target.closest(".section-add-editor")
        || target.closest(".section-add-button")
      )) {
        return;
      }
      if (state.claimTextEditor) closeClaimTextEditor();
      if (state.bulletTextEditor) closeBulletTextEditor();
      if (state.sectionAddEditor) closeSectionAddEditor();
    });
    window.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (state.claimSourceModal) closeClaimSourceModal();
        if (state.claimTextEditor) closeClaimTextEditor();
        if (state.bulletTextEditor) closeBulletTextEditor();
        if (state.sectionAddEditor) closeSectionAddEditor();
      }
    });
    el("tasks-refresh").addEventListener("click", function () {
      state.tasks = [];
      loadTasks().catch(function (error) { setBanner(error.message, "error"); });
    });
    ["tasks-project-filter", "tasks-status-filter"].forEach(function (id) {
      el(id).addEventListener("change", function () {
        updateLocationFromState({ anchor: null, view: "tasks", history: "push" });
        state.tasks = [];
        loadTasks().catch(function (error) { setBanner(error.message, "error"); });
      });
    });
    ["tasks-completed-days", "tasks-due-days", "tasks-project-priority-max", "tasks-task-priority-max", "tasks-modified-after"].forEach(function (id) {
      el(id).addEventListener("input", debounce(function () {
        updateLocationFromState({ anchor: null, view: "tasks", history: "replace" });
        state.tasks = [];
        loadTasks().catch(function (error) { setBanner(error.message, "error"); });
      }, 180));
    });
    ["tasks-group-by", "tasks-sort"].forEach(function (id) {
      el(id).addEventListener("change", function () {
        state.tasksGroupBy = validTasksGroupBy(controlValue("tasks-group-by", state.tasksGroupBy));
        state.tasksSort = validTasksSort(controlValue("tasks-sort", state.tasksSort));
        updateLocationFromState({ anchor: null, view: "tasks", history: "push" });
        renderTasks();
      });
    });
    el("tasks-no-due").addEventListener("change", function () {
      updateLocationFromState({ anchor: null, view: "tasks", history: "push" });
      state.tasks = [];
      loadTasks().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("tasks-unassigned").addEventListener("change", function () {
      updateLocationFromState({ anchor: null, view: "tasks", history: "push" });
      state.tasks = [];
      loadTasks().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("tasks-add").addEventListener("click", function () {
      var form = el("tasks-add-form");
      form.hidden = !form.hidden;
      if (!form.hidden) {
        var proj = controlValue("tasks-project-filter", state.tasksProject);
        if (proj && !el("new-task-project").value) { el("new-task-project").value = proj; }
        el("new-task-title").focus();
      }
    });
    el("new-task-cancel").addEventListener("click", function () {
      el("tasks-add-form").hidden = true;
      el("new-task-result").textContent = "";
    });
    wireTaskOwnerInput(el("new-task-owner"));
    el("new-task-save").addEventListener("click", function () {
      saveNewTask().catch(function (error) { el("new-task-result").textContent = error.message; });
    });
    el("proposal-list").addEventListener("click", function (event) {
      var card = event.target.closest("[data-proposal-id]");
      if (!card) {
        return;
      }
      selectProposal(card.dataset.proposalId).catch(function (error) { setBanner(error.message, "error"); });
    });
    el("apply-proposal").addEventListener("click", function () {
      applyActiveProposal().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("request-proposal-changes").addEventListener("click", function () {
      reviewActiveProposal("changes_requested").catch(function (error) { setBanner(error.message, "error"); });
    });
    el("reject-proposal").addEventListener("click", function () {
      reviewActiveProposal("rejected").catch(function (error) { setBanner(error.message, "error"); });
    });
    el("priority-form").addEventListener("submit", function (event) {
      event.preventDefault();
      updateProjectPriorityFromDetail().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("priority-input").addEventListener("input", function () {
      sanitizeProjectPriorityInput();
    });
    el("load-history").addEventListener("click", function () {
      loadAnchorHistory().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("load-neighbors").addEventListener("click", function () {
      loadAnchorNeighbors(state.selectedName).catch(function (error) { setBanner(error.message, "error"); });
    });
    el("history-list").addEventListener("click", function (event) {
      var diff = event.target.closest("[data-diff-index]");
      if (diff) {
        diffHistoryIndex(Number(diff.dataset.diffIndex)).catch(function (error) { setBanner(error.message, "error"); });
        return;
      }
      var revert = event.target.closest("[data-revert-version]");
      if (revert) {
        revertAnchorVersion(revert.dataset.revertVersion).catch(function (error) { setBanner(error.message, "error"); });
      }
    });
    el("rename-anchor").addEventListener("click", function () {
      renameSelectedAnchor().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("delete-anchor").addEventListener("click", function () {
      deleteSelectedAnchor().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("search-input").addEventListener("input", debounce(function () {
      updateLocationFromState({ history: "replace" });
      renderAnchorList();
    }, 120));
    el("anchor-list").addEventListener("click", function (event) {
      var row = event.target.closest("[data-name]");
      if (row && shouldHandleClientNavigation(event, row)) {
        event.preventDefault();
        selectAnchor(row.dataset.name);
      }
    });
    el("content-area").addEventListener("click", function (event) {
      var link = event.target.closest("a[data-anchor-name]");
      if (!link || !shouldHandleClientNavigation(event, link)) {
        return;
      }
      event.preventDefault();
      selectAnchor(link.dataset.anchorName);
    });
    document.querySelectorAll(".tab").forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.dataset.tab === "root") {
          showRoot();
          return;
        }
        if (button.dataset.tab === "detail") {
          showSelectedAnchor();
          return;
        }
        if (button.dataset.tab === "planner") {
          showPlanner();
          return;
        }
        if (button.dataset.tab === "tasks") {
          showTasksView();
          return;
        }
        if (button.dataset.tab === "traces") {
          showTracesView();
          return;
        }
        if (button.dataset.tab === "coverage") {
          showCoverageView();
          return;
        }
        if (button.dataset.tab === "people") {
          showPeopleView();
          return;
        }
        if (button.dataset.tab === "teams") {
          showTeamsView();
          return;
        }
        if (button.dataset.tab === "mappings") {
          showMappingsView();
          return;
        }
        if (button.dataset.tab === "review") {
          showReview();
          return;
        }
        showTab(button.dataset.tab);
      });
    });
    document.querySelectorAll("[data-root-mode]").forEach(function (button) {
      button.addEventListener("click", function () { showRootMode(button.dataset.rootMode); });
    });
    document.querySelectorAll("[data-detail-mode]").forEach(function (button) {
      button.addEventListener("click", function () { showDetailMode(button.dataset.detailMode); });
    });
    ["planner-task", "planner-runtime", "planner-budget", "planner-max-anchors", "planner-max-excluded"].forEach(function (id) {
      el(id).addEventListener("input", debounce(function () {
        updateLocationFromState({ view: "planner", history: "replace" });
      }, 160));
    });
    ["planner-project", "planner-category", "planner-tag", "planner-archive"].forEach(function (id) {
      el(id).addEventListener("change", function () {
        updateLocationFromState({ view: "planner", history: "replace" });
      });
    });
    el("people-add").addEventListener("click", function () {
      var form = el("people-add-form");
      form.hidden = !form.hidden;
      if (!form.hidden) { el("new-person-id").focus(); }
    });
    el("people-refresh").addEventListener("click", function () {
      state.registry = null;
      loadRegistry().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("traces-refresh").addEventListener("click", function () {
      if (state.tracesMode === "dry") {
        state.dryQueries = null;
        loadDryQueries();
      } else {
        state.traces = null;
        loadTraces();
      }
    });
    el("traces-show-timeline").addEventListener("click", function () { showTracesMode("timeline"); });
    el("traces-show-dry").addEventListener("click", function () { showTracesMode("dry"); });
    el("traces-dry-thin").addEventListener("change", function () {
      state.dryQueriesThinNoFollowUp = el("traces-dry-thin").checked;
      state.dryQueries = null;
      loadDryQueries();
    });
    el("coverage-refresh").addEventListener("click", function () {
      state.coverage = null;
      state.coverageRecords = [];
      state.coverageNextCursor = null;
      loadCoverage();
    });
    el("coverage-project-filter").addEventListener("change", function () {
      // Reload from the server (like the state-card filter) rather than just
      // re-rendering: project scoping affects claim records too (a claim has
      // no projectSlug of its own -- only its owning anchor does -- so a
      // client-side-only project filter would silently drop every claim row)
      // and keeps "Load more" paging within the same project scope.
      state.coverageProject = controlValue("coverage-project-filter", state.coverageProject);
      updateLocationFromState({ anchor: null, view: "coverage", history: "push" });
      state.coverage = null;
      state.coverageRecords = [];
      state.coverageNextCursor = null;
      loadCoverage();
    });
    el("coverage-text-filter").addEventListener("input", debounce(function () {
      state.coverageText = controlValue("coverage-text-filter", state.coverageText);
      updateLocationFromState({ anchor: null, view: "coverage", history: "replace" });
      renderCoverage();
    }, 150));
    el("coverage-clear-filters").addEventListener("click", function () {
      state.coverageProject = "";
      state.coverageStates = [];
      state.coverageText = "";
      setControlValue("coverage-project-filter", "");
      setControlValue("coverage-text-filter", "");
      updateLocationFromState({ anchor: null, view: "coverage", history: "push" });
      state.coverage = null;
      state.coverageRecords = [];
      state.coverageNextCursor = null;
      loadCoverage();
    });
    el("coverage-load-more").addEventListener("click", function () {
      loadMoreCoverage().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("mappings-save").addEventListener("click", function () { saveProjectMappings(); });
    el("mappings-refresh").addEventListener("click", function () {
      state.projectMappings = null;
      loadProjectMappings().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("claim-source-type-add").addEventListener("click", addClaimSourceType);
    el("claim-source-types-list").addEventListener("click", function (event) {
      var target = event.target;
      if (target && target.classList && target.classList.contains("claim-source-type-remove")) {
        removeClaimSourceType(Number(target.getAttribute("data-source-type-index")));
      }
    });
    el("mappings-list").addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.classList) { return; }
      if (target.classList.contains("mapping-clear")) {
        clearMapping(Number(target.getAttribute("data-pi")));
      } else if (target.classList.contains("mapping-remove-orphan")) {
        removeOrphanMapping(Number(target.getAttribute("data-pi")));
      } else if (target.classList.contains("mapping-add-repo")) {
        addMappingRepo(Number(target.getAttribute("data-pi")));
      } else if (target.classList.contains("mapping-remove-repo")) {
        removeMappingRepo(Number(target.getAttribute("data-pi")), Number(target.getAttribute("data-ri")));
      }
    });
    el("people-search").addEventListener("input", function () {
      state.peopleSearch = el("people-search").value || "";
      renderPeople();
    });
    el("new-person-cancel").addEventListener("click", function () {
      el("people-add-form").hidden = true;
      el("new-person-result").textContent = "";
    });
    wireTeamCsvInput(el("new-person-teams"));
    el("new-person-save").addEventListener("click", function () {
      var id = (el("new-person-id").value || "").trim();
      var name = (el("new-person-name").value || "").trim();
      if (!id) { el("new-person-result").textContent = "ID is required."; return; }
      if (!name) { el("new-person-result").textContent = "Display name is required."; return; }
      if (!state.registry) state.registry = { people: [], teams: [] };
      if (state.registry.people.some(function (p) { return p.id === id; })) {
        el("new-person-result").textContent = "A person with that ID already exists.";
        return;
      }
      var slack = (el("new-person-slack").value || "").trim();
      var confluence = (el("new-person-confluence").value || "").trim();
      var emails = splitCsv(el("new-person-emails").value);
      var names = splitCsv(el("new-person-names").value);
      var teams = resolveTeamIdsFromCsv(el("new-person-teams").value);
      var identities = {};
      if (slack) identities.slack = slack;
      if (confluence) identities.confluence = confluence;
      if (emails.length) identities.emails = emails;
      if (names.length) identities.names = names;
      var person = { id: id, displayName: name };
      if (Object.keys(identities).length) person.identities = identities;
      if (teams.length) person.teams = teams;
      state.registry.people.push(person);
      el("people-add-form").hidden = true;
      ["new-person-id", "new-person-name", "new-person-slack", "new-person-confluence", "new-person-emails", "new-person-names", "new-person-teams"].forEach(function (id) { el(id).value = ""; });
      el("new-person-result").textContent = "";
      saveRegistry("chore: add person " + id).catch(function (error) { setBanner(error.message, "error"); });
    });

    el("teams-add").addEventListener("click", function () {
      var form = el("teams-add-form");
      form.hidden = !form.hidden;
      if (!form.hidden) { el("new-team-id").focus(); }
    });
    el("teams-refresh").addEventListener("click", function () {
      state.registry = null;
      loadRegistry().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("teams-search").addEventListener("input", function () {
      state.teamsSearch = el("teams-search").value || "";
      renderTeams();
    });
    el("new-team-cancel").addEventListener("click", function () {
      el("teams-add-form").hidden = true;
      el("new-team-result").textContent = "";
    });
    el("new-team-save").addEventListener("click", function () {
      var id = (el("new-team-id").value || "").trim();
      var name = (el("new-team-name").value || "").trim();
      if (!id) { el("new-team-result").textContent = "ID is required."; return; }
      if (!name) { el("new-team-result").textContent = "Display name is required."; return; }
      if (!state.registry) state.registry = { people: [], teams: [] };
      if (state.registry.teams.some(function (t) { return t.id === id; })) {
        el("new-team-result").textContent = "A team with that ID already exists.";
        return;
      }
      var synonyms = splitCsv(el("new-team-synonyms").value);
      var handles = splitCsv(el("new-team-handles").value);
      var team = { id: id, displayName: name };
      if (synonyms.length) team.synonyms = synonyms;
      if (handles.length) team.slackHandles = handles;
      state.registry.teams.push(team);
      el("teams-add-form").hidden = true;
      ["new-team-id", "new-team-name", "new-team-synonyms", "new-team-handles"].forEach(function (id) { el(id).value = ""; });
      el("new-team-result").textContent = "";
      saveRegistry("chore: add team " + id).catch(function (error) { setBanner(error.message, "error"); });
    });

    window.addEventListener("popstate", handleLocationAnchorChange);
    window.addEventListener("hashchange", handleLocationAnchorChange);
  }

  if (window.__ANCHOR_MCP_UI_TEST_HOOKS__) {
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.claimSources = claimSources;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.claimStrengthValue = claimStrengthValue;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.claimCertaintyValue = claimCertaintyValue;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.sortClaimsByCertainty = sortClaimsByCertainty;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderClaimInline = renderClaimInline;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderClaimPopover = renderClaimPopover;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.claimSourceRowHtml = claimSourceRowHtml;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.neighborsPanelHtml = neighborsPanelHtml;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderMarkdown = renderMarkdown;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderMermaidDiagrams = renderMermaidDiagrams;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.sanitizeLinkHref = sanitizeLinkHref;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.anchorHref = anchorHref;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.readAnchorFromLocation = readAnchorFromLocation;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.clearAnchorLocation = clearAnchorLocation;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.showSelectedAnchor = showSelectedAnchor;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.setSelectedNameForTest = function (name) { state.selectedName = name; };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.token = token;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.saveToken = saveToken;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderAnchorGroup = renderAnchorGroup;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderAnchorRow = renderAnchorRow;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.currentStateOrganizationHtml = currentStateOrganizationHtml;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.sortAnchorGroups = sortAnchorGroups;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.priorityLabel = priorityLabel;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.projectOf = projectOf;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.initialLoadErrorMessage = initialLoadErrorMessage;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.isServerRuleAnchor = isServerRuleAnchor;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.readOnlyDetailControlIds = function () {
      return READ_ONLY_DETAIL_CONTROL_IDS.slice();
    };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.setAnchorGroupSortForTest = function (value) {
      state.anchorGroupSort = validAnchorGroupSort(value);
    };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderPlannerItem = renderPlannerItem;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.comparePlannerRuns = comparePlannerRuns;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.proposalListWithUpdatedProposal = proposalListWithUpdatedProposal;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.sortTasksForDisplay = sortTasksForDisplay;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskGroupsForDisplay = taskGroupsForDisplay;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskGroupPriority = taskGroupPriority;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskProjectPriority = taskProjectPriority;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskPriority = taskPriority;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskReportRanges = taskReportRanges;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskStateClass = taskStateClass;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderTaskRow = renderTaskRow;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.rememberTaskOwnerMatches = rememberTaskOwnerMatches;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskOwnerCachedMatches = taskOwnerCachedMatches;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.taskOwnerAssignmentValue = taskOwnerAssignmentValue;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.peopleForDisplay = peopleForDisplay;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.teamsForDisplay = teamsForDisplay;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.projectSuggestionOptions = projectSuggestionOptions;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.milestoneSuggestionOptions = milestoneSuggestionOptions;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.teamSuggestionOptions = teamSuggestionOptions;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.resolveTeamIdsFromCsv = resolveTeamIdsFromCsv;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.setTypeaheadStateForTest = function (nextState) {
      state.anchors = nextState.anchors || [];
      state.tasks = nextState.tasks || [];
      state.registry = nextState.registry || null;
    };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.setTasksDisplayForTest = function (groupBy, sortMode) {
      state.tasksGroupBy = validTasksGroupBy(groupBy);
      state.tasksSort = validTasksSort(sortMode);
    };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.shouldHandleClientNavigation = shouldHandleClientNavigation;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.parsePlannerLogPaste = parsePlannerLogPaste;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.queryFromPlannerInput = queryFromPlannerInput;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderProjectResolution = renderProjectResolution;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.formatPlannerStatus = formatPlannerStatus;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.mappingCardHtml = mappingCardHtml;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.mappingsForDisplay = mappingsForDisplay;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.setMappingsTestState = function (anchors, projectMappings) {
      state.anchors = anchors || [];
      state.projectMappings = projectMappings || null;
      state.selectedAnchor = state.anchors[0] || null;
    };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.buildJudgePrompt = buildJudgePrompt;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.formatPreview = formatPreview;
    return;
  }

  applyUrlStateToControls();
  bind();
  showRootMode(state.rootMode);
  showDetailMode(state.detailMode);
  if (state.activeTab === "people") {
    showPeopleView({ skipLocationUpdate: true });
  } else if (state.activeTab === "teams") {
    showTeamsView({ skipLocationUpdate: true });
  } else if (state.activeTab === "mappings") {
    showMappingsView({ skipLocationUpdate: true });
  } else {
    showTab(state.activeTab);
  }
  load().catch(function (error) {
    setBanner(initialLoadErrorMessage(error), error && (error.status === 401 || error.status === 403) ? "warn" : "error");
  });
})();`;
