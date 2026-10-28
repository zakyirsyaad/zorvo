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

// The xterm view needs a real canvas; these tests only need to see that one is mounted.
vi.mock("../components/TerminalView", () => ({
  TerminalView: function FakeTerminalView(props: TerminalViewProps) {
    return <div data-testid={`view-${props.sessionId}`} aria-label={props.label} />;
  },
}));

import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
type Spy = { mock: { calls: unknown[][] } };

const SIGNED_OUT = { state: "signed-out", login: null, name: null, message: null };
const SIGNED_IN = { state: "signed-in", login: "octocat", name: "The Octocat", message: null };
const NOT_INSTALLED = { state: "not-installed", login: null, name: null, message: null };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

/** The calls to `cmd` as [name, args] pairs. */
function callsTo(spy: Spy, cmd: string) {
  return (spy.mock.calls as [string, Record<string, unknown> | undefined][])
    .filter(([name]) => name === cmd)
    .map(([name, args]) => [name, args] as const);
}

/** Starts the app; `github_status` answers `answers` in turn (the last repeats). */
async function renderApp(answers: unknown[]): Promise<Spy> {
  let read = 0;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "github_status") return Promise.resolve(answers[Math.min(read++, answers.length - 1)]);
    if (cmd === "github_start_sign_in") return Promise.resolve(undefined);
    return fakeTauriInvoke(cmd, args);
  });
  await act(async () => {
    render(<App />);
  });
  return spy;
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function openSettings() {
  await click(screen.getByRole("button", { name: /^Settings/ }));
  return screen.getByRole("dialog", { name: "Settings" });
}

/** The sidebar's profile footer: the one footer inside the sidebar. */
const footer = () => within(within(screen.getByRole("complementary")).getAllByRole("contentinfo").at(-1)!);

afterEach(() => {
  vi.restoreAllMocks();
  listeners.clear();
});

describe("GitHub in the app", () => {
  it("shows the GitHub name in the sidebar footer, and Connected in Settings, when signed in", async () => {
    await renderApp([SIGNED_IN]);

    expect(await footer().findByText("The Octocat")).toBeInTheDocument();
    expect(footer().getByRole("img", { name: "Connected to GitHub" })).toBeInTheDocument();
    expect(footer().queryByText("Test User")).toBeNull();

    const settings = await openSettings();
    expect(within(settings).getByText("Connected to GitHub")).toBeInTheDocument();
    expect(within(settings).getByText("@octocat")).toBeInTheDocument();
  });

  it("keeps git's name in the footer when signed out, and offers Connect in Settings", async () => {
    await renderApp([SIGNED_OUT]);

    expect(await footer().findByText("Test User")).toBeInTheDocument();
    expect(footer().queryByRole("img", { name: "Connected to GitHub" })).toBeNull();
    const settings = await openSettings();
    expect(within(settings).getByText("You are not connected to GitHub.")).toBeInTheDocument();
    expect(within(settings).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("tells the user to install the GitHub CLI when it is missing", async () => {
    await renderApp([NOT_INSTALLED]);

    const settings = await openSettings();

    expect(within(settings).getByText("The GitHub CLI is not installed.")).toBeInTheDocument();
    expect(within(settings).getByText("brew install gh")).toBeInTheDocument();
  });

  it("opens cli.github.com in the browser from the missing-CLI help", async () => {
    const spy = await renderApp([NOT_INSTALLED]);
    const settings = await openSettings();

    await click(within(settings).getByRole("button", { name: "Get gh from cli.github.com" }));

    expect(callsTo(spy, "open_external_url")).toEqual([["open_external_url", { url: "https://cli.github.com" }]]);
  });

  it("connects: Connect opens the sign-in terminal, and the footer follows once gh signs in", async () => {
    const spy = await renderApp([SIGNED_OUT, SIGNED_IN]);
    const settings = await openSettings();

    await click(within(settings).getByRole("button", { name: "Connect" }));

    const [[, args]] = callsTo(spy, "github_start_sign_in");
    expect(args).toEqual({ terminalId: expect.stringMatching(/^ghlogin-/) });
    expect(screen.getByRole("dialog", { name: "Sign in to GitHub" })).toBeInTheDocument();

    await act(async () => {
      listeners.get("github-sign-in-terminal")?.({ payload: { terminalId: args?.terminalId, kind: "exit", exitCode: 0 } });
    });

    expect(screen.queryByRole("dialog", { name: "Sign in to GitHub" })).toBeNull();
    expect(await footer().findByText("The Octocat")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Settings" })).getByText("Connected to GitHub")).toBeInTheDocument();
  });

  it("closes only the sign-in terminal on Escape, and ends its login", async () => {
    const spy = await renderApp([SIGNED_OUT]);
    const settings = await openSettings();
    await click(within(settings).getByRole("button", { name: "Connect" }));
    const [[, args]] = callsTo(spy, "github_start_sign_in");

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog", { name: "Sign in to GitHub" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(callsTo(spy, "terminate_session")).toEqual([["terminate_session", { sessionId: args?.terminalId }]]);
  });

  it("checks again from Settings", async () => {
    const spy = await renderApp([SIGNED_OUT, SIGNED_IN]);
    const settings = await openSettings();
    const readsBefore = callsTo(spy, "github_status").length;

    await click(within(settings).getByRole("button", { name: "Check again" }));

    expect(callsTo(spy, "github_status")).toHaveLength(readsBefore + 1);
    expect(await within(settings).findByText("Connected to GitHub")).toBeInTheDocument();
  });
});
