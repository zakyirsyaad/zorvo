import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { openInspectorTab } from "./inspector-helpers";
import type { FakeTauriStore } from "./setup";
import type { Session } from "../types";
import App from "../App";

const fakeStore = () => (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;

const session = (id: string, name: string): Session => ({
  id,
  name,
  profileId: "claude-acp",
  cwd: "/Users/test/developer/zorvo",
  status: "terminated",
  createdAt: 1,
  transport: "acp",
});

async function openSession(name: string) {
  await act(async () => {
    fireEvent.click(screen.getAllByText(name)[0]);
  });
}

describe("The activity panel in the app", () => {
  it("offers no panel on a new-session draft", async () => {
    await act(async () => {
      render(<App />);
    });

    const inspectorButton = screen.queryByRole("button", { name: "Inspector" });
    if (inspectorButton) await act(async () => fireEvent.click(inspectorButton));
    expect(screen.queryByRole("tab", { name: "Activity" })).toBeNull();
  });

  it("starts at All again when another session comes on screen", async () => {
    fakeStore().state.sessions = [session("s-a", "Alpha work"), session("s-b", "Beta work")];
    await act(async () => {
      render(<App />);
    });
    await waitFor(() => expect(screen.getAllByText("Alpha work").length).toBeGreaterThan(0));
    await openSession("Alpha work");
    await openInspectorTab("Activity");
    const panel = () => within(screen.getByRole("complementary", { name: "Activity panel" }));
    fireEvent.click(panel().getByRole("button", { name: /^Commands/ }));
    expect(panel().getByRole("button", { name: /^Commands/ })).toHaveAttribute("aria-pressed", "true");

    await openSession("Beta work");

    expect(panel().getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  });
});
