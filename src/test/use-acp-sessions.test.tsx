import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { toModels, useAcpSessions, type AcpHandlers } from "../hooks/useAcpSessions";
import { sweepOrphans } from "../lib/orphan-sweep";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const STARTED = {
  acpSessionId: "acp-1",
  agentCapabilities: { sessionCapabilities: { fork: {} } },
  modes: {
    currentModeId: "yolo",
    availableModes: [
      { id: "default", name: "Default" },
      { id: "yolo", name: "YOLO" },
    ],
  },
  models: null,
  configOptions: [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "qwen-max",
      options: [
        { value: "qwen-max", name: "Qwen Max" },
        { value: "qwen-flash", name: "Qwen Flash" },
      ],
    },
  ],
};

function stubInvoke(overrides: Record<string, (args?: Record<string, unknown>) => Promise<unknown>>) {
  const internals = tauriInternals();
  const original = internals.invoke;
  return vi.spyOn(internals, "invoke").mockImplementation((cmd, args) => {
    const override = overrides[cmd];
    return override ? override(args) : original(cmd, args);
  });
}

function handlers(): AcpHandlers {
  return {
    onUpdate: vi.fn(),
    onPermission: vi.fn(),
    onElicitation: vi.fn(),
    onElicitationComplete: vi.fn(),
    onTurnEnd: vi.fn(),
    onExit: vi.fn(),
  };
}

async function emit(payload: unknown) {
  await act(async () => {
    listeners.get("acp-event")?.({ payload });
  });
}

describe("toModels", () => {
  it("keeps the models an agent reported and drops malformed ones", () => {
    expect(
      toModels({
        currentModelId: "auto",
        availableModels: [
          { modelId: "auto", name: "Auto", description: "Picks for you" },
          { modelId: "flash", name: "Flash" },
          { modelId: "no-name" },
          "junk",
        ],
      }),
    ).toEqual({
      currentModelId: "auto",
      availableModels: [
        { modelId: "auto", name: "Auto", description: "Picks for you" },
        { modelId: "flash", name: "Flash", description: undefined },
      ],
    });
  });

  it("is null for anything that is not a model state with a list", () => {
    for (const raw of [null, undefined, "auto", [], {}, { currentModelId: "a" }, { availableModels: [] }, { currentModelId: 1, availableModels: [] }]) {
      expect(toModels(raw)).toBeNull();
    }
  });
});

describe("useAcpSessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("starts a session and keeps the agent's modes and config options", async () => {
    const spy = stubInvoke({ acp_start_session: () => Promise.resolve(STARTED) });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    let started: unknown;
    await act(async () => {
      started = await result.current.start("s-1", "/w", "qwen", true);
    });

    expect(spy).toHaveBeenCalledWith("acp_start_session", { sessionId: "s-1", cwd: "/w", profileId: "qwen", agentTools: true }, undefined);
    expect(started).toMatchObject({ acpSessionId: "acp-1" });
    expect(result.current.info["s-1"].modes?.currentModeId).toBe("yolo");
    expect(result.current.info["s-1"].configOptions?.[0].currentValue).toBe("qwen-max");
    expect(result.current.canFork("s-1")).toBe(true);
  });

  it("starts, reopens, imports and forks a session at once, even while the startup orphan sweep runs", async () => {
    // The sweep ends only the sessions it listed when the window loaded, so a start need not wait for it.
    let finishSweep = () => {};
    const spy = stubInvoke({
      end_orphaned_sessions: () => new Promise((resolve) => (finishSweep = () => resolve(0))),
      acp_start_session: () => Promise.resolve(STARTED),
      acp_reopen_session: () => Promise.resolve(STARTED),
      acp_import_session: () => Promise.resolve(STARTED),
      acp_fork_session: () => Promise.resolve(STARTED),
    });
    const sweep = sweepOrphans();
    const { result } = renderHook(() => useAcpSessions(handlers()));

    await act(async () => {
      await Promise.all([
        result.current.start("s-1", "/w", "qwen", true),
        result.current.reopen("s-2", "/w", "qwen", "acp-2", true),
        result.current.importSession("s-3", "/w", "qwen", "acp-3", true),
        result.current.fork("s-1", "s-4", "/w", true),
      ]);
    });
    const started = spy.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd) => ["acp_start_session", "acp_reopen_session", "acp_import_session", "acp_fork_session"].includes(cmd));
    expect(started.sort()).toEqual(["acp_fork_session", "acp_import_session", "acp_reopen_session", "acp_start_session"]);

    finishSweep();
    await sweep;
  });

  it("is busy from prompt until the turn ends, and forwards the turn result", async () => {
    stubInvoke({
      acp_start_session: () => Promise.resolve(STARTED),
      acp_prompt: () => Promise.resolve(),
    });
    const h = handlers();
    const { result } = renderHook(() => useAcpSessions(h));
    await act(async () => {
      await result.current.start("s-1", "/w", "qwen", true);
    });

    await act(async () => {
      await result.current.prompt("s-1", "hello");
    });
    expect(result.current.isBusy("s-1")).toBe(true);

    await emit({ sessionId: "s-1", kind: "turn-end", stopReason: "end_turn" });
    expect(result.current.isBusy("s-1")).toBe(false);
    expect(h.onTurnEnd).toHaveBeenCalledWith("s-1", { stopReason: "end_turn" });
  });

  it("tracks when a turn started and forgets it at turn end", async () => {
    stubInvoke({
      acp_start_session: () => Promise.resolve(STARTED),
      acp_prompt: () => Promise.resolve(),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));
    await act(async () => {
      await result.current.start("s-1", "/w", "qwen", true);
    });
    expect(result.current.busySinceOf("s-1")).toBeUndefined();

    await act(async () => {
      await result.current.prompt("s-1", "hello");
    });
    expect(typeof result.current.busySinceOf("s-1")).toBe("number");

    await emit({ sessionId: "s-1", kind: "turn-end", stopReason: "end_turn" });
    expect(result.current.busySinceOf("s-1")).toBeUndefined();
  });

  it("is not busy when the prompt could not be sent", async () => {
    stubInvoke({ acp_prompt: () => Promise.reject("Session 's-1' not found") });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    await act(async () => {
      await expect(result.current.prompt("s-1", "hello")).rejects.toBe("Session 's-1' not found");
    });
    expect(result.current.isBusy("s-1")).toBe(false);
  });

  it("routes updates, permission requests and exits to the handlers", async () => {
    const h = handlers();
    renderHook(() => useAcpSessions(h));

    await emit({ sessionId: "s-1", kind: "update", update: { sessionUpdate: "agent_message_chunk" } });
    await emit({ sessionId: "s-1", kind: "permission", requestId: "p-1", toolCall: {}, options: [] });
    await emit({ sessionId: "s-1", kind: "exit", code: 0 });

    expect(h.onUpdate).toHaveBeenCalledWith("s-1", { sessionUpdate: "agent_message_chunk" });
    expect(h.onPermission).toHaveBeenCalledWith("s-1", { requestId: "p-1", toolCall: {}, options: [] });
    expect(h.onExit).toHaveBeenCalledWith("s-1", 0);
  });

  it("tracks the agent's current mode and changes it on request", async () => {
    const spy = stubInvoke({
      acp_start_session: () => Promise.resolve(STARTED),
      acp_set_mode: () => Promise.resolve(),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));
    await act(async () => {
      await result.current.start("s-1", "/w", "qwen", true);
    });

    await act(async () => {
      await result.current.setMode("s-1", "default");
    });
    expect(spy).toHaveBeenCalledWith("acp_set_mode", { sessionId: "s-1", modeId: "default" }, undefined);
    expect(result.current.info["s-1"].modes?.currentModeId).toBe("default");

    await emit({ sessionId: "s-1", kind: "update", update: { sessionUpdate: "current_mode_update", currentModeId: "yolo" } });
    expect(result.current.info["s-1"].modes?.currentModeId).toBe("yolo");
  });

  it("reports the models of a session and switches them", async () => {
    const models = {
      currentModelId: "auto",
      availableModels: [
        { modelId: "auto", name: "Auto" },
        { modelId: "flash", name: "Flash" },
      ],
    };
    const spy = stubInvoke({
      acp_start_session: () => Promise.resolve({ ...STARTED, modes: null, configOptions: [], models }),
      acp_set_model: () => Promise.resolve(undefined),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));
    await act(async () => {
      await result.current.start("s-1", "/work", "gemini", true);
    });
    expect(result.current.info["s-1"].models?.currentModelId).toBe("auto");

    await act(async () => {
      await result.current.setModel("s-1", "flash");
    });

    expect(spy).toHaveBeenCalledWith("acp_set_model", { sessionId: "s-1", modelId: "flash" }, undefined);
    expect(result.current.info["s-1"].models?.currentModelId).toBe("flash");
  });

  it("keeps the model when the agent refuses the switch", async () => {
    const models = { currentModelId: "auto", availableModels: [{ modelId: "auto", name: "Auto" }] };
    stubInvoke({
      acp_start_session: () => Promise.resolve({ ...STARTED, models }),
      acp_set_model: () => Promise.reject("Unknown model"),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));
    await act(async () => {
      await result.current.start("s-1", "/work", "gemini", true);
    });

    await act(async () => {
      await expect(result.current.setModel("s-1", "flash")).rejects.toBe("Unknown model");
    });

    expect(result.current.info["s-1"].models?.currentModelId).toBe("auto");
  });

  it("applies the config options the agent returns after a change", async () => {
    const updated = [{ ...STARTED.configOptions[0], currentValue: "qwen-flash" }];
    stubInvoke({
      acp_start_session: () => Promise.resolve(STARTED),
      acp_set_config_option: () => Promise.resolve(updated),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));
    await act(async () => {
      await result.current.start("s-1", "/w", "qwen", true);
    });

    await act(async () => {
      await result.current.setConfigOption("s-1", "model", "qwen-flash");
    });

    expect(result.current.info["s-1"].configOptions?.[0].currentValue).toBe("qwen-flash");
  });

  it("drops malformed modes and config options from the agent", async () => {
    stubInvoke({
      acp_start_session: () =>
        Promise.resolve({ acpSessionId: "acp-1", modes: { currentModeId: 3 }, configOptions: [{ id: 1 }], agentCapabilities: null }),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    await act(async () => {
      await result.current.start("s-1", "/w", "qwen", true);
    });

    expect(result.current.info["s-1"].modes).toBeNull();
    expect(result.current.info["s-1"].configOptions).toEqual([]);
    expect(result.current.canFork("s-1")).toBe(false);
  });

  it("reports whether the agent can reopen a session", async () => {
    stubInvoke({
      acp_start_session: (args) =>
        Promise.resolve({
          acpSessionId: `acp-${(args as { sessionId: string }).sessionId}`,
          agentCapabilities:
            (args as { sessionId: string }).sessionId === "load"
              ? { loadSession: true }
              : (args as { sessionId: string }).sessionId === "resume"
                ? { sessionCapabilities: { resume: {} } }
                : {},
        }),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    await act(async () => {
      await result.current.start("load", "/w", "qwen", true);
      await result.current.start("resume", "/w", "qwen", true);
      await result.current.start("none", "/w", "qwen", true);
    });

    expect(result.current.info["load"].canReopen).toBe(true);
    expect(result.current.info["resume"].canReopen).toBe(true);
    expect(result.current.info["none"].canReopen).toBe(false);
  });

  it("keeps how the backend reopened a session", async () => {
    stubInvoke({
      acp_reopen_session: () =>
        Promise.resolve({
          acpSessionId: "acp-1",
          agentCapabilities: { sessionCapabilities: { resume: {} } },
          reopenedWith: "resume",
        }),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    await act(async () => {
      await result.current.reopen("s-1", "/w", "qwen", "acp-1", true);
    });

    expect(result.current.info["s-1"].reopenedWith).toBe("resume");
  });

  it("starts and reopens a private session with its model, and an ordinary one with no privateModelId key at all", async () => {
    const spy = stubInvoke({
      acp_start_session: () => Promise.resolve(STARTED),
      acp_reopen_session: () => Promise.resolve(STARTED),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    await act(async () => {
      await result.current.start("s-1", "/w", "qwen-code", false, "Qwen/Qwen3.8-27B");
      await result.current.reopen("s-2", "/w", "qwen-code", "acp-2", false, "Qwen/Qwen3.8-27B");
      await result.current.start("s-3", "/w", "qwen-code", false);
      await result.current.reopen("s-4", "/w", "qwen-code", "acp-4", false);
      await result.current.start("s-5", "/w", "qwen-code", false, "Qwen/Qwen3.8-27B", true);
      await result.current.reopen("s-6", "/w", "qwen-code", "acp-6", false, "Qwen/Qwen3.8-27B", true);
      await result.current.start("s-7", "/w", "qwen-code", false, "Qwen/Qwen3.8-27B", false, 200);
      await result.current.reopen("s-8", "/w", "qwen-code", "acp-8", false, "Qwen/Qwen3.8-27B", false, 200);
    });

    const argsOf = (cmd: string) =>
      spy.mock.calls.filter(([name]) => name === cmd).map(([, args]) => args as Record<string, unknown>);
    expect(argsOf("acp_start_session")[0]).toEqual({
      sessionId: "s-1",
      cwd: "/w",
      profileId: "qwen-code",
      agentTools: false,
      privateModelId: "Qwen/Qwen3.8-27B",
    });
    expect(argsOf("acp_reopen_session")[0]).toEqual({
      sessionId: "s-2",
      cwd: "/w",
      profileId: "qwen-code",
      acpSessionId: "acp-2",
      agentTools: false,
      privateModelId: "Qwen/Qwen3.8-27B",
    });
    expect(Object.keys(argsOf("acp_start_session")[1])).not.toContain("privateModelId");
    expect(Object.keys(argsOf("acp_reopen_session")[1])).not.toContain("privateModelId");
    expect(argsOf("acp_start_session")[2]).toMatchObject({
      privateModelId: "Qwen/Qwen3.8-27B",
      privateOwnKey: true,
    });
    expect(argsOf("acp_reopen_session")[2]).toMatchObject({
      privateModelId: "Qwen/Qwen3.8-27B",
      privateOwnKey: true,
    });
    expect(Object.keys(argsOf("acp_start_session")[1])).not.toContain("privateOwnKey");
    expect(argsOf("acp_start_session")[3]).toMatchObject({ privateSessionCap: 200 });
    expect(argsOf("acp_reopen_session")[3]).toMatchObject({ privateSessionCap: 200 });
    expect(Object.keys(argsOf("acp_start_session")[0])).not.toContain("privateSessionCap");
    expect(Object.keys(argsOf("acp_reopen_session")[0])).not.toContain("privateSessionCap");
  });

  it("reopens, imports and lists through the backend commands", async () => {
    const spy = stubInvoke({
      acp_reopen_session: () => Promise.resolve(STARTED),
      acp_import_session: () => Promise.resolve(STARTED),
      acp_list_sessions: () =>
        Promise.resolve({ sessions: [{ acpSessionId: "acp-9" }, { title: "no id" }], truncated: false, incomplete: true }),
    });
    const { result } = renderHook(() => useAcpSessions(handlers()));

    let listed: unknown;
    await act(async () => {
      await result.current.reopen("s-1", "/w", "qwen", "acp-1", true);
      await result.current.importSession("s-2", "/w", "qwen", "acp-2", true);
      listed = await result.current.listSessions("qwen", "/w");
    });

    expect(spy).toHaveBeenCalledWith(
      "acp_reopen_session",
      { sessionId: "s-1", cwd: "/w", profileId: "qwen", acpSessionId: "acp-1", agentTools: true },
      undefined,
    );
    expect(spy).toHaveBeenCalledWith(
      "acp_import_session",
      { sessionId: "s-2", cwd: "/w", profileId: "qwen", acpSessionId: "acp-2", agentTools: true },
      undefined,
    );
    expect(spy).toHaveBeenCalledWith("acp_list_sessions", { profileId: "qwen", cwd: "/w" }, undefined);
    expect(listed).toEqual({ sessions: [{ acpSessionId: "acp-9" }], truncated: false, incomplete: true });
  });
});
