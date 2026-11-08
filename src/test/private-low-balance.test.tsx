import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("../lib/notify", () => ({
  isAppFocused: vi.fn(() => Promise.resolve(true)),
  notifyIfAway: vi.fn(() => Promise.resolve()),
}));

import App from "../App";

const MODEL_ID = "Qwen/Qwen3.8-27B";
const SESSION: Session = {
  id: "s-private",
  name: "Private review",
  profileId: "qwen-code",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
  privateMode: { modelId: MODEL_ID },
};

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

function fakePrivate(): FakePrivate {
  return (window as unknown as { __FAKE_PRIVATE__: FakePrivate }).__FAKE_PRIVATE__;
}

function setStatus(credits: number | null, lastBalance: number | null) {
  fakePrivate().status = {
    ...fakePrivate().status,
    device: "ready",
    keyReady: true,
    balance:
      credits === null
        ? null
        : { credits, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    lastBalance:
      lastBalance === null
        ? null
        : { credits: lastBalance, usedCredits: 0, at: "2026-11-07T09:00:00Z" },
    recoverySaved: true,
    recoveryPrompted: true,
  };
}

async function renderApp() {
  fakeStore().state.sessions = [SESSION];
  await act(async () => {
    render(<App />);
  });
}

describe("the private low balance row", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  it("warns from the live balance with the model's turns, and opens the top-up settings", async () => {
    setStatus(49, 1240);
    fakePrivate().models = [{ id: MODEL_ID, inputPerM: 0, outputPerM: 100 }];
    await renderApp();

    expect(
      await screen.findByText("49 credits left, about 4 turns on Qwen 3.8 27B."),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Top up" }));
    });
    expect(await screen.findByRole("heading", { name: "Private mode" })).toBeInTheDocument();
  });

  it("says nothing while the user pays with their own key", async () => {
    setStatus(49, 1240);
    fakePrivate().models = [{ id: MODEL_ID, inputPerM: 0, outputPerM: 100 }];
    fakeStore().state.settings.paymentSource = "ownKey";
    await renderApp();

    expect(screen.queryByText(/49 credits left/)).toBeNull();
  });

  it("says nothing when only the last known balance is low", async () => {
    setStatus(null, 40);
    fakePrivate().models = [{ id: MODEL_ID, inputPerM: 0, outputPerM: 100 }];
    await renderApp();

    expect(screen.queryByText(/^\d+ credits? left/)).toBeNull();
  });
});