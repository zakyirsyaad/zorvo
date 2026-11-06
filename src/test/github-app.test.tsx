import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within, waitFor } from "@testing-library/react";
import { openInspectorTab } from "./inspector-helpers";
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

/** Starts the app; `github_status` answers `answers` in turn (the last repeats), and `answersFor` replaces other commands. */
async function renderApp(answers: unknown[], answersFor: Record<string, unknown> = {}): Promise<Spy> {
  let read = 0;
  const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "github_status") return Promise.resolve(answers[Math.min(read++, answers.length - 1)]);
    if (cmd === "github_start_sign_in") return Promise.resolve(undefined);
    if (cmd in answersFor) return Promise.resolve(answersFor[cmd]);
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

/** Opens Settings on its GitHub section and returns that section's region. */
async function openSettings() {
  await click(screen.getByRole("button", { name: /^Settings/ }));
  await click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "GitHub" }));
  return githubSettings();
}

const githubSettings = () => screen.getByRole("region", { name: "GitHub" });

/** The sidebar's profile footer: the one footer inside the sidebar. */
const footer = () => within(within(screen.getByRole("complementary")).getAllByRole("contentinfo").at(-1)!);

afterEach(() => {
  vi.restoreAllMocks();
  listeners.clear();
});

describe("GitHub and the Changes panel", () => {
  function seedSession() {
    (window as unknown as { __FAKE_TAURI_STORE__: { state: { sessions: unknown[] } } }).__FAKE_TAURI_STORE__.state.sessions = [
      {
        id: "s-a",
        name: "Alpha work",
        profileId: "claude-code",
        cwd: "/Users/test/developer/zorvo",
        status: "terminated",
        createdAt: 1,
        transport: "acp",
      },
    ];
  }

  const repository = (hasGithubRemote: boolean) => ({
    workspace_details: { location: "~/developer", branch: "main", hasGithubRemote },
  });

  async function openChanges() {
    await openInspectorTab("Changes");
    return screen.getByRole("complementary", { name: "Changes panel" });
  }

  it("says pull requests need a GitHub sign-in, in a repository on github.com, and opens Settings", async () => {
    seedSession();
    await renderApp([SIGNED_OUT], repository(true));
    const panel = await openChanges();

    expect(await within(panel).findByText("Pull requests need you to be connected to GitHub.")).toBeInTheDocument();
    await click(within(panel).getByRole("button", { name: "Open GitHub settings" }));

    const settings = githubSettings();
    expect(within(settings).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("says the GitHub CLI is missing, in a repository on github.com", async () => {
    seedSession();
    await renderApp([NOT_INSTALLED], repository(true));
    const panel = await openChanges();

    expect(
      await within(panel).findByText("Pull requests need the GitHub CLI, which is not installed."),
    ).toBeInTheDocument();
  });

  it("says nothing about pull requests in a repository that is not on github.com", async () => {
    seedSession();
    const spy = await renderApp([SIGNED_OUT], repository(false));
    const panel = await openChanges();
    // The connection is known by now: the same answer shows the hint in a repository on github.com.
    await waitFor(() => expect(callsTo(spy, "github_status").length).toBeGreaterThan(0));
    await act(async () => {});

    expect(within(panel).queryByText(/Pull requests need/)).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Open GitHub settings" })).toBeNull();
  });

  it("says nothing when connected", async () => {
    seedSession();
    await renderApp([SIGNED_IN], repository(true));
    const panel = await openChanges();

    expect(await screen.findByText("The Octocat")).toBeInTheDocument();
    expect(within(panel).queryByText(/Pull requests need/)).toBeNull();
  });
});

describe("GitHub in the app", () => {
  it("shows the GitHub name in the sidebar footer, and Connected in Settings, when signed in", async () => {
    await renderApp([SIGNED_IN]);

    expect(await footer().findByText("The Octocat")).toBeInTheDocument();
    expect(footer().getByRole("img", { name: "Connected to GitHub" })).toBeInTheDocument();
    expect(footer().queryByText("Test User")).toBeNull();

    const settings = await openSettings();
    expect(within(settings).getByText("The Octocat")).toBeInTheDocument();
    expect(within(settings).getByText("Connected as @octocat on github.com")).toBeInTheDocument();
  });

  it("keeps git's name in the footer when signed out, and offers Connect in Settings", async () => {
    await renderApp([SIGNED_OUT]);

    expect(await footer().findByText("Test User")).toBeInTheDocument();
    expect(footer().queryByRole("img", { name: "Connected to GitHub" })).toBeNull();
    const settings = await openSettings();
    expect(within(settings).getByText("Not connected")).toBeInTheDocument();
    expect(within(settings).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("tells the user to install the GitHub CLI when it is missing", async () => {
    await renderApp([NOT_INSTALLED]);

    const settings = await openSettings();

    expect(within(settings).getByText("Install the GitHub CLI first")).toBeInTheDocument();
    expect(within(settings).getByText("brew install gh")).toBeInTheDocument();
  });

  it("opens cli.github.com in the browser from the missing-CLI help", async () => {
    const spy = await renderApp([NOT_INSTALLED]);
    const settings = await openSettings();

    await click(within(settings).getByRole("button", { name: "cli.github.com" }));

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
    expect(await within(githubSettings()).findByText("Connected as @octocat on github.com")).toBeInTheDocument();
    // The footer is in the sidebar, which Settings hides: go back to the sessions to see it.
    await click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "Back to sessions" }));
    expect(await footer().findByText("The Octocat")).toBeInTheDocument();
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
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeInTheDocument();
    expect(callsTo(spy, "terminate_session")).toEqual([["terminate_session", { sessionId: args?.terminalId }]]);
  });

  it("says in the sign-in dialog that gh asks a few questions to answer there", async () => {
    await renderApp([SIGNED_OUT]);
    const settings = await openSettings();

    await click(within(settings).getByRole("button", { name: "Connect" }));

    expect(within(screen.getByRole("dialog", { name: "Sign in to GitHub" })).getByRole("status")).toHaveTextContent(
      /gh asks a few questions/,
    );
  });

  it("puts focus back in Settings, on the GitHub section, when a sign-in that worked closes the dialog", async () => {
    const spy = await renderApp([SIGNED_OUT, SIGNED_IN]);
    const settings = await openSettings();
    // As in a browser, a click leaves focus on the button: it is the dialog's opener, and it goes when the card changes.
    const connect = within(settings).getByRole("button", { name: "Connect" });
    connect.focus();
    await click(connect);
    const [[, args]] = callsTo(spy, "github_start_sign_in");

    await act(async () => {
      listeners.get("github-sign-in-terminal")?.({ payload: { terminalId: args?.terminalId, kind: "exit", exitCode: 0 } });
    });

    await within(githubSettings()).findByText("Connected as @octocat on github.com");
    expect(screen.queryByRole("dialog", { name: "Sign in to GitHub" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(githubSettings()).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("checks again from Settings", async () => {
    // Signed out offers only Connect (gh is re-read on window focus); a missing gh offers Check again.
    const spy = await renderApp([NOT_INSTALLED, SIGNED_IN]);
    const settings = await openSettings();
    const readsBefore = callsTo(spy, "github_status").length;

    await click(within(settings).getByRole("button", { name: "Check again" }));

    expect(callsTo(spy, "github_status")).toHaveLength(readsBefore + 1);
    expect(await within(settings).findByText("Connected as @octocat on github.com")).toBeInTheDocument();
  });
});
