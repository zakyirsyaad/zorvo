import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useNextStep, type NextStepArgs } from "../hooks/useNextStep";
import { fakeTauriInvoke } from "./setup";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const SESSION: Session = { id: "s-1", name: "Status words", profileId: "claude-acp", cwd: "/w/zorvo", status: "running", createdAt: 1, transport: "acp" };
const USER: ChatMessage = { id: "u-1", role: "user", content: "Do it", timestamp: 1 };
const REPLY: ChatMessage = { id: "a-1", role: "agent", content: "Done.", timestamp: 2, isComplete: true, endedNormally: true, nextStep: { recap: "Done.", pick: "create_pr" } };
const PR = { branch: "feat/x", number: 7, title: "t", url: "https://github.com/o/r/pull/7", state: "open", isDraft: false, checks: { passing: 1, failing: 0, pending: 0 }, mergeState: "CLEAN" };

beforeEach(() => {
  const spy = vi.spyOn(internals(), "invoke");
  spy.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "session_diff_stats") return Promise.resolve([{ path: "a.ts", added: 3, removed: 1 }]);
    if (cmd === "session_branch_state") return Promise.resolve({ branch: "feat/x", upstream: null, ahead: 0, isDefaultBranch: false });
    return fakeTauriInvoke(cmd, args);
  });
});

let lastArgs: NextStepArgs | undefined;
function setup(over: Partial<NextStepArgs> = {}) {
  let messages: ChatMessage[] = over.messages ? [...over.messages] : [USER, REPLY];
  let resolveSend: (taken: boolean) => void = () => undefined;
  const send = vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; }));
  const openUrl = vi.fn();
  const openPreview = vi.fn();
  const args: NextStepArgs = {
    session: SESSION,
    sessions: [SESSION],
    messages,
    isBusy: false,
    isWaiting: false,
    blockedReason: undefined,
    pullRequest: null,
    tasks: [],
    send,
    updateMessages: (_id, update) => { messages = update(messages); },
    openUrl,
    openPreview,
    ...over,
  };
  lastArgs = args;
  const hook = renderHook((props: NextStepArgs) => useNextStep(props), { initialProps: args });
  return { hook, send, openUrl, openPreview, resolve: (taken: boolean) => resolveSend(taken), messages: () => messages };
}

describe("useNextStep", () => {
  it("is the active box of a finished turn's last reply", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current?.facts.changes).toEqual({ files: 1, added: 3, removed: 1 }));
    expect(hook.result.current?.messageId).toBe("a-1");
  });

  it("sends a press once, records the answer when the agent took it", async () => {
    const { hook, send, resolve, messages } = setup();
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const button = { kind: "action" as const, action: "create_pr" as const, label: "Create PR", message: "Commit, push and open a pull request.", isPick: true };
    act(() => {
      hook.result.current?.onPress(button);
      hook.result.current?.onPress(button);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("s-1", "Commit, push and open a pull request.");
    await act(async () => resolve(true));
    expect(messages()[1].nextStep?.answered?.label).toBe("Create PR");
  });

  it("records nothing when the agent did not take the message", async () => {
    const { hook, resolve, messages } = setup();
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    act(() => hook.result.current?.onPress({ kind: "reply", label: "Not yet", message: "Not yet" }));
    await act(async () => resolve(false));
    expect(messages()[1].nextStep?.answered).toBeUndefined();
    expect(hook.result.current?.isSending).toBe(false);
  });

  it("opens the pull request and the preview without sending", async () => {
    const { hook, send, openUrl, openPreview } = setup({ pullRequest: PR, tasks: [{ id: "p", kind: "shell", name: "pnpm dev", status: "Running", startedAt: 1, sessionId: "s-1", pid: 2, ports: [5173] }] });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    act(() => hook.result.current?.onPress({ kind: "action", action: "open_pr", label: "Open PR", isPick: false }));
    act(() => hook.result.current?.onPress({ kind: "action", action: "open_preview", label: "Open in Zorvo's browser", isPick: false }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/7");
    expect(openPreview).toHaveBeenCalledWith("http://localhost:5173");
    expect(send).not.toHaveBeenCalled();
  });

  it("is null for a worker, a compare run, a busy session, or a turn that did not end normally", () => {
    const worker = { ...SESSION, delegatedFrom: { sessionId: "s-0", task: "t", startedAt: 1 } };
    expect(setup({ session: worker, sessions: [worker] }).hook.result.current).toBeNull();
    const run = { ...SESSION, compareRunId: "r-1" };
    expect(setup({ session: run, sessions: [run] }).hook.result.current).toBeNull();
    expect(setup({ isBusy: true }).hook.result.current).toBeNull();
    expect(setup({ isWaiting: true }).hook.result.current).toBeNull();
    expect(setup({ messages: [USER, { ...REPLY, endedNormally: undefined }] }).hook.result.current).toBeNull();
    expect(setup({ messages: [REPLY, USER] }).hook.result.current).toBeNull();
  });

  it("passes on why Send is blocked", async () => {
    const { hook } = setup({ blockedReason: "Sign in to Claude Code to send." });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    expect(hook.result.current?.blockedReason).toBe("Sign in to Claude Code to send.");
  });

  it("returns the same view across renders while nothing changed", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current?.facts.changes).toBeDefined());
    const first = hook.result.current;
    hook.rerender({ ...lastArgs!, send: vi.fn(), openUrl: vi.fn() });
    expect(hook.result.current).toBe(first);
  });
});
