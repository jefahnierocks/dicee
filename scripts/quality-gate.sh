#!/usr/bin/env bash
# Local completion gate: `pnpm validate:ci` (validate, the high-severity
# dependency audit, and the public-safety scan). The dependency audit queries the
# package registry; live Cloudflare/Supabase services and generated remote
# database types are intentionally outside this gate.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
cd "$PROJECT_DIR"

case "${1:-}" in
  "") ;;
  --fix)
    pnpm format
    ;;
  *)
    echo "Usage: $0 [--fix]" >&2
    exit 2
    ;;
esac

pnpm validate:ci
