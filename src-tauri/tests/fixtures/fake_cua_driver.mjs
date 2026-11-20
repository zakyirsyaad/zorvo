// A stand-in for `cua-driver __private-worker --generation <id>` in tests. It speaks the
// worker's protocol (version 1, one JSON object per line) and answers one request before it
// reads the next, as the real worker does.
//
//   FAKE_CUA_HANG=<tool>      never answer a `call` of that tool
//   FAKE_CUA_HUGE=1           answer `get_window_state` with a line over 32 MiB
//   FAKE_CUA_PROTOCOL=<n>     answer with another protocol version
//   FAKE_CUA_VERSION=<v>      the driver version `initialize` reports (default 0.52.13)
//   FAKE_CUA_SLOW_MS=<n>      wait that long before each `call` answer
//   FAKE_CUA_CALL_LOG=<file>  append every request, one JSON line each
//   FAKE_CUA_PID_FILE=<file>  write this process's pid at start
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args[0] !== "__private-worker" || args[1] !== "--generation" || !args[2]) {
  console.error("fake cua-driver: expected __private-worker --generation <id>");
  process.exit(64);
}
const generation = args[2];
const protocol = Number(process.env.FAKE_CUA_PROTOCOL ?? 1);
const slowMs = Number(process.env.FAKE_CUA_SLOW_MS ?? 0);
if (process.env.FAKE_CUA_PID_FILE) writeFileSync(process.env.FAKE_CUA_PID_FILE, String(process.pid));

// A 4×4 PNG, the screenshot of the fixture window.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP8z4AATAxEcQCukgEHVUl5SQAAAABJRU5ErkJggg==";
const TOOLS = ["list_apps", "list_windows", "get_window_state", "click", "type_text", "run_steps"];

const sessions = new Map();
let nextHandle = 1;

const write = (body) => process.stdout.write(`${JSON.stringify(body)}\n`);
const answer = (request, result) =>
  write({ protocol_version: protocol, request_id: request.request_id, generation, ok: true, completion: "completed", result });
const refuse = (request, code, error) =>
  write({ protocol_version: protocol, request_id: request.request_id, generation, ok: false, completion: "not_started", error, error_code: code });
const text = (value, structured) => ({ content: [{ type: "text", text: value }], structuredContent: structured, isError: false });

const callResult = (name, callArguments, label) => {
  switch (name) {
    case "list_apps":
      return text("1 app", { apps: [{ name: "Notes", bundle_id: "com.apple.Notes", pid: 4242 }] });
    case "list_windows":
      return text("1 window", {
        windows: [{ window_id: 7, pid: 4242, title: "Notes", is_on_screen: true, bounds: { x: 0, y: 0, width: 400, height: 300 } }],
      });
    case "get_window_state":
      if (process.env.FAKE_CUA_HUGE) return text("x".repeat(33 * 1024 * 1024), {});
      return {
        content: [
          { type: "text", text: '- [0] AXWindow "Notes"\n  - [1] AXButton (New Note)' },
          { type: "image", data: PNG, mimeType: "image/png" },
        ],
        structuredContent: { snapshot_id: "s00000001", pid: 4242, window_id: 7, screenshot_width: 4, screenshot_height: 4 },
        isError: false,
      };
    case "click":
    case "type_text":
    case "run_steps":
      return text(`${name} done for ${label}`, { echoed: callArguments });
    default:
      return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handle(request) {
  if (process.env.FAKE_CUA_CALL_LOG) appendFileSync(process.env.FAKE_CUA_CALL_LOG, `${JSON.stringify(request)}\n`);
  if (request.generation !== generation) return refuse(request, "generation_mismatch", "private worker request belongs to another runtime generation");
  switch (request.operation) {
    case "initialize":
      return answer(request, {
        ready: true,
        pid: process.pid,
        host_bundle_id: request.arguments?.host_bundle_id,
        metadata: { driver_version: process.env.FAKE_CUA_VERSION ?? "0.52.13" },
      });
    case "list":
      return answer(request, { tools: TOOLS.map((name) => ({ name, inputSchema: { type: "object", properties: {} } })) });
    case "bind_session": {
      const label = String(request.arguments?.public_session ?? "").trim();
      if (!label) return refuse(request, "worker_request_failed", "invalid SDK configuration: public_session must not be empty");
      if ([...sessions.values()].includes(label)) {
        return refuse(request, "worker_request_failed", "invalid SDK configuration: the public or transport session is already bound to a live authorization context");
      }
      const handle = `handle-${nextHandle++}`;
      sessions.set(handle, label);
      return answer(request, { session_handle: handle });
    }
    case "close_session":
      sessions.delete(request.session_handle);
      return answer(request, { closed: true });
    case "call": {
      const label = sessions.get(request.session_handle);
      if (!label) return refuse(request, "session_not_bound", "private worker session handle is not live on this channel");
      if (process.env.FAKE_CUA_HANG === request.name) return new Promise(() => {});
      if (slowMs) await sleep(slowMs);
      return answer(request, callResult(request.name, request.arguments ?? {}, label));
    }
    case "shutdown":
      answer(request, { shutdown: true });
      return process.exit(0);
    default:
      return refuse(request, "worker_request_failed", `unknown private worker operation: ${request.operation}`);
  }
}

// One request at a time: the next line waits for this one's answer.
let chain = Promise.resolve();
createInterface({ input: process.stdin })
  .on("line", (line) => {
    chain = chain.then(() => handle(JSON.parse(line)));
  })
  .on("close", () => process.exit(0));
