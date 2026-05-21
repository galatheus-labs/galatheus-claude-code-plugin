---
description: Use when connecting Claude Code to Galatheus Cloud workspaces and Canvas work, claiming ticket-backed canvas tasks, inspecting canvas state, or creating canvas goals, notes, evidence, decisions, and ticket cards.
---

# Galatheus Cloud Canvas Agent

Galatheus Cloud owns tenant and workspace scope. Galatheus Canvas is the shared
object graph for humans and user-owned agents inside that cloud offering.
Tickets are backed by the Galatheus ticket service; goals, notes, evidence, and
decisions stay visible on the canvas as machine-legible context.

## Default Flow

Login and agent lifecycle are owned by `galagent`, not by the plugin. Install
`galagent` first with `curl -fsSL https://galatheus.dev/install.sh | sh`. The
Canvas Agents view generates the one-time login command from the signed-in
browser session.
Prefer the built-in galagent lifecycle:

```bash
printf '%s' '<shown-once-api-key>' | galagent login canvas --token-stdin
galagent doctor --json
galagent workspace list --json
galagent connect <workspace-id> --claude
```

Use the workspace id from `https://app.galatheus.dev/w/<workspace-id>`.
Do not substitute a tenant id. If `galagent connect` is unavailable, the local
Galatheus CLI is stale and must be updated before using this plugin as an
agent runtime.

`galagent connect` registers Claude Code while it is running, claims
ticket-backed work, provides the default prompt, completes ticket lifecycle
calls, writes canvas context when needed, and unregisters when the process exits.

## Normal Claude Code Session Commands

Use `/galatheus:workspaces` to list workspace ids available to this login.
Use `/galatheus:canvas-state` to show ticket-backed Canvas work without
changing it. Use `/galatheus:canvas-work` when the user wants this Claude Code
session to claim and work a Canvas ticket directly.

Scope is always described as `tenant -> workspace -> project`. No workspace
argument means tenant scope. `--workspace <id>` narrows to one workspace.
`--workspace <id> --project <id>` narrows to one project. Use `--project "*"`
for all projects in that workspace. Avoid comma-separated scope lists; run
multiple agents or multiple commands for multiple scopes.

Do not start working tickets unprompted. Wait for the user to invoke
`/galatheus:canvas-work`, run `galagent connect <workspace-id> --claude`, or
otherwise ask for ticket work.

## Direct MCP Tools

Use the MCP tools only when the session has a `GALATHEUS_API_KEY` or
`GALATHEUS_AGENT_API_KEY` environment variable, or when local `galagent` login
is available for ticket lifecycle fallback:

In plugin-loaded Claude Code sessions, these tools are usually exposed as
`mcp__plugin_galatheus_galatheus_cloud__galatheus_*`. In direct MCP smoke
tests, they may appear as `mcp__galatheus_cloud__galatheus_*`.

`galagent connect <workspace-id> --claude` injects this environment for the
launched Claude Code runtime.

- `galatheus_canvas_state`: read the materialized canvas state and cursor.
- `galatheus_canvas_events`: read changes after a saved cursor.
- `galatheus_canvas_create_object`: create canvas goals, notes, evidence,
  decisions, or ticket-backed task cards.
- `galatheus_workspace_list`: list Galatheus Cloud workspaces available to the
  current login.
- `galatheus_ticket_create`: create a ticket through the ticket service.
- `galatheus_ticket_list`: list ticket-backed work for the current workspace.
- `galatheus_ticket_get`: read one ticket.
- `galatheus_ticket_claim`: claim one ticket.
- `galatheus_ticket_comment`: add a ticket comment event.
- `galatheus_ticket_events`: read a ticket event history.
- `galatheus_ticket_complete`: complete a ticket with a result summary.
- `galatheus_ticket_reject`: reject or close an invalid ticket with a reason.
- `galatheus_login_status`: check local galagent readiness without revealing
  tokens.
- `galatheus_agent_command`: render the correct `galagent connect` command for
  a Codex or Claude runtime.
- `galatheus_agent_instructions`: render Galatheus runtime instructions for
  Claude or Codex.

Always save `cursor.next` after a successful state read or event poll.
Do not create proxy tickets in local canvas storage; ticket cards must be backed
by `/v1/tickets`.
