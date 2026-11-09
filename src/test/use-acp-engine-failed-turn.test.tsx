import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAcpEngine } from "../hooks/session-engine/useAcpEngine";
import { fakeProfiles } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const SESSION: Session = {
  id: "s-1",
  name: "Network trouble",
  profileId: "qwen",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
};

const NETWORK_ERROR = "exception TypeError: fetch failed sending request";

const promptsSent = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([cmd]) => cmd === "acp_prompt").map(([, args]) => (args as { text: string }).text);

const emit = (payload: Record<string, unknown>) =>
  act(async () => {
    listeners.get("acp-event")?.({ payload: { sessionId: "s-1", ...payload } });
  });

/** The engine with its session, transcript and callbacks held in plain variables the test can read. */
function renderEngine(
  options: { withTurnFailed?: boolean; promptBlockedReason?: (sessionId: string) => string | null } = {},
) {
  const withTurnFailed = options.withTurnFailed ?? true;
  let sessions: Session[] = [SESSION];
  let messages: ChatMessage[] = [];
  const onTurnFailed = vi.fn();
  const reportError = vi.fn();
  const hook = renderHook(() =>
    useAcpEngine({
      sessions,
      agents: fakeProfiles,
      updateMessages: (_id, change) => {
        messages = change(messages);
      },
      patchSession: (_id, patch) => {
        sessions = sessions.map((s) => ({ ...s, ...patch }));
      },
      reportError,
      rememberOptions: () => {},
      onAuthRequired: () => {},
      ...(withTurnFailed ? { onTurnFailed } : {}),
      ...(options.promptBlockedReason ? { promptBlockedReason: options.promptBlockedReason } : {}),
    }),
  );
  return {
    ...hook,
    onTurnFailed,
    reportError,
    userMessages: () => messages.filter((m) => m.role === "user"),
    /** Renders again so the engine sees the sessions the test (or the engine) changed. */
    refresh: () => hook.rerender(),
  };
}

async function startWithFailedTurn(engine: ReturnType<typeof renderEngine>, spy: { mock: { calls: unknown[][] } }) {
  await act(async () => {
    await engine.result.current.start(SESSION, { text: "fix the parser" });
  });
  await waitFor(() => expect(promptsSent(spy)).toHaveLength(1));
  await emit({ kind: "turn-end", error: NETWORK_ERROR });
}

describe("useAcpEngine when a turn fails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports the error to onTurnFailed and keeps the prompt to send again", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();

    await startWithFailedTurn(engine, spy);

    expect(engine.onTurnFailed).toHaveBeenCalledWith("s-1", NETWORK_ERROR);
    expect(engine.reportError).not.toHaveBeenCalled();
    expect(engine.result.current.hasFailedPrompt("s-1")).toBe(true);
  });

  it("falls back to a plain notice when nothing listens for failed turns", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine({ withTurnFailed: false });

    await startWithFailedTurn(engine, spy);

    expect(engine.reportError).toHaveBeenCalledWith(`The agent's turn failed: ${NETWORK_ERROR}`);
  });

  it("sends exactly the last prompt again, once, without adding a message to the chat", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startWithFailedTurn(engine, spy);
    expect(engine.userMessages()).toHaveLength(1);

    let first = false;
    let second = true;
    await act(async () => {
      first = await engine.result.current.retryFailedTurn("s-1");
      second = await engine.result.current.retryFailedTurn("s-1");
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(promptsSent(spy)).toEqual(["fix the parser", "fix the parser"]);
    expect(engine.userMessages()).toHaveLength(1);
    // The failure is cleared as the new turn starts.
    expect(engine.onTurnFailed).toHaveBeenLastCalledWith("s-1", null);
    expect(engine.result.current.hasFailedPrompt("s-1")).toBe(false);
  });

  it("does not try again while a turn runs", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startWithFailedTurn(engine, spy);
    // A turn is running again, and its start drops the failure: nothing is left to send.
    await act(async () => {
      await engine.result.current.send("s-1", "something else");
    });
    expect(engine.result.current.isBusy("s-1")).toBe(true);

    let retried = true;
    await act(async () => {
      retried = await engine.result.current.retryFailedTurn("s-1");
    });

    expect(retried).toBe(false);
    expect(promptsSent(spy)).toEqual(["fix the parser", "something else"]);
  });

  it("refuses to try again while a delegated report is handing over", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const reason = "Claude Code is working on Codex's report.";
    const engine = renderEngine({ promptBlockedReason: () => reason });
    await startWithFailedTurn(engine, spy);
    expect(promptsSent(spy)).toHaveLength(1);

    let retried = true;
    await act(async () => {
      retried = await engine.result.current.retryFailedTurn("s-1");
    });

    expect(retried).toBe(false);
    // Nothing was prompted past the pair's other side.
    expect(promptsSent(spy)).toEqual(["fix the parser"]);
    expect(engine.reportError).toHaveBeenCalledWith(reason);
    // The message is still in the chat, so the banner can stay.
    expect(engine.result.current.hasFailedPrompt("s-1")).toBe(true);
  });

  it("forgets the prompt once the user sends something else", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startWithFailedTurn(engine, spy);

    await act(async () => {
      await engine.result.current.send("s-1", "never mind, do this");
    });

    expect(engine.result.current.hasFailedPrompt("s-1")).toBe(false);
    expect(engine.onTurnFailed).toHaveBeenLastCalledWith("s-1", null);
  });

  it("keeps nothing to send again after a turn that ended without an error", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(SESSION, { text: "fix the parser" });
    });
    await waitFor(() => expect(promptsSent(spy)).toHaveLength(1));

    await emit({ kind: "turn-end", stopReason: "end_turn" });

    expect(engine.result.current.hasFailedPrompt("s-1")).toBe(false);
    expect(engine.onTurnFailed).not.toHaveBeenCalledWith("s-1", expect.any(String));
  });

  it("hands the message back when the agent does not take it", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startWithFailedTurn(engine, spy);
    const real = tauriInternals().invoke.bind(tauriInternals());
    spy.mockImplementation((cmd, args) =>
      cmd === "acp_prompt" ? Promise.reject(new Error("agent is gone")) : real(cmd, args),
    );
    const giveBack = vi.fn();

    let retried = true;
    await act(async () => {
      retried = await engine.result.current.retryFailedTurn("s-1", giveBack);
    });

    expect(retried).toBe(false);
    expect(giveBack).toHaveBeenCalledWith(expect.objectContaining({ text: "fix the parser" }));
    // Out of the chat, and back with the user: it is not shown twice.
    expect(engine.userMessages()).toHaveLength(0);
  });

  it("reopens an agent that has exited and shows the message once", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startWithFailedTurn(engine, spy);
    await emit({ kind: "exit", code: 1 });
    engine.refresh();

    await act(async () => {
      await engine.result.current.retryFailedTurn("s-1");
    });

    await waitFor(() => expect(promptsSent(spy)).toHaveLength(2));
    expect(promptsSent(spy)[1]).toContain("fix the parser");
    expect(engine.userMessages()).toHaveLength(1);
    expect(engine.userMessages()[0]?.content).toBe("fix the parser");
  });
});
