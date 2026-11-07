import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { fakeTauriInvoke } from "./setup";
import type { TerminalViewProps } from "../components/TerminalView";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
  emit: () => Promise.resolve(),
  emitTo: () => Promise.resolve(),
}));

vi.mock("../components/TerminalView", () => ({
  TerminalView: function FakeTerminalView(props: TerminalViewProps) {
    return <div data-testid={`view-${props.sessionId}`} aria-label={props.label} />;
  },
}));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const SIGNED_OUT = { state: "signed-out", login: null, name: null, message: null };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

async function renderApp(answersFor: Record<string, unknown> = {}) {
  vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "github_status") return Promise.resolve(SIGNED_OUT);
    if (cmd === "github_start_sign_in") return Promise.resolve(undefined);
    if (cmd in answersFor) return Promise.resolve(answersFor[cmd]);
    return fakeTauriInvoke(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

const settingsButton = () => screen.getByRole("button", { name: /^Settings/ });
const nav = () => screen.getByRole("navigation", { name: "Settings" });
const back = () => within(nav()).getByRole("link", { name: "Back to sessions" });

afterEach(() => {
  vi.restoreAllMocks();
  listeners.clear();
});

describe("Settings page", () => {
  it("the footer's Settings opens the page in place of the sidebar and chat", async () => {
    await renderApp();
    const sidebar = screen.getByRole("complementary");
    await click(settingsButton());

    expect(nav()).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "General" })).toHaveFocus();
    expect(sidebar).not.toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  });

  it("the page has one main landmark and the content is a region named by its title", async () => {
    await renderApp();
    await click(settingsButton());
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const region = screen.getByRole("region", { name: "General" });
    expect(region.firstElementChild).toHaveAttribute("data-tauri-drag-region");
  });

  it("names the content region by every section's title", async () => {
    await renderApp();
    await click(settingsButton());
    for (const name of ["General", "Appearance", "Agents", "Private mode", "GitHub"]) {
      await click(within(nav()).getByRole("link", { name: new RegExp(`^${name}`) }));
      expect(screen.getByRole("region", { name })).toHaveAttribute("data-settings-content");
    }
  });

  it("keeps the composer's text across a visit to Settings", async () => {
    await renderApp();
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    await act(async () => {
      fireEvent.change(prompt, { target: { value: "half a thought" } });
    });
    await click(settingsButton());
    await click(back());

    expect(nav).toThrow();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("half a thought");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBe(prompt);
  });

  it("Back gives focus to the control that opened Settings", async () => {
    await renderApp();
    await click(settingsButton());
    await click(back());
    expect(settingsButton()).toHaveFocus();
  });

  it("Back from Manage agents gives focus to the footer's Settings button", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: /^Agents/ }));
    await click(screen.getByRole("button", { name: "Manage agents" }));

    expect(within(nav()).getByRole("link", { name: /^Agents/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("The agents Zorvo can run. Zorvo installs them in its own folder, or uses the ones already on this Mac.")).toBeInTheDocument();
    await click(back());
    expect(settingsButton()).toHaveFocus();
  });

  it("each section opens at its top", async () => {
    await renderApp();
    await click(settingsButton());
    await click(within(nav()).getByRole("link", { name: /^Agents/ }));
    screen.getByRole("region", { name: "Agents" }).scrollTop = 400;
    await click(within(nav()).getByRole("link", { name: "General" }));
    expect(screen.getByRole("region", { name: "General" }).scrollTop).toBe(0);
  });

  it("Private mode is a section of its own, after Agents", async () => {
    await renderApp();
    await click(settingsButton());
    const links = within(nav()).getAllByRole("link").map((link) => link.textContent ?? "");
    const agents = links.findIndex((text) => text.startsWith("Agents"));
    expect(links.indexOf("Private mode")).toBe(agents + 1);
    await click(within(nav()).getByRole("link", { name: "Private mode" }));
    expect(screen.getByRole("heading", { level: 1, name: "Private mode" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Private mode" })).toBeInTheDocument();
    expect(await screen.findByText("0 credits")).toBeInTheDocument();
  });

  it("asks for the recovery code in the app, with Settings closed", async () => {
    const fakePrivate = (window as unknown as { __FAKE_PRIVATE__: { status: Record<string, unknown> } }).__FAKE_PRIVATE__;
    fakePrivate.status = {
      ...fakePrivate.status,
      device: "ready",
      keyReady: true,
      balance: { credits: 500, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
    };
    await renderApp();
    expect(await screen.findByRole("dialog", { name: "Save your recovery code" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Settings" })).toBeNull();
    expect(await screen.findByText("ZRV-FAKE-CODE")).toBeInTheDocument();
  });

  it("the nav switches sections", async () => {
    await renderApp();
    await click(settingsButton());
    const appearance = within(nav()).getByRole("link", { name: "Appearance" });
    appearance.focus();
    await click(appearance);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    // Moving between sections leaves focus on the link; only opening Settings moves it to the title.
    expect(appearance).toHaveFocus();
    await click(within(nav()).getByRole("link", { name: "GitHub" }));
    expect(screen.getByRole("heading", { level: 1, name: "GitHub" })).toBeInTheDocument();
  });

  it("a notice raised in Settings shows on the page", async () => {
    await renderApp();
    await click(settingsButton());
    await click(within(nav()).getByRole("link", { name: "GitHub" }));
    // Connect fails to start the sign-in terminal: the page shows why.
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
      if (cmd === "github_status") return Promise.resolve(SIGNED_OUT);
      if (cmd === "github_start_sign_in") return Promise.reject(new Error("gh could not start"));
      return fakeTauriInvoke(cmd, args);
    });
    await click(screen.getByRole("button", { name: "Connect" }));
    const region = screen.getByRole("region", { name: "GitHub" }).closest("[data-settings-page]") as HTMLElement;
    expect(within(region).getAllByText(/gh could not start/).some((element) => element.closest("[hidden]") === null)).toBe(true);
  });

  it("the GitHub sign-in dialog stays after Back", async () => {
    await renderApp();
    await click(settingsButton());
    await click(within(nav()).getByRole("link", { name: "GitHub" }));
    await click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByRole("dialog", { name: "Sign in to GitHub" })).toBeInTheDocument();
    await click(back());
    expect(screen.getByRole("dialog", { name: "Sign in to GitHub" })).toBeInTheDocument();
  });
});
