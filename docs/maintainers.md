# Maintainers

This file collects maintainer-only release and local development notes.

## Local Development

```sh
npm install
npm run build
npm test
```

Run `npm run install-git-hooks` once per clone to point Git at `githooks/` so
`git push` runs `npm run typecheck` first.

Run the built binary from this checkout:

```sh
node dist/bin/anchor-mcp.js --repo ~/agent-context
```

For local source development, prefer `tsx`:

```sh
npx tsx src/bin/anchor-mcp.ts --repo ~/agent-context
```

For auto-restart while editing source:

```sh
npx tsx watch src/bin/anchor-mcp.ts --repo ~/agent-context --transport http --port 3333 --config ./anchor-mcp.config.json
```

## Releases

From the repo root, on a clean `main` checkout:

```sh
./scripts/release.sh tag              # tag vX.Y.Z from package.json version and push
./scripts/release.sh patch            # or: minor | major
./scripts/release.sh --dry-run tag    # print steps only
```

The Release workflow runs on tag `v*.*.*`, publishes to npm, and creates a GitHub
Release. Configure the repository Actions secret `NPM_TOKEN` with an npm automation
token that can publish `@mason/anchor-mcp`.

The tag must match `package.json`, including the leading `v`.
