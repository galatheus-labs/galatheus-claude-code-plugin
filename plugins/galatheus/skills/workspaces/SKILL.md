---
description: "List Galatheus Cloud tenant workspaces available to this Claude Code session so a user can choose a workspace id."
---

# List Galatheus workspaces

Read-only. Do not claim, complete, reject, or modify any ticket.

## Steps

1. Use the available Galatheus Cloud MCP tools. In plugin-loaded Claude Code
   sessions they are usually named
   `mcp__plugin_galatheus_galatheus_cloud__galatheus_*`; in direct MCP smoke
   tests they may appear as `mcp__galatheus_cloud__galatheus_*`.
2. Call the `galatheus_workspace_list` tool. If `$ARGUMENTS` contains a simple
   search term, pass it as `workspace_pattern`; glob and `/regex/` values are
   supported by the tool.
3. Show a concise table with workspace id, name, slug, state, and tenant id.
   Mark the current workspace if the tool reports `current: true`.
4. Stop there. To inspect work state for one workspace, the user runs
   `/galatheus:canvas-state --workspace <workspace-id>`.
