#!/usr/bin/env bash
set -euo pipefail

repo="${1:-${ANCHOR_MCP_REPO:-$HOME/agent-context}}"
interval="${2:-45}"

if [[ ! -d "$repo" ]]; then
  mkdir -p "$repo"
fi

cd "$repo"

if [[ ! -d .git ]]; then
  git init
fi

echo "Watching $repo every ${interval}s"

while true; do
  if [[ -n "$(git status --porcelain)" ]]; then
    git add .
    git -c user.name=anchor-mcp -c user.email=anchor-mcp@local \
      commit -m "anchor-sync: persist context changes" || true
    git push || true
  fi

  git pull --rebase || {
    echo "Sync paused: git pull --rebase failed. Resolve conflicts in $repo, then restart." >&2
    exit 1
  }

  sleep "$interval"
done

