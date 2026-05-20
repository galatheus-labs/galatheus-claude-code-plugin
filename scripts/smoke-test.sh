#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

claude plugin validate "$ROOT" >/dev/null
claude plugin validate "$ROOT/plugins/canvas" >/dev/null

node "$ROOT/plugins/canvas/bin/galatheus-canvas-mcp.js" <<'JSON' | grep -q '"galatheus_login_status"'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
JSON

if ! command -v galagent >/dev/null 2>&1; then
  echo "galagent not found" >&2
  exit 1
fi
if ! galagent --help 2>/dev/null | grep -q "connect WORKSPACE_ID"; then
  echo "galagent does not support 'galagent connect'; update galagent before demoing Canvas agents." >&2
  exit 1
fi

echo "Claude Code plugin smoke test passed."
