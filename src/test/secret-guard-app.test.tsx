import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type InvokeCall = [string, Record<string, unknown> | undefined, ...unknown[]];
type Override = (args: Record<string, unknown> | undefined) => Promise<unknown>;

const MODEL_ID = "Qwen/Qwen3.8-27B";
const AWS = ["AKIA", "IOSFODNN7EXAMPL", "E"].join("");
const PRIVATE_HEADER = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const FOLDER = "/Users/test/developer/ai-perpetual-trading";

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

function withCredits() {
  fakePrivate().status = {
    ...fakePrivate().status,
    device: "ready",
    keyReady: true,
    balance: { credits: 1240, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    recoverySaved: true,
    recoveryPrompted: true,
  };
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

describe("the secret guard in the app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
    openDialog.mockReset();
  });

  it("holds a private message with a secret until Send anyway sends it once", async () => {
    withCredits();
    const spy = await renderApp();
    await turnOnPrivate();

    await send(`my key is ${AWS}`);
    const dialog = await screen.findByRole("dialog", { name: "This message may hold a secret" });

    expect(within(dialog).getByText("Zorvo found these on this Mac, before anything was sent.")).toBeTruthy();
    expect(within(dialog).getByText("AWS access key")).toBeTruthy();
    expect(within(dialog).getByText(`AKIA••••••••MPLE · in your message`)).toBeTruthy();
    expect(within(dialog).getByText(/Qwen Code can still read files in the folder itself/)).toBeTruthy();
    expect(callsTo(spy, "acp_start_session")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send anyway" }));
    });
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "This message may hold a secret" })).toBeNull();
    expect(callsTo(spy, "acp_start_session")).toHaveLength(1);
  });

  it("Edit message puts the text back in the focused composer and sends nothing", async () => {
    withCredits();
    const spy = await renderApp();
    await turnOnPrivate();

    await send(`my key is ${AWS}`);
    const dialog = await screen.findByRole("dialog", { name: "This message may hold a secret" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Edit message" }));
    });

    expect(prompt().value).toBe(`my key is ${AWS}`);
    expect(document.activeElement).toBe(prompt());
    expect(callsTo(spy, "acp_start_session")).toHaveLength(0);
  });

  it("reads an attached file and names it in the dialog", async () => {
    withCredits();
    openDialog.mockResolvedValue([`${FOLDER}/.env.local`]);
    const spy = await renderApp({
      read_workspace_file: () =>
        Promise.resolve({ kind: "text", text: `${PRIVATE_HEADER}\nMIIBOgIBAAJBAK\n`, size: 42 }),
    });
    await turnOnPrivate();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add attachment" }));
    });
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });

    const dialog = await screen.findByRole("dialog", { name: "This message may hold a secret" });
    expect(within(dialog).getByText("Private key")).toBeTruthy();
    expect(within(dialog).getByText("BEGIN PRIVATE KEY · in .env.local, attached")).toBeTruthy();
    expect(callsTo(spy, "read_workspace_file")[0]).toMatchObject({ root: FOLDER, relative: ".env.local" });
    expect(callsTo(spy, "acp_start_session")).toHaveLength(0);
  });

  it("names a binary attachment it could not check", async () => {
    withCredits();
    openDialog.mockResolvedValue([`${FOLDER}/archive.bin`]);
    const spy = await renderApp({
      read_workspace_file: () => Promise.resolve({ kind: "binary", size: 42 }),
    });
    await turnOnPrivate();

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add attachment" }));
    });
    await act(async () => {
      fireEvent.keyDown(prompt(), { key: "Enter" });
    });

    const dialog = await screen.findByRole("dialog", { name: "This message may hold a secret" });
    expect(within(dialog).getByText(`Couldn't check 1 file: ${FOLDER}/archive.bin`)).toBeTruthy();
    expect(callsTo(spy, "acp_start_session")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Send anyway" }));
    });
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
  });

  it("does not scan a plain session", async () => {
    const spy = await renderApp();

    await send(`my key is ${AWS}`);
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "This message may hold a secret" })).toBeNull();
  });

  it("does not scan when the Safety switch is off", async () => {
    withCredits();
    fakeStore().state.settings.secretGuard = false;
    const spy = await renderApp();
    await turnOnPrivate();

    await send(`my key is ${AWS}`);
    await waitFor(() => expect(callsTo(spy, "acp_start_session")).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "This message may hold a secret" })).toBeNull();
  });
});