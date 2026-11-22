import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within, waitFor, configure } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import { openInspectorTab } from "./inspector-helpers";
import type { FakePrivate } from "./fixtures/private-backend";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const subscriptions = new Map<string, Set<Listener>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    const group = subscriptions.get(event) ?? new Set<Listener>();
    group.add(cb);
    subscriptions.set(event, group);
    listeners.set(event, (payload) => {
      for (const callback of [...group]) callback(payload);
    });
    return Promise.resolve(() => {
      group.delete(cb);
      if (!group.size) {
        subscriptions.delete(event);
        listeners.delete(event);
      }
    });
  },
  emit: () => Promise.resolve(),
}));

import App from "../App";

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 60_000 });

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined, ...unknown[]];

const AWS = ["AKIA", "IOSFODNN7EXAMPL", "E"].join("");
const MODEL_ID = "Qwen/Qwen3.8-27B";

const tauriInternals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
const fakeStore = () => (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
const fakePrivate = () => (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
const callsTo = (spy: { mock: { calls: unknown[][] } }, cmd: string) =>
  (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd).map(([, args]) => args ?? {});
const prompt = () => screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;

async function acpEvent(payload: Record<string, unknown>) {
  await act(async () => {
    listeners.get("acp-event")?.({ payload });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderApp() {
  fakeStore().state.settings.defaultAgentId = "qwen";
  const spy = vi.spyOn(tauriInternals(), "invoke");
  await act(async () => {
    render(<App />);
  });
  return spy;
}

async function send(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(prompt(), { key: "Enter" });
  });
}

/** Starts a session the way the user does, then leaves its first turn running. */
async function startRunning(spy: { mock: { calls: unknown[][] } }, isPrivate = false) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
  });
  if (isPrivate) {
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Private · TEE" }));
    });
  }
  await send("get started");
  await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
  const sessionId = String(callsTo(spy, "acp_start_session")[0].sessionId);
  await screen.findByRole("button", { name: "Stop agent" });
  return sessionId;
}

const promptTexts = (spy: { mock: { calls: unknown[][] } }) =>
  callsTo(spy, "acp_prompt").map((args) => JSON.stringify(args));
const turnEnd = (sessionId: string, extra: Record<string, unknown> = { stopReason: "end_turn" }) =>
  acpEvent({ sessionId, kind: "turn-end", ...extra });

describe("sending while an agent works", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
    subscriptions.clear();
  });

  it("queues a message sent during a turn and sends it once, when the turn ends", async () => {
    const spy = await renderApp();
    const id = await startRunning(spy);

    await send("second thought");
    const list = await screen.findByRole("list", { name: "Queued messages" });
    expect(within(list).getByText("second thought")).toBeInTheDocument();
    expect(callsTo(spy, "acp_prompt")).toHaveLength(1);
    expect(prompt().value).toBe("");

    await turnEnd(id);
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(2));
    expect(promptTexts(spy)[1]).toContain("second thought");
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });

  it("keeps a failed turn's queue and says so", async () => {
    const spy = await renderApp();
    const id = await startRunning(spy);
    await send("after that");
    await screen.findByRole("list", { name: "Queued messages" });

    await turnEnd(id, { error: "network is down" });
    expect(await screen.findByText("Not sent: the last turn failed.")).toBeInTheDocument();
    expect(callsTo(spy, "acp_prompt")).toHaveLength(1);
  });

  it("Send now asks the agent to stop and sends when the turn ends", async () => {
    const spy = await renderApp();
    const id = await startRunning(spy);
    await send("urgent");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Send now: urgent/ }));
    });
    await waitFor(() => expect(callsTo(spy, "acp_cancel")).toHaveLength(1));
    expect(callsTo(spy, "acp_prompt")).toHaveLength(1);
    await turnEnd(id, { stopReason: "cancelled" });
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(2));
  });

  it("Edit puts the message back in the composer", async () => {
    const spy = await renderApp();
    await startRunning(spy);
    await send("typo hree");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Edit: typo hree/ }));
    });
    expect(prompt().value).toBe("typo hree");
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });

  it("a private session's secret check runs when the message is queued, and not again when it is sent", async () => {
    fakePrivate().status = {
      ...fakePrivate().status,
      device: "ready",
      keyReady: true,
      balance: { credits: 1240, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
      recoverySaved: true,
      recoveryPrompted: true,
    };
    fakePrivate().models = [{ id: MODEL_ID, inputPerM: 0.04, outputPerM: 1.35 }];
    const spy = await renderApp();
    const id = await startRunning(spy, true);

    await send(`my key is ${AWS}`);
    const dialog = await screen.findByRole("dialog", { name: "This message may hold a secret" });
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send anyway" }));
    });
    await screen.findByRole("list", { name: "Queued messages" });

    await turnEnd(id);
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(2));
    expect(screen.queryByRole("dialog", { name: "This message may hold a secret" })).toBeNull();
  });

  it("a rewind drops the queue and leaves only the rewound message in the composer, with one notice", async () => {
    const spy = await renderApp();
    await startRunning(spy);
    await send("queued one");
    await send("queued two");
    await screen.findByRole("list", { name: "Queued messages" });

    const yours = screen.getByText("get started", { selector: "p" }).closest("[data-testid^='chat-message-']") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(yours).getByRole("button", { name: "Rewind to here" }));
    });
    await act(async () => {
      fireEvent.click(within(yours).getByRole("button", { name: "Confirm rewind" }));
    });

    expect(prompt().value).toBe("get started");
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
    expect(await screen.findByText("2 queued messages were removed with the rewind.")).toBeInTheDocument();
  });

  it("does not queue while the session is still starting: the text stays, as before", async () => {
    const spy = await renderApp();
    const real = spy.getMockImplementation();
    let finishSetMode: () => void = () => {};
    spy.mockImplementation((cmd, args) =>
      cmd === "acp_set_mode"
        ? new Promise((resolve) => {
            finishSetMode = () => resolve(fakeTauriInvoke(cmd, args));
          })
        : (real ? real(cmd, args) : fakeTauriInvoke(cmd, args)),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });
    await send("first");
    await waitFor(() => expect(callsTo(spy, "acp_set_mode")).toHaveLength(1));
    await send("second");

    expect(prompt().value).toBe("second");
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
    await act(async () => {
      finishSetMode();
    });
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
  });

  it("a session off screen still sends its queue at its turn end, and a refused one waits for that session", async () => {
    const spy = await renderApp();
    const id = await startRunning(spy);
    await send("later one");
    await screen.findByRole("list", { name: "Queued messages" });
    spy.mockImplementation((cmd, args) =>
      cmd === "acp_prompt" && JSON.stringify(args).includes("later one")
        ? Promise.reject(new Error("refused"))
        : fakeTauriInvoke(cmd, args),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
    await turnEnd(id);

    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(2));
    // The refused message waits: it is in no other session's composer.
    expect(prompt().value).toBe("");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("complementary")).getByText("get started"));
    });
    await waitFor(() => expect(prompt().value).toBe("later one"));
  });

  it("a prompt the user starts from the composer clears the held line", async () => {
    const spy = await renderApp();
    const id = await startRunning(spy);
    await send("after that");
    await screen.findByRole("list", { name: "Queued messages" });
    await turnEnd(id, { error: "network is down" });
    await screen.findByText("Not sent: the last turn failed.");

    await send("a fresh question");
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText("Not sent: the last turn failed.")).toBeNull());
  });

  it("while review comments are held the composer keeps Stop only and says they go when the agent finishes", async () => {
    const FILE = "src/app.ts";
    const DIFF = "@@ -41,2 +41,2 @@\n the context\n-old line\n+const x\n";
    const STAT = { path: FILE, oldPath: null, kind: "modified", added: 1, removed: 1, isBinary: false, fingerprint: "f1" };
    const spy = await renderApp();
    spy.mockImplementation((cmd, args) => {
      if (cmd === "session_changes") return Promise.resolve([{ path: FILE, oldPath: null, kind: "modified" }]);
      if (cmd === "session_diff_targets") return Promise.resolve({ base: null, root: "/Users/test/developer/ai-perpetual-trading", prefix: "" });
      if (cmd === "session_diff_stats") return Promise.resolve([STAT]);
      if (cmd === "session_file_diff") return Promise.resolve(DIFF);
      return fakeTauriInvoke(cmd, args);
    });
    Element.prototype.scrollIntoView = () => {};
    await startRunning(spy);
    await openInspectorTab("Changes");
    const panel = await screen.findByRole("complementary", { name: "Changes panel" });
    await act(async () => {
      fireEvent.click(await within(panel).findByTitle(FILE));
    });
    fireEvent.mouseOver(await within(panel).findByRole("row", { name: /^Line 42, added/ }));
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Comment on line 42" }));
    });
    fireEvent.change(within(panel).getByRole("textbox", { name: "Comment on line 42" }), { target: { value: "Check this." } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Save comment" }));
    });
    const add = await within(panel).findByRole("button", { name: "Add 1 comment to message" });
    await waitFor(() => expect(add).toBeEnabled());
    await act(async () => {
      fireEvent.click(add);
    });

    expect(prompt().value).toContain("Check this.");
    expect(screen.getByText("Comments are sent when Qwen Code finishes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Queue message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  });
});
