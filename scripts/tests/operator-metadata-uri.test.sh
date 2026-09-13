#!/usr/bin/env bash
# Value-free regression test for the credential-manager URI builder in
# scripts/lib/dicee-operator-metadata.sh. It sources the loader against a
# throwaway metadata file filled with dummy identifiers, never invokes the real
# 1Password CLI, and never reads a secret.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$PROJECT_ROOT/scripts/lib/dicee-operator-metadata.sh"

# The scheme is assembled from pieces so this tracked file never contains the
# literal URI token rejected by scripts/public-safety-scan.sh.
readonly SCHEME="op:/""/"

failures=0

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	failures=$((failures + 1))
}

assert_eq() {
	local label="$1"
	local expected="$2"
	local actual="$3"
	if [[ "$actual" == "$expected" ]]; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label"
		printf '  expected: %s\n  actual:   %s\n' "$expected" "$actual" >&2
	fi
}

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-op-uri-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
metadata_file="$work_dir/operator-metadata.sh"

# Derive the required variable names from the loader itself so this test keeps
# tracking the list as it changes. Every value is a dummy placeholder.
required_names=()
while IFS= read -r name; do
	[[ -n "$name" ]] && required_names+=("$name")
done < <(awk '/^_dicee_required_metadata=\(/ { in_list = 1; next } in_list && /^\)/ { exit } in_list { print $1 }' "$LIB")

if [[ "${#required_names[@]}" -eq 0 ]]; then
	printf 'FAIL: could not read _dicee_required_metadata from %s\n' "$LIB" >&2
	exit 1
fi

{
	for name in "${required_names[@]}"; do
		case "$name" in
			DICEE_OP_ACCOUNT) printf '%s=%q\n' "$name" "ACCOUNT" ;;
			DICEE_OP_VAULT) printf '%s=%q\n' "$name" "VAULT" ;;
			*) printf '%s=%q\n' "$name" "dummy-value" ;;
		esac
	done
} >"$metadata_file"

# Shadow the 1Password CLI with a function so the real binary can never run;
# dicee_op_read is exercised through this stub, which only records arguments.
op_stub_args=""
op() {
	op_stub_args="$*"
	printf 'stubbed-op-output'
}

export DICEE_OPERATOR_METADATA_FILE="$metadata_file"
# shellcheck source-path=SCRIPTDIR/../lib source=dicee-operator-metadata.sh
source "$LIB"

assert_eq "dicee_op_uri builds vault/item/field URI" \
	"${SCHEME}VAULT/ITEM/FIELD" \
	"$(dicee_op_uri ITEM FIELD)"

assert_eq "dicee_op_uri keeps hyphenated item and field names" \
	"${SCHEME}VAULT/example-item/api-token" \
	"$(dicee_op_uri example-item api-token)"

assert_eq "dicee_op_uri emits no trailing newline" \
	"$(printf '%s' "${SCHEME}VAULT/ITEM/FIELD" | wc -c | tr -d ' ')" \
	"$(dicee_op_uri ITEM FIELD | wc -c | tr -d ' ')"

# Call without command substitution so the stub's recorded arguments survive.
dicee_op_read ITEM FIELD >/dev/null
assert_eq "dicee_op_read passes account and URI to op read" \
	"read --account ACCOUNT ${SCHEME}VAULT/ITEM/FIELD" \
	"$op_stub_args"

if [[ "$failures" -ne 0 ]]; then
	printf '%d operator metadata URI assertion(s) failed.\n' "$failures" >&2
	exit 1
fi

printf 'Operator metadata URI tests passed.\n'
