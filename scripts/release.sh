#!/usr/bin/env bash
# Bump version and/or push a semver tag so GitHub Actions can publish to npm
# and create a GitHub Release. Requires Actions secret NPM_TOKEN on the repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
while [[ "${1:-}" == "--dry-run" ]]; do
  DRY_RUN=1
  shift
done

usage() {
  cat <<'EOF' >&2
Usage: scripts/release.sh [--dry-run] [patch | minor | major | tag]

  patch | minor | major   Run npm version on a clean main branch, then push
                            the branch and the new v* tag (triggers Release workflow).

  tag                     Create an annotated tag v$(version) at HEAD and push
                            only that tag (default). package.json must already
                            list the version you intend to ship.

  --dry-run               Print what would run without changing git or npm.

Requires: clean working tree. For bumps, current branch must be main.
Configure GitHub Actions secret NPM_TOKEN before expecting npm publish to succeed.
EOF
  exit 1
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]' >&2
    printf ' %q' "$@" >&2
    printf '\n' >&2
  else
    "$@"
  fi
}

require_clean_tree() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "error: working tree is not clean; commit or stash first." >&2
    exit 1
  fi
}

require_main() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  local branch
  branch="$(git branch --show-current)"
  if [[ "$branch" != "main" ]]; then
    echo "error: must be on main (current branch: ${branch})." >&2
    exit 1
  fi
}

cmd="${1:-tag}"
case "$cmd" in
  -h | --help | help) usage ;;
  patch | minor | major)
    [[ $# -eq 1 ]] || usage
    require_clean_tree
    require_main
    run npm version "$cmd" -m "Release v%s"
    run git push origin "$(git branch --show-current)" --follow-tags
    ;;
  tag)
    if [[ $# -gt 1 ]]; then
      usage
    fi
    require_clean_tree
    version="$(node -p "require('./package.json').version")"
    tag="v${version}"
    if git rev-parse "$tag" >/dev/null 2>&1; then
      echo "error: tag ${tag} already exists locally." >&2
      exit 1
    fi
    if git ls-remote --tags origin "refs/tags/${tag}" | grep -q .; then
      echo "error: tag ${tag} already exists on origin." >&2
      exit 1
    fi
    run git tag -a "$tag" -m "Release ${tag}"
    run git push origin "refs/tags/${tag}"
    ;;
  *)
    usage
    ;;
esac
