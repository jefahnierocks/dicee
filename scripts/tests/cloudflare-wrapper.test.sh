#!/usr/bin/env bash
# Value-free regression test for the Cloudflare operator wrapper.
# Everything is synthetic: the real 1Password CLI and Cloudflare are never used.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRAPPER="$PROJECT_ROOT/scripts/with-dicee-cloudflare.sh"
LIB="$PROJECT_ROOT/scripts/lib/dicee-operator-metadata.sh"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-cf-operator-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

metadata_file="$work_dir/operator-metadata.sh"
bin_dir="$work_dir/bin"
env_marker="$work_dir/intermediate-env-called"
mkdir -p "$bin_dir"

# Build complete synthetic operator metadata from the loader's required-variable
# list so this test stays aligned as metadata evolves.
required_names=()
while IFS= read -r name; do
	[[ -n "$name" ]] && required_names+=("$name")
done < <(
	awk '
		/^_dicee_required_metadata=\(/ { in_list = 1; next }
		in_list && /^\)/ { exit }
		in_list { print $1 }
	' "$LIB"
)

if [[ "${#required_names[@]}" -eq 0 ]]; then
	printf 'FAIL: could not read required operator metadata names\n' >&2
	exit 1
fi

{
	for name in "${required_names[@]}"; do
		case "$name" in
			DICEE_OP_ACCOUNT)
				printf '%s=%q\n' "$name" "SYNTHETIC_ACCOUNT"
				;;
			DICEE_OP_VAULT)
				printf '%s=%q\n' "$name" "SYNTHETIC_VAULT"
				;;
			DICEE_OP_ITEM_CLOUDFLARE)
				printf '%s=%q\n' "$name" "SYNTHETIC_CLOUDFLARE_ITEM"
				;;
			DICEE_CLOUDFLARE_ACCOUNT_ID)
				printf '%s=%q\n' "$name" "SYNTHETIC_CF_ACCOUNT"
				;;
			*)
				printf '%s=%q\n' "$name" "synthetic-value"
				;;
		esac
	done
} > "$metadata_file"

# Stub 1Password. The real `op` executable cannot be reached by the wrapper.
cat > "$bin_dir/op" <<'EOF_OP'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
	vault)
		exit 0
		;;
	read)
		printf '%s' 'synthetic-cloudflare-token'
		;;
	*)
		printf 'unexpected synthetic op invocation\n' >&2
		exit 2
		;;
esac
EOF_OP

# Deliberately shadow `env`. The old wrapper reaches this executable because it
# performs `exec env NAME=value ...`. The corrected wrapper must never reach it.
cat > "$bin_dir/env" <<'EOF_ENV'
#!/usr/bin/env bash
set -euo pipefail
printf 'called\n' > "${DICEE_TEST_ENV_MARKER:?}"
printf 'FAIL: Cloudflare wrapper invoked an intermediate env command\n' >&2
exit 97
EOF_ENV

# Synthetic child command: prove the corrected wrapper exports the values and
# preserves the supplied command arguments.
cat > "$bin_dir/probe" <<'EOF_PROBE'
#!/usr/bin/env bash
set -euo pipefail

printf 'account=%s\n' "${CLOUDFLARE_ACCOUNT_ID:-}"
printf 'token=%s\n' "${CLOUDFLARE_API_TOKEN:-}"
printf 'argc=%s\n' "$#"

for arg in "$@"; do
	printf 'arg=%s\n' "$arg"
done
EOF_PROBE

chmod +x "$bin_dir/op" "$bin_dir/env" "$bin_dir/probe"

export DICEE_OPERATOR_METADATA_FILE="$metadata_file"
export DICEE_TEST_ENV_MARKER="$env_marker"

status=0
output="$(
	PATH="$bin_dir:$PATH" \
		"$WRAPPER" -- probe alpha "beta gamma" 2>&1
)" || status=$?

if [[ -e "$env_marker" ]]; then
	printf 'FAIL: wrapper exposed credential assignments through intermediate env argv\n' >&2
	exit 1
fi

if [[ "$status" -ne 0 ]]; then
	printf 'FAIL: wrapper exited %d\n%s\n' "$status" "$output" >&2
	exit 1
fi

expected=$'account=SYNTHETIC_CF_ACCOUNT\ntoken=synthetic-cloudflare-token\nargc=2\narg=alpha\narg=beta gamma'

if [[ "$output" != "$expected" ]]; then
	printf 'FAIL: child environment/arguments differ\n' >&2
	printf 'expected:\n%s\n\nactual:\n%s\n' "$expected" "$output" >&2
	exit 1
fi

printf 'Cloudflare wrapper environment tests passed.\n'
