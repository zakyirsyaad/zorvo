import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAcpEngine, type FirstMessage } from "../hooks/session-engine/useAcpEngine";
import { fakeProfiles } from "./fixtures/agents";
import type { Session } from "../types";
import { MCP_PATH_CONTEXT, workerContext } from "../lib/agent-tools-context";
import { isSlashCommand } from "../lib/slash-commands";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type FakeWindow = { __TAURI_INTERNALS__: TauriInternals; __FAKE_TOOLS_PATH__?: string; __FAKE_AGENT_TOOLS__?: boolean };
const fakeWindow = () => window as unknown as FakeWindow;

const SESSION: Session = {
  id: "s-1",
  name: "Switch account",
  profileId: "qwen",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
};

function renderEngine(session: Session = SESSION) {
  const spy = vi.spyOn(fakeWindow().__TAURI_INTERNALS__, "invoke");
  const { result } = renderHook(() =>
    useAcpEngine({
      sessions: [session],
      agents: fakeProfiles,
      updateMessages: () => {},
      patchSession: () => {},
      reportError: vi.fn(),
      rememberOptions: () => {},
      onAuthRequired: () => {},
      onTurnFailed: () => {},
    }),
  );
  return {
    start: (first: FirstMessage) =>
      act(async () => {
        await result.current.start(session, first);
      }),
    send: (text: string) =>
      act(async () => {
        await result.current.send(session.id, text);
      }),
    retry: () =>
      act(async () => {
        await result.current.retryFailedTurn(session.id);
      }),
    endTurn: (error?: string) =>
      act(async () => {
        listeners.get("acp-event")?.({
          payload: { sessionId: session.id, kind: "turn-end", ...(error ? { error } : { stopReason: "end_turn" }) },
        });
      }),
    prompts: () =>
      spy.mock.calls.filter(([cmd]) => cmd === "acp_prompt").map(([, args]) => (args as { text: string }).text),
  };
}

describe("isSlashCommand", () => {
  it.each(["/logout", "/compact keep the plan", "/review\nthe parser", "/plugin:skill", "/git-commit"])(
    "reads %j as a command",
    (text) => expect(isSlashCommand(text)).toBe(true),
  );

  it.each(["", "/", "/ spaced", "// a comment", "/Users/me/app is broken", "run /logout", "fix the parser"])(
    "reads %j as plain text",
    (text) => expect(isSlashCommand(text)).toBe(false),
  );
});

describe("useAcpEngine with a slash command", () => {
  beforeEach(() => {
    fakeWindow().__FAKE_TOOLS_PATH__ = "mcp";
    fakeWindow().__FAKE_AGENT_TOOLS__ = true;
  });
  afterEach(() => {
    delete fakeWindow().__FAKE_TOOLS_PATH__;
    delete fakeWindow().__FAKE_AGENT_TOOLS__;
    vi.restoreAllMocks();
  });

  it("sends a first command as typed and the tools note with the next plain message", async () => {
    const engine = renderEngine();
    await engine.start({ text: "/logout" });
    await engine.endTurn();
    await engine.send("fix the parser");
    await engine.endTurn();
    await engine.send("and the tests");

    expect(engine.prompts()).toEqual(["/logout", `${MCP_PATH_CONTEXT}\n\nfix the parser`, "and the tests"]);
  });

  it("keeps a handoff through several commands", async () => {
    const engine = renderEngine();
    await engine.start({ text: "/model", context: "Read the handoff." });
    await engine.endTurn();
    await engine.send("/compact");
    await engine.endTurn();
    await engine.send("go on");

    expect(engine.prompts()).toEqual(["/model", "/compact", `${MCP_PATH_CONTEXT}\n\nRead the handoff.\n\ngo on`]);
  });

  it("tries a failed command again as typed and still keeps the hidden context", async () => {
    const engine = renderEngine();
    await engine.start({ text: "/compact", context: "Read the handoff." });
    await engine.endTurn("fetch failed");
    await engine.retry();
    await engine.endTurn();
    await engine.send("go on");

    expect(engine.prompts()).toEqual(["/compact", "/compact", `${MCP_PATH_CONTEXT}\n\nRead the handoff.\n\ngo on`]);
  });

  it("still puts the note before a first message that starts with a path", async () => {
    const engine = renderEngine();
    await engine.start({ text: "/Users/me/app is broken" });

    expect(engine.prompts()).toEqual([`${MCP_PATH_CONTEXT}\n\n/Users/me/app is broken`]);
  });

  describe("in a worker", () => {
    const worker: Session = {
      ...SESSION,
      delegatedFrom: { sessionId: "s-0", task: "/review the parser", startedAt: 1, handle: "worker-1" },
    };
    const note = workerContext("mcp", "Another agent");

    it("keeps the handoff and note with a task, which the worker may get no message after", async () => {
      const engine = renderEngine(worker);
      await engine.start({ text: "/review the parser", context: "Read the handoff." });

      expect(engine.prompts()).toEqual([`${note}\n\nRead the handoff.\n\n/review the parser`]);
    });

    it("keeps the note with a further task", async () => {
      const engine = renderEngine(worker);
      await engine.start({ text: "/test", marks: { delegationTask: { agentName: "Codex", agentId: "codex" } } });

      expect(engine.prompts()).toEqual([`${note}\n\n/test`]);
    });

    it("sends the user's own command as typed", async () => {
      const engine = renderEngine(worker);
      await engine.start({ text: "/logout" });

      expect(engine.prompts()).toEqual(["/logout"]);
    });
  });
});
