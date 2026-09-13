#!/usr/bin/env bash
# Session Initialization Hook
# Loads current project state at session start

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"
AGENT_NAME="${AGENT_NAME:-claude-code}"
cd "$PROJECT_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
LOG_FILE=".claude/state/tool-log.jsonl"

# Log session start to tool log (not memory.jsonl - owned by MCP)
echo "{\"type\":\"session_start\",\"timestamp\":\"$TIMESTAMP\",\"agent\":\"$AGENT_NAME\"}" >> "$LOG_FILE"

# Show current phase (to stderr so it appears in hook output)
if [ -f .claude/state/current-phase.json ]; then
    PHASE=$(jq -r '.currentPhase // "unknown"' .claude/state/current-phase.json 2>/dev/null || echo "unknown")
    echo "Session started | Phase: $PHASE" >&2
fi

# Check for blockers
if [ -f .claude/state/blockers.json ]; then
    BLOCKER_COUNT=$(jq '.blockers | length' .claude/state/blockers.json 2>/dev/null || echo "0")
    if [ "$BLOCKER_COUNT" -gt "0" ]; then
        echo "Warning: $BLOCKER_COUNT active blocker(s)" >&2
    fi
fi

# Check AKG graph freshness (silent if OK, warn if stale)
AKG_GRAPH="docs/architecture/akg/graph/current.json"
if [ -f "$AKG_GRAPH" ]; then
    # Get graph age in hours
    GRAPH_MTIME=$(stat -f %m "$AKG_GRAPH" 2>/dev/null || stat -c %Y "$AKG_GRAPH" 2>/dev/null || echo "0")
    NOW=$(date +%s)
    AGE_HOURS=$(( (NOW - GRAPH_MTIME) / 3600 ))

    if [ "$AGE_HOURS" -gt 24 ]; then
        echo "AKG: Graph is ${AGE_HOURS}h old - consider running 'pnpm akg:discover'" >&2
    fi

    # Check node count from graph
    NODE_COUNT=$(jq '.nodes | length' "$AKG_GRAPH" 2>/dev/null || echo "0")
    EDGE_COUNT=$(jq '.edges | length' "$AKG_GRAPH" 2>/dev/null || echo "0")
    echo "AKG: ${NODE_COUNT} nodes, ${EDGE_COUNT} edges" >&2
fi

exit 0
