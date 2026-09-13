#!/usr/bin/env bash
# Exercise publication-candidate filename rules in an isolated Git repository.
# All fixtures contain dummy data; the real working tree is never scanned.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-public-safety-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
repo_dir="$work_dir/repo"
scan_output="$work_dir/scan-output"
failures=0

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	failures=$((failures + 1))
}

run_scan() {
	scan_status=0
	bash "$repo_dir/scripts/public-safety-scan.sh" >"$scan_output" 2>&1 || scan_status=$?
}

assert_scan_passes() {
	local label="$1"
	run_scan
	if [[ "$scan_status" -eq 0 ]]; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (scanner exited $scan_status)"
	fi
}

assert_private_file_rejected() {
	local path="$1"
	run_scan
	if [[ "$scan_status" -eq 1 ]] &&
		rg --fixed-strings --line-regexp --quiet -- \
			'FAIL: private file is part of the publication candidate' "$scan_output" &&
		rg --fixed-strings --line-regexp --quiet -- "  $path" "$scan_output"; then
		printf 'ok: tracked private file rejected: %s\n' "$path"
	else
		fail "tracked private file was not rejected by filename: $path"
	fi
	if rg --fixed-strings --quiet -- 'synthetic-placeholder' "$scan_output"; then
		fail "scanner printed fixture contents: $path"
	fi
}

git init --quiet "$repo_dir"
mkdir -p "$repo_dir/scripts" "$repo_dir/packages/web"
cp "$PROJECT_ROOT/scripts/public-safety-scan.sh" "$repo_dir/scripts/public-safety-scan.sh"
cat >"$repo_dir/.gitignore" <<'EOF'
.env
.env.*
!.env.example
.infisical.json
*.pem
*.key
*.p12
*.pfx
EOF

for path in .env.example packages/web/.env.example .infisical.example.json packages/web/.infisical.example.json; do
	printf 'DUMMY_VALUE=synthetic-placeholder\n' >"$repo_dir/$path"
done
git -C "$repo_dir" add -- .gitignore scripts .env.example packages/web/.env.example \
	.infisical.example.json packages/web/.infisical.example.json
assert_scan_passes 'tracked root and nested templates are allowed'

private_paths=(
	.env
	.env.local
	packages/web/.env
	packages/web/.env.local
	packages/web/.env.production
	.infisical.json
	packages/web/.infisical.json
	packages/web/private.pem
	packages/web/private.key
	packages/web/private.p12
	packages/web/private.pfx
)

for path in "${private_paths[@]}"; do
	printf 'DUMMY_VALUE=synthetic-placeholder\n' >"$repo_dir/$path"
	git -C "$repo_dir" check-ignore --quiet -- "$path"
done
assert_scan_passes 'ignored untracked private files are excluded'

for path in "${private_paths[@]}"; do
	git -C "$repo_dir" add --force -- "$path"
	assert_private_file_rejected "$path"
	git -C "$repo_dir" rm --quiet --cached -- "$path"
done
assert_scan_passes 'removing private files from the candidate restores a passing scan'

if [[ "$failures" -ne 0 ]]; then
	printf '%d public-safety scan assertion(s) failed.\n' "$failures" >&2
	exit 1
fi

printf 'Public-safety scan tests passed.\n'
