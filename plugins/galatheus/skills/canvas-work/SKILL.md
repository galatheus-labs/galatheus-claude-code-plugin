---
description: "Work Galatheus Canvas ticket state in the current Claude Code session: load instructions, claim a ticket, implement it, comment progress, and complete it."
disable-model-invocation: true
---

# Work Canvas ticket state

Use the Galatheus Cloud MCP tools bundled with this plugin. In plugin-loaded
Claude Code sessions they are usually named
`mcp__plugin_galatheus_galatheus_cloud__galatheus_*`; in direct MCP smoke tests
they may appear as `mcp__galatheus_cloud__galatheus_*`. Do not spawn a nested
`galagent connect ... --claude` process from inside an already-running Claude
Code session unless the user explicitly asks for the managed runtime.

## 1. Load operating instructions first

Call the `galatheus_agent_instructions` tool with `runtime: "claude"`. Follow
those returned instructions. They are the local Galatheus operating contract
for Claude Code sessions.

## 2. Choose a ticket

Determine scope using the hierarchy `tenant -> workspace -> project`.

No workspace argument means tenant scope. `workspace_id: "*"` also means all
workspaces. A concrete `workspace_id` narrows to one workspace. Add
`project_id` only when the user wants `workspace -> project`; use
`project_id: "*"` for all projects in that workspace.

Parse simple flags from `$ARGUMENTS` when present:
`--workspace <id|*|glob|/regex/>` and `--project <id|*|glob|/regex/>`.
Do not invent comma-separated lists; multiple scopes should be handled by
multiple agents or multiple command runs.

If `$ARGUMENTS` contains a ticket id (`T-...`), call
the `galatheus_ticket_get` tool for that ticket and include the selected
`workspace_id` and `project_id` if supplied so the tool can reject tickets
outside the requested scope. Otherwise call the `galatheus_ticket_list` tool
with `workspace_id` if supplied, `project_id` if supplied,
`status: "proposed"`, and `target: "code-agent"`. Use `title_pattern`,
`kind_pattern`, or `ticket_pattern` only if the user asks for extra filtering.

Pick the highest priority ticket whose `kind` is `canvas_task` or whose tags
include `work_type:canvas_task`. If the selected scope has no such ticket, say
so and stop rather than silently falling back to a broader scope.

## 3. Claim and work

Claim the ticket with the `galatheus_ticket_claim` tool. Immediately add a
short plan comment with the `galatheus_ticket_comment` tool.

Read the ticket body and any relevant ticket events. Do the implementation in
the local repository. Run focused checks that match the change. Keep unrelated
files and unrelated user edits untouched.

## 4. Finish or block

Before finishing, call the `galatheus_ticket_events` tool and check for new
human comments.

When the work is complete, post a concise evidence comment and call
the `galatheus_ticket_complete` tool with a result summary and
`resolution: "completed"`.

If a human decision is required or the work cannot proceed, post a comment
explaining the blocker. Do not complete the ticket. Only reject a ticket with
the `galatheus_ticket_reject` tool when the user explicitly asks or the ticket
is invalid/duplicate and the reason is clear.
