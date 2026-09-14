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

export CLOUDFLARE_ACCOUNT_ID="$DICEE_CLOUDFLARE_ACCOUNT_ID"
export CLOUDFLARE_API_TOKEN
CLOUDFLARE_API_TOKEN="$(dicee_op_read "$DICEE_OP_ITEM_CLOUDFLARE" api-token)"

exec "$@"
