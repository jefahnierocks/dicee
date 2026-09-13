#!/usr/bin/env bash
# Log Tool Use Hook
# Logs significant tool operations to a separate log file
# NOTE: Do NOT write to memory.jsonl - that's owned by MCP memory server

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"
AGENT_NAME="${AGENT_NAME:-claude-code}"
cd "$PROJECT_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE=".claude/state/tool-log.jsonl"

# Read tool info from stdin (JSON format from Claude Code)
TOOL_INFO=$(cat)

# Extract tool name if available
TOOL_NAME=$(echo "$TOOL_INFO" | jq -r '.tool_name // "unknown"' 2>/dev/null || echo "unknown")

# Log to separate tool log file (not memory.jsonl which is owned by MCP)
echo "{\"type\":\"tool_use\",\"tool\":\"$TOOL_NAME\",\"timestamp\":\"$TIMESTAMP\",\"agent\":\"$AGENT_NAME\"}" >> "$LOG_FILE"

# Keep log file manageable (last 500 entries)
if [ -f "$LOG_FILE" ]; then
    LINE_COUNT=$(wc -l < "$LOG_FILE")
    if [ "$LINE_COUNT" -gt 500 ]; then
        tail -250 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
fi

exit 0
