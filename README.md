# Galatheus Canvas for Claude Code

This repo is a Claude Code plugin marketplace for Galatheus Canvas.

It provides the `canvas` plugin, which adds:

- a Galatheus Canvas skill for Claude Code,
- an MCP server for reading canvas state and writing canvas objects,
- the recommended `galagent connect <workspace-id> --claude` runtime flow.

## Install

Inside Claude Code:

```text
/plugin marketplace add galatheus-labs/galatheus-claude-code-plugin
/plugin install canvas@galatheus
```

For local checkout development:

```bash
claude plugin marketplace add "$PWD" --scope user
claude plugin install canvas@galatheus
```

## Login And Agent Runtime

Login is owned by `galagent`, not by the Claude Code plugin. Install
`galagent` first on the machine where Claude Code will run:

```bash
curl -fsSL https://galatheus.dev/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
galagent --help
```

Packaged downloads are also listed at
`https://galatheus.dev/onboarding.html#download`.

Then open the Canvas Agents view at
`https://app.galatheus.dev/w/<workspace-id>`, click **Generate Login**, and run
the generated command. It has this shape:

```bash
printf '%s' '<shown-once-api-key>' | galagent login canvas --token-stdin
galagent doctor --json
galagent workspace list --json
```

To turn a Claude Code run into a Canvas ticket agent, use the Canvas project id
from `https://app.galatheus.dev/w/<workspace-id>`:

```bash
galagent connect <canvas-workspace-id> --claude
```

`galagent connect` registers this machine as a `code-agent`, claims
`canvas_task` tickets for that Canvas project, runs `claude -p`, completes the
ticket, and unregisters the agent on exit.

If `galagent connect` is missing, the installed `galagent` binary is stale.
Install the current Galatheus CLI with `https://galatheus.dev/install.sh`
before the demo.

## Optional Direct MCP Use

The installed MCP server can call `https://api.galatheus.dev` directly when the
Claude Code process has one of these environment variables:

```bash
export GALATHEUS_API_KEY="<api key from your Galatheus workspace>"
# or
export GALATHEUS_AGENT_API_KEY="<agent key>"
```

Available tools:

- `galatheus_canvas_state`
- `galatheus_canvas_events`
- `galatheus_canvas_create_object`
- `galatheus_ticket_create`
- `galatheus_login_status`
- `galatheus_agent_command`

Direct MCP/API use is for custom workflows. The normal experience is:

```bash
galagent connect <canvas-workspace-id> --claude
```

## Development

Test locally with Claude Code:

```bash
claude --plugin-dir ./plugins/canvas
```

Smoke test the MCP server:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/canvas/bin/galatheus-canvas-mcp.js
```
