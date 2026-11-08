import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import type { FakeTauriStore } from "./setup";
import type { FakePrivate } from "./fixtures/private-backend";
import type { PrivateStatus } from "../lib/private-credits";
import type { ChatMessage, Session } from "../types";

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
import { PrivateInspector, VERIFICATION_CENTER_URL } from "../components/private/PrivateInspector";
import { offeredTabs } from "../lib/inspector";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

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

const READY: PrivateStatus = {
  device: "ready",
  keyReady: true,
  keyError: null,
  balance: { credits: 1240, usedCredits: 60, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
  balanceError: null,
  lastBalance: null,
  recoverySaved: true,
  recoveryPrompted: true,
  pendingTopup: null,
};

const SESSION: Session = {
  id: "s-1",
  name: "Private review",
  profileId: "qwen-code",
  cwd: "/Users/test/developer/zorvo",
  status: "running",
  createdAt: 1,
  transport: "acp",
  privateMode: { modelId: MODEL_ID },
};

function renderInspector(credits: { status: PrivateStatus | null; models: { id: string; inputPerM: number; outputPerM: number }[] | null }) {
  const onTopUp = vi.fn();
  const onOpenUrl = vi.fn();
  const loadCatalog = vi.fn(() => Promise.resolve());
  render(
    <PrivateInspector
      session={SESSION}
      credits={{ ...credits, loadCatalog } as unknown as Parameters<typeof PrivateInspector>[0]["credits"]}
      onTopUp={onTopUp}
      onOpenUrl={onOpenUrl}
    />,
  );
  return { onTopUp, onOpenUrl, loadCatalog };
}

describe("PrivateInspector", () => {
  it("names the session's model by its label once the catalog is loaded", () => {
    renderInspector({ status: READY, models: [{ id: MODEL_ID, inputPerM: 0.04, outputPerM: 1.35 }] });
    expect(screen.getByText("Model").parentElement).toHaveTextContent("Qwen3.8 27B");
  });

  it("names the model by its id while the catalog is not loaded, and never loads it", () => {
    const { loadCatalog } = renderInspector({ status: READY, models: null });
    expect(screen.getByText("Model").parentElement).toHaveTextContent(MODEL_ID);
    expect(loadCatalog).not.toHaveBeenCalled();
  });

  it("shows the balance, with Top up", () => {
    const { onTopUp } = renderInspector({ status: READY, models: null });
    const balance = screen.getByRole("region", { name: "Balance" });
    expect(balance).toHaveTextContent("1,240 credits");
    fireEvent.click(within(balance).getByRole("button", { name: "Top up" }));
    expect(onTopUp).toHaveBeenCalledTimes(1);
  });

  it("says the balance is being read before the first status arrives", () => {
    renderInspector({ status: null, models: null });
    expect(screen.getByRole("region", { name: "Balance" })).toHaveTextContent("Checking…");
  });

  it("marks a balance below 50 as running low", () => {
    const status: PrivateStatus = {
      ...READY,
      balance: { ...READY.balance!, credits: 49 },
    };
    renderInspector({ status, models: null });
    const balance = screen.getByRole("region", { name: "Balance" });

    expect(balance).toHaveTextContent("49 credits");
    expect(within(balance).getByText("Running low")).toBeInTheDocument();
  });

  it("says where it runs, and opens NEAR AI's Verification Center", () => {
    const { onOpenUrl } = renderInspector({ status: READY, models: null });
    const where = screen.getByRole("region", { name: "Where it runs" });
    expect(where).toHaveTextContent(
      "NEAR AI Cloud, inside Intel TDX and NVIDIA confidential computing. The credits server never sees your prompts.",
    );
    fireEvent.click(within(where).getByRole("button", { name: "Open the Verification Center" }));
    expect(onOpenUrl).toHaveBeenCalledWith(VERIFICATION_CENTER_URL);
    expect(VERIFICATION_CENTER_URL).toBe("https://cloud.near.ai/verify");
  });

  it("counts the replies NEAR AI's signature did not verify", () => {
    const messages = [
      {
        id: "a-1",
        role: "agent" as const,
        content: "",
        timestamp: 1,
        verification: { state: "didnt_verify" as const, signed: 0, total: 1 },
      },
      {
        id: "a-2",
        role: "agent" as const,
        content: "",
        timestamp: 2,
        verification: { state: "verified" as const, signed: 1, total: 1 },
      },
    ] satisfies ChatMessage[];
    render(
      <PrivateInspector
        session={SESSION}
        credits={{ status: READY, models: null }}
        messages={messages}
        onTopUp={vi.fn()}
        onOpenUrl={vi.fn()}
      />,
    );

    const row = screen.getByText("Didn't verify").parentElement;
    expect(row).not.toBeNull();
    expect(within(row!).getByText("1")).toBeInTheDocument();
  });
});

describe("offeredTabs", () => {
  it("offers the Private tab only for a private session, after the others", () => {
    const on = { hasFolder: true, isRepository: true, hasSession: true };
    expect(offeredTabs(on)).toEqual(["changes", "activity", "files", "terminal"]);
    expect(offeredTabs({ ...on, isPrivate: true })).toEqual(["changes", "activity", "files", "terminal", "private"]);
    expect(offeredTabs({ hasFolder: false, isRepository: false, hasSession: true, isPrivate: true })).toEqual([
      "activity",
      "private",
    ]);
  });
});

describe("the Private tab in the app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  async function renderWith(sessions: Session[]) {
    fakePrivate().status = READY;
    fakeStore().state.sessions = sessions;
    vi.spyOn(tauriInternals(), "invoke");
    await act(async () => {
      render(<App />);
    });
  }

  async function openInspector() {
    const button = await within(screen.getAllByRole("banner")[0]).findByRole("button", { name: "Inspector" });
    await act(async () => {
      fireEvent.click(button);
    });
    return screen.findByRole("tablist", { name: "Inspector" });
  }

  it("shows the Private tab for a private session, with its model and balance", async () => {
    await renderWith([SESSION]);
    const tablist = await openInspector();

    const tab = within(tablist).getByRole("tab", { name: "Private" });
    await act(async () => {
      fireEvent.click(tab);
    });

    await waitFor(() => expect(screen.getByRole("region", { name: "Balance" })).toHaveTextContent("1,240 credits"));
    expect(screen.getByText("Model").parentElement).toHaveTextContent(MODEL_ID);
    // The inspector asks the credits server for nothing beyond the status.
    expect(fakePrivate().calls.filter((call) => call.cmd !== "private_status")).toEqual([]);
  });

  it("offers no Private tab for an ordinary session", async () => {
    await renderWith([{ ...SESSION, privateMode: undefined }]);
    const tablist = await openInspector();
    expect(within(tablist).queryByRole("tab", { name: "Private" })).toBeNull();
    expect(within(tablist).getByRole("tab", { name: /^Activity/ })).toBeInTheDocument();
  });
});
