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

From this project (`context-conductor`):

```bash
npm install
npm run build
node dist/bin/anchor-mcp.js --repo /path/to/your-context-repo --transport http --host 127.0.0.1 --port 3333
```

Optional (local dev with auto-reload):

```bash
npx tsx watch src/bin/anchor-mcp.ts --repo /path/to/your-context-repo --transport http --host 127.0.0.1 --port 3333
```

If you expose the local HTTP server through ngrok, keep `--host 127.0.0.1` and
put the tunnel hostname in `anchor-mcp.config.json`:

```json
{
  "allowedHosts": [
    "your-tunnel.ngrok-free.dev"
  ]
}
```

Then start with:

```bash
npx tsx watch src/bin/anchor-mcp.ts \
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
      "url": "http://127.0.0.1:3333/mcp"
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
      "command": "node",
      "args": [
        "/absolute/path/to/context-conductor/dist/bin/anchor-mcp.js",
        "--repo",
        "/path/to/your-context-repo"
      ]
    }
  }
}
```

### Codex (stdio)

Add an MCP server entry in your Codex MCP settings using:

- command: `node`
- args:
  - `/absolute/path/to/context-conductor/dist/bin/anchor-mcp.js`
  - `--repo`
  - `/path/to/your-context-repo`

Use the same values as the Claude stdio example above.

---

## Session start: load anchors first

Before your first non-trivial tool call (read/search/edit/shell), call **`loadContext`** so discovery (`entries` / optional `markdown`) and multiple anchor bodies arrive in **one** MCP request. If you only need the index, call **`contextRoot`** instead.

If `truncated` is true or the response is too large: pass **`nextCursor`** from the prior response, or lower **`limit`** / **`maxBytes`**, or set **`includeContent`** to `excerpt` or `none`.

### Cursor rule snippet (recommended)

Put this in `.cursor/rules/` (or global Cursor rules) so it survives buried MCP `instructions`:

```md
- Before any non-trivial tool use, call anchor-mcp `loadContext` first (or `contextRoot` if only the index is needed).
- If overloaded or `truncated`: use `nextCursor`, or reduce `limit` / `maxBytes`, or set `includeContent` to `excerpt` or `none`.
- Do not locate anchors via filesystem search; use MCP tools only.
```
