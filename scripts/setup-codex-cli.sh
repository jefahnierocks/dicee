#!/usr/bin/env bash
# Validate the repository-scoped Codex setup without changing user config.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is not installed or not on PATH" >&2
  exit 1
fi

cd "$PROJECT_DIR"
codex --version
codex features list >/dev/null

echo "Project config parsed successfully: $PROJECT_DIR/.codex/config.toml"
echo "Trust this repository in Codex to load project configuration and custom agents."
