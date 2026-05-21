# Galatheus Cloud for Claude Code

This repo is a Claude Code plugin marketplace for Galatheus Cloud.

It provides the `galatheus` plugin, which adds:

- Galatheus Cloud and Canvas skills for Claude Code,
- a session-start hook that surfaces Galatheus commands when auth is available,
- `/galatheus:workspaces`, `/galatheus:canvas-state`, and `/galatheus:canvas-work` command skills for normal Claude Code sessions,
- an MCP server for reading cloud workspace state, reading Canvas state, and writing Canvas objects,
- MCP ticket lifecycle tools for listing, claiming, commenting on, and completing tickets,
- the recommended `galagent connect <workspace-id> --claude` runtime flow.

## Install

Inside Claude Code:

```text
/plugin marketplace add galatheus-labs/galatheus-claude-code-plugin
/plugin install galatheus@galatheus
```

For local checkout development:

```bash
claude plugin marketplace add "$PWD" --scope user
claude plugin install galatheus@galatheus
```

## Normal Claude Code Sessions

When the plugin detects either Galatheus API credentials in the session
environment or a local `galagent` login, it adds a short session-start notice
with the available Galatheus commands:

```text
/galatheus:workspaces
/galatheus:canvas-state
/galatheus:canvas-work
```

`/galatheus:workspaces` is read-only. It lists workspace ids available to the
current login so you can choose a value for `--workspace`.

`/galatheus:canvas-state` is read-only. It shows the scoped Canvas work state
visible to a code agent. By default it uses tenant scope unless you pass a
workspace.

`/galatheus:canvas-work` works in the current Claude Code session: it loads
Galatheus agent instructions, chooses or fetches a ticket, claims it, comments
progress, runs the implementation workflow, and completes the ticket with
evidence.

### Scope Model

Canvas work is scoped as:

```text
tenant -> workspace -> project
```

Normal command usage is:

```text
/galatheus:workspaces
/galatheus:canvas-state
/galatheus:canvas-state --workspace ws_...
/galatheus:canvas-state --workspace ws_... --project prj_...
/galatheus:canvas-state --workspace ws_... --project "*"
```

No workspace means tenant scope. `--workspace "*"` also means all workspaces.
A workspace narrows to that workspace. A project narrows inside that workspace.
`--project "*"` means all projects in the selected workspace. Avoid
comma-separated scope lists; run multiple agents or multiple commands for
multiple scopes.

The ticket tools also support glob or `/regex/` values for `workspace_id` and
`project_id`, plus `title_pattern`, `kind_pattern`, and `ticket_pattern` for
ticket-level narrowing.

The MCP result reports `raw_count`, `filtered_count`, and
`dropped_out_of_scope` so it is clear when a tenant-wide backend response has
been narrowed to the requested workspace or project.

For a long-running managed agent that registers, watches, claims, runs Claude,
and unregisters automatically, use `galagent connect <workspace-id> --claude`
as described below.

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

To turn a Claude Code run into a Canvas ticket agent, use the workspace id from
`https://app.galatheus.dev/w/<workspace-id>`:

```bash
galagent connect <workspace-id> --claude
```

`galagent connect` registers this machine as a `code-agent`, claims
`canvas_task` tickets for that workspace, runs `claude -p`, completes the
ticket, and unregisters the agent on exit. Project-level narrowing can be
done from the command skills or MCP tools when desired.

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

When Claude Code is launched through `galagent connect <workspace-id> --claude`,
`galagent` injects the scoped agent API environment for the MCP server.

Available tools are exposed by Claude Code under the plugin MCP namespace. In a
local `--plugin-dir ./plugins/galatheus` session, that namespace is
`mcp__plugin_galatheus_galatheus_cloud__*`.

Tool names:

- `galatheus_canvas_state`
- `galatheus_canvas_events`
- `galatheus_canvas_create_object`
- `galatheus_login_status`
- `galatheus_agent_command`
- `galatheus_agent_instructions`
- `galatheus_workspace_list`
- `galatheus_ticket_create`
- `galatheus_ticket_list`
- `galatheus_ticket_get`
- `galatheus_ticket_claim`
- `galatheus_ticket_comment`
- `galatheus_ticket_events`
- `galatheus_ticket_complete`
- `galatheus_ticket_reject`

Ticket tools use direct Galatheus API credentials when present. In a normal
Claude Code session with only a local `galagent` login, they fall back to the
`galagent` CLI. Ticket list/get/mutation tools enforce the requested
`tenant -> workspace -> project` scope in the plugin before returning or
mutating scoped tickets.

## Permissions

The first time Claude Code calls one of the Galatheus MCP tools it may ask for
approval. To pre-allow the plugin tools, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__plugin_galatheus_galatheus_cloud__*"]
  }
}
```

For the managed runtime instead of current-session ticket work, run:

```bash
galagent connect <workspace-id> --claude
```

## Development

Test locally with Claude Code:

```bash
claude --plugin-dir ./plugins/galatheus
```

Smoke test the MCP server:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node plugins/galatheus/bin/galatheus-cloud-mcp.js
```

Main plugin layout:

```text
plugins/galatheus/.claude-plugin/plugin.json
plugins/galatheus/hooks/hooks.json
plugins/galatheus/scripts/session-init.sh
plugins/galatheus/bin/galatheus-cloud-mcp.js
plugins/galatheus/skills/workspaces/SKILL.md
plugins/galatheus/skills/canvas-state/SKILL.md
plugins/galatheus/skills/canvas-work/SKILL.md
plugins/galatheus/skills/canvas-agent/SKILL.md
```
