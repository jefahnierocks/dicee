#!/usr/bin/env bash
# Pre-Compact Archive Hook
# Archives state files before Claude compacts session history

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"
cd "$PROJECT_DIR"

TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
ARCHIVE_DIR=".claude/state/archives"

# Ensure archive directory exists
mkdir -p "$ARCHIVE_DIR"

# Archive current state files
if [ -f .claude/state/memory.jsonl ]; then
    cp .claude/state/memory.jsonl "$ARCHIVE_DIR/memory-$TIMESTAMP.jsonl"
fi

if [ -f .claude/state/current-phase.json ]; then
    cp .claude/state/current-phase.json "$ARCHIVE_DIR/phase-$TIMESTAMP.json"
fi

# Clean up old archives (keep last 10)
ls -t "$ARCHIVE_DIR"/memory-*.jsonl 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
ls -t "$ARCHIVE_DIR"/phase-*.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

echo "State archived to $ARCHIVE_DIR" >&2
exit 0
