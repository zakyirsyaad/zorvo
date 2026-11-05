import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { clickRowDelete } from "./sidebar-helpers";
import { makeProfile } from "./fixtures/agents";

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
import { NewSessionBelow, NewSessionHeading } from "../components/workspace/NewSessionView";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

describe("The new-session heading", () => {
  it("names the folder the session starts in", () => {
    render(<NewSessionHeading workspace={{ name: "api", path: "/Users/test/developer/api" }} />);

    expect(screen.getByRole("heading", { name: "New session in api" })).toBeDefined();
  });

  it("says why nothing can start when no agent is ready", () => {
    render(<NewSessionHeading workspace={{ name: "api", path: "/w/api" }} unavailableReason="Install an agent first." />);

    expect(screen.getByText("Install an agent first.")).toBeDefined();
  });

  it("with no folder open, asks for one in the chat's place, and Open folder opens the dialog", async () => {
    const store = (window as unknown as { __FAKE_TAURI_STORE__: { state: { recentFolders: unknown[] } } }).__FAKE_TAURI_STORE__;
    store.state.recentFolders = [];
    openDialog.mockResolvedValue(null);
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByRole("heading", { name: "Open a folder to start" })).toBeDefined();
    expect(
      screen.getByText("Pick a project folder. Your agents work inside it, and its sessions show in the sidebar."),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /^New session/ })).toBeNull();
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).disabled).toBe(true);

    const open = screen.getAllByRole("button", { name: "Open folder" }).find((button) => button.className.includes("bg-primary"))!;
    await act(async () => {
      fireEvent.click(open);
    });
    expect(openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it("puts the agent's other sessions under the composer", () => {
    render(<NewSessionBelow sessionList={<p>Listed sessions</p>} />);

    expect(screen.getByText("Listed sessions")).toBeDefined();
  });
});

describe("Starting a new session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    listeners.clear();
  });

  /**
   * Replaces the fake invoke for one command and delegates everything else to
   * the real test double from setup.ts.
   */
  function stubInvoke(
    overrides: Record<string, (args?: Record<string, unknown>) => Promise<unknown>>
  ) {
    const internals = tauriInternals();
    const originalInvoke = internals.invoke;
    return vi
      .spyOn(internals, "invoke")
      .mockImplementation((cmd: string, args?: Record<string, unknown>) => {
        const override = overrides[cmd];
        return override ? override(args) : originalInvoke(cmd, args);
      });
  }

  /** Opens a new session and sends its first message, which starts the agent. */
  async function startFromNew(text = "get started") {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });
    await sendFirst(text);
  }

  async function sendFirst(text = "get started") {
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    await act(async () => {
      fireEvent.change(prompt, { target: { value: text } });
      fireEvent.keyDown(prompt, { key: "Enter" });
    });
  }

  it("forgets an agent picked for a new session once the user opens another session", async () => {
    (window as unknown as { __FAKE_TAURI_STORE__: { state: { sessions: unknown[] } } }).__FAKE_TAURI_STORE__.state.sessions = [
      { id: "s-old", name: "Old work", profileId: "qwen-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 1, transport: "acp" },
    ];
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agent: Claude Code" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Qwen Code" }));
    });
    expect(screen.getByRole("button", { name: "Agent: Qwen Code" })).toBeDefined();

    await act(async () => {
      fireEvent.click(within(screen.getByRole("complementary")).getByText("Old work"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });

    expect(screen.getByRole("button", { name: "Agent: Claude Code" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Agent: Qwen Code" })).toBeNull();
  });

  it("starts the agent in the workspace's absolute path, not its display name", async () => {
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");

    await act(async () => {
      render(<App />);
    });
    await startFromNew();

    const startCall = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session");
    expect(startCall).toBeDefined();
    const cwd = (startCall?.[1] as { cwd: string }).cwd;
    expect(cwd.startsWith("/")).toBe(true);
    expect(cwd.endsWith("/ai-perpetual-trading")).toBe(true);
  });

  it("puts the install card under the heading and right above the prompt, which can still be written", async () => {
    const needsNode = (id: string, name: string) =>
      makeProfile({
        id,
        name,
        source: "registry",
        distribution: "npx",
        availability: "needs_runtime",
        detected: false,
        install_plan: [{ kind: "node", name: "Node.js", version: "24.11.1", download_bytes: 49 * 1_048_576 }],
      });
    const profiles = [needsNode("claude-acp", "Claude Code"), needsNode("codex-acp", "Codex")];
    const original = tauriInternals().invoke;
    vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "get_agent_profiles" ? Promise.resolve(structuredClone(profiles)) : original(cmd, args),
    );
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });

    const heading = screen.getByRole("heading", { name: "New session in ai-perpetual-trading" });
    const card = await screen.findByRole("region", { name: "Install Claude Code" });
    const prompt = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
    expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(prompt.disabled).toBe(false);
  });

  it("does not start an agent until the new session's first message", async () => {
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });

    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")).toBeUndefined();
    expect(screen.getByRole("heading", { name: "New session in ai-perpetual-trading" })).toBeDefined();
    // The chips say where the session starts; the draft has no summary card any more.
    expect(screen.getByRole("button", { name: "Folder: ai-perpetual-trading" })).toBeDefined();
    expect(await screen.findByRole("button", { name: "Branch: main" })).toBeDefined();
    expect(screen.queryByRole("group", { name: "Workspace" })).toBeNull();
  });

  it("puts the heading above the composer (the agent's sessions below it are checked in session-import)", async () => {
    await act(async () => {
      render(<App />);
    });

    const heading = screen.getByRole("heading", { name: /^New session/ });
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    expect(heading.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the same composer when the draft becomes a session, so nothing typed is lost", async () => {
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");
    await act(async () => {
      render(<App />);
    });
    const draftPrompt = screen.getByRole("textbox", { name: "Prompt" });

    await sendFirst();

    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")).toBeDefined();
    expect(screen.queryByRole("heading", { name: /^New session/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBe(draftPrompt);
  });

  it("starts a session in the workspace and with the agent picked from its + menu", async () => {
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session in titan-investment" }));
    });
    const menu = within(screen.getByRole("menu", { name: "Agent for the new session in titan-investment" }));
    expect(menu.getAllByRole("menuitem")[0].textContent).toContain("Default");
    await act(async () => {
      fireEvent.click(menu.getByRole("menuitem", { name: /Qwen Code/ }));
    });
    expect(screen.getByRole("button", { name: "Agent: Qwen Code" })).toBeDefined();
    await sendFirst();

    const args = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")?.[1] as { cwd: string; profileId: string };
    expect(args).toMatchObject({ cwd: "/Users/test/developer/titan-investment", profileId: "qwen-code" });
    expect(await screen.findByRole("list", { name: "Sessions in titan-investment" })).toBeDefined();
  });

  it("starts in the folder and with the agent picked in the composer", async () => {
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Folder: ai-perpetual-trading" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Search folders" }), { target: { value: "zor" } });
    });
    const folders = within(screen.getByRole("listbox", { name: "Recent folders" }));
    expect(folders.getAllByRole("option").map((o) => o.textContent)).toEqual(["zorvo"]);
    await act(async () => {
      fireEvent.click(folders.getByRole("option", { name: "zorvo" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Agent: Claude Code" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Qwen Code" }));
    });
    await sendFirst();

    const args = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")?.[1] as { cwd: string; profileId: string };
    expect(args).toMatchObject({ cwd: "/Users/test/developer/zorvo", profileId: "qwen-code" });
    // The pickers only belong to a session that has not started.
    expect(screen.queryByRole("button", { name: /^Folder:/ })).toBeNull();
  });

  it("runs a new session in its own worktree when Worktree is on", async () => {
    const invokeSpy = stubInvoke({
      create_session_worktree: () =>
        Promise.resolve({
          path: "/data/worktrees/ai-perpetual-trading/get-started",
          cwd: "/data/worktrees/ai-perpetual-trading/get-started",
          branch: "agent/get-started",
        }),
    });
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Branch:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("switch", { name: "New worktree" }));
    });
    await sendFirst();

    const created = invokeSpy.mock.calls.find(([cmd]) => cmd === "create_session_worktree")?.[1];
    expect(created).toEqual({ repoPath: "/Users/test/developer/ai-perpetual-trading", title: "get started" });
    const args = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")?.[1] as { cwd: string };
    expect(args.cwd).toBe("/data/worktrees/ai-perpetual-trading/get-started");
    // The session is listed under the workspace it was made from.
    const sessions = within(await screen.findByRole("list", { name: "Sessions in ai-perpetual-trading" }));
    expect(sessions.getByTitle(/agent\/get-started/)).toBeDefined();
  });

  it("starts the worktree from the branch picked in the folder list", async () => {
    const invokeSpy = stubInvoke({
      list_branches: () => Promise.resolve(["release", "main"]),
      create_session_worktree: () =>
        Promise.resolve({
          path: "/data/worktrees/ai-perpetual-trading/get-started",
          cwd: "/data/worktrees/ai-perpetual-trading/get-started",
          branch: "agent/get-started",
        }),
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Branch:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("switch", { name: "New worktree" }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "release" }));
    });
    await sendFirst();

    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "switch_branch")).toBeUndefined();
    const created = invokeSpy.mock.calls.find(([cmd]) => cmd === "create_session_worktree")?.[1];
    expect(created).toEqual({
      repoPath: "/Users/test/developer/ai-perpetual-trading",
      title: "get started",
      baseBranch: "release",
    });
  });

  it("forgets the worktree's starting branch once a session used it", async () => {
    stubInvoke({
      list_branches: () => Promise.resolve(["release", "main"]),
      create_session_worktree: () =>
        Promise.resolve({
          path: "/data/worktrees/ai-perpetual-trading/get-started",
          cwd: "/data/worktrees/ai-perpetual-trading/get-started",
          branch: "agent/get-started",
        }),
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Branch:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("switch", { name: "New worktree" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "release" }));
    });
    await sendFirst();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });

    // Back on the folder's own branch; the worktree switch may stay on for the next session.
    expect(await screen.findByRole("button", { name: /^Branch: main/ })).toBeDefined();
  });

  it("shows the branch the worktree will start from on the branch chip", async () => {
    stubInvoke({ list_branches: () => Promise.resolve(["release", "main"]) });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Branch:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("switch", { name: "New worktree" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "release" }));
    });

    expect(screen.getByRole("button", { name: "Branch: release, in a new worktree" })).toBeDefined();
  });

  it("switches the folder to the branch picked while Worktree is off", async () => {
    const invokeSpy = stubInvoke({ list_branches: () => Promise.resolve(["release", "main"]) });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Branch: main" }));
    });
    const readsBefore = invokeSpy.mock.calls.filter(([cmd]) => cmd === "workspace_details").length;

    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "release" }));
    });

    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "switch_branch")?.[1]).toEqual({
      path: "/Users/test/developer/ai-perpetual-trading",
      branch: "release",
    });
    // The top bar and the Branch row read the folder's branch again.
    expect(invokeSpy.mock.calls.filter(([cmd]) => cmd === "workspace_details").length).toBeGreaterThan(readsBefore);
  });

  it("keeps the message and starts nothing when the worktree cannot be made", async () => {
    const invokeSpy = stubInvoke({
      create_session_worktree: () => Promise.reject("ai-perpetual-trading is not a git repository"),
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Branch:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("switch", { name: "New worktree" }));
    });

    await sendFirst("fix the login");

    expect(screen.getByRole("alert").textContent).toContain("not a git repository");
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("fix the login");
    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")).toBeUndefined();
  });

  it("offers Worktree only for a folder that is a git repository", async () => {
    stubInvoke({ workspace_details: () => Promise.resolve({ location: "~/developer", branch: null }) });
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Folder: ai-perpetual-trading" }));
    });

    expect(screen.getByRole("dialog", { name: "Choose a folder" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Branch:/ })).toBeNull();
    expect(screen.queryByRole("switch", { name: "New worktree" })).toBeNull();
  });

  async function turnOnWorktree() {
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Branch:/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("switch", { name: "New worktree" }));
    });
  }

  const CREATED_WORKTREE = {
    path: "/data/worktrees/ai-perpetual-trading/get-started",
    cwd: "/data/worktrees/ai-perpetual-trading/get-started",
    branch: "agent/get-started",
  };

  /** Ends the agent's first turn, so its session can be deleted. */
  async function endFirstTurn(invokeSpy: { mock: { calls: unknown[][] } }) {
    const start = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session");
    const sessionId = (start?.[1] as { sessionId: string }).sessionId;
    await act(async () => {
      listeners.get("acp-event")?.({ payload: { sessionId, kind: "turn-end", stopReason: "end_turn" } });
    });
  }

  async function deleteSession(name: string) {
    const row = () => within(screen.getByRole("complementary")).getByText(name).closest("li") as HTMLElement;
    await clickRowDelete(() => row());
    await act(async () => {
      fireEvent.click(within(row()).getByRole("menuitem", { name: "Confirm delete" }));
    });
  }

  it("removes a deleted session's worktree only after its agent has stopped", async () => {
    let finishStopping: () => void = () => {};
    const invokeSpy = stubInvoke({
      create_session_worktree: () => Promise.resolve(CREATED_WORKTREE),
      acp_stop_session: () =>
        new Promise((resolve) => {
          finishStopping = () => resolve(undefined);
        }),
    });
    await act(async () => {
      render(<App />);
    });
    await turnOnWorktree();
    await sendFirst();
    await endFirstTurn(invokeSpy);
    const removals = () => invokeSpy.mock.calls.filter(([cmd]) => cmd === "remove_session_worktree");

    await deleteSession("get started");
    expect(removals()).toHaveLength(0);
    await act(async () => {
      finishStopping();
    });

    expect(removals()).toHaveLength(1);
  });

  it("keeps a deleted session's worktree when its agent could not be stopped", async () => {
    const invokeSpy = stubInvoke({
      create_session_worktree: () => Promise.resolve(CREATED_WORKTREE),
      acp_stop_session: () => Promise.reject("no such session"),
    });
    await act(async () => {
      render(<App />);
    });
    await turnOnWorktree();
    await sendFirst();
    await endFirstTurn(invokeSpy);

    await deleteSession("get started");

    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "remove_session_worktree")).toBeUndefined();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toContain("Kept the worktree");
  });

  it("puts a message back into its new session when the worktree fails after the user moved on", async () => {
    (window as unknown as { __FAKE_TAURI_STORE__: { state: { sessions: unknown[] } } }).__FAKE_TAURI_STORE__.state.sessions = [
      { id: "s-old", name: "Old work", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 1, transport: "acp" },
    ];
    let failCreating: () => void = () => {};
    stubInvoke({
      create_session_worktree: () =>
        new Promise((_, reject) => {
          failCreating = () => reject("disk full");
        }),
    });
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New session" }));
    });
    await turnOnWorktree();
    await sendFirst("fix the login");

    await act(async () => {
      fireEvent.click(within(screen.getByRole("complementary")).getByText("Old work"));
    });
    await act(async () => {
      failCreating();
    });

    expect(screen.getByRole("heading", { name: /^New session/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "Folder: ai-perpetual-trading" })).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("fix the login");
  });

  it("starts an agent by its profile id, never by a raw command", async () => {
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");

    await act(async () => {
      render(<App />);
    });
    await startFromNew();

    const args = invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["cwd", "profileId", "sessionId"]);
    expect(args.profileId).toBe("claude-acp");
  });

  it("surfaces an alert when the backend rejects the session's folder", async () => {
    stubInvoke({
      acp_start_session: () =>
        Promise.reject(
          "Working directory '/Users/test/developer/ai-perpetual-trading' is not an existing directory"
        ),
    });

    await act(async () => {
      render(<App />);
    });
    await startFromNew();

    expect(screen.getByRole("alert").textContent).toContain("Failed to start");
  });

  it("warns instead of starting an agent when no project folder has been opened", async () => {
    (window as unknown as { __FAKE_TAURI_STORE__: { state: { recentFolders: unknown[] } } })
      .__FAKE_TAURI_STORE__.state.recentFolders = [];
    const invokeSpy = vi.spyOn(tauriInternals(), "invoke");

    await act(async () => {
      render(<App />);
    });
    await startFromNew();

    expect(screen.getByRole("heading", { name: "Open a folder to start" })).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).disabled).toBe(true);
    expect(invokeSpy.mock.calls.find(([cmd]) => cmd === "acp_start_session")).toBeUndefined();
  });
});
