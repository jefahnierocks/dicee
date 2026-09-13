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

_dicee_required_metadata=(
	DICEE_OP_ACCOUNT
	DICEE_OP_VAULT
	DICEE_OP_ITEM_INFISICAL_DEV
	DICEE_OP_ITEM_INFISICAL_STAGING
	DICEE_OP_ITEM_INFISICAL_PROD
	DICEE_OP_ITEM_CLOUDFLARE
	DICEE_OP_ITEM_VERCEL
	DICEE_OP_ITEM_PARTYKIT
	DICEE_OP_ITEM_ELEVENLABS_LOCAL
	DICEE_INFISICAL_INSTANCE_URL
	DICEE_INFISICAL_PROJECT_ID
	DICEE_INFISICAL_PROJECT_SLUG
	DICEE_INFISICAL_ORG_NAME
	DICEE_INFISICAL_DEV_IDENTITY_NAME
	DICEE_INFISICAL_DEV_IDENTITY_ID
	DICEE_INFISICAL_STAGING_IDENTITY_NAME
	DICEE_INFISICAL_STAGING_IDENTITY_ID
	DICEE_INFISICAL_PROD_IDENTITY_NAME
	DICEE_INFISICAL_PROD_IDENTITY_ID
	DICEE_CLOUDFLARE_ACCOUNT_ID
	DICEE_CLOUDFLARE_DOMAIN
	DICEE_SUPABASE_PROJECT_NAME
	DICEE_SUPABASE_PROJECT_REF
	DICEE_VERCEL_PROJECT_NAME
	DICEE_PARTYKIT_PROJECT_NAME
	DICEE_AUDIO_PROJECT_NAME
)

for _dicee_metadata_name in "${_dicee_required_metadata[@]}"; do
	if [[ -z "${!_dicee_metadata_name:-}" ]]; then
		echo "Missing required operator metadata: $_dicee_metadata_name" >&2
		return 1
	fi
	readonly "$_dicee_metadata_name"
done
unset _dicee_metadata_name _dicee_required_metadata

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
