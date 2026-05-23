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
          <p>Read-only context explorer</p>
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
              <span id="anchor-count" class="count">0</span>
            </div>
            <div id="anchor-list" class="anchor-list"></div>
          </section>
        </aside>

        <section id="content-area" class="content-area">
          <section id="status-banner" class="status-banner" hidden></section>

          <nav class="tabs" aria-label="Primary views">
            <button class="tab active" data-tab="root" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-home"></use></svg><span>Context Root</span></span></button>
            <button class="tab" data-tab="planner" type="button"><span class="icon-label"><svg class="icon" aria-hidden="true"><use href="#icon-plan"></use></svg><span>Planner</span></span></button>
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
                <textarea id="planner-task" rows="4" placeholder="Update anchor-mcp UI planning context"></textarea>
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
                    <button id="copy-load-context" type="button">Copy</button>
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
}

.count {
  color: var(--muted);
  font-size: 12px;
}

.anchor-list {
  display: grid;
  gap: 12px;
}

.anchor-group {
  display: grid;
  gap: 7px;
}

.anchor-group-title {
  color: var(--muted);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0;
  text-transform: uppercase;
}

.anchor-row {
  width: 100%;
  text-align: left;
  display: grid;
  gap: 4px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  text-decoration: none;
  padding: 10px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  .planner-controls,
  .planner-summary,
  .planner-grid {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
`;

export const UI_JS = `(function () {
  var state = {
    anchors: [],
    root: null,
    pendingAnchor: readAnchorFromLocation(),
    selectedName: null,
    rootMode: "rendered",
    detailMode: "rendered",
    activeTab: "root",
    plannerPlans: [],
    plannerLastLoadContext: null
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
    return "?anchor=" + encodeURIComponent(anchorName);
  }

  function updateAnchorLocation(anchorName) {
    if (!window.history || !window.history.pushState) {
      return;
    }
    var next = new URL(window.location.href);
    next.searchParams.set("anchor", anchorName);
    next.hash = "";
    window.history.pushState(null, "", next.pathname + next.search);
  }

  function clearAnchorLocation() {
    if (!window.history || !window.history.pushState) {
      return;
    }
    var next = new URL(window.location.href);
    next.searchParams.delete("anchor");
    next.hash = "";
    window.history.pushState(null, "", next.pathname + next.search);
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
    return "";
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
    setBanner("Loading context index...", "info");
    var anchorsResponse = await api("/api/ui/anchors" + suffix);
    var rootResponse = await api("/api/ui/context-root" + suffix);
    state.anchors = anchorsResponse.anchors || [];
    state.root = rootResponse;
    populateFilterOptions();
    renderAnchorList();
    renderRoot();
    openPendingAnchor();
    setBanner("", "info");
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
    projectSelect.innerHTML = optionList(projects, "All projects");
    tagSelect.innerHTML = optionList(tags, "All tags");
    categorySelect.innerHTML = optionList(categories.slice(1), "All categories");
    plannerProjectSelect.innerHTML = optionList(projects, "All projects");
    plannerTagSelect.innerHTML = optionList(tags, "All tags");
    plannerCategorySelect.innerHTML = optionList(categories.slice(1), "All categories");
    projectSelect.value = projects.includes(currentProject) ? currentProject : "";
    tagSelect.value = tags.includes(currentTag) ? currentTag : "";
    categorySelect.value = categories.includes(currentCategory) ? currentCategory : "";
    plannerProjectSelect.value = projects.includes(currentPlannerProject) ? currentPlannerProject : "";
    plannerTagSelect.value = tags.includes(currentPlannerTag) ? currentPlannerTag : "";
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

  function healthBadge(health) {
    var status = health && health.status ? health.status : "ok";
    var label = status === "block" ? "Block" : status === "warn" ? "Warn" : "OK";
    return "<span class=\\"badge " + status + "\\">" + label + "</span>";
  }

  function renderAnchorList() {
    var list = el("anchor-list");
    var anchors = filteredAnchors();
    el("anchor-count").textContent = String(anchors.length);
    if (!anchors.length) {
      list.innerHTML = "<div class=\\"empty-state\\">No anchors match the current filters.</div>";
      return;
    }
    var groups = new Map();
    anchors.forEach(function (anchor) {
      var groupName = anchor.category === "projects" && projectOf(anchor)
        ? "projects / " + projectOf(anchor)
        : anchor.category;
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName).push(anchor);
    });
    list.innerHTML = Array.from(groups.keys()).map(function (groupName) {
      return "<div class=\\"anchor-group\\">"
        + "<div class=\\"anchor-group-title\\">" + escapeHtml(groupName) + "</div>"
        + groups.get(groupName).map(renderAnchorRow).join("")
        + "</div>";
    }).join("");
  }

  function renderAnchorRow(anchor) {
      var active = anchor.name === state.selectedName ? " active" : "";
      var meta = [anchor.category, projectOf(anchor)].filter(Boolean).map(function (item) {
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

    setBanner("Planning context bundle...", "info");
    var plan = await api("/api/ui/context-plan?" + queryFromPlannerInput(input));
    state.plannerPlans.unshift(plan);
    state.plannerPlans = state.plannerPlans.slice(0, 2);
    state.plannerLastLoadContext = plan.loadContext;
    renderPlanner(plan, state.plannerPlans[1]);
    showTab("planner");
    setBanner("", "info");
  }

  function renderPlanner(plan, previous) {
    el("planner-empty").hidden = true;
    el("planner-results").hidden = false;
    el("planner-status").textContent = "Generated " + plan.generatedAt + " from " + plan.totalCandidates + " candidates";
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

  function showRootMode(mode) {
    state.rootMode = mode;
    document.querySelectorAll("[data-root-mode]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.rootMode === mode);
    });
    el("root-rendered").hidden = mode !== "rendered";
    el("root-raw").hidden = mode !== "raw";
  }

  function showDetailMode(mode) {
    state.detailMode = mode;
    document.querySelectorAll("[data-detail-mode]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.detailMode === mode);
    });
    el("detail-rendered").hidden = mode !== "rendered";
    el("detail-raw").hidden = mode !== "raw";
    el("detail-frontmatter").hidden = mode !== "frontmatter";
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
      clearAnchorLocation();
    }
    state.pendingAnchor = null;
    showTab("root");
  }

  function showPlanner(options) {
    var opts = options || {};
    if (!opts.skipLocationUpdate) {
      clearAnchorLocation();
    }
    state.pendingAnchor = null;
    showTab("planner");
  }

  async function selectAnchor(name, options) {
    var opts = options || {};
    state.selectedName = name;
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
    el("detail-empty").hidden = true;
    el("detail-content").hidden = false;
    el("detail-title").textContent = anchor.ui.label;
    el("detail-path").textContent = anchor.name;
    el("detail-badges").innerHTML = healthBadge(anchor.ui.health)
      + "<span class=\\"badge\\">" + escapeHtml(anchor.frontmatter.type || "unknown type") + "</span>";
    el("section-status").innerHTML = Object.keys(anchor.ui.sections).map(function (section) {
      var ok = anchor.ui.sections[section];
      return "<span class=\\"badge " + (ok ? "ok" : "block") + "\\">" + escapeHtml(section) + "</span>";
    }).join("");
    el("validation-status").innerHTML = renderIssues(anchor.ui.health);
    el("detail-rendered").innerHTML = renderMarkdown(markdownBody(anchor.content || ""));
    decorateAnchorLinks(el("detail-rendered"));
    el("detail-raw").textContent = anchor.content || "";
    el("detail-frontmatter").textContent = JSON.stringify(anchor.frontmatter || {}, null, 2);
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
    state.pendingAnchor = readAnchorFromLocation();
    if (state.pendingAnchor) {
      openPendingAnchor();
    } else {
      showRoot({ skipLocationUpdate: true });
    }
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
        load().catch(function (error) { setBanner(error.message, "error"); });
      });
    });
    el("planner-form").addEventListener("submit", function (event) {
      event.preventDefault();
      runPlanner().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("copy-load-context").addEventListener("click", function () {
      copyLoadContext().catch(function (error) { setBanner(error.message, "error"); });
    });
    el("search-input").addEventListener("input", debounce(renderAnchorList, 120));
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
        showTab(button.dataset.tab);
      });
    });
    document.querySelectorAll("[data-root-mode]").forEach(function (button) {
      button.addEventListener("click", function () { showRootMode(button.dataset.rootMode); });
    });
    document.querySelectorAll("[data-detail-mode]").forEach(function (button) {
      button.addEventListener("click", function () { showDetailMode(button.dataset.detailMode); });
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
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderAnchorRow = renderAnchorRow;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.renderPlannerItem = renderPlannerItem;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.comparePlannerRuns = comparePlannerRuns;
    window.__ANCHOR_MCP_UI_TEST_HOOKS__.shouldHandleClientNavigation = shouldHandleClientNavigation;
    return;
  }

  bind();
  load().catch(function (error) {
    setBanner("Enter the HTTP auth token to load anchors. " + error.message, "warn");
  });
})();`;
