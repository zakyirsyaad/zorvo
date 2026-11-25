import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import { useAgentTools, type AgentToolsDeps } from "../hooks/useAgentTools";
import { NO_SESSION } from "../lib/agent-tools";
import type { ShownArtifact } from "../lib/artifacts";
import { WRAP_UP_SHOWN_TEXT } from "../lib/next-step-part";
import { fakeTauriInvoke } from "./setup";
import { makeProfile } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const SESSION: Session = { id: "s-1", name: "Parser work", profileId: "pi-acp", cwd: "/Users/test/developer/zorvo", status: "running", createdAt: 1, transport: "acp" };
const OTHER: Session = { ...SESSION, id: "s-2", name: "Other" };

function setup(show: (args: Record<string, unknown>) => unknown | Promise<unknown>, sessions: Session[] = [SESSION, OTHER], queued?: (messages: Record<string, ChatMessage[]>) => void) {
  const messages: Record<string, ChatMessage[]> = {
    "s-1": [
      { id: "m-1", role: "user", content: "fix it", timestamp: 1 },
      { id: "m-3", role: "agent", content: "Fixed.", timestamp: 2 },
    ],
    "s-2": [{ id: "m-2", role: "agent", content: "First.", timestamp: 1, parts: [{ kind: "text", text: "First." }] }],
  };
  const notices: string[] = [];
  const spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd, args) => {
    if (cmd === "visual_show") return Promise.resolve().then(() => show(args ?? {}));
    return fakeTauriInvoke(cmd, args);
  });
  const deps: AgentToolsDeps = {
    sessions,
    agents: [makeProfile({ id: "pi-acp", name: "pi ACP", detected: true })],
    statusOf: () => "ready",
    workersOf: () => [],
    startWorker: async () => ({ ok: false, reason: "no" }),
    sendToWorker: async () => ({ ok: false, reason: "no" }),
    recordDone: () => false,
    workspaces: [],
    openSession: async () => ({ ok: false, reason: "no" }),
    openedOf: () => [],
    updateMessages: (sessionId, update) => {
      messages[sessionId] = update(messages[sessionId] ?? []);
    },
    flushUpdates: () => queued?.(messages),
    onAttention: () => undefined,
    onNotice: (message) => {
      notices.push(message);
    },
    messagesOf: async () => [],
    stateOf: () => "idle",
    stopTurn: () => undefined,
    onArtifactShown: (_sessionId: string, _shown: ShownArtifact | { kind: "canvas" | "motion" | "video"; key: string }) => undefined,
  };
  renderHook(() => useAgentTools(deps));
  const answers = () =>
    spy.mock.calls.filter(([cmd]) => cmd === "agent_tool_respond").map(([, args]) => args as { callId: string; ok: boolean; text: string });
  const shows = () => spy.mock.calls.filter(([cmd]) => cmd === "visual_show").map(([, args]) => args);
  const call = async (callId: string, tool: string, args: Record<string, unknown> = {}, sessionId = "s-1") => {
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));
    await act(async () => {
      listeners.get("agent-tool-call")?.({ payload: { callId, sessionId, tool, args } });
    });
    await waitFor(() => expect(answers().some((answer) => answer.callId === callId)).toBe(true));
  };
  return { answers, shows, call, notices, messages };
}

describe("wrap_up", () => {
  it("leaves the step on the turn's reply and answers at once", async () => {
    const { answers, call, messages } = setup(() => null);
    await call("c-1", "wrap_up", { recap: "Fixed the parser.", ask: "Commit it?", pick: "commit", replies: ["Not yet"] });
    expect(answers()).toEqual([{ callId: "c-1", ok: true, text: WRAP_UP_SHOWN_TEXT }]);
    expect(messages["s-1"][1].nextStep).toEqual({ recap: "Fixed the parser.", ask: "Commit it?", pick: "commit", replies: ["Not yet"] });
  });

  it("replaces an earlier wrap_up of the same turn", async () => {
    const { call, messages } = setup(() => null);
    await call("c-1", "wrap_up", { recap: "First." });
    await call("c-2", "wrap_up", { recap: "Second." });
    expect(messages["s-1"][1].nextStep).toEqual({ recap: "Second." });
  });

  it("keeps the agent's words as sent, so they survive a reload within their limits", async () => {
    const { call, messages } = setup(() => null);
    const recap = "Line one\nLine \u202e two".padEnd(300, ".");
    await call("c-1", "wrap_up", { recap });
    expect(messages["s-1"][1].nextStep?.recap).toBe(recap);
  });

  it("tells a session with no coordinator role it cannot use the tool", async () => {
    const worker: Session = { ...SESSION, delegatedFrom: { sessionId: "s-2", task: "parse", startedAt: 1 } };
    const { answers, call } = setup(() => null, [worker, OTHER]);
    await call("c-1", "wrap_up", { recap: "Done." });
    expect(answers()).toEqual([{ callId: "c-1", ok: false, text: NO_SESSION }]);
  });
});
