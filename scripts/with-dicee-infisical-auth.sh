#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/dicee-operator-metadata.sh"

usage() {
	cat <<'EOF' >&2
Usage:
  ./scripts/with-dicee-infisical-auth.sh <dev|staging|prod> -- <command> [args...]
EOF
	exit 1
}

[[ $# -ge 3 ]] || usage

environment="$1"
shift
[[ "${1:-}" == "--" ]] || usage
shift
[[ $# -ge 1 ]] || usage

item=""
identity_name=""
identity_id=""

case "$environment" in
dev)
	item="$DICEE_OP_ITEM_INFISICAL_DEV"
	identity_name="$DICEE_INFISICAL_DEV_IDENTITY_NAME"
	identity_id="$DICEE_INFISICAL_DEV_IDENTITY_ID"
	;;
staging)
	item="$DICEE_OP_ITEM_INFISICAL_STAGING"
	identity_name="$DICEE_INFISICAL_STAGING_IDENTITY_NAME"
	identity_id="$DICEE_INFISICAL_STAGING_IDENTITY_ID"
	;;
prod)
	item="$DICEE_OP_ITEM_INFISICAL_PROD"
	identity_name="$DICEE_INFISICAL_PROD_IDENTITY_NAME"
	identity_id="$DICEE_INFISICAL_PROD_IDENTITY_ID"
	;;
*)
	echo "Unsupported environment: $environment" >&2
	usage
	;;
esac

dicee_require_op

INFISICAL_CLIENT_ID="$(dicee_op_read "$item" client-id)"
if [[ -z "$INFISICAL_CLIENT_ID" ]]; then
	printf 'Missing required credential: INFISICAL_CLIENT_ID\n' >&2
	exit 1
fi

INFISICAL_CLIENT_SECRET="$(dicee_op_read "$item" client-secret)"
if [[ -z "$INFISICAL_CLIENT_SECRET" ]]; then
	printf 'Missing required credential: INFISICAL_CLIENT_SECRET\n' >&2
	exit 1
fi

export \
	DICEE_ENV="$environment" \
	INFISICAL_API_URL="$DICEE_INFISICAL_INSTANCE_URL" \
	INFISICAL_PROJECT_ID="$DICEE_INFISICAL_PROJECT_ID" \
	INFISICAL_PROJECT_SLUG="$DICEE_INFISICAL_PROJECT_SLUG" \
	INFISICAL_ORG_NAME="$DICEE_INFISICAL_ORG_NAME" \
	INFISICAL_IDENTITY_NAME="$identity_name" \
	INFISICAL_IDENTITY_ID="$identity_id" \
	INFISICAL_CLIENT_ID \
	INFISICAL_CLIENT_SECRET

exec "$@"
