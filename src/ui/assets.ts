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
                    <option value="updated">Last update</option>
                    <option value="name">Project name</option>
                    <option value="priority">Priority</option>
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
            <button class="tab" data-tab="review" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-save"></use></svg><span>Review</span></span></button>
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
                </div>
                <div class="segmented">
                  <button class="mode active" data-detail-mode="rendered" type="button">Rendered</button>
                  <button class="mode" data-detail-mode="raw" type="button">Raw</button>
                  <button class="mode" data-detail-mode="frontmatter" type="button">Front Matter</button>
                </div>
              </div>
              <section class="detail-grid">
                <div class="metadata-box">
                  <h3>Required Sections</h3>
                  <div id="section-status" class="section-status"></div>
                </div>
                <div class="metadata-box">
                  <h3>Validation</h3>
                  <div id="validation-status"></div>
                </div>
                <div class="metadata-box">
                  <h3>Project Priority</h3>
                  <form id="priority-form" class="stack-form">
                    <label>
                      Priority
                      <input id="priority-input" type="number" step="any" placeholder="1.1">
                    </label>
                    <div class="action-row">
                      <button id="update-priority" type="submit">Update</button>
                      <button id="clear-priority" type="button">Clear</button>
                    </div>
                  </form>
                  <pre id="priority-result" class="compact-raw">Set a numeric priority such as 1, 1.1, or 2.045.</pre>
                </div>
              </section>
              <section class="editor-grid">
                <div class="metadata-box">
                  <h3>Edit Composer</h3>
                  <form id="edit-form" class="stack-form">
                    <label>
                      Operation
                      <select id="edit-operation">
                        <option value="section.replace">Replace section</option>
                        <option value="section.append">Append to section</option>
                        <option value="frontmatter.merge">Merge front matter</option>
                      </select>
                    </label>
                    <label>
                      Heading
                      <select id="edit-heading">
                        <option value="Current State">Current State</option>
                        <option value="Decisions">Decisions</option>
                        <option value="Constraints">Constraints</option>
                        <option value="PRs">PRs</option>
                      </select>
                    </label>
                    <label>
                      Summary
                      <input id="edit-summary" type="text" placeholder="Short review summary">
                    </label>
                    <label>
                      Content or front matter JSON
                      <textarea id="edit-content" rows="7" placeholder="- New anchor fact, or { &quot;summary&quot;: &quot;...&quot; }"></textarea>
                    </label>
                    <div class="form-grid">
                      <label>
                        Commit message
                        <input id="edit-message" type="text" placeholder="optional">
                      </label>
                      <label>
                        last_validated
                        <input id="edit-last-validated" type="date">
                      </label>
                    </div>
                    <label class="checkbox-row">
                      <input id="edit-approved" type="checkbox">
                      Explicit approval for gated changes
                    </label>
                    <div class="action-row">
                      <button id="stage-proposal" type="button">Stage Proposal</button>
                      <button id="commit-direct" type="submit">Commit Directly</button>
                    </div>
                  </form>
                  <pre id="edit-result" class="compact-raw">Compose an edit to preview proposal or commit results.</pre>
                </div>
                <div class="metadata-box">
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
                </div>
              </section>
              <article id="detail-rendered" class="markdown"></article>
              <pre id="detail-raw" class="raw-view" hidden></pre>
              <pre id="detail-frontmatter" class="raw-view" hidden></pre>
            </div>
          </section>
        </section>
      </main>
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

.editor-grid {
  display: grid;
  grid-template-columns: minmax(360px, 1.1fr) minmax(320px, 0.9fr);
  gap: 12px;
  margin-bottom: 14px;
}

.metadata-box {
  padding: 14px;
}

.metadata-box h3 {
  margin: 0 0 10px;
  font-size: 14px;
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
  .editor-grid,
  .planner-controls,
  .planner-summary,
  .planner-grid,
  .form-grid,
  .proposal-filters {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
`;

export const UI_JS = `(function () {
  var DEFAULT_ANCHOR_SORT = "updated";
  var ANCHOR_BATCH_SIZE = 50;
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
    "proposal"
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
    anchorGroupSort: DEFAULT_ANCHOR_SORT
  };

  var categories = ["", "server-rules", "agent-rules", "projects", "invariants", "conflicts", "shared", "archive"];
  var tokenStorageKey = "anchor-mcp-token";

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
    return value === "root" || value === "planner" || value === "review" || value === "detail" ? value : null;
  }

  function validRootMode(value) {
    return value === "raw" || value === "rendered" ? value : "rendered";
  }

  function validDetailMode(value) {
    return value === "raw" || value === "frontmatter" || value === "rendered" ? value : "rendered";
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
      throw new Error(response.status + " " + response.statusText + ": " + text);
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
      throw new Error(response.status + " " + response.statusText + ": " + text);
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

  function currentPlannerInput() {
    return {
      task: el("planner-task").value.trim(),
      project: el("planner-project").value,
      category: el("planner-category").value,
      tag: el("planner-tag").value,
      runtime: el("planner-runtime").value.trim(),
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
    ["project", "category", "tag", "runtime", "budgetTokens", "maxAnchors", "maxExcluded"].forEach(function (key) {
      if (input[key]) {
        params.set(key, input[key]);
      }
    });
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
    projects = uniqueSorted(projects.concat([currentProject, currentPlannerProject]));
    tags = uniqueSorted(tags.concat([currentTag, currentPlannerTag]));
    projectSelect.innerHTML = optionList(projects, "All projects");
    tagSelect.innerHTML = optionList(tags, "All tags");
    categorySelect.innerHTML = optionList(categories.slice(1), "All categories");
    plannerProjectSelect.innerHTML = optionList(projects, "All projects");
    plannerTagSelect.innerHTML = optionList(tags, "All tags");
    plannerCategorySelect.innerHTML = optionList(categories.slice(1), "All categories");
    projectSelect.value = currentProject && projects.includes(currentProject) ? currentProject : "";
    tagSelect.value = currentTag && tags.includes(currentTag) ? currentTag : "";
    categorySelect.value = categories.includes(currentCategory) ? currentCategory : "";
    plannerProjectSelect.value = currentPlannerProject && projects.includes(currentPlannerProject) ? currentPlannerProject : "";
    plannerTagSelect.value = currentPlannerTag && tags.includes(currentPlannerTag) ? currentPlannerTag : "";
    plannerCategorySelect.value = categories.includes(currentPlannerCategory) ? currentPlannerCategory : "";
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
    return status;
  }

  function renderPlanner(plan, previous) {
    el("planner-empty").hidden = true;
    el("planner-results").hidden = false;
    el("planner-status").textContent = formatPlannerStatus(plan);
    el("planner-summary").innerHTML = [
      renderMetric(plan.included.length, "included"),
      renderMetric(plan.excluded.length, "excluded shown"),
      renderMetric(plan.estimatedTokens + " / " + plan.budgetTokens, "estimated tokens"),
      renderMetric(plan.missingContext.length, "missing signals")
    ].join("");
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
    await loadProposals();
    if (state.selectedName) {
      await selectAnchor(state.selectedName, { skipLocationUpdate: true });
    }
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
    await loadProposals();
  }

  function scopeForAnchor(anchor) {
    if (!anchor) {
      throw new Error("Select an anchor before staging a proposal.");
    }
    if (anchor.name.indexOf("agent-rules/") === 0) {
      return { kind: "agent-rules" };
    }
    var project = projectOf(anchor);
    if (project) {
      return { kind: "project", project: project };
    }
    throw new Error("Proposals are currently supported for project and agent-rule anchors.");
  }

  function parseFrontmatterUpdates() {
    try {
      var parsed = JSON.parse(el("edit-content").value || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Front matter updates must be a JSON object.");
      }
      return parsed;
    } catch (error) {
      throw new Error("Front matter updates must be valid JSON. " + error.message);
    }
  }

  function editOperation() {
    var type = el("edit-operation").value;
    if (type === "frontmatter.merge") {
      return { type: type, updates: parseFrontmatterUpdates() };
    }
    var operation = {
      type: type,
      heading: el("edit-heading").value,
      content: el("edit-content").value
    };
    var lastValidated = el("edit-last-validated").value;
    if (lastValidated) {
      operation.lastValidated = lastValidated;
    }
    return operation;
  }

  async function stageProposalFromComposer() {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      throw new Error("Select an anchor before staging a proposal.");
    }
    var operation = editOperation();
    var summary = el("edit-summary").value.trim() || (operation.type + " " + anchor.name);
    var result = await apiPost("/api/ui/propose-change", {
      scope: scopeForAnchor(anchor),
      target: anchor.name,
      summary: summary,
      operations: [operation],
      message: el("edit-message").value.trim() || undefined
    });
    el("edit-result").textContent = formatWriteResult(result);
    await loadProposals();
    if (result.proposal && result.proposal.id) {
      await selectProposal(result.proposal.id);
    }
  }

  async function commitDirectFromComposer() {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      throw new Error("Select an anchor before committing.");
    }
    var operation = editOperation();
    var common = {
      name: anchor.name,
      message: el("edit-message").value.trim() || undefined,
      approved: el("edit-approved").checked,
      expectedFileCommit: anchor.fileCommit
    };
    var result;
    if (operation.type === "frontmatter.merge") {
      result = await apiPost("/api/ui/anchor-frontmatter", Object.assign({}, common, { updates: operation.updates }));
    } else if (operation.type === "section.append") {
      result = await apiPost("/api/ui/anchor-append", Object.assign({}, common, {
        heading: operation.heading,
        content: operation.content,
        lastValidated: operation.lastValidated
      }));
    } else {
      result = await apiPost("/api/ui/anchor-section", Object.assign({}, common, {
        heading: operation.heading,
        content: operation.content,
        lastValidated: operation.lastValidated
      }));
    }
    el("edit-result").textContent = formatWriteResult(result);
    if (result.version) {
      await load();
      await selectAnchor(anchor.name, { skipLocationUpdate: true });
    }
  }

  function formatWriteResult(result) {
    return JSON.stringify(result, null, 2);
  }

  async function updateProjectPriorityFromDetail(clear) {
    var anchor = state.selectedAnchor;
    if (!anchor) {
      throw new Error("Select a project anchor before updating priority.");
    }
    var project = projectOf(anchor);
    if (!project) {
      throw new Error("Selected anchor is not associated with a project.");
    }
    var priority = null;
    if (!clear) {
      var raw = el("priority-input").value.trim();
      if (!raw) {
        throw new Error("Enter a priority number, or use Clear.");
      }
      priority = Number(raw);
      if (!Number.isFinite(priority)) {
        throw new Error("Priority must be a finite number.");
      }
    }
    var label = clear ? "clear this project priority" : "set this project priority to P" + String(priority);
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
    el("priority-result").textContent = formatWriteResult(result);
    if (result.version) {
      await load();
      await selectAnchor(anchor.name, { skipLocationUpdate: true });
    }
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
    if (!state.anchorVersions.length) {
      list.innerHTML = "<div class=\\"empty-state\\">No versions returned.</div>";
      return;
    }
    list.innerHTML = state.anchorVersions.map(function (version, index) {
      var previous = state.anchorVersions[index + 1];
      var diffButton = previous
        ? "<button type=\\"button\\" data-diff-index=\\"" + index + "\\">Diff previous</button>"
        : "";
      return "<div class=\\"planner-card\\">"
        + "<div class=\\"planner-card-title\\"><span>" + escapeHtml(version.message || version.version) + "</span><span class=\\"badge\\">" + escapeHtml(version.date || "") + "</span></div>"
        + "<p>" + escapeHtml(version.version) + "</p>"
        + "<p>" + escapeHtml(version.author || "") + "</p>"
        + "<div class=\\"action-row\\">" + diffButton + "<button type=\\"button\\" data-revert-version=\\"" + escapeHtml(version.version) + "\\">Revert</button></div>"
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
    if (!anchor || !window.confirm("Revert " + anchor.name + " to " + version + " as a new commit?")) {
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
      var detail = await api("/api/ui/anchor?name=" + encodeURIComponent(name));
      renderDetail(detail.anchor);
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

  function renderDetail(anchor) {
    state.selectedAnchor = anchor;
    state.anchorVersions = [];
    el("detail-empty").hidden = true;
    el("detail-content").hidden = false;
    el("detail-title").textContent = anchor.ui.label;
    el("detail-path").textContent = anchor.name;
    el("detail-badges").innerHTML = healthBadge(anchor.ui.health)
      + "<span class=\\"badge\\">" + escapeHtml(anchor.frontmatter.type || "unknown type") + "</span>"
      + (priorityLabel(anchorPriority(anchor)) ? "<span class=\\"badge\\">" + escapeHtml(priorityLabel(anchorPriority(anchor))) + "</span>" : "");
    el("section-status").innerHTML = Object.keys(anchor.ui.sections).map(function (section) {
      var ok = anchor.ui.sections[section];
      return "<span class=\\"badge " + (ok ? "ok" : "block") + "\\">" + escapeHtml(section) + "</span>";
    }).join("");
    el("validation-status").innerHTML = renderIssues(anchor.ui.health);
    el("detail-rendered").innerHTML = renderMarkdown(markdownBody(anchor.content || ""));
    decorateAnchorLinks(el("detail-rendered"));
    el("detail-raw").textContent = anchor.content || "";
    el("detail-frontmatter").textContent = JSON.stringify(anchor.frontmatter || {}, null, 2);
    el("edit-summary").value = "";
    el("edit-content").value = "";
    el("edit-message").value = "";
    el("edit-approved").checked = false;
    el("priority-input").value = priorityLabel(anchorPriority(anchor)).replace(/^P/, "");
    el("rename-target").value = anchor.name;
    el("action-message").value = "";
    el("priority-result").textContent = projectOf(anchor)
      ? "Set a numeric priority such as 1, 1.1, or 2.045."
      : "Priority is only available for project anchors.";
    el("edit-result").textContent = "Compose an edit to preview proposal or commit results.";
    el("history-list").innerHTML = "";
    el("history-diff").textContent = "Load history to inspect diffs or revert.";
    showDetailMode(state.detailMode);
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

  function renderMarkdown(markdown) {
    var fence = String.fromCharCode(96, 96, 96);
    var lines = String(markdown || "").split(/\\r?\\n/);
    var html = "";
    var paragraph = [];
    var inList = false;
    var inCode = false;
    var code = [];

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
        html += "<pre><code>" + escapeHtml(code.join("\\n")) + "</code></pre>";
        code = [];
      }
    }

    lines.forEach(function (line) {
      if (line.slice(0, 3) === fence) {
        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          flushParagraph();
          closeList();
          inCode = true;
        }
        return;
      }
      if (inCode) {
        code.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        return;
      }
      var heading = line.match(/^(#{1,4})\\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        var level = heading[1].length;
        html += "<h" + level + ">" + inlineMarkdown(heading[2]) + "</h" + level + ">";
        return;
      }
      var bullet = line.match(/^[-*]\\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += "<li>" + inlineMarkdown(bullet[1]) + "</li>";
        return;
      }
      paragraph.push(line.trim());
    });
    flushParagraph();
    closeList();
    if (inCode) {
      flushCode();
    }
    return html;
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

  function inlineMarkdown(value) {
    var tick = String.fromCharCode(96);
    return escapeHtml(value)
      .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
      .replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), "<code>$1</code>")
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function (_match, label, href) {
        var safeHref = sanitizeLinkHref(href);
        if (!safeHref) {
          return "<span class=\\"unsafe-link\\" title=\\"Unsafe link removed\\">" + label + "</span>";
        }
        return "<a href=\\"" + safeHref + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + label + "</a>";
      });
  }

  function sanitizeLinkHref(href) {
    var value = String(href || "").trim();
    if (!value || value.indexOf("//") === 0) {
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
    el("stage-proposal").addEventListener("click", function () {
      stageProposalFromComposer().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("edit-form").addEventListener("submit", function (event) {
      event.preventDefault();
      commitDirectFromComposer().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("priority-form").addEventListener("submit", function (event) {
      event.preventDefault();
      updateProjectPriorityFromDetail(false).catch(function (error) { setBanner(error.message, "error"); });
    });
    el("clear-priority").addEventListener("click", function () {
      updateProjectPriorityFromDetail(true).catch(function (error) { setBanner(error.message, "error"); });
    });
    el("load-history").addEventListener("click", function () {
      loadAnchorHistory().catch(function (error) { setBanner(error.message, "error"); });
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
    window.addEventListener("popstate", handleLocationAnchorChange);
    window.addEventListener("hashchange", handleLocationAnchorChange);
  }

  if (window.__ANCHOR_MCP_UI_TEST_HOOKS__) {
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderMarkdown = renderMarkdown;
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
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.sortAnchorGroups = sortAnchorGroups;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.priorityLabel = priorityLabel;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.projectOf = projectOf;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.setAnchorGroupSortForTest = function (value) {
      state.anchorGroupSort = validAnchorGroupSort(value);
    };
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderPlannerItem = renderPlannerItem;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.comparePlannerRuns = comparePlannerRuns;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.shouldHandleClientNavigation = shouldHandleClientNavigation;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.parsePlannerLogPaste = parsePlannerLogPaste;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.buildJudgePrompt = buildJudgePrompt;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.formatPreview = formatPreview;
    return;
  }

  applyUrlStateToControls();
  bind();
  showRootMode(state.rootMode);
  showDetailMode(state.detailMode);
  showTab(state.activeTab);
  load().catch(function (error) {
    setBanner("Enter the HTTP auth token to load anchors. " + error.message, "warn");
  });
})();`;
