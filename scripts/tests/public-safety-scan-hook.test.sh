#!/usr/bin/env bash
# Keep fixture tests isolated when they run inside a Git hook. The inherited
# repository is a disposable decoy containing only synthetic data.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Git hooks export repository-local variables that override `git -C`.
# Follow githooks(5)'s foreign-repository guidance before creating the decoy.
git_local_env_vars="$(git rev-parse --local-env-vars)"
while IFS= read -r name; do
	unset "$name"
done <<<"$git_local_env_vars"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-public-safety-hook-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
failures=0

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	failures=$((failures + 1))
}

assert_file_unchanged() {
	local path="$1"
	if cmp -s "$snapshot_dir/$path" "$decoy_dir/$path"; then
		printf 'ok: %s decoy %s is unchanged\n' "$scenario" "$path"
	else
		fail "$scenario hook context changed decoy $path"
	fi
}

for scenario in explicit_worktree git_dir_only; do
	decoy_dir="$work_dir/decoy-$scenario"
	snapshot_dir="$work_dir/decoy-$scenario-before"
	git init --quiet "$decoy_dir"
	mkdir -p "$decoy_dir/scripts" "$decoy_dir/packages/web"
	cat >"$decoy_dir/.gitignore" <<'EOF'
.env
.env.*
!.env.example
.infisical.json
*.pem
*.key
*.p12
*.pfx
EOF

	# Mirror the paths touched by the fixture test so a regression can reach its
	# Git mutations. Every file here belongs to the decoy, never the real checkout.
	for path in .env.example packages/web/.env.example .infisical.example.json packages/web/.infisical.example.json; do
		printf 'DUMMY_VALUE=synthetic-placeholder\n' >"$decoy_dir/$path"
	done
	printf 'synthetic staged sentinel\n' >"$decoy_dir/scripts/sentinel.sh"
	git -C "$decoy_dir" add --all

	# An unstaged edit detects accidental `git add scripts` even when fixture paths
	# already exist in the decoy's index. Preserve both versions independently.
	printf 'synthetic unstaged sentinel\n' >"$decoy_dir/scripts/sentinel.sh"
	for path in .env .env.local packages/web/.env packages/web/.env.local \
		packages/web/.env.production .infisical.json packages/web/.infisical.json \
		packages/web/private.pem packages/web/private.key packages/web/private.p12 packages/web/private.pfx; do
		printf 'DUMMY_VALUE=synthetic-placeholder\n' >"$decoy_dir/$path"
	done
	cp -R "$decoy_dir" "$snapshot_dir"

	# Some hooks provide a worktree explicitly; others provide only Git paths.
	# The latter can make an accidental `git init` rewrite the decoy as bare.
	hook_env=("GIT_DIR=$decoy_dir/.git" "GIT_INDEX_FILE=$decoy_dir/.git/index")
	if [[ "$scenario" == explicit_worktree ]]; then
		hook_env+=("GIT_WORK_TREE=$decoy_dir")
	fi
	fixture_status=0
	env "${hook_env[@]}" bash "$PROJECT_ROOT/scripts/tests/public-safety-scan.test.sh" \
		>"$work_dir/fixture-$scenario-output" 2>&1 || fixture_status=$?

	if [[ "$fixture_status" -eq 0 ]]; then
		printf 'ok: fixture suite passes with %s hook variables\n' "$scenario"
	else
		fail "fixture suite failed with $scenario hook variables (exit $fixture_status)"
		# This child only operates on disposable repositories with synthetic data.
		printf 'Synthetic fixture suite output:\n' >&2
		cat "$work_dir/fixture-$scenario-output" >&2
	fi
	assert_file_unchanged .git/config
	assert_file_unchanged .git/HEAD
	assert_file_unchanged .git/index
	if diff -r -x .git "$snapshot_dir" "$decoy_dir" >"$work_dir/worktree-$scenario-diff"; then
		printf 'ok: %s decoy worktree is unchanged\n' "$scenario"
	else
		fail "$scenario hook context changed the decoy worktree"
	fi
done

if [[ "$failures" -ne 0 ]]; then
	printf '%d public-safety hook assertion(s) failed.\n' "$failures" >&2
	exit 1
fi

printf 'Public-safety hook isolation tests passed.\n'
