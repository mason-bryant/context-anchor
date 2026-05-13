# Git hooks (versioned)

This directory is used when Git is configured with:

```sh
git config core.hooksPath githooks
```

Run **`npm run install-git-hooks`** from the repository root once per clone to set that (local config only).

- **`pre-push`** — runs `npm run typecheck` before a push is sent.

To stop using these hooks in a clone:

```sh
git config --unset core.hooksPath
```

Git then falls back to `.git/hooks/` (the default).
