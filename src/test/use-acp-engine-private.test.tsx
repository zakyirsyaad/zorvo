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
type Call = [string, Record<string, unknown> | undefined];

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const MODEL_ID = "Qwen/Qwen3.8-27B";

const PRIVATE: Session = {
  id: "s-1",
  name: "Private review",
  profileId: "qwen-code",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
  privateMode: { modelId: MODEL_ID },
};

const ORDINARY: Session = { ...PRIVATE, privateMode: undefined };

/** Qwen Code's answer with a model config option, as a real start reports it. */
const STARTED_WITH_MODEL = {
  acpSessionId: "acp-s-1",
  agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
  modes: null,
  models: null,
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: MODEL_ID,
      options: [
        { value: MODEL_ID, name: "Qwen 3.8 27B" },
        { value: "qwen-max", name: "Qwen Max" },
      ],
    },
  ],
};

let realInvoke: TauriInternals["invoke"] = () => Promise.resolve();

/** Spies on invoke, letting `overrides` answer some commands and the fake backend the rest. */
function stub(overrides: Record<string, (args?: Record<string, unknown>) => Promise<unknown>> = {}) {
  realInvoke = tauriInternals().invoke;
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    const override = overrides[cmd];
    return override ? override(args) : realInvoke(cmd, args);
  });
}

const callsTo = (spy: { mock: { calls: unknown[][] } }, cmd: string) =>
  (spy.mock.calls as unknown as Call[]).filter(([name]) => name === cmd).map(([, args]) => args ?? {});

const emit = (payload: Record<string, unknown>) =>
  act(async () => {
    listeners.get("acp-event")?.({ payload: { sessionId: "s-1", ...payload } });
  });

function renderEngine(session: Session = PRIVATE) {
  let sessions: Session[] = [session];
  let messages: ChatMessage[] = [];
  const reportError = vi.fn();
  const rememberOptions = vi.fn();
  const onPrivateCreditsOut = vi.fn();
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
      rememberOptions,
      onAuthRequired: () => {},
      onTurnFailed: () => {},
      onPrivateCreditsOut,
    }),
  );
  return {
    ...hook,
    reportError,
    rememberOptions,
    onPrivateCreditsOut,
    session: () => sessions[0],
    userMessages: () => messages.filter((m) => m.role === "user"),
    refresh: () => hook.rerender(),
  };
}

describe("useAcpEngine with a private session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("starts a private session on its model, and an ordinary one with no privateModelId key", async () => {
    const spy = stub();
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(PRIVATE);
      await engine.result.current.start({ ...ORDINARY, id: "s-2" });
    });

    const [privateStart, ordinaryStart] = callsTo(spy, "acp_start_session");
    expect(privateStart).toEqual({ sessionId: "s-1", cwd: PRIVATE.cwd, profileId: "qwen-code", privateModelId: MODEL_ID });
    expect(Object.keys(ordinaryStart)).not.toContain("privateModelId");
  });

  it("never moves a private session off its model, and keeps its options out of the agent's remembered ones", async () => {
    const spy = stub({ acp_start_session: () => Promise.resolve(STARTED_WITH_MODEL) });
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(PRIVATE, undefined, { config: { model: "qwen-max" } });
    });

    expect(callsTo(spy, "acp_set_config_option")).toEqual([]);
    expect(engine.rememberOptions).not.toHaveBeenCalled();
  });

  it("resumes a saved private session with its model", async () => {
    const spy = stub();
    const engine = renderEngine({ ...PRIVATE, status: "terminated", acpSessionId: "acp-s-1" });
    await act(async () => {
      await engine.result.current.resume(engine.session(), "acp-s-1", { text: "go on" });
    });

    expect(callsTo(spy, "acp_reopen_session")).toEqual([
      { sessionId: "s-1", cwd: PRIVATE.cwd, profileId: "qwen-code", acpSessionId: "acp-s-1", privateModelId: MODEL_ID },
    ]);
  });

  it("tries a failed turn again in a reopened agent on the same model", async () => {
    const spy = stub();
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(PRIVATE, { text: "review the module" });
    });
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
    await emit({ kind: "turn-end", error: "fetch failed" });
    await emit({ kind: "exit", code: 1 });
    engine.refresh();
    expect(engine.session().status).toBe("terminated");

    await act(async () => {
      await engine.result.current.retryFailedTurn("s-1");
    });

    expect(callsTo(spy, "acp_reopen_session")).toEqual([
      { sessionId: "s-1", cwd: PRIVATE.cwd, profileId: "qwen-code", acpSessionId: "acp-s-1", privateModelId: MODEL_ID },
    ]);
  });

  it("says the credits ran out, gives the message back and marks the session, never showing the raw refusal", async () => {
    stub({ acp_start_session: () => Promise.reject('PRIVATE_CREDITS:{"reason":"empty"}') });
    const engine = renderEngine();
    let isTaken = true;
    await act(async () => {
      isTaken = await engine.result.current.start(PRIVATE, { text: "review the module" });
    });

    // False: the caller gives the message back to the composer.
    expect(isTaken).toBe(false);
    expect(engine.userMessages()).toEqual([]);
    expect(engine.reportError).toHaveBeenCalledWith("Your credits ran out. Top up to continue.");
    expect(engine.reportError.mock.calls.flat().join(" ")).not.toContain("PRIVATE_CREDITS");
    expect(engine.onPrivateCreditsOut).toHaveBeenCalledWith("s-1", "empty");
  });

  it("says the private key stopped working", async () => {
    stub({ acp_start_session: () => Promise.reject('PRIVATE_CREDITS:{"reason":"key"}') });
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(PRIVATE, { text: "hi" });
    });

    expect(engine.reportError).toHaveBeenCalledWith(
      "This Mac's private key stopped working. Restore it in Settings → Private mode.",
    );
    expect(engine.onPrivateCreditsOut).toHaveBeenCalledWith("s-1", "key");
  });

  it("words a model that is no longer offered", async () => {
    stub({ acp_start_session: () => Promise.reject("unknown_model") });
    const engine = renderEngine();
    await act(async () => {
      await engine.result.current.start(PRIVATE, { text: "hi" });
    });

    expect(engine.reportError).toHaveBeenCalledWith(
      "That model isn't offered anymore. Start a new private session to pick another.",
    );
    expect(engine.onPrivateCreditsOut).not.toHaveBeenCalled();
  });

  it("words the refusal of a plain reopen of a session that ran privately", async () => {
    stub({ acp_reopen_session: () => Promise.reject("private_session") });
    const engine = renderEngine({ ...ORDINARY, status: "terminated", acpSessionId: "acp-s-1" });
    await act(async () => {
      await engine.result.current.resume(engine.session(), "acp-s-1", { text: "go on" });
    });

    expect(engine.reportError).toHaveBeenCalledWith("This session ran privately. Reopen it as a private session.");
  });

  it("keeps an ordinary session's errors as they were", async () => {
    stub({ acp_start_session: () => Promise.reject("spawn failed") });
    const engine = renderEngine(ORDINARY);
    await act(async () => {
      await engine.result.current.start(ORDINARY, { text: "hi" });
    });

    expect(engine.reportError).toHaveBeenCalledWith("Failed to start Qwen Code: spawn failed");
  });
});
