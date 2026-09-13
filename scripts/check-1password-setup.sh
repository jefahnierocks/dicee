#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/dicee-operator-metadata.sh"

quiet=false
if [[ "${1:-}" == "--quiet" ]]; then
	quiet=true
	shift
fi

log() {
	if [[ "$quiet" == false ]]; then
		echo "$@"
	fi
}

check_field() {
	local item="$1"
	local field="$2"
	local label="$3"
	local optional="${4:-false}"

	if op read --account "$DICEE_OP_ACCOUNT" "$(dicee_op_uri "$item" "$field")" >/dev/null 2>&1; then
		log "ok  $label"
		return 0
	fi

	if [[ "$optional" == "true" ]]; then
		log "warn $label (optional, deferred until rotated or needed)"
		return 0
	fi

	log "missing $label"
	return 1
}

dicee_require_op

log "Dicee local bootstrap secret contract"
log "1Password account: $DICEE_OP_ACCOUNT"
log "1Password vault:   $DICEE_OP_VAULT"
log "Infisical runtime authority remains: $DICEE_INFISICAL_PROJECT_SLUG ($DICEE_INFISICAL_INSTANCE_URL)"
log

check_field "$DICEE_OP_ITEM_INFISICAL_DEV" client-id "development Infisical client-id"
check_field "$DICEE_OP_ITEM_INFISICAL_DEV" client-secret "development Infisical client-secret"
check_field "$DICEE_OP_ITEM_INFISICAL_STAGING" client-id "staging Infisical client-id"
check_field "$DICEE_OP_ITEM_INFISICAL_STAGING" client-secret "staging Infisical client-secret"
check_field "$DICEE_OP_ITEM_INFISICAL_PROD" client-id "production Infisical client-id"
check_field "$DICEE_OP_ITEM_INFISICAL_PROD" client-secret "production Infisical client-secret"
check_field "$DICEE_OP_ITEM_CLOUDFLARE" api-token "Cloudflare API token"

check_field "$DICEE_OP_ITEM_VERCEL" token "dicee-vercel-api/token" true
check_field "$DICEE_OP_ITEM_PARTYKIT" token "dicee-partykit-api/token" true
check_field "$DICEE_OP_ITEM_ELEVENLABS_LOCAL" api-key "ElevenLabs API key" true

if [[ "$quiet" == false ]]; then
	cat <<EOF

Non-secret metadata stays in repo:
  Infisical project id: $DICEE_INFISICAL_PROJECT_ID
  Supabase project ref: $DICEE_SUPABASE_PROJECT_REF
  Cloudflare account id: $DICEE_CLOUDFLARE_ACCOUNT_ID
EOF
fi
