#!/usr/bin/env node
"use strict";

const http = require("node:http");
const https = require("node:https");
const { spawnSync } = require("node:child_process");
const { URL, URLSearchParams } = require("node:url");

const apiBase = (process.env.GALATHEUS_API_URL || "https://api.galatheus.dev").replace(/\/+$/, "");
const apiKey = process.env.GALATHEUS_AGENT_API_KEY || process.env.GALATHEUS_API_KEY || process.env.GALATHEUS_TOKEN || "";
const galagent = process.env.GALATHEUS_GALAGENT || "galagent";
let framedOutput = false;

function send(message) {
  const payload = JSON.stringify(message);
  if (framedOutput) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
    return;
  }
  process.stdout.write(payload + "\n");
}

function response(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function errorResponse(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, data } });
}

function readJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, apiBase);
    const payload = body == null ? null : JSON.stringify(body);
    const headers = {
      "Accept": "application/json",
      "User-Agent": "galatheus-cloud-mcp/0.2"
    };
    if (payload != null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (apiKey !== "") headers.Authorization = "Bearer " + apiKey;

    const transport = url.protocol === "http:" ? http : https;
    const req = transport.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const parsed = text === "" ? null : readJson(text);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: parsed == null ? text : parsed
        });
      });
    });
    req.on("error", reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

function queryString(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "") continue;
    q.set(key, String(value));
  }
  const text = q.toString();
  return text === "" ? "" : `?${text}`;
}

function resolvedWorkspaceId(input) {
  return input.workspace_id ||
    input.workspace ||
    process.env.GALATHEUS_WORKSPACE_ID ||
    process.env.GALATHEUS_WORKSPACE ||
    process.env.GALATHEUS_CANVAS_WORKSPACE_ID ||
    "";
}

function resolvedTenantId(input) {
  return input.tenant_id || process.env.GALATHEUS_TENANT || "";
}

function resolvedProjectId(input) {
  return input.project_id || input.project || input.canvas_project_id || process.env.GALATHEUS_PROJECT_ID || "";
}

function scopedPath(path, input, params) {
  const query = Object.assign({}, params || {});
  const workspace = resolvedWorkspaceId(input || {});
  const tenant = resolvedTenantId(input || {});
  if (workspace !== "" && workspace !== "*" && query.workspace == null) query.workspace = workspace;
  if (tenant !== "" && query.tenant == null) query.tenant = tenant;
  return path + queryString(query);
}

function workspaceRequired(toolName) {
  return textResult({
    error: `${toolName} requires a Galatheus workspace id`,
    workspace_id: "Pass workspace_id, set GALATHEUS_WORKSPACE_ID/GALATHEUS_WORKSPACE, or launch through `galagent connect <workspace-id> --claude`."
  }, true);
}

function textResult(value, isError) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError: !!isError };
}

function runGalagent(args) {
  const result = spawnSync(galagent, args, {
    encoding: "utf8",
    timeout: 30000,
    env: process.env
  });
  if (result.error) {
    return { ok: false, body: `${galagent}: ${result.error.message}` };
  }
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  const parsed = stdout === "" ? null : readJson(stdout);
  if (result.status !== 0) {
    return { ok: false, body: parsed || stderr || stdout || `${galagent} exited ${result.status}` };
  }
  return { ok: true, body: parsed || stdout };
}

function galagentBaseArgs(input) {
  const args = ["--json"];
  const workspace = resolvedWorkspaceId(input || {});
  const tenant = resolvedTenantId(input || {});
  if (workspace !== "" && workspace !== "*") args.push("--workspace", workspace);
  if (tenant !== "") args.push("--tenant", tenant);
  return args;
}

function addFlag(args, flag, value) {
  if (value == null || value === "") return;
  args.push(flag, String(value));
}

function addTag(args, value) {
  addFlag(args, "--tag", value);
}

function galagentTicketList(input) {
  const args = galagentBaseArgs(input);
  args.push("ticket", "list");
  addFlag(args, "--status", input.status);
  addFlag(args, "--target", input.target);
  addFlag(args, "--app", input.app);
  addFlag(args, "--parent", input.parent);
  if (input.include_closed) args.push("--include-closed");
  return runGalagent(args);
}

function galagentTicketCreate(input) {
  const args = galagentBaseArgs(input);
  args.push("ticket", "create");
  addFlag(args, "--title", input.title);
  addFlag(args, "--body", input.body);
  addFlag(args, "--target", input.target);
  addFlag(args, "--kind", input.kind);
  addFlag(args, "--priority", input.priority);
  const workspace = resolvedWorkspaceId(input);
  const project = resolvedProjectId(input);
  if (workspace !== "" && workspace !== "*") addTag(args, `workspace:${workspace}`);
  if (project !== "" && project !== "*") addTag(args, `canvas_project:${project}`);
  return runGalagent(args);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function tagsOf(ticket) {
  return asArray(ticket && ticket.tags).map((tag) => String(tag));
}

function tagValues(ticket, prefix) {
  const out = [];
  for (const tag of tagsOf(ticket)) {
    if (tag.startsWith(prefix)) out.push(tag.slice(prefix.length));
  }
  return out;
}

function compactStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function ticketsFromBody(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.tickets)) return body.tickets;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.result)) return body.result;
  if (body.result && typeof body.result === "object") {
    if (Array.isArray(body.result.tickets)) return body.result.tickets;
    if (Array.isArray(body.result.items)) return body.result.items;
    if (body.result.ticket && typeof body.result.ticket === "object") return [body.result.ticket];
    if (body.result.id) return [body.result];
  }
  if (body.ticket && typeof body.ticket === "object") return [body.ticket];
  if (body.id) return [body];
  return [];
}

function ticketWorkspaceValues(ticket) {
  return compactStrings([
    ticket && ticket.workspace_id,
    ticket && ticket.workspace,
    ticket && ticket.galatheus_workspace_id,
    ...(ticket && ticket.payload && typeof ticket.payload === "object"
      ? [ticket.payload.workspace_id, ticket.payload.workspace]
      : []),
    ...tagValues(ticket, "workspace:")
  ]);
}

function ticketProjectIdValues(ticket) {
  return compactStrings([
    ticket && ticket.project_id,
    ticket && ticket.canvas_project_id,
    ticket && ticket.galatheus_project_id,
    ...(ticket && ticket.payload && typeof ticket.payload === "object"
      ? [ticket.payload.project_id, ticket.payload.canvas_project_id]
      : []),
    ...tagValues(ticket, "canvas_project:"),
    ...tagValues(ticket, "project_id:")
  ]);
}

function ticketProjectNameValues(ticket) {
  return compactStrings([
    ticket && ticket.project,
    ticket && ticket.app,
    ...(ticket && ticket.payload && typeof ticket.payload === "object"
      ? [ticket.payload.project, ticket.payload.app]
      : []),
    ...tagValues(ticket, "app:"),
    ...tagValues(ticket, "project:")
  ]);
}

function ticketTextValues(ticket) {
  return compactStrings([
    ticket && ticket.id,
    ticket && ticket.title,
    ticket && ticket.kind,
    ticket && ticket.status,
    ticket && ticket.assignee,
    ticket && ticket.target,
    ticket && ticket.body,
    ...ticketWorkspaceValues(ticket),
    ...ticketProjectIdValues(ticket),
    ...ticketProjectNameValues(ticket),
    ...tagsOf(ticket)
  ]);
}

function patternList(value) {
  if (Array.isArray(value)) return compactStrings(value);
  if (value == null || value === "") return [];
  const text = String(value).trim();
  if (text.startsWith("/") && text.lastIndexOf("/") > 0) return [text];
  return compactStrings(text.split(","));
}

function patternMatches(pattern, value) {
  const text = String(value || "");
  if (pattern == null || pattern === "" || pattern === "*") return true;
  const p = String(pattern);
  if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
    const last = p.lastIndexOf("/");
    try {
      return new RegExp(p.slice(1, last), p.slice(last + 1) || "i").test(text);
    } catch (err) {
      return false;
    }
  }
  const escaped = p.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(text);
}

function anyPatternMatches(patterns, values) {
  if (patterns.length === 0) return true;
  for (const pattern of patterns) {
    for (const value of values) {
      if (patternMatches(pattern, value)) return true;
    }
  }
  return false;
}

function normalizeTicketScope(input) {
  const tenant = resolvedTenantId(input);
  const workspace = resolvedWorkspaceId(input);
  const project = resolvedProjectId(input);
  let scope = "";
  if (workspace === "" || workspace === "*") scope = "tenant";
  else if (project !== "" && project !== "*") scope = "project";
  else scope = "workspace";
  if (input.scope && ["tenant", "workspace", "project"].includes(input.scope)) scope = input.scope;
  if (!["tenant", "workspace", "project"].includes(scope)) scope = "workspace";
  return { scope, tenant, workspace, project };
}

function ticketMatchesScopeOnly(ticket, input) {
  const filters = normalizeTicketScope(input);
  const includeUnscoped = !!input.include_unscoped;

  if (filters.scope !== "tenant" && filters.workspace !== "") {
    const workspaceValues = ticketWorkspaceValues(ticket);
    if (workspaceValues.length === 0 && !includeUnscoped) return false;
    if (workspaceValues.length > 0 && !anyPatternMatches([filters.workspace], workspaceValues)) return false;
  }

  if (filters.scope === "project") {
    const projectIdValues = ticketProjectIdValues(ticket);
    const projectNameValues = ticketProjectNameValues(ticket);
    if (filters.project !== "" && filters.project !== "*") {
      if (!anyPatternMatches([filters.project], [...projectIdValues, ...projectNameValues])) return false;
    }
  }

  return true;
}

function ticketMatchesPatternFilters(ticket, input) {
  if (!anyPatternMatches(patternList(input.title_pattern), [ticket && ticket.title])) return false;
  if (!anyPatternMatches(patternList(input.kind_pattern), [ticket && ticket.kind])) return false;
  if (!anyPatternMatches(patternList(input.ticket_pattern || input.q), ticketTextValues(ticket))) return false;

  return true;
}

function filterTicketListBody(body, input) {
  const tickets = ticketsFromBody(body);
  const scopeMatched = tickets.filter((ticket) => ticketMatchesScopeOnly(ticket, input));
  const filtered = scopeMatched.filter((ticket) => ticketMatchesPatternFilters(ticket, input));
  const filters = normalizeTicketScope(input);
  return {
    ok: !(body && body.ok === false),
    scope: filters.scope,
    scope_hierarchy: {
      tenant_id: filters.tenant || (filters.scope === "tenant" ? "*" : ""),
      workspace_id: filters.scope === "tenant" ? "*" : filters.workspace,
      project_id: filters.scope === "project" ? (filters.project || "*") : "*"
    },
    filters: {
      status: input.status || "",
      target: input.target || "",
      app: input.app || "",
      parent: input.parent || "",
      workspace: filters.workspace || "*",
      project: filters.scope === "project" ? (filters.project || "*") : "*",
      title_pattern: input.title_pattern || "",
      kind_pattern: input.kind_pattern || "",
      ticket_pattern: input.ticket_pattern || input.q || "",
      include_unscoped: !!input.include_unscoped
    },
    raw_count: tickets.length,
    filtered_count: filtered.length,
    dropped_out_of_scope: Math.max(0, tickets.length - scopeMatched.length),
    dropped_by_filters: Math.max(0, scopeMatched.length - filtered.length),
    tickets: filtered
  };
}

function filterSingleTicketBody(body, input) {
  const tickets = ticketsFromBody(body);
  if (tickets.length === 0) return body;
  const ticket = tickets[0];
  if (ticketMatchesScopeOnly(ticket, input)) return body;
  return {
    error: "ticket is outside the requested Galatheus scope",
    requested_scope: filterTicketListBody({ tickets: [] }, input).scope_hierarchy,
    ticket: {
      id: ticket.id,
      title: ticket.title,
      workspace: ticketWorkspaceValues(ticket),
      project_ids: ticketProjectIdValues(ticket),
      projects: ticketProjectNameValues(ticket)
    }
  };
}

function shouldGuardTicketScope(input) {
  const filters = normalizeTicketScope(input);
  return filters.scope !== "tenant" && filters.workspace !== "" && filters.workspace !== "*";
}

async function guardTicketScope(input) {
  if (!shouldGuardTicketScope(input)) return { ok: true };
  let body;
  let ok;
  if (apiKey === "") {
    const fetched = galagentTicketSimple(input, "get");
    ok = fetched.ok;
    body = fetched.body;
  } else {
    const fetched = await request("GET", scopedPath(`/v1/tickets/${encodeURIComponent(resolvedTicketId(input))}`, input));
    ok = fetched.ok;
    body = fetched.body;
  }
  if (!ok) return { ok: false, body };
  const filtered = filterSingleTicketBody(body, input);
  if (filtered && filtered.error) return { ok: false, body: filtered };
  return { ok: true };
}

// resolvedTicketId accepts the canonical `ticket_id` parameter name. The
// legacy `id` field is also honored for backward compatibility with any callers
// that haven't migrated yet.
function resolvedTicketId(input) {
  return String((input && (input.ticket_id || input.id)) || "").trim();
}

function galagentTicketSimple(input, action) {
  const args = galagentBaseArgs(input);
  args.push("ticket", action, resolvedTicketId(input));
  return runGalagent(args);
}

function galagentTicketComment(input) {
  const args = galagentBaseArgs(input);
  args.push("ticket", "comment", resolvedTicketId(input));
  addFlag(args, "--body", input.body);
  addFlag(args, "--actor", input.actor);
  return runGalagent(args);
}

function galagentTicketComplete(input) {
  const args = galagentBaseArgs(input);
  args.push("ticket", "complete", resolvedTicketId(input));
  addFlag(args, "--result", input.result);
  addFlag(args, "--resolution", input.resolution);
  addFlag(args, "--actor", input.actor);
  return runGalagent(args);
}

function galagentTicketReject(input) {
  const args = galagentBaseArgs(input);
  args.push("ticket", "reject", resolvedTicketId(input));
  addFlag(args, "--reason", input.reason);
  return runGalagent(args);
}

function galagentWorkspaceList(input) {
  const args = ["--json"];
  const tenant = resolvedTenantId(input || {});
  if (tenant !== "") args.push("--tenant", tenant);
  args.push("workspace", "list");
  return runGalagent(args);
}

function workspacesFromBody(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.workspaces)) return body.workspaces;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.result)) return body.result;
  if (body.result && typeof body.result === "object") {
    if (Array.isArray(body.result.workspaces)) return body.result.workspaces;
    if (Array.isArray(body.result.items)) return body.result.items;
  }
  return [];
}

function workspaceTextValues(workspace) {
  return compactStrings([
    workspace && workspace.id,
    workspace && workspace.workspace_id,
    workspace && workspace.name,
    workspace && workspace.slug,
    workspace && workspace.description,
    workspace && workspace.state,
    workspace && workspace.tenant_id
  ]);
}

function detectedCurrentWorkspaceId() {
  const envWorkspace = resolvedWorkspaceId({});
  if (envWorkspace !== "" && envWorkspace !== "*") return envWorkspace;
  const doctor = runGalagent(["--json", "doctor"]);
  if (!doctor.ok || !doctor.body || typeof doctor.body !== "object") return "";
  return doctor.body.workspace || doctor.body.workspace_id || "";
}

function filterWorkspaceListBody(body, input) {
  const workspaces = workspacesFromBody(body);
  const filter = input.workspace_pattern || input.pattern || input.q || "";
  const patterns = patternList(filter);
  const filtered = workspaces.filter((workspace) => anyPatternMatches(patterns, workspaceTextValues(workspace)));
  const currentWorkspaceId = detectedCurrentWorkspaceId();
  return {
    ok: !(body && body.ok === false),
    tenant_id: resolvedTenantId(input) || "*",
    current_workspace_id: currentWorkspaceId || "",
    filter,
    raw_count: workspaces.length,
    filtered_count: filtered.length,
    workspaces: filtered.map((workspace) => {
      const id = workspace && (workspace.id || workspace.workspace_id || "");
      return Object.assign({}, workspace, {
        current: currentWorkspaceId !== "" && id === currentWorkspaceId
      });
    })
  };
}

function directAuthRequired(toolName, input) {
  const resolvedWorkspace = resolvedWorkspaceId(input || {});
  const workspaceForCmd = (resolvedWorkspace !== "" && resolvedWorkspace !== "*") ? resolvedWorkspace : "<workspace-id>";
  return textResult({
    error: `${toolName} requires direct API credentials`,
    install: "Install galagent first with `curl -fsSL https://galatheus.dev/install.sh | sh`.",
    login: "Generate the login command from the Canvas Agents view, then start agent work with `galagent connect <workspace-id> --claude`.",
    direct_mcp: "For direct MCP writes, launch Claude Code with GALATHEUS_API_KEY or GALATHEUS_AGENT_API_KEY in the environment.",
    workspace_id: "Use the workspace id from https://app.galatheus.dev/w/<workspace-id>.",
    relaunch: `Canvas read/write tools need an agent key in the environment, which the managed runtime injects automatically. Re-launch this session with: galagent connect ${workspaceForCmd} --claude`
  }, true);
}

function normalizeDoctorForCanvas(doctor) {
  if (!doctor || typeof doctor !== "object") return doctor;
  const clone = JSON.parse(JSON.stringify(doctor));
  if (Array.isArray(clone.checks)) {
    clone.checks = clone.checks.map((check) => {
      if (check && check.name === "token") {
        return {
          ...check,
          action: "Install galagent if needed, then open the Canvas Agents view and run the generated galagent login command."
        };
      }
      return check;
    });
  }
  if (!clone.hasToken) {
    clone.next = ["Install galagent with `curl -fsSL https://galatheus.dev/install.sh | sh`", "Generate login from Canvas Agents view"];
  }
  return clone;
}

function galagentStatus() {
  const doctor = runGalagent(["--json", "doctor"]);
  const help = runGalagent(["--help"]);
  const body = {
    galagent,
    doctor: normalizeDoctorForCanvas(doctor.body),
    connect_supported: help.ok && String(help.body).includes("connect WORKSPACE_ID"),
    next: [
      "Generate login from Canvas Agents view",
      "galagent workspace list --json",
      "galagent connect <workspace-id> --claude"
    ]
  };
  return textResult(body, !doctor.ok);
}

function agentCommand(input) {
  const runtime = input.runtime === "claude" ? "claude" : "codex";
  const workspace = input.workspace_id || "<workspace-id>";
  const name = input.name ? ` --name ${shellWord(input.name)}` : "";
  return textResult({
    runtime,
    command: `galagent connect ${shellWord(workspace)} --${runtime}${name}`,
    login: "Run the Canvas-generated galagent login command once before connecting.",
    workspace_id: "Use the workspace id from app.galatheus.dev/w/<workspace-id>."
  });
}

function agentInstructions(input) {
  const runtime = input.runtime === "codex" ? "codex" : "claude";
  const result = runGalagent(["--json", "agent", "instructions", "--agent", runtime]);
  return textResult(result.body, !result.ok);
}

function shellWord(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function tools() {
  // MCP tool annotations: readOnlyHint / destructiveHint / idempotentHint /
  // openWorldHint inform clients (e.g. claude/codex) which calls are safe to
  // auto-approve in headless / --full-auto runs. Without these, clients
  // default to prompting for every call and headless runs cancel.
  return [
    {
      name: "galatheus_login_status",
      description: "Check local galagent login/readiness without revealing tokens.",
      annotations: {
        title: "Check Galatheus login status",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "galatheus_agent_command",
      description: "Return the galagent command that connects this CLI as a Galatheus Canvas ticket agent.",
      annotations: {
        title: "Build galagent connect command",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          runtime: { type: "string", enum: ["codex", "claude"], description: "CLI runtime. Defaults to codex." },
          workspace_id: { type: "string", description: "Workspace id from app.galatheus.dev/w/<id>." },
          name: { type: "string", description: "Optional agent registration name." }
        }
      }
    },
    {
      name: "galatheus_agent_instructions",
      description: "Return Galatheus agent operating instructions for Claude or Codex from galagent.",
      annotations: {
        title: "Read agent instructions",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      },
      inputSchema: {
        type: "object",
        properties: {
          // INTENTIONAL DIVERGENCE: this plugin defaults runtime to "claude"
          // because it runs inside Claude Code; the codex plugin defaults to
          // "codex" for the same host-runtime reason. Do NOT converge this.
          runtime: { type: "string", enum: ["claude", "codex"], description: "CLI runtime. Defaults to claude." }
        }
      }
    },
    {
      name: "galatheus_workspace_list",
      description: "List Galatheus Cloud workspaces available to the current login so users can choose a workspace id.",
      annotations: {
        title: "List workspaces",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        properties: {
          tenant_id: { type: "string" },
          workspace_pattern: { type: "string", description: "Optional glob or /regex/ matched against workspace id, name, slug, description, state, or tenant id." },
          pattern: { type: "string", description: "Alias for workspace_pattern." },
          q: { type: "string", description: "Alias for workspace_pattern." }
        }
      }
    },
    {
      name: "galatheus_canvas_state",
      description: "Read the materialized state for a Galatheus Canvas workspace.",
      annotations: {
        title: "Read canvas state",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["workspace_id"],
        properties: {
          workspace_id: { type: "string" },
          since: { type: "number", description: "Last seen cursor. Defaults to 0." }
        }
      }
    },
    {
      name: "galatheus_canvas_events",
      description: "Read canvas events after a cursor.",
      annotations: {
        title: "Read canvas events",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["workspace_id"],
        properties: {
          workspace_id: { type: "string" },
          since: { type: "number", description: "Last seen cursor. Defaults to 0." }
        }
      }
    },
    {
      name: "galatheus_canvas_create_object",
      description: "Create a goal, note, evidence object, decision, or ticket-backed card on a canvas.",
      annotations: {
        title: "Create canvas object",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["workspace_id", "type", "title"],
        properties: {
          workspace_id: { type: "string" },
          type: { type: "string", enum: ["goal", "task", "decision", "evidence", "note"] },
          title: { type: "string" },
          body: { type: "string" },
          status: { type: "string" },
          canvas: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" }
            }
          },
          created_by: { type: "string" },
          capability: { type: "string" }
        }
      }
    },
    {
      name: "galatheus_ticket_create",
      description: "Create a Galatheus ticket through the ticket service.",
      annotations: {
        title: "Create ticket",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          target: { type: "string" },
          kind: { type: "string" },
          workspace_id: { type: "string" },
          project_id: { type: "string", description: "Optional Canvas project id for project-scoped tickets." },
          tenant_id: { type: "string" },
          priority: { type: "integer" }
        }
      }
    },
    {
      name: "galatheus_ticket_list",
      description: "List Galatheus tickets, usually filtered by status and target for the current Canvas work state.",
      annotations: {
        title: "List tickets",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          workspace: { type: "string", description: "Alias for workspace_id. Use '*' for all workspaces." },
          project_id: { type: "string", description: "Canvas project id/name/glob within the workspace. Use '*' for all projects." },
          project: { type: "string", description: "Alias for project_id." },
          tenant_id: { type: "string" },
          status: { type: "string", description: "Ticket status, for example proposed." },
          target: { type: "string", description: "Ticket target/assignee filter, for example code-agent." },
          app: { type: "string" },
          parent: { type: "string" },
          title_pattern: { type: "string", description: "Glob or /regex/ matched against ticket title." },
          kind_pattern: { type: "string", description: "Glob or /regex/ matched against ticket kind." },
          ticket_pattern: { type: "string", description: "Glob or /regex/ matched across id, title, project, workspace, kind, status, and tags." },
          include_unscoped: { type: "boolean", description: "Include tickets without workspace/project metadata when scoped to workspace or project." },
          include_closed: { type: "boolean" }
        }
      }
    },
    {
      name: "galatheus_ticket_get",
      description: "Fetch one Galatheus ticket by id.",
      annotations: {
        title: "Get ticket",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["ticket_id"],
        properties: {
          ticket_id: { type: "string", description: "Ticket id like T-xxxxxxxxxx." },
          workspace_id: { type: "string" },
          workspace: { type: "string" },
          project_id: { type: "string" },
          project: { type: "string" },
          tenant_id: { type: "string" }
        }
      }
    },
    {
      name: "galatheus_ticket_claim",
      description: "Claim a Galatheus ticket for the authenticated user or scoped agent.",
      annotations: {
        title: "Claim ticket",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["ticket_id"],
        properties: {
          ticket_id: { type: "string", description: "Ticket id like T-xxxxxxxxxx." },
          workspace_id: { type: "string" },
          workspace: { type: "string" },
          project_id: { type: "string" },
          project: { type: "string" },
          tenant_id: { type: "string" }
        }
      }
    },
    {
      name: "galatheus_ticket_comment",
      description: "Post a comment (evidence, design note, status update) on an existing Galatheus ticket. Use this to attach evidence/progress to a ticket you have claimed.",
      annotations: {
        title: "Post ticket comment",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["ticket_id", "body"],
        properties: {
          ticket_id: { type: "string", description: "Ticket id like T-xxxxxxxxxx." },
          body: { type: "string", description: "Comment body (markdown supported)." },
          actor: { type: "string", description: "Optional actor override; defaults to the authenticated principal." },
          workspace_id: { type: "string" },
          workspace: { type: "string" },
          project_id: { type: "string" },
          project: { type: "string" },
          tenant_id: { type: "string" }
        }
      }
    },
    {
      name: "galatheus_ticket_events",
      description: "Read the event history for one Galatheus ticket.",
      annotations: {
        title: "Read ticket events",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["ticket_id"],
        properties: {
          ticket_id: { type: "string", description: "Ticket id like T-xxxxxxxxxx." },
          workspace_id: { type: "string" },
          workspace: { type: "string" },
          project_id: { type: "string" },
          project: { type: "string" },
          tenant_id: { type: "string" }
        }
      }
    },
    {
      name: "galatheus_ticket_complete",
      description: "Mark a Galatheus ticket as completed with a result summary. Use this after the work has landed (e.g. PR opened).",
      annotations: {
        title: "Complete ticket",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["ticket_id"],
        properties: {
          ticket_id: { type: "string", description: "Ticket id like T-xxxxxxxxxx." },
          result: { type: "string", description: "Result summary (markdown supported)." },
          resolution: { type: "string", description: "Optional short resolution status." },
          actor: { type: "string", description: "Optional actor override; defaults to the authenticated principal." },
          workspace_id: { type: "string" },
          workspace: { type: "string" },
          project_id: { type: "string" },
          project: { type: "string" },
          tenant_id: { type: "string" }
        }
      }
    },
    {
      name: "galatheus_ticket_reject",
      description: "Reject or close a Galatheus ticket with a reason.",
      annotations: {
        title: "Reject ticket",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      },
      inputSchema: {
        type: "object",
        required: ["ticket_id"],
        properties: {
          ticket_id: { type: "string", description: "Ticket id like T-xxxxxxxxxx." },
          reason: { type: "string", description: "Short reason for rejection." },
          workspace_id: { type: "string" },
          workspace: { type: "string" },
          project_id: { type: "string" },
          project: { type: "string" },
          tenant_id: { type: "string" }
        }
      }
    }
  ];
}

async function callTool(name, args) {
  const input = args || {};
  if (name === "galatheus_login_status") {
    return galagentStatus();
  }
  if (name === "galatheus_agent_command") {
    return agentCommand(input);
  }
  if (name === "galatheus_agent_instructions") {
    return agentInstructions(input);
  }
  if (name === "galatheus_workspace_list") {
    if (apiKey !== "") {
      const params = {};
      if (input.tenant_id) params.tenant = input.tenant_id;
      const result = await request("GET", "/v1/workspaces" + queryString(params));
      if (result.ok) return textResult(filterWorkspaceListBody(result.body, input), false);
    }
    const fallback = galagentWorkspaceList(input);
    return textResult(fallback.ok ? filterWorkspaceListBody(fallback.body, input) : fallback.body, !fallback.ok);
  }
  if (name === "galatheus_canvas_state") {
    if (apiKey === "") return directAuthRequired(name, input);
    const workspaceId = resolvedWorkspaceId(input);
    if (workspaceId === "") return workspaceRequired(name);
    const since = input.since == null ? 0 : input.since;
    const result = await request("GET", `/v1/canvas/${encodeURIComponent(workspaceId)}/state?since=${encodeURIComponent(String(since))}`);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_canvas_events") {
    if (apiKey === "") return directAuthRequired(name, input);
    const workspaceId = resolvedWorkspaceId(input);
    if (workspaceId === "") return workspaceRequired(name);
    const since = input.since == null ? 0 : input.since;
    const result = await request("GET", `/v1/canvas/${encodeURIComponent(workspaceId)}/events?since=${encodeURIComponent(String(since))}`);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_canvas_create_object") {
    if (apiKey === "") return directAuthRequired(name, input);
    const workspaceId = resolvedWorkspaceId(input);
    if (workspaceId === "") return workspaceRequired(name);
    const payload = Object.assign({}, input);
    delete payload.workspace_id;
    delete payload.tenant_id;
    const result = await request("POST", `/v1/canvas/${encodeURIComponent(workspaceId)}/objects`, payload);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_create") {
    if (apiKey === "") {
      const fallback = galagentTicketCreate(input);
      return textResult(fallback.body, !fallback.ok);
    }
    const payload = Object.assign({}, input);
    if (payload.priority != null) {
      const priority = Number(payload.priority);
      if (Number.isFinite(priority)) payload.priority = priority;
    }
    const result = await request("POST", scopedPath("/v1/tickets", input), payload);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_list") {
    if (apiKey === "") {
      const fallback = galagentTicketList(input);
      return textResult(fallback.ok ? filterTicketListBody(fallback.body, input) : fallback.body, !fallback.ok);
    }
    const params = {};
    for (const key of ["status", "target", "app", "parent"]) {
      if (input[key] != null && input[key] !== "") params[key] = input[key];
    }
    if (input.include_closed) params.include_closed = "true";
    const result = await request("GET", scopedPath("/v1/tickets", input, params));
    return textResult(result.ok ? filterTicketListBody(result.body, input) : result.body, !result.ok);
  }
  if (name === "galatheus_ticket_get") {
    const ticketId = resolvedTicketId(input);
    if (ticketId === "") return textResult("ticket_id is required", true);
    if (apiKey === "") {
      const fallback = galagentTicketSimple(input, "get");
      const filtered = fallback.ok ? filterSingleTicketBody(fallback.body, input) : fallback.body;
      return textResult(filtered, !fallback.ok || !!(filtered && filtered.error));
    }
    const result = await request("GET", scopedPath(`/v1/tickets/${encodeURIComponent(ticketId)}`, input));
    const filtered = result.ok ? filterSingleTicketBody(result.body, input) : result.body;
    return textResult(filtered, !result.ok || !!(filtered && filtered.error));
  }
  if (name === "galatheus_ticket_claim") {
    const ticketId = resolvedTicketId(input);
    if (ticketId === "") return textResult("ticket_id is required", true);
    const guard = await guardTicketScope(input);
    if (!guard.ok) return textResult(guard.body, true);
    if (apiKey === "") {
      const fallback = galagentTicketSimple(input, "claim");
      return textResult(fallback.body, !fallback.ok);
    }
    const result = await request("POST", scopedPath(`/v1/tickets/${encodeURIComponent(ticketId)}/claim`, input), {});
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_comment") {
    const ticketId = resolvedTicketId(input);
    if (ticketId === "") return textResult("ticket_id is required", true);
    const guard = await guardTicketScope(input);
    if (!guard.ok) return textResult(guard.body, true);
    if (apiKey === "") {
      const fallback = galagentTicketComment(input);
      return textResult(fallback.body, !fallback.ok);
    }
    // Canonical kernel endpoint: POST /v1/tickets/{id}/comments with {body, actor?}.
    // The kernel translates this into a ticket_event_append("comment") internally
    // and returns a structured `comment` object. This matches `galagent ticket comment`
    // and tools/galad/ticket_comments_api.go:94 (handleAppendTicketComment).
    const payload = { body: input.body };
    if (input.actor) payload.actor = input.actor;
    const result = await request("POST", scopedPath(`/v1/tickets/${encodeURIComponent(ticketId)}/comments`, input), payload);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_events") {
    const ticketId = resolvedTicketId(input);
    if (ticketId === "") return textResult("ticket_id is required", true);
    if (apiKey === "") {
      const fallback = galagentTicketSimple(input, "events");
      return textResult(fallback.body, !fallback.ok);
    }
    const result = await request("GET", scopedPath(`/v1/tickets/${encodeURIComponent(ticketId)}/events`, input));
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_complete") {
    const ticketId = resolvedTicketId(input);
    if (ticketId === "") return textResult("ticket_id is required", true);
    const guard = await guardTicketScope(input);
    if (!guard.ok) return textResult(guard.body, true);
    if (apiKey === "") {
      const fallback = galagentTicketComplete(input);
      return textResult(fallback.body, !fallback.ok);
    }
    const payload = {};
    for (const key of ["result", "resolution", "actor"]) {
      if (input[key] != null && input[key] !== "") payload[key] = input[key];
    }
    const result = await request("POST", scopedPath(`/v1/tickets/${encodeURIComponent(ticketId)}/complete`, input), payload);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_reject") {
    const ticketId = resolvedTicketId(input);
    if (ticketId === "") return textResult("ticket_id is required", true);
    const guard = await guardTicketScope(input);
    if (!guard.ok) return textResult(guard.body, true);
    if (apiKey === "") {
      const fallback = galagentTicketReject(input);
      return textResult(fallback.body, !fallback.ok);
    }
    const payload = {};
    if (input.reason != null && input.reason !== "") payload.reason = input.reason;
    const result = await request("POST", scopedPath(`/v1/tickets/${encodeURIComponent(ticketId)}/reject`, input), payload);
    return textResult(result.body, !result.ok);
  }
  return textResult(`Unknown tool: ${name}`, true);
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;

  try {
    if (message.method === "initialize") {
      response(message.id, {
        protocolVersion: message.params && message.params.protocolVersion ? message.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "galatheus-cloud", version: "0.2.0" }
      });
    } else if (message.method === "ping") {
      response(message.id, {});
    } else if (message.method === "tools/list") {
      response(message.id, { tools: tools() });
    } else if (message.method === "tools/call") {
      const params = message.params || {};
      response(message.id, await callTool(params.name, params.arguments || {}));
    } else {
      errorResponse(message.id, -32601, "Method not found");
    }
  } catch (err) {
    errorResponse(message.id, -32000, err && err.message ? err.message : String(err));
  }
}

let inputBuffer = Buffer.alloc(0);

function parseFramedMessage() {
  const headerEndCRLF = inputBuffer.indexOf("\r\n\r\n");
  const headerEndLF = inputBuffer.indexOf("\n\n");
  let headerEnd = -1;
  let separatorLength = 0;
  if (headerEndCRLF >= 0 && (headerEndLF < 0 || headerEndCRLF <= headerEndLF)) {
    headerEnd = headerEndCRLF;
    separatorLength = 4;
  } else if (headerEndLF >= 0) {
    headerEnd = headerEndLF;
    separatorLength = 2;
  }
  if (headerEnd < 0) return false;

  const header = inputBuffer.slice(0, headerEnd).toString("utf8");
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    errorResponse(null, -32700, "Missing Content-Length header");
    inputBuffer = Buffer.alloc(0);
    return false;
  }
  const length = Number.parseInt(match[1], 10);
  const bodyStart = headerEnd + separatorLength;
  const bodyEnd = bodyStart + length;
  if (inputBuffer.length < bodyEnd) return false;

  framedOutput = true;
  const raw = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
  inputBuffer = inputBuffer.slice(bodyEnd);
  const message = readJson(raw);
  if (message == null) {
    errorResponse(null, -32700, "Parse error");
  } else {
    handle(message);
  }
  return true;
}

function parseLineMessage() {
  const lineEnd = inputBuffer.indexOf("\n");
  if (lineEnd < 0) return false;
  const raw = inputBuffer.slice(0, lineEnd).toString("utf8").trim();
  inputBuffer = inputBuffer.slice(lineEnd + 1);
  if (raw === "") return true;
  const message = readJson(raw);
  if (message == null) {
    errorResponse(null, -32700, "Parse error");
  } else {
    handle(message);
  }
  return true;
}

function processInput() {
  for (;;) {
    while (inputBuffer.length > 0 && /\s/.test(String.fromCharCode(inputBuffer[0]))) {
      inputBuffer = inputBuffer.slice(1);
    }
    if (inputBuffer.length === 0) return;
    const textStart = inputBuffer.slice(0, Math.min(inputBuffer.length, 32)).toString("utf8");
    const progressed = /^Content-Length:/i.test(textStart) ? parseFramedMessage() : parseLineMessage();
    if (!progressed) return;
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  processInput();
});
