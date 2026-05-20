#!/usr/bin/env bash
# Prepare release PRs and publish semver tags for GitHub Actions.
# Requires Actions secret NPM_TOKEN on the repo for npm publishing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
while [[ "${1:-}" == "--dry-run" ]]; do
  DRY_RUN=1
  shift
done

usage() {
  local status="${1:-1}"
  if [[ "$status" -eq 0 ]]; then
    print_usage
  else
    print_usage >&2
  fi
  exit "$status"
}

print_usage() {
  cat <<'EOF'
Usage: scripts/release.sh [--dry-run] <command>

Commands:
  prepare <patch|minor|major>
                          Create a release branch from origin/main, bump
                          package.json/package-lock.json without tagging,
                          run checks, commit, push, and open a PR.

  publish                 Tag the version currently on main and push only the
                          v* tag, triggering the Release workflow.

  --dry-run               Print what would run without changing git or npm.

Requires: clean working tree.
Configure GitHub Actions secret NPM_TOKEN before expecting npm publish to succeed.
EOF
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

require_command() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
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

bump_version() {
  local current="$1"
  local bump="$2"
  node -e '
const [current, bump] = process.argv.slice(1);
const match = current.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
if (!match) {
  console.error(`error: expected simple semver version, got ${current}`);
  process.exit(1);
}
let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);
switch (bump) {
  case "major":
    major += 1;
    minor = 0;
    patch = 0;
    break;
  case "minor":
    minor += 1;
    patch = 0;
    break;
  case "patch":
    patch += 1;
    break;
  default:
    console.error(`error: unsupported bump type ${bump}`);
    process.exit(1);
}
console.log(`${major}.${minor}.${patch}`);
' "$current" "$bump"
}

package_version_from_ref() {
  local ref="$1"
  git show "${ref}:package.json" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  console.log(JSON.parse(input).version);
});
'
}

require_tag_available() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  local tag="$1"
  if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    echo "error: tag ${tag} already exists locally." >&2
    exit 1
  fi
  if git ls-remote --tags origin "refs/tags/${tag}" | grep -q .; then
    echo "error: tag ${tag} already exists on origin." >&2
    exit 1
  fi
}

require_branch_available() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  local branch="$1"
  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "error: branch ${branch} already exists locally." >&2
    exit 1
  fi
  if git ls-remote --heads origin "$branch" | grep -q .; then
    echo "error: branch ${branch} already exists on origin." >&2
    exit 1
  fi
}

prepare_release() {
  local bump="$1"
  require_clean_tree
  require_command gh

  run git fetch origin --tags

  local base_version
  base_version="$(package_version_from_ref origin/main)"

  local next_version
  next_version="$(bump_version "$base_version" "$bump")"

  local tag="v${next_version}"
  require_tag_available "$tag"

  local branch="codex/release-${tag}"
  require_branch_available "$branch"

  run git switch -c "$branch" origin/main
  run npm version "$bump" --no-git-tag-version

  if [[ "$DRY_RUN" -eq 0 ]]; then
    local actual_version
    actual_version="$(node -p "require('./package.json').version")"
    if [[ "$actual_version" != "$next_version" ]]; then
      echo "error: expected version ${next_version}, got ${actual_version}." >&2
      exit 1
    fi
  fi

  run npm run typecheck
  run npm test
  run git add package.json package-lock.json
  run git commit -m "Release ${tag}"
  run git push -u origin "$branch"
  run gh pr create --base main --head "$branch" --title "Release ${tag}" --body "Release ${tag}"
}

publish_release() {
  require_clean_tree

  run git fetch origin --tags
  run git switch main
  run git pull --ff-only origin main

  if [[ "$DRY_RUN" -eq 0 ]]; then
    local local_head
    local_head="$(git rev-parse HEAD)"

    local remote_head
    remote_head="$(git rev-parse origin/main)"

    if [[ "$local_head" != "$remote_head" ]]; then
      echo "error: local main does not match origin/main after pull." >&2
      echo "       Refusing to tag a commit that is not the protected main head." >&2
      exit 1
    fi
  fi

  local version
  if [[ "$DRY_RUN" -eq 1 ]]; then
    version="$(package_version_from_ref origin/main)"
  else
    version="$(node -p "require('./package.json').version")"
  fi

  local tag="v${version}"
  require_tag_available "$tag"

  run git tag -a "$tag" -m "Release ${tag}"
  run git push origin "refs/tags/${tag}"
}

if [[ $# -eq 0 ]]; then
  usage 0
fi

cmd="$1"
shift
case "$cmd" in
  -h | --help | help) usage 0 ;;
  prepare)
    [[ $# -eq 1 ]] || usage
    case "$1" in
      patch | minor | major)
        prepare_release "$1"
        ;;
      *)
        usage
        ;;
    esac
    ;;
  publish)
    [[ $# -eq 0 ]] || usage
    publish_release
    ;;
  *)
    usage
    ;;
esac
