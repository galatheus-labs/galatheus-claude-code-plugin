---
description: Use when connecting Claude Code to Galatheus Canvas work, claiming ticket-backed canvas tasks, inspecting canvas state, or creating canvas goals, notes, evidence, decisions, and ticket cards.
---

# Galatheus Canvas Agent

Galatheus Canvas is the shared object graph for humans and user-owned agents.
Tickets are backed by the Galatheus ticket service; goals, notes, evidence, and
decisions stay visible on the canvas as machine-legible context.

## Default Flow

Prefer the built-in galagent lifecycle:

```bash
galagent login
galagent connect <workspace-id> --claude
```

`galagent connect` registers Claude Code while it is running, claims
ticket-backed work, provides the default prompt, completes ticket lifecycle
calls, writes canvas context when needed, and unregisters when the process exits.

## Direct MCP Tools

Use the MCP tools only when the session has a `GALATHEUS_API_KEY` or
`GALATHEUS_AGENT_API_KEY` environment variable:

- `galatheus_canvas_state`: read the materialized canvas state and cursor.
- `galatheus_canvas_events`: read changes after a saved cursor.
- `galatheus_canvas_create_object`: create canvas goals, notes, evidence,
  decisions, or ticket-backed task cards.
- `galatheus_ticket_create`: create a ticket through the ticket service.

Always save `cursor.next` after a successful state read or event poll.
Do not create proxy tickets in local canvas storage; ticket cards must be backed
by `/v1/tickets`.
