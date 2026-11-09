import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";
import type { FakePrivate } from "./fixtures/private-backend";

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

/** This Mac holds credits and a key, and the server offers two private models. */
function withCredits(credits = 1240) {
  fakePrivate().status = {
    ...fakePrivate().status,
    device: "ready",
    keyReady: true,
    balance: { credits, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    recoverySaved: true,
    recoveryPrompted: true,
  };
  fakePrivate().models = [
    { id: MODEL_ID, inputPerM: 0.04, outputPerM: 1.35 },
    { id: "moonshotai/Kimi-K3", inputPerM: 3.3, outputPerM: 16.5 },
  ];
}

function withOwnKey() {
  withCredits();
  fakePrivate().status = {
    ...fakePrivate().status,
    ownKey: { saved: true, last4: "3f9a", addedAt: new Date().toISOString(), noCredits: false },
  };
  fakeStore().state.settings.paymentSource = "ownKey";
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

async function send(text: string) {
  await act(async () => {
    fireEvent.change(prompt(), { target: { value: text } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
  });
}

async function turnOnPrivate() {
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Private · TEE" }));
  });
}

const privateCatalogCalls = () =>
  fakePrivate().calls.filter((call) => call.cmd === "private_stock" || call.cmd === "private_models");

describe("a private draft in the app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("asks the credits server for nothing while the chip is off, and starts an ordinary session as before", async () => {
    withCredits();
    const spy = await renderApp();
    expect(await screen.findByRole("button", { name: "Private · TEE" })).toHaveAttribute("aria-pressed", "false");

    await send("hello");
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));

    expect(Object.keys(callsTo(spy, "acp_start_session")[0])).not.toContain("privateModelId");
    expect(privateCatalogCalls()).toEqual([]);
    await waitFor(() => expect(fakeStore().state.sessions).toHaveLength(1));
    expect(fakeStore().state.sessions[0]).not.toHaveProperty("privateMode");
  });

  it("starts on the user's own key, shows its footer, and sends the ownKey choice", async () => {
    withOwnKey();
    const spy = await renderApp();
    await turnOnPrivate();

    expect(await screen.findByText(/Paying with your NEAR AI key/)).toBeInTheDocument();
    expect(screen.getByText("sk-…3f9a")).toBeInTheDocument();
    expect(screen.queryByText("1,240 credits left")).toBeNull();
    expect(screen.getByRole("button", { name: "Session limit" })).toBeDisabled();
    expect(
      screen.getByText("With your own key, set spending limits on the key in your NEAR AI dashboard."),
    ).toBeInTheDocument();

    await send("review the payment module");
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(callsTo(spy, "acp_start_session")[0]).toMatchObject({
      privateModelId: MODEL_ID,
      privateOwnKey: true,
    });
    await waitFor(() => expect(fakeStore().state.sessions).toHaveLength(1));
    expect(fakeStore().state.sessions[0]).toMatchObject({ privateMode: { modelId: MODEL_ID, ownKey: true } });
  });

  it("starts a private session on the first model, and the session and its row say so", async () => {
    withCredits();
    const spy = await renderApp();
    await turnOnPrivate();

    expect(privateCatalogCalls().map((call) => call.cmd).sort()).toEqual(["private_models", "private_stock"]);
    expect(await screen.findByRole("heading", { name: /New private session in/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Private model: Qwen 3.8 27B" })).toBeInTheDocument();
    expect(screen.getByText("1,240 credits left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start private session" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Qwen Code sends your prompts straight to NEAR AI. Each answer comes with a signature from the secure hardware, so you can check where it ran.",
      ),
    ).toBeInTheDocument();

    await send("review the payment module");
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));

    expect(callsTo(spy, "acp_start_session")[0]).toMatchObject({ profileId: "qwen-code", privateModelId: MODEL_ID });
    await waitFor(() => expect(fakeStore().state.sessions[0]).toMatchObject({ privateMode: { modelId: MODEL_ID } }));
    expect(await screen.findByRole("img", { name: "Private session" })).toBeInTheDocument();
    expect(screen.getByText("Private · TEE")).toBeInTheDocument();
    expect(screen.getByTitle(/Qwen Code · Private ·/)).toBeInTheDocument();
  });

  it("sets a session limit and starts the session with that capped key", async () => {
    withCredits();
    const spy = await renderApp();
    await turnOnPrivate();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Session limit: No session limit" }));
    });
    expect(screen.getByRole("listbox", { name: "Session limit" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /200 credits/ }));
    });
    expect(screen.getByRole("button", { name: "Session limit: 200 credits" })).toBeInTheDocument();

    await send("review the payment module");
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(callsTo(spy, "acp_start_session")[0]).toMatchObject({
      privateModelId: MODEL_ID,
      privateSessionCap: 200,
    });
    await waitFor(() =>
      expect(fakeStore().state.sessions[0]).toMatchObject({
        privateMode: { modelId: MODEL_ID, sessionCap: 200 },
      }),
    );
  });

  it("with Qwen Code signed out, shows no sign-in panel while on and lets the credits decide", async () => {
    withCredits();
    const authRequired = `ACP_AUTH_REQUIRED:${JSON.stringify([{ id: "qwen-oauth", name: "Qwen OAuth", type: "terminal" }])}`;
    const spy = await renderApp({ acp_probe_agent: () => Promise.reject(authRequired) });
    expect(await screen.findByRole("region", { name: "Sign in to Qwen Code" })).toBeInTheDocument();

    await turnOnPrivate();

    expect(screen.queryByRole("region", { name: "Sign in to Qwen Code" })).toBeNull();
    expect(screen.queryByText("Sign in to Qwen Code to send a message.")).toBeNull();
    const probes = callsTo(spy, "acp_probe_agent").length;
    await send("review the payment module");
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(callsTo(spy, "acp_start_session")[0]).toMatchObject({ privateModelId: MODEL_ID });
    // The private session on screen shows no sign-in panel for Qwen Code either, and its agent is not probed.
    await screen.findByRole("img", { name: "Private session" });
    expect(screen.queryByRole("region", { name: "Sign in to Qwen Code" })).toBeNull();
    expect(callsTo(spy, "acp_probe_agent")).toHaveLength(probes);
  });

  it("blocks Send while the credits are used up, with the reason", async () => {
    withCredits(0);
    const spy = await renderApp();
    await turnOnPrivate();
    await act(async () => {
      fireEvent.change(prompt(), { target: { value: "hi" } });
    });

    const sendButton = screen.getByRole("button", { name: "Start private session" });
    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveAccessibleDescription("Add credits to start a private session");
    expect(callsTo(spy, "acp_start_session")).toHaveLength(0);
  });

  it("gives the message back with plain words when the start is refused for credits", async () => {
    withCredits();
    await renderApp({ acp_start_session: () => Promise.reject('PRIVATE_CREDITS:{"reason":"empty"}') });
    await turnOnPrivate();
    // NEAR AI refused for credits: the balance the refusal makes Zorvo read again is empty too.
    withCredits(0);

    await send("review the payment module");

    expect(await screen.findByRole("region", { name: "Private credits" })).toHaveTextContent("Your credits ran out. Top up to continue.");
    await waitFor(() => expect(prompt().value).toBe("review the payment module"));
    expect(screen.queryByText(/PRIVATE_CREDITS/)).toBeNull();
  });

  it("is disabled, with its reason, for another agent", async () => {
    withCredits();
    fakeStore().state.settings.defaultAgentId = "claude-acp";
    vi.spyOn(tauriInternals(), "invoke");
    await act(async () => {
      render(<App />);
    });
    const chip = await screen.findByRole("button", { name: "Private · TEE" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).toHaveAccessibleDescription(
      "Private mode works with Qwen Code for now. Claude Code sends your code to Anthropic.",
    );
    expect(within(document.body).queryByRole("button", { name: /^Private model/ })).toBeNull();
  });

  it("shows an agent's top-up ask and opens the checkout only after a click", async () => {
    withCredits();
    const spy = await renderApp();
    await turnOnPrivate();
    await send("review the payment module");
    await waitFor(() => expect(fakeStore().state.sessions).toHaveLength(1));
    const sessionId = (fakeStore().state.sessions[0] as { id: string }).id;

    await act(async () => {
      listeners.get("private-topup-request")?.({
        payload: {
          sessionId,
          requestId: "r-1",
          usd: 5,
          credits: 500,
          reason: "The review needs more credits.",
        },
      });
    });

    expect(await screen.findByRole("heading", { name: "Qwen Code asks to top up $5" })).toBeInTheDocument();
    expect(screen.getByText(/^500 credits/)).toBeInTheDocument();
    expect(screen.getByText(/The review needs more credits\./)).toBeInTheDocument();
    expect(callsTo(spy, "private_create_topup")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Top up $5" }));
    });

    await waitFor(() => expect(callsTo(spy, "private_answer_topup_request")).toHaveLength(1));
    expect(callsTo(spy, "private_answer_topup_request")[0]).toMatchObject({
      sessionId,
      requestId: "r-1",
      approve: true,
    });
    await waitFor(() => expect(callsTo(spy, "private_create_topup")).toHaveLength(1));
    expect(callsTo(spy, "private_create_topup")[0]).toMatchObject({ packageUsd: 5 });
    expect(screen.queryByRole("heading", { name: "Qwen Code asks to top up $5" })).toBeNull();
  });

  it("declines an agent's top-up ask without creating a checkout", async () => {
    withCredits();
    const spy = await renderApp();
    await turnOnPrivate();
    await send("review the payment module");
    await waitFor(() => expect(fakeStore().state.sessions).toHaveLength(1));
    const sessionId = (fakeStore().state.sessions[0] as { id: string }).id;

    await act(async () => {
      listeners.get("private-topup-request")?.({
        payload: {
          sessionId,
          requestId: "r-2",
          usd: 5,
          credits: 500,
          reason: "The review needs more credits.",
        },
      });
    });
    await screen.findByRole("heading", { name: "Qwen Code asks to top up $5" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    });

    await waitFor(() => expect(callsTo(spy, "private_answer_topup_request")).toHaveLength(1));
    expect(callsTo(spy, "private_answer_topup_request")[0]).toMatchObject({
      sessionId,
      requestId: "r-2",
      approve: false,
    });
    expect(callsTo(spy, "private_create_topup")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Qwen Code asks to top up $5" })).toBeNull();
  });
});
