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
import { MOTION_GUIDE } from "../lib/motion";
import { DESIGN_SYSTEM_GUIDE } from "../lib/design-systems";
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
  const shown: Array<{ sessionId: string; shown: ShownArtifact | { kind: "canvas" | "motion" | "video" | "design-system"; key: string } }> = [];
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

/** The line every design guide ends with when the folder holds no design system. */
const NO_SYSTEM = "No design system in this folder. Zorvo looks only in this folder and below it, never above it.";

describe("artifact_guide", () => {
  it("answers the guide", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "artifact_guide");
    expect(env.answers()).toEqual([{ callId: "c-1", ok: true, text: `${ARTIFACT_GUIDE}\n\n${NO_SYSTEM}` }]);
  });

  it("ends the motion guide with the systems the session's folder holds", async () => {
    const env = setup(() => SHOWN);
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockImplementation((cmd, args) =>
      cmd === "design_systems_list"
        ? Promise.resolve({
            systems: [{ key: "d-0123456789abcdef", relative: "docs/design-system", title: "Zorvo", isDefault: true, dropped: [] }],
            defaultProblem: null,
          })
        : fakeTauriInvoke(cmd, args),
    );
    await env.call("c-1", "artifact_guide", { kind: "motion" });
    expect(env.answers()[0]).toEqual({
      callId: "c-1",
      ok: true,
      text: `${MOTION_GUIDE}\n\nDesign systems in this folder: \`docs/design-system\` (\`Zorvo\`, default). Read its README.md and tokens.json before you design. Zorvo looks only in this folder and below it, never above it.`,
    });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "design_systems_list").map(([, args]) => args)).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd }]);
  });

  it("answers the guide alone when the search fails", async () => {
    const env = setup(() => SHOWN);
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockImplementation((cmd, args) => (cmd === "design_systems_list" ? Promise.reject("/Users/test is not one of your workspaces") : fakeTauriInvoke(cmd, args)));
    await env.call("c-1", "artifact_guide", { kind: "canvas" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: true, text: CANVAS_GUIDE }]);
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
    expect(env.answers().map((a) => a.text)).toEqual([`${CANVAS_GUIDE}\n\n${NO_SYSTEM}`, `${ARTIFACT_GUIDE}\n\n${NO_SYSTEM}`]);
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
  // The card joins the open reply, so it sits on the queued text's own message or on a later one.
  const expectCardAfterText = (messages: ChatMessage[]) => {
    const text = messages.findIndex((message) => message.id === "m-2");
    const card = messages.findIndex((message) => message.artifactCard !== undefined);
    expect(text).toBeGreaterThan(-1);
    expect(card).toBeGreaterThanOrEqual(text);
  };

  it("puts an artifact's card after that text", async () => {
    const env = setup(() => SHOWN, [SESSION], queuedReply);
    await env.call("c-1", "show_artifact", { path: "r.html", title: "Report" });
    expectCardAfterText(env.messages["s-1"]);
  });

  it("puts a canvas's card after that text", async () => {
    const env = setup(() => SHOWN, [SESSION], queuedReply);
    await env.call("c-1", "show_artifact", { path: "d", kind: "canvas" });
    expectCardAfterText(env.messages["s-1"]);
  });
});

describe("motions and videos", () => {
  const MOTION_READ = {
    entry: { key: "m-0123456789abcdef", folder: "/w/promo", relative: "promo", title: "Promo", shownAt: 1, duration: 15, formats: ["wide"] },
    title: "Promo",
    duration: 15,
    fps: 60,
    poster: 5,
    tracks: 0,
    formats: [{ id: "wide", width: 1920, height: 1080, hasRender: false, isUpToDate: false }],
    jobs: [],
    error: null,
    warnings: [],
  };
  const VIDEO = { key: "v-0123456789abcdef", path: "/w/out/reel.mp4", relative: "out/reel.mp4", title: "Reel", shownAt: 1 };

  function withMedia(env: ReturnType<typeof setup>, answers: { motion?: unknown; video?: unknown }) {
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockImplementation((cmd, args) => {
      if (cmd === "motion_show") return answers.motion instanceof Error ? Promise.reject(answers.motion.message) : Promise.resolve(answers.motion);
      if (cmd === "video_show") return Promise.resolve(answers.video);
      return fakeTauriInvoke(cmd, args);
    });
    return { env, spy };
  }

  it("routes kind motion to motion_show, marks the chat and opens it", async () => {
    const { env, spy } = withMedia(setup(() => SHOWN), { motion: MOTION_READ });
    await env.call("c-1", "show_artifact", { path: "promo", kind: "motion" });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "motion_show").map(([, args]) => args)).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd, path: "promo" }]);
    expect(JSON.parse(env.answers()[0].text)).toMatchObject({ shown: true, motion: "m-0123456789abcdef", formats: ["wide"] });
    expect(env.cards()).toEqual([{ kind: "motion", motionKey: "m-0123456789abcdef", title: "Promo", duration: 15, formats: 1 }]);
    expect(env.shown).toEqual([{ sessionId: "s-1", shown: { kind: "motion", key: "m-0123456789abcdef" } }]);
  });

  it("routes kind video to video_show with its title", async () => {
    const { env, spy } = withMedia(setup(() => SHOWN), { video: VIDEO });
    await env.call("c-1", "show_artifact", { path: "out/reel.mp4", kind: "video", title: "Reel" });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "video_show").map(([, args]) => args)).toEqual([
      { sessionId: "s-1", cwd: SESSION.cwd, path: "out/reel.mp4", title: "Reel" },
    ]);
    expect(env.cards()).toEqual([{ kind: "video", videoKey: "v-0123456789abcdef", title: "Reel" }]);
  });

  it("passes a motion refusal on and hides any other error", async () => {
    const { env } = withMedia(setup(() => SHOWN), { motion: new Error("formats[0].width: must be even") });
    await env.call("c-1", "show_artifact", { path: "promo", kind: "motion" });
    expect(env.answers()).toEqual([{ callId: "c-1", ok: false, text: "formats[0].width: must be even" }]);
    const other = withMedia(setup(() => SHOWN), { motion: new Error("/Users/me/private exploded") });
    await other.env.call("c-2", "show_artifact", { path: "promo", kind: "motion" });
    expect(other.env.answers()[0].text).not.toContain("/Users/me");
  });

  it("answers artifact_guide kind motion with the motion guide", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "artifact_guide", { kind: "motion" });
    expect(env.answers()[0].text).toContain("motion.json");
  });
});

describe("design systems", () => {
  const DS_READ = {
    entry: { key: "d-0123456789abcdef", folder: "/w/ds", relative: "ds", title: "Acme", tokens: 42, components: 12, shownAt: 1 },
    content: null,
    error: null,
    googleFontsUrl: null,
  };

  it("routes show_artifact kind design-system to design_system_show and answers with the key", async () => {
    const env = setup(() => SHOWN);
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockImplementation((cmd, args) => (cmd === "design_system_show" ? Promise.resolve(DS_READ) : fakeTauriInvoke(cmd, args)));
    await env.call("c-1", "show_artifact", { path: "ds", kind: "design-system" });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "design_system_show").map(([, args]) => args)).toEqual([{ sessionId: "s-1", cwd: SESSION.cwd, path: "ds" }]);
    expect(env.answers()).toEqual([{ callId: "c-1", ok: true, text: "Shown: `Acme` (key d-0123456789abcdef), 42 tokens, 12 components." }]);
    expect(env.shown).toEqual([{ sessionId: "s-1", shown: { kind: "design-system", key: "d-0123456789abcdef" } }]);
  });

  it("passes a refusal on and hides any other error", async () => {
    const env = setup(() => SHOWN);
    const spy = vi.spyOn(internals(), "invoke");
    const refusal = "A design system needs a README.md beside its design-system.json.";
    spy.mockImplementation((cmd) => (cmd === "design_system_show" ? Promise.reject(refusal) : Promise.resolve(null)));
    await env.call("c-1", "show_artifact", { path: "ds", kind: "design-system" });
    spy.mockImplementation((cmd) => (cmd === "design_system_show" ? Promise.reject("/private/x is not one of your workspaces") : Promise.resolve(null)));
    await env.call("c-2", "show_artifact", { path: "ds", kind: "design-system" });
    expect(env.answers()).toEqual([
      { callId: "c-1", ok: false, text: refusal },
      { callId: "c-2", ok: false, text: "Zorvo could not show that design system." },
    ]);
    expect(env.notices).toEqual(["Zorvo could not show the design system an agent made."]);
  });

  it("answers artifact_guide kind design-system with its guide and the line", async () => {
    const env = setup(() => SHOWN);
    await env.call("c-1", "artifact_guide", { kind: "design-system" });
    expect(env.answers()[0].text).toBe(`${DESIGN_SYSTEM_GUIDE}\n\n${NO_SYSTEM}`);
  });
});
