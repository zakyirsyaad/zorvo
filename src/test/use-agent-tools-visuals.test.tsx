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
import { VISUAL_GUIDE, VISUAL_SHOWN_TEXT } from "../lib/visuals";
import { fakeTauriInvoke } from "./setup";
import { makeProfile } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const SESSION: Session = { id: "s-1", name: "Parser work", profileId: "pi-acp", cwd: "/Users/test/developer/zorvo", status: "running", createdAt: 1, transport: "acp" };
const OTHER: Session = { ...SESSION, id: "s-2", name: "Other" };
const ENTRY = { id: "v-0123456789abcdef", title: "Flow", kind: "svg", bytes: 18, shownAt: 5 };
const PART = { kind: "visual", id: ENTRY.id, title: "Flow", visualKind: "svg" };

function setup(show: (args: Record<string, unknown>) => unknown | Promise<unknown>, sessions: Session[] = [SESSION, OTHER], queued?: (messages: Record<string, ChatMessage[]>) => void) {
  const messages: Record<string, ChatMessage[]> = {
    "s-1": [{ id: "m-1", role: "user", content: "draw it", timestamp: 1 }],
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
    onArtifactShown: (_sessionId: string, _shown: ShownArtifact | { kind: "canvas" | "motion" | "video" | "design-system"; key: string }) => undefined,
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

describe("show_visual", () => {
  it("keeps the visual from code and answers shown", async () => {
    const env = setup(() => ENTRY);
    await env.call("c-1", "show_visual", { title: "Flow", code: "<svg><rect/></svg>" });
    expect(env.shows()).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd, title: "Flow", code: "<svg><rect/></svg>" }]);
    expect(env.answers()).toEqual([{ callId: "c-1", ok: true, text: VISUAL_SHOWN_TEXT }]);
    expect(env.messages["s-1"].at(-1)).toMatchObject({ role: "agent", parts: [PART] });
  });

  it("lands the text the agent already sent before it adds the visual", async () => {
    const env = setup(() => ENTRY, [SESSION, OTHER], (messages) => {
      messages["s-2"] = messages["s-2"].map((message) => ({ ...message, parts: [...(message.parts ?? []), { kind: "text" as const, text: " Here it is:" }] }));
    });
    await env.call("c-1", "show_visual", { title: "Flow", code: "<p>a</p>" }, "s-2");
    expect(env.messages["s-2"][0].parts).toEqual([{ kind: "text", text: "First." }, { kind: "text", text: " Here it is:" }, PART]);
  });

  it("passes a path instead of code, never both", async () => {
    const env = setup(() => ENTRY);
    await env.call("c-1", "show_visual", { title: "Flow", path: "flow.svg" });
    expect(env.shows()).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd, title: "Flow", path: "flow.svg" }]);
  });

  it("puts the visual in the session that called, after what its reply already says", async () => {
    const env = setup(() => ENTRY);
    await env.call("c-1", "show_visual", { title: "Flow", code: "<p>a</p>" }, "s-2");
    expect(env.messages["s-2"][0].parts).toEqual([{ kind: "text", text: "First." }, PART]);
    expect(env.messages["s-1"]).toHaveLength(1);
  });

  it("passes a refusal from the backend to the agent as it is", async () => {
    const env = setup(() => Promise.reject("The visual is over 256 KB."));
    await env.call("c-1", "show_visual", { title: "Flow", code: "<p>a</p>" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: false, text: "The visual is over 256 KB." }]);
    expect(env.notices).toEqual([]);
    expect(env.messages["s-1"]).toHaveLength(1);
  });

  it("turns any other failure into one plain sentence and a notice", async () => {
    const env = setup(() => Promise.reject("ENOENT /Users/test/secret"));
    await env.call("c-1", "show_visual", { title: "Flow", code: "<p>a</p>" });
    expect(env.answers()[0]).toMatchObject({ ok: false, text: "Zorvo could not do that." });
    expect(env.notices).toEqual(["Zorvo could not show the visual an agent made."]);
  });

  it("does not trust an answer of the wrong shape", async () => {
    const env = setup(() => ({ id: "nope" }));
    await env.call("c-1", "show_visual", { title: "Flow", code: "<p>a</p>" });
    expect(env.answers()[0].ok).toBe(false);
    expect(env.messages["s-1"]).toHaveLength(1);
  });

  it("tells a session with no tools that it has none", async () => {
    const env = setup(() => ENTRY, [{ ...SESSION, compareRunId: "run-1" }]);
    await env.call("c-1", "show_visual", { title: "Flow", code: "<p>a</p>" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: false, text: NO_SESSION }]);
    expect(env.shows()).toEqual([]);
  });
});

describe("artifact_guide", () => {
  it("answers kind visual with the visual guide", async () => {
    const env = setup(() => ENTRY);
    await env.call("c-1", "artifact_guide", { kind: "visual" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: true, text: VISUAL_GUIDE }]);
  });
});
