---
description: "Show Galatheus Canvas state as a read-only snapshot of ticket-backed work visible to a code agent."
---

# Show Canvas state

Read-only. Do not claim, complete, reject, or modify any ticket.

## Steps

1. Use the available Galatheus Cloud MCP tools. In plugin-loaded Claude Code
   sessions they are usually named
   `mcp__plugin_galatheus_galatheus_cloud__galatheus_*`; in direct MCP smoke
   tests they may appear as `mcp__galatheus_cloud__galatheus_*`.
2. Call the `galatheus_agent_instructions` tool with `runtime: "claude"` and
   follow the returned Galatheus operating rules.
3. Determine scope using the hierarchy `tenant -> workspace -> project`.
   No workspace argument means tenant scope. `workspace_id: "*"` also means all
   workspaces. A concrete `workspace_id` narrows to one workspace. Add
   `project_id` only when the user wants `workspace -> project`; use
   `project_id: "*"` for all projects in that workspace.
4. Parse simple flags from `$ARGUMENTS` when present:
   `--workspace <id|*|glob|/regex/>` and `--project <id|*|glob|/regex/>`.
   Do not invent comma-separated lists; multiple scopes should be handled by
   multiple agents or multiple command runs.
5. Call the `galatheus_ticket_list` tool with:
   `workspace_id` if supplied, `project_id` if supplied, `status: "proposed"`,
   and `target: "code-agent"`. Use `title_pattern`, `kind_pattern`, or
   `ticket_pattern` only if the user asks for extra filtering.
   If the tool reports missing credentials, tell the user to run the
   Canvas-generated galagent login command or launch Claude through
   `galagent connect <workspace-id> --claude`, then stop.
6. Report the resolved scope before the tickets as
   `tenant -> workspace -> project`, including `raw_count`, `filtered_count`,
   and `dropped_out_of_scope` from the tool result when present.
7. Summarize open ticket-backed Canvas work in priority order. Prefer tickets
   with `kind: "canvas_task"` or tags containing `work_type:canvas_task`.
   Include ticket id, priority, status, project, title, and a short body
   excerpt when useful.
8. Stop there. To work an item, the user runs `/galatheus:canvas-work`.
