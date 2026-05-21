#!/usr/bin/env bash
# SessionStart hook for the Galatheus Cloud plugin.
#
# Stays silent unless this machine/session appears to be connected to
# Galatheus. Environment credentials are enough; otherwise, a local galagent
# login is enough. The hook does not print secrets and does not fetch tickets.
set -uo pipefail

API_URL="${GALATHEUS_API_URL:-https://api.galatheus.dev}"
WORKSPACE_ID="${GALATHEUS_WORKSPACE_ID:-${GALATHEUS_WORKSPACE:-${GALATHEUS_CANVAS_WORKSPACE_ID:-}}}"
CONNECTED=0
SOURCE=""

if [ -n "${GALATHEUS_AGENT_API_KEY:-}" ] || [ -n "${GALATHEUS_API_KEY:-}" ] || [ -n "${GALATHEUS_TOKEN:-}" ]; then
  CONNECTED=1
  SOURCE="environment credentials"
elif command -v galagent >/dev/null 2>&1; then
  DOCTOR="$(galagent --json doctor 2>/dev/null || true)"
  if printf '%s' "$DOCTOR" | grep -q '"hasToken"[[:space:]]*:[[:space:]]*true'; then
    CONNECTED=1
    SOURCE="local galagent login"
    if [ -z "$WORKSPACE_ID" ]; then
      WORKSPACE_ID="$(printf '%s' "$DOCTOR" | sed -n 's/.*"workspace"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    fi
  fi
fi

if [ "$CONNECTED" -ne 1 ]; then
  exit 0
fi

cat <<EOF
Galatheus Cloud is available in this session (${SOURCE}; API: ${API_URL}).

- \`/galatheus:workspaces\`   - list workspace ids available to this login.
- \`/galatheus:canvas-state\` - show scoped Canvas work state for a code agent.
- \`/galatheus:canvas-work\`  - claim and work a Canvas ticket in this Claude Code session.

Do not start working Canvas tickets unprompted. Wait for the user to invoke
\`/galatheus:canvas-work\` or ask for ticket work.
EOF

if [ -n "$WORKSPACE_ID" ]; then
  cat <<EOF

Current Galatheus workspace: ${WORKSPACE_ID}
Managed runtime alternative: \`galagent connect ${WORKSPACE_ID} --claude\`
EOF
else
  cat <<EOF

Pass a workspace id to \`/galatheus:canvas-state\` or
\`/galatheus:canvas-work\`, or launch the managed runtime with
\`galagent connect <workspace-id> --claude\`.
EOF
fi
