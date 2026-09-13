#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/dicee-operator-metadata.sh"

usage() {
	cat <<'EOF' >&2
Usage:
  ./scripts/with-dicee-cloudflare.sh -- <command> [args...]
EOF
	exit 1
}

[[ $# -ge 2 ]] || usage
[[ "${1:-}" == "--" ]] || usage
shift

dicee_require_op

token="$(dicee_op_read "$DICEE_OP_ITEM_CLOUDFLARE" api-token)"

exec env \
	CLOUDFLARE_ACCOUNT_ID="$DICEE_CLOUDFLARE_ACCOUNT_ID" \
	CLOUDFLARE_API_TOKEN="$token" \
	"$@"
