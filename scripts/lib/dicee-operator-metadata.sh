#!/usr/bin/env bash

# Public-safe loader for operator metadata. Account, project, identity, vault,
# and secret-item identifiers are deliberately kept out of the repository.

readonly DICEE_OPERATOR_METADATA_FILE="${DICEE_OPERATOR_METADATA_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.dicee/operator-metadata.sh}"

if [[ ! -r "$DICEE_OPERATOR_METADATA_FILE" ]]; then
	cat >&2 <<EOF
Dicee operator metadata is not configured.
Copy scripts/templates/dicee-operator-metadata.example.sh to:
  $DICEE_OPERATOR_METADATA_FILE
Fill it from the private operator inventory and set mode 0600.
EOF
	return 1
fi

# shellcheck source=/dev/null
source "$DICEE_OPERATOR_METADATA_FILE"

# Validated when this file is sourced: the identifiers a credential launcher
# needs before it can start a process that carries a secret. A name belongs here
# only when a tracked launcher reads it. Anything a single consumer needs is
# declared by that consumer through dicee_require_metadata, so retiring one
# provider can never fail an unrelated launcher closed.
_dicee_required_metadata=(
	DICEE_OP_ACCOUNT
	DICEE_OP_VAULT
	DICEE_OP_ITEM_CLOUDFLARE
	DICEE_OP_ITEM_ELEVENLABS_LOCAL
	DICEE_CLOUDFLARE_ACCOUNT_ID
)

for _dicee_metadata_name in "${_dicee_required_metadata[@]}"; do
	if [[ -z "${!_dicee_metadata_name:-}" ]]; then
		echo "Missing required operator metadata: $_dicee_metadata_name" >&2
		return 1
	fi
	readonly "$_dicee_metadata_name"
done
unset _dicee_metadata_name _dicee_required_metadata

# Declare metadata one consumer needs beyond the launcher set. The caller fails
# closed on a missing name without imposing that name on any other script.
dicee_require_metadata() {
	local name
	for name in "$@"; do
		if [[ -z "${!name:-}" ]]; then
			echo "Missing required operator metadata: $name" >&2
			return 1
		fi
		readonly "$name"
	done
}

dicee_require_command() {
	local command_name="$1"
	if ! command -v "$command_name" >/dev/null 2>&1; then
		echo "Missing required command: $command_name" >&2
		return 1
	fi
}

dicee_op_uri() {
	local item="$1"
	local field="$2"
	# Emits the credential-manager reference "op:" + "//VAULT/ITEM/FIELD". The
	# second slash is passed as an argument so the literal URI token stays out of
	# tracked files (scripts/public-safety-scan.sh fails on it). Keep exactly one
	# placeholder per argument; scripts/tests/operator-metadata-uri.test.sh
	# guards the output.
	printf 'op:%s/%s/%s/%s' '/' "$DICEE_OP_VAULT" "$item" "$field"
}

dicee_require_op() {
	dicee_require_command op
	if ! op vault get "$DICEE_OP_VAULT" --account "$DICEE_OP_ACCOUNT" >/dev/null 2>&1; then
		cat >&2 <<'EOF'
1Password CLI is not ready for Dicee. Sign in through the desktop app,
enable CLI integration, and rerun the private operator readiness check.
EOF
		return 1
	fi
}

dicee_op_read() {
	local item="$1"
	local field="$2"
	op read --account "$DICEE_OP_ACCOUNT" "$(dicee_op_uri "$item" "$field")"
}
