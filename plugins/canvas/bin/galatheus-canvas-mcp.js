#!/usr/bin/env node
"use strict";

const http = require("node:http");
const https = require("node:https");
const readline = require("node:readline");
const { URL } = require("node:url");

const apiBase = (process.env.GALATHEUS_API_URL || "https://api.galatheus.dev").replace(/\/+$/, "");
const apiKey = process.env.GALATHEUS_API_KEY || process.env.GALATHEUS_AGENT_API_KEY || "";

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
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

function tools() {
  return [
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
          priority: { type: "string" }
        }
      }
    }
  ];
}

async function callTool(name, args) {
  const input = args || {};
  if (name === "galatheus_canvas_state") {
    const since = input.since == null ? 0 : input.since;
    const result = await request("GET", `/v1/canvas/${encodeURIComponent(input.workspace_id)}/state?since=${encodeURIComponent(String(since))}`);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_canvas_events") {
    const since = input.since == null ? 0 : input.since;
    const result = await request("GET", `/v1/canvas/${encodeURIComponent(input.workspace_id)}/events?since=${encodeURIComponent(String(since))}`);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_canvas_create_object") {
    const workspaceId = input.workspace_id;
    const payload = Object.assign({}, input);
    delete payload.workspace_id;
    const result = await request("POST", `/v1/canvas/${encodeURIComponent(workspaceId)}/objects`, payload);
    return textResult(result.body, !result.ok);
  }
  if (name === "galatheus_ticket_create") {
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

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  const message = readJson(trimmed);
  if (message == null) {
    errorResponse(null, -32700, "Parse error");
    return;
  }
  handle(message);
});
