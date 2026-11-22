import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
const fakeStore = () => (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;

const ARTIFACT = { id: "a-0123456789abcdef", title: "Session list performance", sourcePath: "/w/r.html", versions: [{ n: 1, at: 1_000, bytes: 9 }] };

function seed(withArtifact: boolean) {
  fakeStore().state.sessions = [
    { id: "s-old", name: "Refactor parser", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 1000, transport: "acp" },
    { id: "s-new", name: "Write the docs", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 2000, transport: "acp" },
  ];
  vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "artifact_list") {
      const ids = (args as { sessionIds: string[] }).sessionIds;
      return Promise.resolve(ids.map((sessionId) => ({ sessionId, artifacts: withArtifact && sessionId === "s-old" ? [ARTIFACT] : [] })));
    }
    return fakeTauriInvoke(cmd, args);
  });
}

async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

const sidebar = () => within(screen.getByRole("complementary"));

describe("the gallery in the app", () => {
  it("offers Artifacts in the sidebar only while a session has a page", async () => {
    seed(false);
    await renderApp();
    await waitFor(() => expect(sidebar().getByText("Refactor parser")).toBeTruthy());
    expect(sidebar().queryByRole("button", { name: /^Artifacts/ })).toBeNull();
  });

  it("opens the gallery, then an artifact in its session's Artifacts tab", async () => {
    seed(true);
    await renderApp();
    const entry = await waitFor(() => sidebar().getByRole("button", { name: "Artifacts, 1" }));

    await act(async () => {
      fireEvent.click(entry);
    });

    const gallery = screen.getByRole("region", { name: "Artifact gallery" });
    expect(within(gallery).getByText("1 page in 1 session")).toBeTruthy();
    expect(entry.getAttribute("aria-current")).toBe("page");

    await act(async () => {
      fireEvent.click(within(gallery).getByRole("button", { name: /Session list performance/ }));
    });

    expect(screen.queryByRole("region", { name: "Artifact gallery" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Artifacts/ }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("heading", { name: "Session list performance", level: 3 })).toBeTruthy();
  });

  it("opens the artifact that was clicked, in a session that has several", async () => {
    fakeStore().state.sessions = [
      { id: "s-old", name: "Refactor parser", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 1000, transport: "acp" },
      { id: "s-new", name: "Write the docs", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 2000, transport: "acp" },
    ];
    const second = { id: "a-1111111111111111", title: "Render steps", sourcePath: "/w/s.html", versions: [{ n: 1, at: 500, bytes: 5 }] };
    vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "artifact_list") {
        const ids = (args as { sessionIds: string[] }).sessionIds;
        return Promise.resolve(ids.map((sessionId) => ({ sessionId, artifacts: sessionId === "s-old" ? [ARTIFACT, second] : [] })));
      }
      return fakeTauriInvoke(cmd, args);
    });
    await renderApp();
    // Another session is on screen when the gallery opens.
    await act(async () => {
      fireEvent.click(await waitFor(() => sidebar().getByText("Write the docs")));
    });
    await act(async () => {
      fireEvent.click(await waitFor(() => sidebar().getByRole("button", { name: "Artifacts, 2" })));
    });

    await act(async () => {
      fireEvent.click(within(screen.getByRole("region", { name: "Artifact gallery" })).getByRole("button", { name: /Render steps/ }));
    });

    await waitFor(() => expect(screen.getByRole("heading", { name: "Render steps", level: 3 })).toBeTruthy());
  });

  it("shows a failure inside the expanded page, where the chat's notice cannot be seen", async () => {
    seed(true);
    vi.spyOn(internals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "artifact_list") {
        const ids = (args as { sessionIds: string[] }).sessionIds;
        return Promise.resolve(ids.map((sessionId) => ({ sessionId, artifacts: sessionId === "s-old" ? [ARTIFACT] : [] })));
      }
      if (cmd === "artifact_export") return Promise.reject("Zorvo could not save that file.");
      return fakeTauriInvoke(cmd, args);
    });
    await renderApp();
    await act(async () => {
      fireEvent.click(await waitFor(() => sidebar().getByRole("button", { name: "Artifacts, 1" })));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("region", { name: "Artifact gallery" })).getByRole("button", { name: /Session list performance/ }));
    });
    await act(async () => {
      fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "Expand" })));
    });
    const expanded = screen.getByRole("region", { name: "Artifact" });

    await act(async () => {
      fireEvent.click(within(expanded).getByRole("button", { name: "Export" }));
    });
    await act(async () => {
      fireEvent.click(within(expanded).getByRole("button", { name: "Choose where to save" }));
    });

    await waitFor(() => expect(within(expanded).getByRole("alert").textContent).toContain("Zorvo could not save that file."));
  });

  it("leaves the gallery when a session is picked in the sidebar", async () => {
    seed(true);
    await renderApp();
    await act(async () => {
      fireEvent.click(await waitFor(() => sidebar().getByRole("button", { name: "Artifacts, 1" })));
    });

    await act(async () => {
      fireEvent.click(sidebar().getByText("Write the docs"));
    });

    expect(screen.queryByRole("region", { name: "Artifact gallery" })).toBeNull();
  });
});
