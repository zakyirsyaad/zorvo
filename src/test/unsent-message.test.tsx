import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within, waitFor } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    write(_data: string, callback?: () => void) {
      callback?.();
    }
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined, ...unknown[]];
type Spy = { mock: { calls: unknown[][] }; mockImplementation: (impl: never) => unknown };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

function callsTo(spy: Spy, cmd: string) {
  return (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd);
}

/** The fake backend itself, for mocks that change one command and pass the rest through. */
let realInvoke: TauriInternals["invoke"] = () => Promise.resolve();

/** Makes the backend answer `cmd` with `answer` and everything else as usual. */
function answer(spy: Spy, cmd: string, reply: () => Promise<unknown>) {
  spy.mockImplementation(((name: string, args?: Record<string, unknown>) =>
    name === cmd ? reply() : realInvoke(name, args)) as never);
}

async function renderWithQwen(): Promise<Spy> {
  fakeStore().state.settings.defaultAgentId = "qwen";
  realInvoke = tauriInternals().invoke;
  const spy = vi.spyOn(tauriInternals(), "invoke");
  await act(async () => {
    render(<App />);
  });
  return spy as unknown as Spy;
}

async function acpEvent(payload: Record<string, unknown>) {
  await act(async () => {
    listeners.get("acp-event")?.({ payload });
    // Stream updates apply once a frame; let that frame land inside act.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

async function type(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
  });
}

async function send(text: string) {
  await type(text);
  await act(async () => {
    fireEvent.keyDown(prompt(), { key: "Enter" });
  });
}

function sidebar() {
  return within(screen.getByRole("complementary"));
}

async function openSession(name: string) {
  await act(async () => {
    fireEvent.click(sidebar().getByText(name));
  });
}

/** A promise the test settles itself, for an answer that comes while the user acts. */
function deferred() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((_, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

const FOLDER = "/Users/test/developer/ai-perpetual-trading";
const FIRST_MESSAGE = "get started";

function endedSession(id: string, name: string, createdAt: number, acpSessionId: string) {
  return { id, name, profileId: "qwen", cwd: FOLDER, status: "terminated", createdAt, transport: "acp", acpSessionId };
}

/** Starts a session with a first message and ends its turn, so the next message goes to a running agent. */
async function startRunningSession(spy: Spy) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
  });
  await send(FIRST_MESSAGE);
  await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
  const sessionId = String(callsTo(spy, "acp_start_session")[0][1]?.sessionId);
  await acpEvent({ sessionId, kind: "turn-end", stopReason: "end_turn" });
  return sessionId;
}

describe("a message that did not reach the agent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("comes back to the composer when the prompt to a running agent fails", async () => {
    const spy = await renderWithQwen();
    await startRunningSession(spy);
    answer(spy, "acp_prompt", () => Promise.reject("agent went away"));

    await send("please run the tests");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Failed to send the message"));
    expect(prompt().value).toBe("please run the tests");
    // Back in the box, and no longer shown in the chat as if the agent had it.
    expect(screen.queryAllByText("please run the tests").filter((el) => el.tagName !== "TEXTAREA")).toHaveLength(0);
  });

  it("does not replace what was typed while the agent was still being asked", async () => {
    const spy = await renderWithQwen();
    await startRunningSession(spy);
    const pending = deferred();
    answer(spy, "acp_prompt", () => pending.promise);

    await send("please run the tests");
    await type("and then the linter");
    await act(async () => {
      pending.reject("agent went away");
    });

    await waitFor(() => expect(prompt().value).toBe("please run the tests\n\nand then the linter"));
  });

  it("goes back to the session it was written for, never into the one on screen", async () => {
    fakeStore().state.sessions = [endedSession("s-beta", "Beta work", 1, "qwen-beta")];
    const spy = await renderWithQwen();
    await startRunningSession(spy);
    const pending = deferred();
    answer(spy, "acp_prompt", () => pending.promise);

    await send("please run the tests");
    await openSession("Beta work");
    await act(async () => {
      pending.reject("agent went away");
    });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Failed to send the message"));
    expect(prompt().value).toBe("");

    await openSession(FIRST_MESSAGE);
    await waitFor(() => expect(prompt().value).toBe("please run the tests"));
  });

  it("is given back once, not every time its session is opened", async () => {
    fakeStore().state.sessions = [endedSession("s-beta", "Beta work", 1, "qwen-beta")];
    const spy = await renderWithQwen();
    await startRunningSession(spy);
    const pending = deferred();
    answer(spy, "acp_prompt", () => pending.promise);

    await send("please run the tests");
    await openSession("Beta work");
    await act(async () => {
      pending.reject("agent went away");
    });
    await openSession(FIRST_MESSAGE);
    await waitFor(() => expect(prompt().value).toBe("please run the tests"));

    await type("");
    await openSession("Beta work");
    await openSession(FIRST_MESSAGE);

    expect(prompt().value).toBe("");
  });

  it("comes back when an ended session cannot be resumed", async () => {
    fakeStore().state.sessions = [endedSession("s-old", "Session #4", 1, "qwen-old")];
    const spy = await renderWithQwen();
    answer(spy, "acp_reopen_session", () => Promise.reject("session not found"));

    await send("next step");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("session not found"));
    expect(prompt().value).toBe("next step");
    expect(callsTo(spy, "acp_prompt")).toHaveLength(0);
  });

  it("comes back when the prompt after a resume fails", async () => {
    fakeStore().state.sessions = [endedSession("s-old", "Session #4", 1, "qwen-old")];
    const spy = await renderWithQwen();
    answer(spy, "acp_prompt", () => Promise.reject("agent went away"));

    await send("next step");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Failed to send the message"));
    expect(prompt().value).toBe("next step");
  });

  it("comes back when a new session cannot start", async () => {
    const spy = await renderWithQwen();
    answer(spy, "acp_start_session", () => Promise.reject("spawn failed"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
    });

    await send(FIRST_MESSAGE);

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Failed to start"));
    expect(prompt().value).toBe(FIRST_MESSAGE);
  });

  it("goes back to its own session when the agent asks for a sign-in while another session is on screen", async () => {
    fakeStore().state.sessions = [endedSession("s-beta", "Beta work", 1, "qwen-beta")];
    const spy = await renderWithQwen();
    const sessionId = await startRunningSession(spy);

    await send("please run the tests");
    await openSession("Beta work");
    const methods = [{ id: "qwen-oauth", name: "Qwen OAuth", type: "terminal" }];
    await acpEvent({
      sessionId,
      kind: "turn-end",
      stopReason: "end_turn",
      error: `ACP_AUTH_REQUIRED:${JSON.stringify(methods)}`,
    });

    expect(prompt().value).toBe("");

    await openSession(FIRST_MESSAGE);
    await waitFor(() => expect(prompt().value).toBe("please run the tests"));
  });
});
