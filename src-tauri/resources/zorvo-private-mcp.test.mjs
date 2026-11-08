import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./zorvo-private-mcp.mjs", import.meta.url));
const proxyToken = ["test", "proxy", "token"].join("-");

function fakeServer(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function startMcp(url, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ZORVO_PRIVATE_URL: url, ZORVO_PRIVATE_TOKEN: proxyToken, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  const pending = new Map();
  let buffer = "";
  let raw = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    raw += chunk;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() === "") continue;
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    call,
    raw: () => raw,
    async close() {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

test("MCP handshake, tool list and both calls", async () => {
  const fake = await fakeServer((request, response) => {
    if (request.url === "/zorvo/v1/credits") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        credits: 52,
        updatedAt: "2026-11-08T10:00:00Z",
        model: "Qwen/Qwen3.8-27B",
        approxTurns: 130,
      }));
    } else if (request.url === "/zorvo/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ models: [{ id: "Qwen/Qwen3.8-27B", label: "Qwen 3.8 27B" }] }));
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  const mcp = startMcp(fake.url);
  try {
    const init = await mcp.call("initialize", {});
    assert.equal(init.result.protocolVersion, "2025-06-18");
    const list = await mcp.call("tools/list", {});
    assert.deepEqual(list.result.tools.map((tool) => tool.name), ["credits_balance", "private_models"]);

    const credits = await mcp.call("tools/call", { name: "credits_balance", arguments: {} });
    assert.match(credits.result.content[0].text, /^52 credits left · ≈ 130 turns/);
    assert.equal(credits.result.isError, undefined);

    const models = await mcp.call("tools/call", { name: "private_models", arguments: {} });
    assert.match(models.result.content[0].text, /^1 private model in a TEE\./);
    assert.match(models.result.content[0].text, /Qwen 3\.8 27B/);
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test("a 401 and a timeout become tool errors, never a crash", async () => {
  const fake = await fakeServer((request, response) => {
    if (request.url === "/zorvo/v1/credits") {
      response.statusCode = 401;
      response.end("{}");
    }
    // The models path deliberately never answers.
  });
  const mcp = startMcp(fake.url, { ZORVO_PRIVATE_TIMEOUT_MS: "50" });
  try {
    const unauthorized = await mcp.call("tools/call", { name: "credits_balance", arguments: {} });
    assert.equal(unauthorized.result.isError, true);
    assert.match(unauthorized.result.content[0].text, /401/);

    const timeout = await mcp.call("tools/call", { name: "private_models", arguments: {} });
    assert.equal(timeout.result.isError, true);
    assert.match(timeout.result.content[0].text, /did not answer/i);

    const ping = await mcp.call("ping", {});
    assert.deepEqual(ping.result, {});
  } finally {
    await mcp.close();
    await fake.close();
  }
});

test("the proxy token is never written to stdout", async () => {
  const fake = await fakeServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ credits: 1, updatedAt: "x", model: "m", approxTurns: 0 }));
  });
  const mcp = startMcp(fake.url);
  await mcp.call("tools/call", { name: "credits_balance", arguments: {} });
  assert.equal(mcp.raw().includes(proxyToken), false);
  await mcp.close();
  await fake.close();
});