#!/usr/bin/env bash
# Local-only project checks exposed to agent tooling. Some checks rebuild tracked
# generated output; none perform remote operations.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

case "${1:-help}" in
  quality-gate)
    exec ./scripts/quality-gate.sh "${@:2}"
    ;;
  public-safety)
    exec ./scripts/public-safety-scan.sh
    ;;
  check-errors)
    pnpm check
    pnpm biome:check
    pnpm build
    ;;
  status)
    git status --short --branch
    ;;
  help|*)
    cat <<'EOF'
Dicee agent checks (local-only; quality/build checks may update generated files)

  quality-gate   Run the repository quality gate
  public-safety  Scan the publication candidate
  check-errors   Run type, lint, and build checks
  status         Show local Git status

Deployment and log-tail commands are intentionally not exposed through an MCP
wrapper. Use the reviewed, manually dispatched GitHub deployment workflow.
EOF
    ;;
esac
