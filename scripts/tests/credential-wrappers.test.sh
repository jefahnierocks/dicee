#!/usr/bin/env bash
# Synthetic credential delivery tests. No real provider or credential is used.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$PROJECT_ROOT/scripts/lib/dicee-operator-metadata.sh"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-credential-wrappers.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$work_dir/bin"

# Build the synthetic manifest from the loader's launcher set, so this test keeps
# tracking that set as it changes. Every entry is a placeholder; the real
# operator manifest is never sourced.
awk '
	/^_dicee_required_metadata=\(/ { in_list = 1; next }
	in_list && /^\)/ { exit }
	in_list { printf "%s=synthetic-metadata\n", $1 }
' "$LIB" > "$work_dir/metadata.sh"
[[ -s "$work_dir/metadata.sh" ]] || { printf 'FAIL: missing synthetic metadata\n' >&2; exit 1; }

# A name that only one consumer reads must stay out of the launcher set. Holding
# such a name there is what let a retired provider fail the Cloudflare launcher
# closed; the launchers below then prove they run without it.
if grep -q '^DICEE_SUPABASE_PROJECT_REF=' "$work_dir/metadata.sh"; then
	printf 'FAIL: consumer-only metadata is in the launcher required set\n' >&2
	exit 1
fi

cat > "$work_dir/bin/op" <<'EOF_OP'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
	vault) exit 0 ;;
	read)
		reference="${@: -1}"
		field="${reference##*/}"
		if [[ "$field" == "${DICEE_TEST_READ_FIELD:-}" ]]; then
			case "${DICEE_TEST_READ_MODE:-}" in
				failure) exit 23 ;;
				empty) exit 0 ;;
			esac
		fi
		printf 'synthetic-%s' "$field"
		;;
	*) exit 2 ;;
esac
EOF_OP

# Any intermediate `exec env NAME=value ...` fails the test before the child
# runs. This protects the credential delivery path from argv exposure.
cat > "$work_dir/bin/env" <<'EOF_ENV'
#!/bin/sh
printf called > "$DICEE_TEST_ENV_MARKER"
exit 97
EOF_ENV

cat > "$work_dir/bin/probe" <<'EOF_PROBE'
#!/usr/bin/env bash
set -euo pipefail
printf called > "$DICEE_TEST_CHILD_MARKER"
[[ $# -eq 4 && "$1" == alpha && "$2" == 'two words' && -z "$3" && "$4" == '--flag=value' ]] || exit 91
case "$DICEE_TEST_LANE" in
	cloudflare)
		[[ "${CLOUDFLARE_ACCOUNT_ID:-}" == synthetic-metadata && "${CLOUDFLARE_API_TOKEN:-}" == synthetic-api-token ]] || exit 92
		;;
	elevenlabs)
		[[ "${ELEVENLABS_API_KEY:-}" == synthetic-api-key ]] || exit 92
		;;
	*) exit 94 ;;
esac
exit "$DICEE_TEST_CHILD_STATUS"
EOF_PROBE
chmod +x "$work_dir/bin/op" "$work_dir/bin/env" "$work_dir/bin/probe"

export PATH="$work_dir/bin:$PATH"
export DICEE_OPERATOR_METADATA_FILE="$work_dir/metadata.sh"
export DICEE_TEST_ENV_MARKER="$work_dir/env-called"
export DICEE_TEST_CHILD_MARKER="$work_dir/child-called"

# An inherited value must neither mask an empty provider result nor let a
# provider failure start the requested process.
ambient_value="ambient-test-credential"
export CLOUDFLARE_API_TOKEN="$ambient_value"
export ELEVENLABS_API_KEY="$ambient_value"

assert_run() {
	local expected_status="$1" expected_child="$2" status=0
	shift 2
	rm -f "$DICEE_TEST_ENV_MARKER" "$DICEE_TEST_CHILD_MARKER"
	"$@" -- probe alpha "two words" "" "--flag=value" > "$work_dir/output" 2>&1 || status=$?
	if [[ "$status" -ne "$expected_status" || -e "$DICEE_TEST_ENV_MARKER" ]]; then
		printf 'FAIL: %s/%s/%s returned %s, expected %s, or invoked env\n' "$DICEE_TEST_LANE" "$DICEE_TEST_READ_FIELD" "$DICEE_TEST_READ_MODE" "$status" "$expected_status" >&2
		exit 1
	fi
	if [[ "$expected_child" == yes && ! -e "$DICEE_TEST_CHILD_MARKER" ]] || [[ "$expected_child" == no && -e "$DICEE_TEST_CHILD_MARKER" ]]; then
		printf 'FAIL: %s child launch did not match %s\n' "$DICEE_TEST_LANE" "$expected_child" >&2
		exit 1
	fi
}

# A malformed argument list must be rejected before any credential is read.
assert_usage_rejected() {
	local wrapper="$1" status=0
	shift
	rm -f "$DICEE_TEST_ENV_MARKER" "$DICEE_TEST_CHILD_MARKER"
	"$wrapper" "$@" > "$work_dir/output" 2>&1 || status=$?
	if [[ "$status" -ne 1 || -e "$DICEE_TEST_CHILD_MARKER" || -e "$DICEE_TEST_ENV_MARKER" ]]; then
		printf 'FAIL: %s accepted a malformed argument list: %s\n' "$wrapper" "$*" >&2
		exit 1
	fi
	grep -q 'Usage:' "$work_dir/output" || {
		printf 'FAIL: %s rejected %s without usage output\n' "$wrapper" "$*" >&2
		exit 1
	}
}

wrapper_for() {
	case "$1" in
		cloudflare) printf '%s' "$PROJECT_ROOT/scripts/with-dicee-cloudflare.sh" ;;
		elevenlabs) printf '%s' "$PROJECT_ROOT/scripts/with-dicee-elevenlabs-local.sh" ;;
	esac
}

for lane in cloudflare elevenlabs; do
	export DICEE_TEST_LANE="$lane"
	wrapper="$(wrapper_for "$lane")"
	case "$lane" in
		cloudflare) fields=(api-token) ;;
		elevenlabs) fields=(api-key) ;;
	esac
	export DICEE_TEST_READ_MODE=success DICEE_TEST_READ_FIELD=""
	for child_status in 0 37; do
		export DICEE_TEST_CHILD_STATUS="$child_status"
		assert_run "$child_status" yes "$wrapper"
	done
	export DICEE_TEST_CHILD_STATUS=0
	for field in "${fields[@]}"; do
		export DICEE_TEST_READ_FIELD="$field"
		export DICEE_TEST_READ_MODE=failure
		assert_run 23 no "$wrapper"
		export DICEE_TEST_READ_MODE=empty
		assert_run 1 no "$wrapper"
	done
	export DICEE_TEST_READ_MODE=success DICEE_TEST_READ_FIELD=""
	assert_usage_rejected "$wrapper"
	assert_usage_rejected "$wrapper" --
	assert_usage_rejected "$wrapper" probe alpha
	printf 'ok: %s delivery, arguments, exit status, failed and empty reads, usage guard\n' "$lane"
done

# A launcher metadata name that the private manifest does not define must stop
# the wrapper before it reads a credential or starts a child.
grep -v '^DICEE_OP_ITEM_CLOUDFLARE=' "$work_dir/metadata.sh" > "$work_dir/metadata-incomplete.sh"
rm -f "$DICEE_TEST_ENV_MARKER" "$DICEE_TEST_CHILD_MARKER"
incomplete_status=0
DICEE_OPERATOR_METADATA_FILE="$work_dir/metadata-incomplete.sh" \
	"$(wrapper_for cloudflare)" -- probe alpha "two words" "" "--flag=value" \
	> "$work_dir/output" 2>&1 || incomplete_status=$?
if [[ "$incomplete_status" -eq 0 || -e "$DICEE_TEST_CHILD_MARKER" || -e "$DICEE_TEST_ENV_MARKER" ]]; then
	printf 'FAIL: incomplete launcher metadata did not fail closed (exit %s)\n' "$incomplete_status" >&2
	exit 1
fi
grep -q 'Missing required operator metadata: DICEE_OP_ITEM_CLOUDFLARE' "$work_dir/output" || {
	printf 'FAIL: incomplete launcher metadata did not name the missing identifier\n' >&2
	exit 1
}
printf 'ok: incomplete launcher metadata fails closed\n'

printf 'Credential wrapper tests passed.\n'
