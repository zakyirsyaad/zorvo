import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAcpEngine } from "../hooks/session-engine/useAcpEngine";
import { useSessionRewind } from "../hooks/useSessionRewind";
import { NO_CHOICES } from "../lib/acp-draft";
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
  acpSessionId: "acp-s-1",
  privateMode: { modelId: MODEL_ID },
};

const MESSAGES: ChatMessage[] = [
  { id: "m-1", role: "user", content: "review the module", timestamp: 1 } as ChatMessage,
  { id: "m-2", role: "agent", content: "done", timestamp: 2 } as ChatMessage,
  { id: "m-3", role: "user", content: "and the tests", timestamp: 3 } as ChatMessage,
];

describe("rewinding a private session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("restarts its fresh agent on the same private model", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke");
    let sessions: Session[] = [PRIVATE];
    const patchSession = (_id: string, patch: Partial<Session>) => {
      sessions = sessions.map((s) => ({ ...s, ...patch }));
    };
    const { result, rerender } = renderHook(() => {
      const acp = useAcpEngine({
        sessions,
        agents: fakeProfiles,
        updateMessages: () => {},
        patchSession,
        reportError: () => {},
        rememberOptions: () => {},
        onAuthRequired: () => {},
        transcripts: { "s-1": MESSAGES },
      });
      const rewind = useSessionRewind({
        agents: fakeProfiles,
        transcripts: { "s-1": MESSAGES },
        acp,
        patchSession,
        updateMessages: () => {},
        onRestore: () => {},
        onGiveBack: () => {},
        onNotice: () => {},
      });
      return { rewind };
    });

    act(() => result.current.rewind.rewind(sessions[0], "m-3"));
    rerender();
    expect(sessions[0].acpSessionId).toBeNull();
    await act(async () => {
      await result.current.rewind.restart(sessions[0], { text: "and the tests, please" }, NO_CHOICES);
    });

    await waitFor(() =>
      expect((spy.mock.calls as unknown as Call[]).filter(([cmd]) => cmd === "acp_start_session").map(([, args]) => args)).toEqual([
        { sessionId: "s-1", cwd: PRIVATE.cwd, profileId: "qwen-code", agentTools: false, privateModelId: MODEL_ID },
      ]),
    );
  });
});
