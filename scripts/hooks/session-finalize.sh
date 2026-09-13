#!/usr/bin/env bash
# Session Finalization Hook
# Persists state at session end

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"
AGENT_NAME="${AGENT_NAME:-claude-code}"
cd "$PROJECT_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE=".claude/state/tool-log.jsonl"

# Log session end to tool log (not memory.jsonl - owned by MCP)
echo "{\"type\":\"session_end\",\"timestamp\":\"$TIMESTAMP\",\"agent\":\"$AGENT_NAME\"}" >> "$LOG_FILE"

# Update lastUpdated in current-phase.json
if [ -f .claude/state/current-phase.json ]; then
    # Use temp file to avoid in-place editing issues
    jq ".lastUpdated = \"$TIMESTAMP\" | .lastAgent = \"$AGENT_NAME\"" \
        .claude/state/current-phase.json > .claude/state/current-phase.json.tmp && \
        mv .claude/state/current-phase.json.tmp .claude/state/current-phase.json
fi

echo "Session finalized at $TIMESTAMP" >&2
exit 0
