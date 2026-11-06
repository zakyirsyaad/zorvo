import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";

const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openDialog(...args) }));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

function sidebar() {
  return within(screen.getByRole("complementary"));
}

/** Opens a folder the way the window offers it: the new-session draft's folder chip. */
async function openFolderFromDraft() {
  await click(screen.getByRole("button", { name: "New session" }));
  await click(screen.getByRole("button", { name: /^Folder: / }));
  await click(screen.getByRole("button", { name: "Open another folder…" }));
}

describe("First run and project folders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    openDialog.mockReset();
  });

  it("walks a first-time user through setup and saves the result", async () => {
    fakeStore().state.settings.onboardingCompleted = false;
    fakeStore().state.recentFolders = [];
    await renderApp();

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Every coding agent. One desktop." })).toBeDefined();
    // A suggested folder found under ~/developer, then Start.
    await click(screen.getByRole("button", { name: "Use zorvo" }));
    await click(screen.getByRole("button", { name: "Start" }));

    expect(sidebar().getByText("zorvo")).toBeDefined();
    // Start opens a new-session draft in that folder.
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeDefined();
    await waitFor(() => {
      const { settings, recentFolders } = fakeStore().state;
      expect(settings.onboardingCompleted).toBe(true);
      expect(settings.defaultAgentId).toBe("claude-acp");
      expect((recentFolders as { path: string }[])[0].path).toBe("/Users/test/developer/zorvo");
    });
  });

  it("skips setup for a returning user and lists their recent folders", async () => {
    await renderApp();

    expect(screen.queryByRole("heading", { name: "Every coding agent. One desktop." })).toBeNull();
    expect(sidebar().getByText("ai-perpetual-trading")).toBeDefined();
    expect(sidebar().getByText("titan-investment")).toBeDefined();
  });

  it("opens a folder through the native dialog and starts the next session there", async () => {
    openDialog.mockResolvedValue("/Users/test/code/new-project");
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");
    await renderApp();

    await openFolderFromDraft();
    expect(sidebar().getByText("new-project")).toBeDefined();
    await click(screen.getByRole("button", { name: "New session" }));
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "get started" } });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Prompt" }), { key: "Enter" });
    });

    const args = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")?.[1] as { cwd: string };
    expect(args.cwd).toBe("/Users/test/code/new-project");
  });

  it("reads a newly opened folder only once the backend has registered it", async () => {
    openDialog.mockResolvedValue("/Users/test/code/new-project");
    await renderApp();
    let finishRegistering: () => void = () => {};
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "remember_workspace"
        ? new Promise((resolve) => {
            finishRegistering = () => resolve(undefined);
          })
        : fakeTauriInvoke(cmd, args)
    );
    const detailsReads = () =>
      spy.mock.calls.filter(([cmd, a]) => cmd === "workspace_details" && (a as { path?: string })?.path === "/Users/test/code/new-project");

    await openFolderFromDraft();
    expect(detailsReads()).toHaveLength(0);

    await act(async () => {
      finishRegistering();
    });
    await waitFor(() => expect(detailsReads()).toHaveLength(1));
  });

  it("opens settings, saves a new default agent, and can rerun setup", async () => {
    await renderApp();

    // Settings lives in the sidebar footer.
    await click(screen.getByRole("button", { name: /^Settings/ }));
    const general = within(screen.getByRole("region", { name: "General" }));
    await click(within(general.getByRole("region", { name: "New sessions" })).getByRole("button"));
    await click(screen.getByRole("option", { name: /Qwen Code/ }));
    await waitFor(() => expect(fakeStore().state.settings.defaultAgentId).toBe("qwen-code"));

    await click(general.getByRole("button", { name: "Run setup again" }));
    expect(screen.getByRole("heading", { name: "Every coding agent. One desktop." })).toBeDefined();
  });

  it("Run setup again picks the most recent folder", async () => {
    await renderApp();
    await click(screen.getByRole("button", { name: /^Settings/ }));
    await click(within(screen.getByRole("region", { name: "About" })).getByRole("button", { name: "Run setup again" }));

    expect(screen.getByRole("button", { name: "Change" })).toBeDefined();
    expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so on the welcome screen when the folder dialog fails", async () => {
    fakeStore().state.settings.onboardingCompleted = false;
    fakeStore().state.recentFolders = [];
    openDialog.mockRejectedValue(new Error("denied"));
    await renderApp();
    await click(screen.getByRole("button", { name: "Open folder" }));

    expect(await screen.findByText(/Could not open the folder dialog/)).toBeDefined();
  });

  it("unticking an installing agent cancels it and keeps its files", async () => {
    fakeStore().state.settings.onboardingCompleted = false;
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "install_agent" ? new Promise(() => {}) : fakeTauriInvoke(cmd, args),
    );
    await renderApp();
    const gemini = await screen.findByRole("checkbox", { name: "Use Gemini CLI" });

    await click(gemini);
    await waitFor(() => expect(spy.mock.calls.some(([cmd]) => cmd === "install_agent")).toBe(true));
    await waitFor(() => expect((fakeStore().state.settings as { enabledAgents?: string[] }).enabledAgents ?? []).toContain("gemini"));

    await click(screen.getByRole("checkbox", { name: "Use Gemini CLI" }));
    await waitFor(() => expect(spy.mock.calls.some(([cmd]) => cmd === "cancel_agent_install")).toBe(true));
    expect(spy.mock.calls.some(([cmd]) => cmd === "remove_agent_install")).toBe(false);
    await waitFor(() => expect((fakeStore().state.settings as { enabledAgents?: string[] }).enabledAgents ?? []).not.toContain("gemini"));
  });
});
