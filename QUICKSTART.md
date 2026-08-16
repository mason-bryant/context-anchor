# Quick Start

Use this guide to migrate an existing context set, run `anchor-mcp`, and connect it to your MCP client.

## 1) Migrate your context with `AGENTS.md` + your favorite LLM

Use `AGENTS.md` in this repo as the migration checklist. A simple workflow:

1. Copy your existing markdown context into a working directory.
2. Open `AGENTS.md` and walk through Steps 1-5 with your LLM tool (Cursor, Claude, Codex, etc.).
3. Have the LLM help move files into valid categories, fix front matter, and add required sections.
4. Run the verification checklist at the end of `AGENTS.md`.

## 2) Put the migrated context in a local git repo

`anchor-mcp` requires a git-backed context repo.

```bash
cd /path/to/your-context-repo
git init
git add .
git commit -m "initial: import existing context documents"
```

## 3) Start the server

Generate an HTTP bearer token and store it in a config file:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
echo '{"authToken":"paste-generated-token-here"}' > anchor-mcp.config.json
chmod 600 anchor-mcp.config.json
```

Start from the published package:

```bash
npx -y @mason/anchor-mcp@latest \
  --repo /path/to/your-context-repo \
  --transport http \
  --host 127.0.0.1 \
  --port 3333 \
  --config ./anchor-mcp.config.json
```

Optional (local dev with auto-reload):

```bash
npm install
npx tsx watch src/bin/anchor-mcp.ts \
  --repo /path/to/your-context-repo \
  --transport http \
  --host 127.0.0.1 \
  --port 3333 \
  --config ./anchor-mcp.config.json
```

Open `http://127.0.0.1:3333/ui` for the read-only explorer. Enter the same
token there to preview the generated context root, browse anchors and roadmaps,
search/facet the index, and inspect anchor validation badges.

If you expose the local HTTP server through ngrok, keep `--host 127.0.0.1` and
put the tunnel hostname in `anchor-mcp.config.json`:

```json
{
  "authToken": "paste-generated-token-here",
  "allowedHosts": [
    "your-tunnel.ngrok-free.dev"
  ]
}
```

Then start with:

```bash
npx -y @mason/anchor-mcp@latest \
  --repo /path/to/your-context-repo \
  --transport http \
  --host 127.0.0.1 \
  --port 3333 \
  --config ./anchor-mcp.config.json
```

If your anchors are under a subdirectory (for example `.agents/context`), include:

```bash
--anchor-root .agents/context
```

## 4) Add MCP to Cursor, Claude, or Codex

### Cursor (HTTP)

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer paste-generated-token-here"
      }
    }
  }
}
```

### Claude Desktop (stdio)

Add to Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "anchor-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@mason/anchor-mcp@latest",
        "--repo",
        "/path/to/your-context-repo"
      ]
    }
  }
}
```

### Codex (stdio)

Add an MCP server entry in your Codex MCP settings using:

- command: `npx`
- args:
  - `-y`
  - `@mason/anchor-mcp@latest`
  - `--repo`
  - `/path/to/your-context-repo`

Use the same values as the Claude stdio example above.

---

## Session start: start with context

Before your first non-trivial tool call (read/search/edit/shell), call **`startTask`**
when you know the project and task. It plans a task-aware bundle and loads relevant
anchor excerpts in one response. If you do not know the task yet, call **`loadContext`**
for broader discovery. If you only need the index, call **`contextRoot`** instead.

If `truncated` is true or the response is too large: pass **`nextCursor`** from the prior response, or lower **`limit`** / **`maxBytes`**, or set **`includeContent`** to `excerpt` or `none`.

## Mid-session: install the agent skill (recommended)

Opening with `startTask` is not enough on its own. The topic changes several times in a
session — "now write the design doc", "now add a migration" — and each change is a new
question the anchors may already answer. What agents do instead is answer it from AGENTS.md,
or from nothing, because retrieval already happened once and felt done.

Run this in the project you are working in — the code checkout, not the anchor repository:

```bash
npx @mason/anchor-mcp install
```

It writes `.claude/skills/anchor-context/SKILL.md` and `.cursor/rules/anchor-context.mdc`:
one instruction set, in the two places Claude Code and Cursor each look. Both harnesses load
it on demand from its description, so it costs nothing until the topic actually shifts. Narrow
it with `--agent claude` or `--agent cursor`. Re-run it after an upgrade — a file anchor-mcp
wrote is replaced, and one it did not is refused unless you pass `--force`.

To keep the install out of a repository you share:

```bash
npx @mason/anchor-mcp install --stealth
```

The Claude Code skill then goes to `~/.claude/skills/`, where it covers every project. Cursor
reads project rules only from `.cursor/rules` — its User Rules are settings text, not files —
so that one stays where it is and gets added to `.git/info/exclude`, which is per-clone and
never committed. Either way there is nothing for your teammates to review.

The skill tells the agent to route on a topic shift, to take nothing when the routes match
only weakly, to report what it used via `reportRecordUse`, and to follow the anchor when an
anchor and AGENTS.md disagree — while reading both, so the conflict gets reported to you
rather than silently resolved.

### Rules the skill does not cover

These are session hygiene rather than retrieval; add them to your own rules file if you want
them enforced:

```md
- If overloaded or `truncated`: use `nextCursor`, or reduce `limit` / `maxBytes`, or set `includeContent` to `excerpt` or `none`.
- For project updates or backlog requests, load built-in `server-rules/project-updates.md`; backlog tasks go on the reserved `milestone_id: backlog` milestone without `sequence`, invented dates, owners, or goal ids.
```
