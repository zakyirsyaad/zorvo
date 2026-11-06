import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCompareModelProbe } from "../hooks/useCompareModelProbe";
import type { AgentOptions } from "../lib/acp-draft";

/** A compare draft asks one agent for its models when that agent's chip is opened, never when it is ticked. */
type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const CWD = "/w/repo";
const PROBED = {
  modes: null,
  configOptions: [
    { id: "model", name: "Model", category: "model", type: "select", currentValue: "gpt-5", options: [{ value: "gpt-5", name: "gpt-5" }] },
  ],
  commands: [],
  signInChecked: false,
  canListSessions: false,
};

const probeCalls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([cmd]) => cmd === "acp_probe_agent");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(answer: (profileId: string) => Promise<unknown>, agentOptions: Record<string, AgentOptions> = {}) {
  const spy = vi
    .spyOn(tauriInternals(), "invoke")
    .mockImplementation((cmd, args) => (cmd === "acp_probe_agent" ? answer(String(args?.profileId)) : Promise.resolve(undefined)));
  const callbacks = { onProbed: vi.fn(), onSignedIn: vi.fn(), onNeedsSignIn: vi.fn() };
  const hook = renderHook(() => useCompareModelProbe({ cwd: CWD, agentOptions, ...callbacks }));
  return { spy, callbacks, hook };
}

describe("useCompareModelProbe", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks nothing until ask", () => {
    const { spy } = setup(() => Promise.resolve(PROBED));
    expect(probeCalls(spy)).toHaveLength(0);
  });

  it("asks one agent with needsOptions true, and stores what it answers", async () => {
    const answer = deferred<unknown>();
    const { spy, callbacks, hook } = setup(() => answer.promise);
    act(() => hook.result.current.ask("codex"));
    expect(probeCalls(spy).map((call) => call[1])).toEqual([{ profileId: "codex", cwd: CWD, needsOptions: true }]);
    expect(hook.result.current.stateOf("codex")).toBe("asking");
    await act(async () => answer.resolve(PROBED));
    expect(callbacks.onProbed).toHaveBeenCalledWith("codex", expect.objectContaining({ configOptions: expect.any(Array) }));
    expect(hook.result.current.stateOf("codex")).toBeUndefined();
  });

  it("queues a second ask behind the first", async () => {
    const first = deferred<unknown>();
    const { spy, hook } = setup((id) => (id === "codex" ? first.promise : Promise.resolve(PROBED)));
    act(() => {
      hook.result.current.ask("codex");
      hook.result.current.ask("gemini");
    });
    expect(probeCalls(spy)).toHaveLength(1);
    expect(hook.result.current.stateOf("gemini")).toBe("asking");
    await act(async () => first.resolve(PROBED));
    await waitFor(() => expect(probeCalls(spy)).toHaveLength(2));
    expect(probeCalls(spy)[1][1]).toMatchObject({ profileId: "gemini" });
  });

  it("never asks a known agent, or one asked already", async () => {
    const known: AgentOptions = { modes: null, configOptions: PROBED.configOptions };
    const { spy, hook } = setup(() => Promise.resolve(PROBED), { claude: known });
    act(() => hook.result.current.ask("claude"));
    expect(probeCalls(spy)).toHaveLength(0);
    await act(async () => hook.result.current.ask("codex"));
    await waitFor(() => expect(hook.result.current.stateOf("codex")).toBeUndefined());
    act(() => hook.result.current.ask("codex"));
    expect(probeCalls(spy)).toHaveLength(1);
  });

  it("marks an answer that shows a sign-in", async () => {
    const { callbacks, hook } = setup(() => Promise.resolve({ ...PROBED, signInChecked: true }));
    await act(async () => hook.result.current.ask("codex"));
    await waitFor(() => expect(callbacks.onSignedIn).toHaveBeenCalledWith("codex"));
  });

  it("marks an agent that needs a sign-in", async () => {
    const { callbacks, hook } = setup(() => Promise.reject(`ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "x", name: "X" }])}`));
    await act(async () => hook.result.current.ask("codex"));
    await waitFor(() => expect(callbacks.onNeedsSignIn).toHaveBeenCalledWith("codex"));
    expect(hook.result.current.stateOf("codex")).toBeUndefined();
  });

  it("asks again after a failure", async () => {
    const { spy, hook } = setup(() => Promise.reject("boom"));
    await act(async () => hook.result.current.ask("codex"));
    await waitFor(() => expect(hook.result.current.stateOf("codex")).toBe("failed"));
    await act(async () => hook.result.current.ask("codex"));
    expect(probeCalls(spy)).toHaveLength(2);
  });
});
