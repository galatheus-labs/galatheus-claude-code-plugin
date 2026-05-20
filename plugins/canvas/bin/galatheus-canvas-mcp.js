#!/usr/bin/env node
"use strict";

const http = require("node:http");
const https = require("node:https");
const { spawnSync } = require("node:child_process");
const { URL } = require("node:url");

const apiBase = (process.env.GALATHEUS_API_URL || "https://api.galatheus.dev").replace(/\/+$/, "");
const apiKey = process.env.GALATHEUS_API_KEY || process.env.GALATHEUS_AGENT_API_KEY || "";
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
      "User-Agent": "galatheus-canvas-mcp/0.1"
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

function directAuthRequired(toolName) {
  return textResult({
    error: `${toolName} requires direct API credentials`,
    login: "Run `galagent login`, then start agent work with `galagent connect <canvas-workspace-id> --codex`.",
    direct_mcp: "For direct MCP writes, launch Codex with GALATHEUS_API_KEY or GALATHEUS_AGENT_API_KEY in the environment.",
    workspace_id: "Use the Canvas project id from https://app.galatheus.dev/w/<workspace-id>."
  }, true);
}

function galagentStatus() {
  const doctor = runGalagent(["--json", "doctor"]);
  const help = runGalagent(["--help"]);
  const body = {
    galagent,
    doctor: doctor.body,
    connect_supported: help.ok && String(help.body).includes("connect WORKSPACE_ID"),
    next: [
      "galagent login",
      "galagent workspace list --json",
      "galagent connect <canvas-workspace-id> --codex"
    ]
  };
  return textResult(body, !doctor.ok);
}

function agentCommand(input) {
  const runtime = input.runtime === "claude" ? "claude" : "codex";
  const workspace = input.workspace_id || "<canvas-workspace-id>";
  const name = input.name ? ` --name ${shellWord(input.name)}` : "";
  return textResult({
    runtime,
    command: `galagent connect ${shellWord(workspace)} --${runtime}${name}`,
    login: "Run `galagent login` once before connecting.",
    workspace_id: "Use the Canvas project id from app.galatheus.dev/w/<workspace-id>."
  });
}

function shellWord(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function tools() {
  return [
    {
      name: "galatheus_login_status",
      description: "Check local galagent login/readiness without revealing tokens.",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "galatheus_agent_command",
      description: "Return the galagent command that connects this CLI as a Canvas ticket agent.",
      inputSchema: {
        type: "object",
        properties: {
          runtime: { type: "string", enum: ["codex", "claude"], description: "CLI runtime. Defaults to codex." },
          workspace_id: { type: "string", description: "Canvas project id from app.galatheus.dev/w/<id>." },
          name: { type: "string", description: "Optional agent registration name." }
        }
      }
    },
    {
      name: "galatheus_canvas_state",
      description: "Read the materialized state for a Galatheus Canvas workspace.",
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
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          target: { type: "string" },
          kind: { type: "string" },
          workspace_id: { type: "string" },
          priority: { type: "integer" }
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
  if (name === "galatheus_canvas_state") {
    if (apiKey === "") return directAuthRequired(name);
    const since = input.since == null ? 0 : input.since;
    const result = await request("GET", `/v1/canvas/${encodeURIComponent(input.workspace_id)}/state?since=${encodeURIComponent(String(since))}`);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_canvas_events") {
    if (apiKey === "") return directAuthRequired(name);
    const since = input.since == null ? 0 : input.since;
    const result = await request("GET", `/v1/canvas/${encodeURIComponent(input.workspace_id)}/events?since=${encodeURIComponent(String(since))}`);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_canvas_create_object") {
    if (apiKey === "") return directAuthRequired(name);
    const workspaceId = input.workspace_id;
    const payload = Object.assign({}, input);
    delete payload.workspace_id;
    const result = await request("POST", `/v1/canvas/${encodeURIComponent(workspaceId)}/objects`, payload);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_create") {
    if (apiKey === "") return directAuthRequired(name);
    const result = await request("POST", "/v1/tickets", input);
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
        serverInfo: { name: "galatheus-canvas", version: "0.1.0" }
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
