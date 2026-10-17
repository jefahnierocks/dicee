#!/usr/bin/env bash
# Explicitly include the stdlib Python adapter fixtures in the native shell lane.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"${DICEE_MANIFEST_PYTHON:-python3}" -I -S -B "$project_root/scripts/tests/test_project_manifest.py"
