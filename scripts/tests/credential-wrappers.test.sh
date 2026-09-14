#!/usr/bin/env bash
# Synthetic credential delivery tests. No real provider or credential is used.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$PROJECT_ROOT/scripts/lib/dicee-operator-metadata.sh"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-credential-wrappers.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$work_dir/bin"

# The shared loader still requires metadata for every legacy lane. All entries
# here are placeholders; the real operator manifest is never sourced.
awk '
	/^_dicee_required_metadata=\(/ { in_list = 1; next }
	in_list && /^\)/ { exit }
	in_list { printf "%s=synthetic-metadata\n", $1 }
' "$LIB" > "$work_dir/metadata.sh"
[[ -s "$work_dir/metadata.sh" ]] || { printf 'FAIL: missing synthetic metadata\n' >&2; exit 1; }

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
	infisical)
		[[ "${INFISICAL_CLIENT_ID:-}" == synthetic-client-id && "${INFISICAL_CLIENT_SECRET:-}" == synthetic-client-secret ]] || exit 92
		[[ "${DICEE_ENV:-}" == "$DICEE_TEST_STAGE" ]] || exit 93
		for name in INFISICAL_API_URL INFISICAL_PROJECT_ID INFISICAL_PROJECT_SLUG INFISICAL_ORG_NAME INFISICAL_IDENTITY_NAME INFISICAL_IDENTITY_ID; do
			[[ "${!name:-}" == synthetic-metadata ]] || exit 93
		done
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
export INFISICAL_CLIENT_ID="$ambient_value"
export INFISICAL_CLIENT_SECRET="$ambient_value"

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

for lane in cloudflare elevenlabs infisical; do
	export DICEE_TEST_LANE="$lane"
	export DICEE_TEST_STAGE=dev
	case "$lane" in
		cloudflare)
			wrapper=("$PROJECT_ROOT/scripts/with-dicee-cloudflare.sh")
			fields=(api-token)
			;;
		elevenlabs)
			wrapper=("$PROJECT_ROOT/scripts/with-dicee-elevenlabs-local.sh")
			fields=(api-key)
			;;
		infisical)
			wrapper=("$PROJECT_ROOT/scripts/with-dicee-infisical-auth.sh" dev)
			fields=(client-id client-secret)
			;;
	esac
	export DICEE_TEST_READ_MODE=success DICEE_TEST_READ_FIELD=""
	for child_status in 0 37; do
		export DICEE_TEST_CHILD_STATUS="$child_status"
		assert_run "$child_status" yes "${wrapper[@]}"
	done
	export DICEE_TEST_CHILD_STATUS=0
	for field in "${fields[@]}"; do
		export DICEE_TEST_READ_FIELD="$field"
		export DICEE_TEST_READ_MODE=failure
		assert_run 23 no "${wrapper[@]}"
		export DICEE_TEST_READ_MODE=empty
		assert_run 1 no "${wrapper[@]}"
	done
	printf 'ok: %s delivery, arguments, exit status, failed and empty reads\n' "$lane"
done

# Preserve both additional Infisical stage selectors while its retired launcher
# remains present; this test still uses only the synthetic provider.
export DICEE_TEST_READ_MODE=success DICEE_TEST_READ_FIELD=""
for stage in staging prod; do
	export DICEE_TEST_STAGE="$stage"
	assert_run 0 yes "$PROJECT_ROOT/scripts/with-dicee-infisical-auth.sh" "$stage"
done

printf 'Credential wrapper tests passed.\n'
