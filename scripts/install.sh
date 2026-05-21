#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude is required to install the Galatheus Cloud plugin." >&2
  exit 1
fi

claude plugin validate "$ROOT" >/dev/null
claude plugin validate "$ROOT/plugins/galatheus" >/dev/null
claude plugin marketplace add "$ROOT" --scope user >/dev/null 2>&1 || true
claude plugin marketplace update galatheus >/dev/null 2>&1 || true
if claude plugin list 2>/dev/null | grep -q "canvas@galatheus"; then
  claude plugin uninstall canvas@galatheus --yes >/dev/null 2>&1 || true
fi
if claude plugin list 2>/dev/null | grep -q "galatheus@galatheus"; then
  claude plugin update galatheus@galatheus >/dev/null || {
    claude plugin uninstall galatheus@galatheus --yes >/dev/null
    claude plugin install galatheus@galatheus >/dev/null
  }
else
  claude plugin install galatheus@galatheus >/dev/null
fi

if ! command -v galagent >/dev/null 2>&1; then
  echo "Warning: galagent is not on PATH. Install galagent before running Canvas agents:" >&2
  echo "  curl -fsSL https://galatheus.dev/install.sh | sh" >&2
elif ! galagent --help 2>/dev/null | grep -q "connect WORKSPACE_ID"; then
  echo "Warning: galagent is installed but does not support 'galagent connect'." >&2
  echo "Install the current Galatheus CLI before running Canvas agents:" >&2
  echo "  curl -fsSL https://galatheus.dev/install.sh | sh" >&2
fi

echo "Installed Galatheus Cloud plugin for Claude Code."
echo "Next:"
echo "  Install galagent first if it is missing: curl -fsSL https://galatheus.dev/install.sh | sh"
echo "  Open https://app.galatheus.dev/w/<workspace-id> and run the generated galagent login command"
echo "  galagent connect <workspace-id> --claude"
