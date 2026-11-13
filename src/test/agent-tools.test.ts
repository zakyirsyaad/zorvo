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

import { useAgentTools } from "../hooks/useAgentTools";
import { useAcpEngine } from "../hooks/session-engine/useAcpEngine";
import { NOT_READY, sessionGetsAgentTools } from "../lib/agent-tools";
import { NO_CHOICES } from "../lib/acp-draft";
import { fakeProfiles } from "./fixtures/agents";
import type { Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

const SESSION: Session = {
  id: "s-1",
  name: "Plain",
  profileId: "qwen",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
  acpSessionId: "acp-s-1",
};

const LINK = { sessionId: "a", task: "t", startedAt: 1 };

const OPENING = ["acp_start_session", "acp_reopen_session", "acp_import_session", "acp_fork_session"];

function openCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .filter(([cmd]) => OPENING.includes(cmd as string))
    .map(([cmd, args]) => [cmd, (args as { agentTools?: unknown }).agentTools]);
}

describe("sessionGetsAgentTools", () => {
  it("gives tools to a plain session and to a fork", () => {
    expect(sessionGetsAgentTools({})).toBe(true);
    expect(sessionGetsAgentTools({ compareRunId: null, delegatedFrom: null })).toBe(true);
  });

  it("gives none to a compare run session", () => {
    expect(sessionGetsAgentTools({ compareRunId: "run-1" })).toBe(false);
  });

  it("gives none to a delegated session, open or ended", () => {
    expect(sessionGetsAgentTools({ delegatedFrom: LINK })).toBe(false);
    expect(sessionGetsAgentTools({ delegatedFrom: { ...LINK, endedAt: 2 } })).toBe(false);
  });
});

describe("useAgentTools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("answers a tool call as not ready", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    renderHook(() => useAgentTools());
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));

    await act(async () => {
      listeners.get("agent-tool-call")?.({
        payload: { callId: "7", sessionId: "s-1", tool: "list_agents", args: {} },
      });
    });

    const answers = spy.mock.calls.filter(([cmd]) => cmd === "agent_tool_respond").map(([, args]) => args);
    expect(answers).toEqual([{ callId: "7", ok: false, text: NOT_READY }]);
  });

  it("listens for a call that ended and does nothing with it", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    renderHook(() => useAgentTools());
    await waitFor(() => expect(listeners.has("agent-tool-call-ended")).toBe(true));

    await act(async () => {
      listeners.get("agent-tool-call-ended")?.({ payload: { callId: "7" } });
    });

    expect(spy.mock.calls.filter(([cmd]) => cmd === "agent_tool_respond")).toHaveLength(0);
  });

  it("stops listening when it unmounts", async () => {
    const { unmount } = renderHook(() => useAgentTools());
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));
    unmount();
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(false));
    expect(listeners.has("agent-tool-call-ended")).toBe(false);
  });
});

describe("useAcpEngine and agentTools", () => {
  afterEach(() => vi.restoreAllMocks());

  const engine = (session: Session) =>
    renderHook(() =>
      useAcpEngine({
        sessions: [session],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

  it("passes agentTools when a session starts, reopens, imports and forks", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const { result } = engine(SESSION);

    await act(async () => {
      await result.current.start(SESSION);
      await result.current.resume(SESSION, "acp-s-1");
      await result.current.importSession(SESSION, NO_CHOICES, () => {});
      await result.current.fork("s-0", SESSION);
    });

    expect(openCalls(spy)).toEqual([
      ["acp_start_session", true],
      ["acp_reopen_session", true],
      ["acp_import_session", true],
      ["acp_fork_session", true],
    ]);
  });

  it("passes false for a compare run session and a delegated one", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    const compared: Session = { ...SESSION, id: "s-2", compareRunId: "run-1" };
    const delegated: Session = { ...SESSION, id: "s-3", delegatedFrom: LINK };
    const { result } = renderHook(() =>
      useAcpEngine({
        sessions: [compared, delegated],
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession: () => {},
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
      }),
    );

    await act(async () => {
      await result.current.start(compared);
      await result.current.start(delegated);
    });

    expect(openCalls(spy)).toEqual([
      ["acp_start_session", false],
      ["acp_start_session", false],
    ]);
  });
});
