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

Then connect Claude Code to a workspace:

```bash
galagent login
galagent connect <workspace-id> --claude
```

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

Direct MCP/API use is for custom workflows. The normal experience is:

```bash
galagent connect <workspace-id> --claude
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
