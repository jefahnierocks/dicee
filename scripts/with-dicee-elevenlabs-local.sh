#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/dicee-operator-metadata.sh"

usage() {
	cat <<'EOF' >&2
Usage:
  ./scripts/with-dicee-elevenlabs-local.sh -- <command> [args...]
EOF
	exit 1
}

[[ $# -ge 2 ]] || usage
[[ "${1:-}" == "--" ]] || usage
shift

dicee_require_op

ELEVENLABS_API_KEY="$(dicee_op_read "$DICEE_OP_ITEM_ELEVENLABS_LOCAL" api-key)"
if [[ -z "$ELEVENLABS_API_KEY" ]]; then
	printf 'Missing required credential: ELEVENLABS_API_KEY\n' >&2
	exit 1
fi

export ELEVENLABS_API_KEY
exec "$@"
