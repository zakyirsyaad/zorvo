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
  name: "Stuck glob",
  profileId: "qwen",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
};

const emit = (payload: Record<string, unknown>) =>
  act(async () => {
    listeners.get("acp-event")?.({ payload: { sessionId: "s-1", ...payload } });
  });

function renderEngine({ reportError = vi.fn(), onTurnSettled = vi.fn() }: { reportError?: (message: string) => void; onTurnSettled?: (id: string, end: unknown) => void } = {}) {
  let sessions: Session[] = [SESSION];
  let messages: ChatMessage[] = [];
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
      onTurnSettled,
    }),
  );
  return { ...hook, session: () => sessions[0], messages: () => messages };
}

async function startTurn(engine: ReturnType<typeof renderEngine>) {
  await act(async () => {
    await engine.result.current.start(SESSION, { text: "find the screenshot" });
  });
  await waitFor(() => expect(engine.result.current.isBusy("s-1")).toBe(true));
}

describe("useAcpEngine when Stop is pressed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("remembers when Stop was pressed until the turn ends", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();

    const before = Date.now();
    act(() => engine.result.current.interrupt("s-1", []));
    expect(engine.result.current.stopAskedAt("s-1")).toBeGreaterThanOrEqual(before);

    await emit({ kind: "turn-end", stopReason: "cancelled" });
    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();
  });

  it("keeps the first Stop's time when Stop is pressed again", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    act(() => engine.result.current.interrupt("s-1", []));
    now.mockReturnValue(9_000);
    act(() => engine.result.current.interrupt("s-1", []));

    expect(engine.result.current.stopAskedAt("s-1")).toBe(1_000);
  });

  it("ends the agent's process, and the exit it causes ends the session", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const engine = renderEngine();
    await startTurn(engine);
    act(() => engine.result.current.interrupt("s-1", []));

    let ended = false;
    await act(async () => {
      ended = await engine.result.current.endAgent("s-1");
    });
    expect(ended).toBe(true);
    // The whole process goes, not this session's route: a native fork shares it.
    expect(spy.mock.calls.filter(([cmd]) => cmd === "acp_end_agent").map(([, args]) => args)).toEqual([{ sessionId: "s-1" }]);
    expect(spy.mock.calls.some(([cmd]) => cmd === "acp_stop_session")).toBe(false);

    await emit({ kind: "exit", code: null });
    expect(engine.session().status).toBe("terminated");
    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();
  });

  it("settles a permission card once Stop has answered it, so End agent can show", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    await emit({
      kind: "permission",
      requestId: 7,
      toolCall: { title: "Delete build" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    const pending = () => engine.messages().filter((m) => m.actionCard?.status === "pending");
    expect(pending()).toHaveLength(1);

    await act(async () => {
      engine.result.current.interrupt("s-1", engine.messages());
    });

    await waitFor(() => expect(pending()).toHaveLength(0));
  });

  it("records no Stop for a session whose turn already ended", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    await emit({ kind: "turn-end", stopReason: "end_turn" });

    act(() => engine.result.current.interrupt("s-1", []));

    expect(engine.result.current.stopAskedAt("s-1")).toBeUndefined();
  });

  it("treats an agent already gone as ended, with no notice", async () => {
    const reportError = vi.fn();
    const engine = renderEngine({ reportError });
    await startTurn(engine);
    const real = tauriInternals().invoke.bind(tauriInternals());
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "acp_end_agent" ? Promise.reject("Session 's-1' not found") : real(cmd, args),
    );

    let ended = false;
    await act(async () => {
      ended = await engine.result.current.endAgent("s-1");
    });

    expect(ended).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("settles nothing for an exit that follows Zorvo's own stop", async () => {
    const onTurnSettled = vi.fn();
    const engine = renderEngine({ onTurnSettled });
    await startTurn(engine);
    await act(async () => {
      await engine.result.current.stop("s-1");
    });

    await emit({ kind: "exit", code: 0 });
    await emit({ kind: "turn-end", stopReason: "cancelled" });

    expect(onTurnSettled).not.toHaveBeenCalled();
  });
});

describe("useAcpEngine turn checks and marks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says a turn is under way from the moment a prompt is out until it ends", async () => {
    const engine = renderEngine();
    expect(engine.result.current.isTurnUnderWay("s-1")).toBe(false);
    await startTurn(engine);
    expect(engine.result.current.isTurnUnderWay("s-1")).toBe(true);
    await emit({ kind: "turn-end", stopReason: "end_turn" });
    expect(engine.result.current.isTurnUnderWay("s-1")).toBe(false);
  });

  it("says a turn is under way while a launch opens, before its prompt is written", async () => {
    const real = tauriInternals().invoke.bind(tauriInternals());
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(tauriInternals(), "invoke").mockImplementation(async (cmd, args) => {
      if (cmd === "acp_start_session") await held;
      return real(cmd, args);
    });
    const engine = renderEngine();
    let launching: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      launching = engine.result.current.start(SESSION, { text: "go" });
      await Promise.resolve();
    });
    expect(engine.result.current.isTurnUnderWay("s-1")).toBe(true);
    await act(async () => {
      release();
      await launching;
    });
  });

  it("puts the first message's marks on the user message a launch adds", async () => {
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(SESSION, {
        text: "Also fix the tests",
        marks: { delegationTask: { agentName: "Claude Code", agentId: "claude-acp" } },
      });
    });
    expect(engine.messages().at(0)).toMatchObject({
      role: "user",
      content: "Also fix the tests",
      delegationTask: { agentName: "Claude Code", agentId: "claude-acp" },
    });
  });
});

describe("useAcpEngine when Stop is pressed before the prompt goes out", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never sends a message whose pre-turn checkpoint was still being taken", async () => {
    const engine = renderEngine();
    await startTurn(engine);
    await emit({ kind: "turn-end", stopReason: "end_turn" });

    let finishCheckpoint!: (sha: string | null) => void;
    const original = tauriInternals().invoke.bind(tauriInternals());
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "create_turn_checkpoint") return new Promise((resolve) => (finishCheckpoint = resolve));
      return original(cmd, args);
    });

    let taken: boolean | undefined;
    await act(async () => {
      void engine.result.current.send("s-1", "rename the files").then((value) => (taken = value));
      await Promise.resolve();
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith("create_turn_checkpoint", expect.anything(), undefined));
    act(() => engine.result.current.interrupt("s-1", []));
    await act(async () => {
      finishCheckpoint("a".repeat(40));
      await Promise.resolve();
    });

    await waitFor(() => expect(taken).toBe(false));
    expect(spy.mock.calls.filter(([cmd]) => cmd === "acp_prompt")).toEqual([]);
    expect(engine.messages().some((message) => message.content === "rename the files")).toBe(false);
  });
});
