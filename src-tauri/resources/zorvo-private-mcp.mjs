#!/usr/bin/env node
// Zorvo Private's local MCP server. It holds no secret: the loopback proxy token in its env is
// the same capability the agent's own process already has. Nothing is logged but to stderr.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 5_000;
const baseUrl = (process.env.ZORVO_PRIVATE_URL ?? "").replace(/\/+$/, "");
const token = process.env.ZORVO_PRIVATE_TOKEN ?? "";
const timeoutMs = Number(process.env.ZORVO_PRIVATE_TIMEOUT_MS) > 0
  ? Number(process.env.ZORVO_PRIVATE_TIMEOUT_MS)
  : DEFAULT_TIMEOUT_MS;

const TOOLS = [
  {
    name: "credits_balance",
    description:
      "Check this private session's Zorvo credits before long work. Tell the user when credits are low, and suggest a cheaper listed model from private_models; never switch models yourself.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "private_models",
    description:
      "List the TEE models Zorvo can run privately, with their prices and approximate cost per turn. Suggest a cheaper one when credits are low; never switch models yourself.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "request_topup",
    description:
      "Ask the user to approve a Zorvo top-up when this session's credits will not cover the work at hand. Give one of the Worker's whole-dollar packages and one short reason. Ask once, and never claim the top-up happened: this returns at once, and the user pays in their own browser. Check credits_balance later.",
    inputSchema: {
      type: "object",
      properties: {
        usd: {
          type: "integer",
          minimum: 1,
          description: "Package size in whole US dollars, one of the packages credits_balance or private_models returned.",
        },
        reason: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "One short sentence for the user: what the work needs the credits for.",
        },
      },
      required: ["usd", "reason"],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function answer(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function requestJson(path, method = "GET", payload) {
  return new Promise((resolve, reject) => {
    if (baseUrl === "" || token === "") {
      reject(new Error("Zorvo Private is not configured for this session."));
      return;
    }
    let url;
    try {
      url = new URL(`${baseUrl}${path}`);
    } catch {
      reject(new Error("Zorvo Private's local address is not usable."));
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error("Zorvo Private's local address is not usable."));
      return;
    }
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, { method, headers }, (response) => {
      let answer = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        answer += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          // A refusal carries the sentence the agent should show the user; a bare status does not.
          let detail = "";
          try {
            const parsed = JSON.parse(answer);
            if (parsed && typeof parsed.message === "string") detail = parsed.message;
          } catch {
            // Keep the status-only message.
          }
          reject(new Error(detail || `Zorvo Private answered ${response.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(answer));
        } catch {
          reject(new Error("Zorvo Private sent an unreadable answer."));
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Zorvo Private did not answer in time.")));
    req.on("error", (error) => reject(error));
    req.end(body);
  });
}

function get(path) {
  return requestJson(path);
}

function post(path, payload) {
  return requestJson(path, "POST", payload);
}

function summary(payload) {
  if (payload.ownKey === true && typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload.credits === "number") {
    const credits = `${payload.credits.toLocaleString("en-US")} ${
      payload.credits === 1 ? "credit" : "credits"
    } left`;
    return payload.approxTurns > 0
      ? `${credits} · ≈ ${payload.approxTurns.toLocaleString("en-US")} turns`
      : credits;
  }
  if (Array.isArray(payload.models)) {
    return `${payload.models.length} private ${payload.models.length === 1 ? "model" : "models"} in a TEE.`;
  }
  return "Zorvo Private answered.";
}

async function callTool(name, args = {}) {
  if (name === "credits_balance") {
    const payload = await get("/zorvo/v1/credits");
    return { content: [{ type: "text", text: `${summary(payload)}\n${JSON.stringify(payload)}` }] };
  }
  if (name === "private_models") {
    const payload = await get("/zorvo/v1/models");
    return { content: [{ type: "text", text: `${summary(payload)}\n${JSON.stringify(payload)}` }] };
  }
  if (name === "request_topup") {
    const usd = args.usd;
    const reason = args.reason;
    if (
      !Number.isInteger(usd) ||
      usd <= 0 ||
      typeof reason !== "string" ||
      reason.trim() === "" ||
      reason.length > 200
    ) {
      return {
        isError: true,
        content: [{ type: "text", text: "Ask for a whole-dollar package and a reason of 200 characters or less." }],
      };
    }
    const asked = await post("/zorvo/v1/topup-requests", { usd, reason });
    const credits = Number.isFinite(asked.credits) ? asked.credits : 0;
    return {
      content: [
        {
          type: "text",
          text: `Asked the user to approve a $${usd} top-up (${credits.toLocaleString("en-US")} credits). Check credits_balance later; do not ask again unless they agree.`,
        },
      ],
    };
  }
  return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
}

async function handle(message) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
  const { id, method, params } = message;
  // Notifications have no id and take no answer.
  if (method === "notifications/initialized") return;
  if (id === undefined) return;
  try {
    if (method === "initialize") {
      answer(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "zorvo-credits", version: "1.0.0" },
      });
      return;
    }
    if (method === "ping") {
      answer(id, {});
      return;
    }
    if (method === "tools/list") {
      answer(id, { tools: TOOLS });
      return;
    }
    if (method === "tools/call") {
      const name = params && typeof params.name === "string" ? params.name : "";
      const args = params && typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};
      answer(id, await callTool(name, args));
      return;
    }
    fail(id, -32601, "Method not found");
  } catch (error) {
    answer(id, {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : "Zorvo Private failed." }],
    });
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (line.trim() === "") return;
  try {
    void handle(JSON.parse(line));
  } catch {
    fail(null, -32700, "Parse error");
  }
});
process.stdin.on("error", (error) => {
  process.stderr.write(`zorvo-credits MCP: ${error.message}\n`);
});