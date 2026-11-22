import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

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
import { ARTIFACT_GUIDE, ARTIFACT_REFUSALS, type ShownArtifact } from "../lib/artifacts";
import { CANVAS_GUIDE } from "../lib/canvas";
import { fakeTauriInvoke } from "./setup";
import { makeProfile } from "./fixtures/agents";
import type { ChatMessage, Session } from "../types";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const SESSION: Session = { id: "s-1", name: "Parser work", profileId: "pi-acp", cwd: "/Users/test/developer/zorvo", status: "running", createdAt: 1, transport: "acp" };
const ARTIFACT = { id: "a-0123456789abcdef", title: "Report", sourcePath: "/Users/test/developer/zorvo/r.html", versions: [{ n: 1, at: 5, bytes: 9 }] };
const SHOWN: ShownArtifact = { artifact: ARTIFACT, version: 1, isNewArtifact: true, isNewVersion: true };

const CANVAS_READ = {
  entry: { key: "c-0123456789abcdef", folder: "/w/d", relative: "d", title: "T", shownAt: 1 },
  canvas: { title: "T", sections: [{ id: "s", title: "S", artboards: [{ id: "a", title: "A", file: "a.html", width: 400, height: 400, group: null }] }] },
  error: null,
  boards: [{ id: "a", sha256: null }],
};

function setup(show: (args: Record<string, unknown>) => unknown | Promise<unknown>, sessions: Session[] = [SESSION], queued?: (messages: Record<string, ChatMessage[]>) => void) {
  const messages: Record<string, ChatMessage[]> = { "s-1": [{ id: "m-1", role: "user", content: "show me", timestamp: 1 }] };
  const shown: Array<{ sessionId: string; shown: ShownArtifact | { kind: "canvas"; key: string } }> = [];
  const notices: string[] = [];
  const spy = vi.spyOn(internals(), "invoke");
  // The same spy comes back on every call in one test: forget what an earlier setup saw.
  spy.mockClear();
  spy.mockImplementation((cmd, args) => {
    if (cmd === "artifact_show") return Promise.resolve().then(() => show(args ?? {}));
    if (cmd === "canvas_show") return Promise.resolve(CANVAS_READ);
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
    onArtifactShown: (sessionId, value) => {
      shown.push({ sessionId, shown: value });
    },
  };
  renderHook(() => useAgentTools(deps));
  const answers = () =>
    spy.mock.calls.filter(([cmd]) => cmd === "agent_tool_respond").map(([, args]) => args as { callId: string; ok: boolean; text: string });
  const shows = () => spy.mock.calls.filter(([cmd]) => cmd === "artifact_show").map(([, args]) => args);
  const call = async (callId: string, tool: string, args: Record<string, unknown> = {}, sessionId = "s-1") => {
    await waitFor(() => expect(listeners.has("agent-tool-call")).toBe(true));
    await act(async () => {
      listeners.get("agent-tool-call")?.({ payload: { callId, sessionId, tool, args } });
    });
    await waitFor(() => expect(answers().some((answer) => answer.callId === callId)).toBe(true));
  };
  const cards = () => (messages["s-1"] ?? []).flatMap((message) => (message.artifactCard ? [message.artifactCard] : []));
  return { answers, shows, call, cards, shown, notices, messages };
}

describe("artifact_guide", () => {
  it("answers the guide", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "artifact_guide");
    expect(env.answers()).toEqual([{ callId: "c-1", ok: true, text: ARTIFACT_GUIDE }]);
  });
});

describe("canvases", () => {
  it("routes show_artifact kind canvas to canvas_show and answers with the key", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "show_artifact", { path: "d", kind: "canvas" });
    expect(env.shows()).toEqual([]);
    const spy = vi.spyOn(internals(), "invoke");
    expect(spy.mock.calls.filter(([cmd]) => cmd === "canvas_show").map(([, args]) => args)).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd, path: "d" }]);
    expect(env.answers()[0].ok).toBe(true);
    expect(JSON.parse(env.answers()[0].text)).toEqual({ shown: true, canvas: "c-0123456789abcdef", artboards: 1 });
    expect(env.shown).toEqual([{ sessionId: "s-1", shown: { kind: "canvas", key: "c-0123456789abcdef" } }]);
    expect(env.cards()).toEqual([{ kind: "canvas", canvasKey: "c-0123456789abcdef", title: "T", artboards: 1 }]);
  });

  it("answers artifact_guide kind canvas with the canvas guide", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "artifact_guide", { kind: "canvas" });
    await env.call("c-2", "artifact_guide", { kind: "page" });
    expect(env.answers().map((a) => a.text)).toEqual([CANVAS_GUIDE, ARTIFACT_GUIDE]);
  });

  it("passes a canvas refusal or parse error on to the agent", async () => {
    const env = setup(() => SHOWN);
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockImplementation((cmd) => (cmd === "canvas_show" ? Promise.reject("sections[0].title: must not be empty") : Promise.resolve(null)));
    await env.call("c-1", "show_artifact", { path: "d", kind: "canvas" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: false, text: "sections[0].title: must not be empty" }]);
  });
});

describe("show_artifact", () => {
  it("stores the page, marks the chat and answers", async () => {
    const env = setup(() => SHOWN);

    await env.call("c-1", "show_artifact", { path: "r.html", title: "Report" });

    expect(env.shows()).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd, path: "r.html", title: "Report" }]);
    expect(env.answers()[0].ok).toBe(true);
    expect(JSON.parse(env.answers()[0].text)).toEqual({ title: "Report", version: 1, shown: true });
    expect(env.cards()).toEqual([{ artifactId: ARTIFACT.id, title: "Report", version: 1 }]);
    expect(env.shown).toEqual([{ sessionId: "s-1", shown: SHOWN }]);
    expect(env.notices).toEqual([]);
  });

  it("sends no title when the agent gave none or a blank one", async () => {
    const env = setup(() => ({ ...SHOWN, isNewArtifact: false }));
    await env.call("c-1", "show_artifact", { path: "r.html" });
    await env.call("c-2", "show_artifact", { path: "r.html", title: "   " });
    expect(env.shows()).toEqual([
      { sessionId: "s-1", cwd: SESSION.cwd, path: "r.html" },
      { sessionId: "s-1", cwd: SESSION.cwd, path: "r.html" },
    ]);
  });

  it("spells out control and bidi characters in a title", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "show_artifact", { path: "r.html", title: "Re‮port\u0007" });
    const sent = (env.shows()[0] as { title: string }).title;
    expect(sent.includes(String.fromCharCode(0x202e)) || sent.includes(String.fromCharCode(7))).toBe(false);
    expect(sent).toContain("Re");
  });

  it("adds no card for content that made no new version", async () => {
    const env = setup(() => ({ ...SHOWN, isNewArtifact: false, isNewVersion: false }));
    await env.call("c-1", "show_artifact", { path: "r.html" });
    expect(env.answers()[0].ok).toBe(true);
    expect(env.cards()).toEqual([]);
    expect(env.shown).toHaveLength(1);
  });

  it("gives each new version a card of its own", async () => {
    let version = 0;
    const env = setup(() => {
      version += 1;
      return { ...SHOWN, isNewArtifact: version === 1, version, artifact: { ...ARTIFACT, versions: [{ n: version, at: version, bytes: 1 }] } };
    });
    await env.call("c-1", "show_artifact", { path: "r.html", title: "Report" });
    await env.call("c-2", "show_artifact", { path: "r.html" });
    expect(env.cards().map((card) => ("version" in card ? card.version : null))).toEqual([1, 2]);
  });

  it("passes the backend's own refusals to the agent as they are", async () => {
    for (const refusal of ARTIFACT_REFUSALS) {
      const env = setup(() => Promise.reject(refusal));
      await env.call("c-1", "show_artifact", { path: "x.html", title: "T" });
      expect(env.answers()).toEqual([{ callId: "c-1", ok: false, text: refusal }]);
      expect(env.notices).toEqual([]);
      expect(env.cards()).toEqual([]);
    }
  });

  it("answers a failure of Zorvo's own in fixed words and tells the user", async () => {
    const env = setup(() => Promise.reject("/Users/test/secret is not one of your workspaces"));
    await env.call("c-1", "show_artifact", { path: "x.html", title: "T" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: false, text: "Zorvo could not do that." }]);
    expect(env.notices).toHaveLength(1);
    expect(env.notices[0]).not.toContain("secret");
  });

  it("answers an unreadable result in fixed words", async () => {
    const env = setup(() => ({ nonsense: true }));
    await env.call("c-1", "show_artifact", { path: "x.html", title: "T" });
    expect(env.answers()[0]).toMatchObject({ ok: false, text: "Zorvo could not do that." });
    expect(env.cards()).toEqual([]);
  });

  it("refuses arguments of another shape without calling the backend", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "show_artifact", { path: 3 });
    expect(env.answers()[0].ok).toBe(false);
    expect(env.shows()).toEqual([]);
  });

  it("tells a session without tools that it cannot use them", async () => {
    const delegated: Session = { ...SESSION, delegatedFrom: { sessionId: "s-0", task: "x", startedAt: 1 } };
    const env = setup(() => SHOWN, [delegated]);
    await env.call("c-1", "show_artifact", { path: "r.html", title: "T" });
    await env.call("c-2", "artifact_guide");
    expect(env.answers().map((answer) => answer.text)).toEqual([NO_SESSION, NO_SESSION]);
    expect(env.shows()).toEqual([]);
  });
});

describe("the refusals", () => {
  it("are the sentences the backend says, word for word", () => {
    const rust = ["src-tauri/src/artifacts/store.rs", "src-tauri/src/artifacts/source.rs"].map((file) => readFileSync(file, "utf8")).join("\n");
    const oneLine = rust.replace(/"\s*\n\s*"/g, "").replace(/=\s*\n\s*"/g, '= "');
    for (const refusal of ARTIFACT_REFUSALS) {
      expect(oneLine).toContain(`"${refusal}"`);
    }
    expect(ARTIFACT_REFUSALS.size).toBe(5);
  });
});

describe("a card after text the agent already sent", () => {
  // Streamed text waits for a frame; the engine's flush lands it. Here that is one queued reply.
  const queuedReply = (messages: Record<string, ChatMessage[]>) => {
    if (messages["s-1"].some((message) => message.id === "m-2")) return;
    messages["s-1"] = [...messages["s-1"], { id: "m-2", role: "agent", content: "Here it is:", timestamp: 2 }];
  };
  const order = (messages: ChatMessage[]) => messages.map((message) => (message.artifactCard ? "card" : message.id));

  it("puts an artifact's card after that text", async () => {
    const env = setup(() => SHOWN, [SESSION], queuedReply);
    await env.call("c-1", "show_artifact", { path: "r.html", title: "Report" });
    expect(order(env.messages["s-1"]).indexOf("m-2")).toBeGreaterThan(-1);
    expect(order(env.messages["s-1"]).indexOf("m-2")).toBeLessThan(order(env.messages["s-1"]).lastIndexOf("card"));
  });

  it("puts a canvas's card after that text", async () => {
    const env = setup(() => SHOWN, [SESSION], queuedReply);
    await env.call("c-1", "show_artifact", { path: "d", kind: "canvas" });
    expect(order(env.messages["s-1"]).indexOf("m-2")).toBeGreaterThan(-1);
    expect(order(env.messages["s-1"]).indexOf("m-2")).toBeLessThan(order(env.messages["s-1"]).lastIndexOf("card"));
  });
});
