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

  publish                 After the release PR is merged, tag the version
                          currently on main and push only the v* tag,
                          triggering the Release workflow.

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
  if tag_exists_locally "$tag"; then
    echo "error: tag ${tag} already exists locally." >&2
    exit 1
  fi
  if tag_exists_on_origin "$tag"; then
    echo "error: tag ${tag} already exists on origin." >&2
    exit 1
  fi
}

tag_exists_locally() {
  local tag="$1"
  git rev-parse -q --verify "refs/tags/${tag}" >/dev/null
}

tag_exists_on_origin() {
  local tag="$1"
  git ls-remote --tags origin "refs/tags/${tag}" | grep -q .
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

pending_release_branches() {
  {
    git branch --format='%(refname:short)' --no-merged main 'codex/release-v*'
    git branch -r --format='%(refname:short)' --no-merged origin/main 'origin/codex/release-v*' | sed 's#^origin/##'
  } | sort -u
}

require_current_release_branch_merged() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  local branch
  branch="$(git branch --show-current)"
  case "$branch" in
    codex/release-v*)
      if ! git merge-base --is-ancestor "$branch" origin/main; then
        local version
        version="$(node -p "require('./package.json').version")"

        echo "error: ${branch} contains v${version}, but it has not been merged into main." >&2
        echo "       publish only tags the protected main branch." >&2
        echo "       Merge the release PR first, then run:" >&2
        echo "       ./scripts/release.sh publish" >&2
        exit 1
      fi
      ;;
  esac
}

require_publish_tag_available() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi

  local version="$1"
  local tag="$2"
  if tag_exists_locally "$tag" || tag_exists_on_origin "$tag"; then
    echo "error: main is at package.json version ${version}, but tag ${tag} already exists." >&2
    echo "       Nothing new can be published from the current main branch." >&2
    echo "       If you just ran 'prepare', merge the release PR first, then run:" >&2
    echo "       ./scripts/release.sh publish" >&2

    local pending
    pending="$(pending_release_branches | paste -sd ', ' -)"
    if [[ -n "$pending" ]]; then
      echo "       Unmerged release branch(es): ${pending}" >&2
    fi

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
  require_current_release_branch_merged
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
  require_publish_tag_available "$version" "$tag"

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
