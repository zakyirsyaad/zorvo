import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";
import type { FakePrivate } from "./fixtures/private-backend";
import type { Session } from "../types";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
}));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined, ...unknown[]];
type Override = (args: Record<string, unknown> | undefined) => Promise<unknown>;

const MODEL_ID = "Qwen/Qwen3.8-27B";
const RAN_OUT = "Your credits ran out. Top up to continue.";
const KEY_STOPPED = "This Mac's private key stopped working. Restore it in Settings → Private mode.";

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

function fakePrivate(): FakePrivate {
  return (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
}

function callsTo(spy: { mock: { calls: unknown[][] } }, cmd: string) {
  return (spy.mock.calls as unknown as InvokeCall[]).filter(([name]) => name === cmd).map(([, args]) => args ?? {});
}

function setCredits(credits: number) {
  fakePrivate().status = {
    ...fakePrivate().status,
    device: "ready",
    keyReady: true,
    balance: { credits, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    recoverySaved: true,
    recoveryPrompted: true,
  };
}

function withCredits() {
  setCredits(1240);
  fakePrivate().models = [{ id: MODEL_ID, inputPerM: 0.04, outputPerM: 1.35 }];
}

async function renderApp(overrides: Record<string, Override> = {}) {
  fakeStore().state.settings.defaultAgentId = "qwen";
  const realInvoke = tauriInternals().invoke;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    const override = overrides[cmd];
    return override ? override(args) : realInvoke(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
  return spy;
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

const sendButton = () => screen.getByRole("button", { name: "Send message" });

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

const storedSessions = () => fakeStore().state.sessions as Session[];

async function emit(payload: Record<string, unknown>) {
  await act(async () => {
    listeners.get("acp-event")?.({ payload });
    // Stream updates apply once a frame; let that frame land inside act.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const endTurn = (sessionId: string, error: string) => emit({ sessionId, kind: "turn-end", error });

/** Starts a private Qwen Code session and ends its first turn with a refusal for credits or a key. */
async function runOutOfCredits(reason: "empty" | "key", overrides: Record<string, Override> = {}) {
  withCredits();
  const spy = await renderApp(overrides);
  // A saved session shows first: the private one starts from a new draft.
  if (!screen.queryByRole("button", { name: "Private · TEE" })) await click(screen.getByRole("button", { name: "New session" }));
  await click(await screen.findByRole("button", { name: "Private · TEE" }));
  // A first turn that Qwen Code answers, so the session has a conversation to hand over.
  await send("look at the payments folder");
  await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
  const sessionId = String(callsTo(spy, "acp_prompt")[0].sessionId);
  await emit({
    sessionId,
    kind: "update",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "It holds three modules." } },
  });
  await emit({ sessionId, kind: "turn-end", stopReason: "end_turn" });
  await send("review the payment module");
  await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(2));
  // The server's balance is empty now; the session's turn is refused.
  if (reason === "empty") setCredits(0);
  await endTurn(sessionId, `PRIVATE_CREDITS:{"reason":"${reason}"}`);
  return spy;
}

describe("a private session that runs out of credits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("gives the message back, marks the session and shows no generic failure notice", async () => {
    await runOutOfCredits("empty");

    await waitFor(() => expect(prompt().value).toBe("review the payment module"));
    const panel = screen.getByRole("region", { name: "Private credits" });
    expect(panel).toHaveTextContent(RAN_OUT);
    expect(within(panel).getByRole("button", { name: "Top up" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Continue with another agent" })).toBeInTheDocument();
    expect(screen.queryByText(/turn failed/i)).toBeNull();
    expect(screen.queryByText(/PRIVATE_CREDITS/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAccessibleDescription(RAN_OUT);
  });

  it("blocks Send for that session only, not for a draft or another session", async () => {
    fakeStore().state.sessions = [
      { id: "s-old", name: "Earlier work", profileId: "claude-acp", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 1, transport: "acp" } as Session,
    ];
    await runOutOfCredits("empty");
    expect(sendButton()).toBeDisabled();

    await click(screen.getByRole("button", { name: "New session" }));
    await type("something else");
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Private credits" })).toBeNull();

    await click(within(screen.getByRole("complementary")).getByText("Earlier work"));
    await type("go on");
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Private credits" })).toBeNull();
  });

  it("is unblocked by a status that shows credits again", async () => {
    await runOutOfCredits("empty");
    expect(sendButton()).toBeDisabled();

    // Top up opens Settings on Private mode; a refresh there reads the new balance.
    await click(within(screen.getByRole("region", { name: "Private credits" })).getByRole("button", { name: "Top up" }));
    expect(await screen.findByRole("heading", { name: "Private mode", level: 1 })).toBeInTheDocument();
    setCredits(500);
    await click(await screen.findByRole("button", { name: "Refresh" }));
    await click(screen.getByRole("link", { name: "Back to sessions" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Private credits" })).toBeNull());
    await waitFor(() => expect(prompt().value).toBe("review the payment module"));
    expect(sendButton()).toBeEnabled();
  });

  it("asks before continuing with another agent, and starts nothing on Cancel", async () => {
    const spy = await runOutOfCredits("empty");
    const startsBefore = callsTo(spy, "acp_start_session").length;

    await click(screen.getByRole("button", { name: "Continue with another agent" }));

    const dialog = screen.getByRole("dialog", { name: "Continue with another agent?" });
    expect(dialog).toHaveTextContent("The conversation so far goes to the agent you pick, outside the TEE.");
    expect(callsTo(spy, "acp_start_session")).toHaveLength(startsBefore);
    expect(callsTo(spy, "write_fork_handoff")).toHaveLength(0);

    await click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(spy, "acp_start_session")).toHaveLength(startsBefore);
    expect(callsTo(spy, "write_fork_handoff")).toHaveLength(0);
  });

  it("continues in an ordinary session of the agent picked, handed the conversation", async () => {
    const spy = await runOutOfCredits("empty");

    await click(screen.getByRole("button", { name: "Continue with another agent" }));
    const dialog = screen.getByRole("dialog", { name: "Continue with another agent?" });
    await click(within(dialog).getByRole("radio", { name: "Claude Code" }));
    await click(within(dialog).getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(callsTo(spy, "acp_start_session").some((args) => args.profileId === "claude-acp")).toBe(true));
    const start = callsTo(spy, "acp_start_session").find((args) => args.profileId === "claude-acp") ?? {};
    expect(Object.keys(start)).not.toContain("privateModelId");
    expect(callsTo(spy, "write_fork_handoff")).toHaveLength(1);
    await waitFor(() => expect(storedSessions().some((s) => s.profileId === "claude-acp")).toBe(true));
    const continued = storedSessions().find((s) => s.profileId === "claude-acp");
    expect(continued).toBeDefined();
    expect(continued).not.toHaveProperty("privateMode");
  });

  it("announces the refusal in a status region that is not part of the panel", async () => {
    await runOutOfCredits("empty");

    const panel = screen.getByRole("region", { name: "Private credits" });
    const announced = screen.getAllByRole("status").filter((region) => region.textContent === RAN_OUT);
    expect(announced).toHaveLength(1);
    expect(panel.contains(announced[0])).toBe(false);
  });

  it("describes the continue dialog with its TEE warning", async () => {
    await runOutOfCredits("empty");

    await click(screen.getByRole("button", { name: "Continue with another agent" }));

    expect(screen.getByRole("dialog", { name: "Continue with another agent?" })).toHaveAccessibleDescription(
      "The conversation so far goes to the agent you pick, outside the TEE.",
    );
  });

  it("reads the balance afresh when the credits ran out", async () => {
    const spy = await runOutOfCredits("empty");

    const calls = spy.mock.calls as unknown as InvokeCall[];
    const lastPrompt = calls.map(([name]) => name).lastIndexOf("acp_prompt");
    await waitFor(() =>
      expect(calls.slice(lastPrompt).some(([name, args]) => name === "private_status" && args?.fresh === true)).toBe(true),
    );
  });

  it("closes the continue dialog when another session out of credits is shown", async () => {
    withCredits();
    const spy = await renderApp();
    const startPrivate = async (text: string, count: number) => {
      if (!screen.queryByRole("button", { name: "Private · TEE" })) await click(screen.getByRole("button", { name: "New session" }));
      await click(await screen.findByRole("button", { name: "Private · TEE" }));
      await send(text);
      await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(count));
      return String(callsTo(spy, "acp_prompt")[count - 1].sessionId);
    };
    const first = await startPrivate("look at the payments folder", 1);
    const second = await startPrivate("write the release notes", 2);
    setCredits(0);
    await endTurn(first, `PRIVATE_CREDITS:{"reason":"empty"}`);
    await endTurn(second, `PRIVATE_CREDITS:{"reason":"empty"}`);
    await click(await screen.findByRole("button", { name: "Continue with another agent" }));
    expect(screen.getByRole("dialog", { name: "Continue with another agent?" })).toBeInTheDocument();

    await click(within(screen.getByRole("complementary")).getByText("look at the payments folder"));

    expect(screen.getByRole("region", { name: "Private credits" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says the private key stopped working, with Open Settings", async () => {
    await runOutOfCredits("key");

    const panel = screen.getByRole("region", { name: "Private credits" });
    expect(panel).toHaveTextContent(KEY_STOPPED);
    expect(within(panel).queryByRole("button", { name: "Top up" })).toBeNull();
    expect(sendButton()).toHaveAccessibleDescription(KEY_STOPPED);

    await click(within(panel).getByRole("button", { name: "Open Settings" }));
    expect(await screen.findByRole("heading", { name: "Private mode", level: 1 })).toBeInTheDocument();
  });
});

describe("a pick in a running private session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("never becomes Qwen Code's remembered options for ordinary drafts", async () => {
    withCredits();
    const efforts = (current: string) => [
      {
        id: "reasoning_effort",
        name: "Effort",
        category: "thought_level",
        currentValue: current,
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
    ];
    // Qwen Code's options as an ordinary session reported them: the effort is known.
    (fakeStore().state as { agentOptions?: Record<string, unknown> }).agentOptions = {
      "qwen-code": { modes: null, configOptions: efforts("low") },
    };
    await renderApp({
      acp_start_session: (args) =>
        Promise.resolve({ acpSessionId: `acp-${args?.sessionId}`, agentCapabilities: {}, modes: null, models: null, configOptions: efforts("low") }),
      acp_set_config_option: (args) => Promise.resolve(efforts(String(args?.value))),
      acp_probe_agent: () =>
        Promise.resolve({ modes: null, models: null, configOptions: efforts("low"), commands: [], signInChecked: true }),
    });
    await click(await screen.findByRole("button", { name: "Private · TEE" }));
    await send("review the payment module");
    await screen.findByRole("img", { name: "Private session" });

    await click(await screen.findByRole("button", { name: "Effort: Low" }));
    await click(screen.getByRole("option", { name: "High" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Effort: High" })).toBeInTheDocument());

    // An ordinary draft of Qwen Code starts on the effort it knew, not the private session's pick.
    await click(screen.getByRole("button", { name: "New session" }));
    expect(await screen.findByRole("button", { name: "Effort: Low" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Effort: High" })).toBeNull();
  });
  it("made in a private draft never becomes Qwen Code's remembered options either", async () => {
    withCredits();
    const efforts = (current: string) => [
      {
        id: "reasoning_effort",
        name: "Effort",
        category: "thought_level",
        currentValue: current,
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      },
    ];
    (fakeStore().state as { agentOptions?: Record<string, unknown> }).agentOptions = {
      "qwen-code": { modes: null, configOptions: efforts("low") },
    };
    await renderApp({
      acp_start_session: (args) =>
        Promise.resolve({ acpSessionId: `acp-${args?.sessionId}`, agentCapabilities: {}, modes: null, models: null, configOptions: efforts("low") }),
      acp_set_config_option: (args) => Promise.resolve(efforts(String(args?.value))),
      acp_probe_agent: () =>
        Promise.resolve({ modes: null, models: null, configOptions: efforts("low"), commands: [], signInChecked: true }),
    });
    await click(await screen.findByRole("button", { name: "Private · TEE" }));
    await click(await screen.findByRole("button", { name: "Effort: Low" }));
    await click(screen.getByRole("option", { name: "High" }));
    await send("review the payment module");
    await screen.findByRole("img", { name: "Private session" });

    await click(screen.getByRole("button", { name: "New session" }));
    expect(await screen.findByRole("button", { name: "Effort: Low" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Effort: High" })).toBeNull();
  });
});

describe("slash commands in private mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  const offered = () => screen.getAllByRole("option").map((option) => option.getAttribute("data-command"));

  it("a private session offers no model or auth command, and still offers the others", async () => {
    withCredits();
    const spy = await renderApp();
    await click(await screen.findByRole("button", { name: "Private · TEE" }));
    await send("review the payment module");
    await waitFor(() => expect(callsTo(spy, "acp_prompt")).toHaveLength(1));
    const sessionId = String(callsTo(spy, "acp_prompt")[0].sessionId);
    await emit({ sessionId, kind: "turn-end", stopReason: "end_turn" });
    await emit({
      sessionId,
      kind: "update",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "model", description: "Switch the model" },
          { name: "init", description: "Create a QWEN.md" },
          { name: "auth", description: "Change the auth method" },
        ],
      },
    });

    await type("/");

    expect(offered()).toEqual(["init"]);
  });

  it("a private draft offers no model or auth command, and an ordinary draft offers them", async () => {
    withCredits();
    (fakeStore().state as { agentOptions?: Record<string, unknown> }).agentOptions = {
      "qwen-code": {
        modes: null,
        configOptions: [],
        commands: [
          { name: "model", description: "Switch the model" },
          { name: "review", description: "Review" },
          { name: "auth", description: "Change the auth method" },
        ],
      },
    };
    await renderApp({
      acp_probe_agent: () =>
        Promise.resolve({
          modes: null,
          models: null,
          configOptions: [],
          commands: [
            { name: "model", description: "Switch the model" },
            { name: "review", description: "Review" },
            { name: "auth", description: "Change the auth method" },
          ],
          signInChecked: true,
        }),
    });
    await click(await screen.findByRole("button", { name: "Private · TEE" }));
    await type("/");
    expect(offered()).toEqual(["review"]);

    await type("");
    await click(screen.getByRole("button", { name: "Private · TEE" }));
    await type("/");
    expect(offered()).toEqual(["model", "review", "auth"]);
  });
});
