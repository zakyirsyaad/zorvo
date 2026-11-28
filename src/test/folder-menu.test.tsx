import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, act } from "@testing-library/react";
import { FolderMenu } from "../components/sidebar/FolderMenu";
import { Sidebar } from "../components/Sidebar";
import { useSessionActions } from "../hooks/useSessionActions";
import { claudeProfile } from "./fixtures/agents";
import type { PersistedState, Session } from "../types";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    name: "First session",
    profileId: claudeProfile.id,
    cwd: "/tmp/agent-desktop",
    status: "idle",
    createdAt: 1000,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FolderMenu", () => {
  it("lists all provided folder actions and runs each callback on click", () => {
    const onNewSession = vi.fn();
    const onReveal = vi.fn();
    const onCopyPath = vi.fn();
    const onToggle = vi.fn();
    const onArchiveAll = vi.fn();
    const onRemove = vi.fn();

    render(
      <FolderMenu
        folderName="agent-desktop"
        isFolded={false}
        onNewSession={onNewSession}
        onReveal={onReveal}
        onCopyPath={onCopyPath}
        onToggle={onToggle}
        onArchiveAll={onArchiveAll}
        onRemove={onRemove}
      />,
    );

    const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "Actions for agent-desktop" }));

    openMenu();
    expect(screen.getByRole("menuitem", { name: "New session" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Reveal in Finder" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Collapse" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive all sessions" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Remove project" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "New session" }));
    expect(onNewSession).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
    expect(onReveal).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(onCopyPath).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive all sessions" }));
    expect(onArchiveAll).toHaveBeenCalledTimes(1);
  });

  it("shows Expand when folded and omits optional actions when absent", () => {
    render(
      <FolderMenu
        folderName="agent-desktop"
        isFolded={true}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for agent-desktop" }));
    expect(screen.getByRole("menuitem", { name: "Expand" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "New session" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Archive all sessions" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove project" })).toBeNull();
  });

  it("requires inline Remove? confirmation before calling onRemove", () => {
    const onRemove = vi.fn();
    render(
      <FolderMenu
        folderName="agent-desktop"
        isFolded={false}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for agent-desktop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove project" }));

    expect(onRemove).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirm removing agent-desktop" });
    expect(confirm.textContent).toBe("Remove?");
    expect(document.activeElement).toBe(confirm);

    fireEvent.click(confirm);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("cancels Remove? on Escape and after 4 seconds without calling onRemove", () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    render(
      <FolderMenu
        folderName="agent-desktop"
        isFolded={false}
        onRemove={onRemove}
      />,
    );

    // Escape cancels
    fireEvent.click(screen.getByRole("button", { name: "Actions for agent-desktop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove project" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Confirm removing agent-desktop" }), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Confirm removing agent-desktop" })).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();

    // Timeout cancels
    fireEvent.click(screen.getByRole("button", { name: "Actions for agent-desktop" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove project" }));
    expect(screen.getByRole("button", { name: "Confirm removing agent-desktop" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("button", { name: "Confirm removing agent-desktop" })).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe("Sidebar folder right-click menu", () => {
  it("opens on right-click, prevents default, and wires folder actions", () => {
    const onNewSessionIn = vi.fn();
    const onRevealFolder = vi.fn();
    const onCopyFolderPath = vi.fn();
    const onArchiveFolderSessions = vi.fn();
    const onRemoveFolder = vi.fn();

    render(
      <Sidebar
        workspaces={[{ name: "agent-desktop", path: "/tmp/agent-desktop" }]}
        sessions={[makeSession()]}
        agents={[claudeProfile]}
        defaultAgentId={claudeProfile.id}
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        onNewSessionIn={onNewSessionIn}
        onRevealFolder={onRevealFolder}
        onCopyFolderPath={onCopyFolderPath}
        onArchiveFolderSessions={onArchiveFolderSessions}
        onRemoveFolder={onRemoveFolder}
      />,
    );

    const header = screen.getByRole("button", { name: "agent-desktop" });
    const notCancelled = fireEvent.contextMenu(header);
    expect(notCancelled).toBe(false);

    fireEvent.click(screen.getByRole("menuitem", { name: "New session" }));
    expect(onNewSessionIn).toHaveBeenCalledWith("/tmp/agent-desktop", claudeProfile.id);

    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
    expect(onRevealFolder).toHaveBeenCalledWith("/tmp/agent-desktop");

    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(onCopyFolderPath).toHaveBeenCalledWith("/tmp/agent-desktop");

    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive all sessions" }));
    expect(onArchiveFolderSessions).toHaveBeenCalledWith("/tmp/agent-desktop");

    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove project" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing agent-desktop" }));
    expect(onRemoveFolder).toHaveBeenCalledWith("/tmp/agent-desktop");
  });

  it("hides Remove project and Archive all sessions while a session in the folder is busy", () => {
    render(
      <Sidebar
        workspaces={[{ name: "agent-desktop", path: "/tmp/agent-desktop" }]}
        sessions={[makeSession({ id: "s-busy", status: "running" })]}
        agents={[claudeProfile]}
        isSessionBusy={(id) => id === "s-busy"}
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        onRevealFolder={vi.fn()}
        onArchiveFolderSessions={vi.fn()}
        onRemoveFolder={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "agent-desktop" }));
    expect(screen.getByRole("menuitem", { name: "Reveal in Finder" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Archive all sessions" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove project" })).toBeNull();
  });
});

describe("useSessionActions workspace helpers", () => {
  it("deleteWorkspaceSessions deletes active, pinned, and archived sessions in the folder atomically", () => {
    const s1 = makeSession({ id: "s-1", cwd: "/tmp/proj-a", createdAt: 100 });
    const s2 = makeSession({ id: "s-2", cwd: "/tmp/proj-a", pinned: true, createdAt: 200 });
    const s3 = makeSession({ id: "s-3", cwd: "/tmp/proj-a", archivedAt: 300, createdAt: 150 });
    const other = makeSession({ id: "s-other", cwd: "/tmp/proj-b", createdAt: 50 });
    let state: PersistedState = {
      version: 2,
      sessions: [s1, s2, s3, other],
      recentFolders: [],
      settings: { appearance: "system", defaultAgentId: claudeProfile.id, onboardingCompleted: true },
    };
    let activeId = "s-1";
    const removeTranscript = vi.fn();
    const navRemove = vi.fn();
    const stop = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useSessionActions({
        sessions: state.sessions,
        setActiveSessionId: (updater) => {
          activeId = typeof updater === "function" ? updater(activeId) : updater;
        },
        patchSession: vi.fn(),
        updateState: (updater) => {
          state = updater(state);
        },
        updateMessages: vi.fn(),
        removeTranscript,
        navigation: { remove: navRemove },
        acp: { stop },
        onNotice: vi.fn(),
      }),
    );

    result.current.deleteWorkspaceSessions("/tmp/proj-a");

    expect(state.sessions.map((s) => s.id)).toEqual(["s-other"]);
    expect(removeTranscript).toHaveBeenCalledTimes(3);
    expect(navRemove).toHaveBeenCalledTimes(3);
    expect(activeId).toBe("s-other");
  });

  it("archiveWorkspaceSessions archives idle unarchived sessions and skips busy or already archived ones", async () => {
    const sIdle = makeSession({ id: "s-idle", cwd: "/tmp/proj-a" });
    const sBusy = makeSession({ id: "s-busy", cwd: "/tmp/proj-a", status: "running" });
    const sArch = makeSession({ id: "s-arch", cwd: "/tmp/proj-a", archivedAt: 500 });
    const sOther = makeSession({ id: "s-other", cwd: "/tmp/proj-b" });
    const patchSession = vi.fn();

    const { result } = renderHook(() =>
      useSessionActions({
        sessions: [sIdle, sBusy, sArch, sOther],
        setActiveSessionId: vi.fn(),
        patchSession,
        updateState: vi.fn(),
        updateMessages: vi.fn(),
        removeTranscript: vi.fn(),
        navigation: { remove: vi.fn() },
        acp: { stop: vi.fn().mockResolvedValue(true) },
        onNotice: vi.fn(),
      }),
    );

    await result.current.archiveWorkspaceSessions("/tmp/proj-a", (id) => id === "s-busy");

    expect(patchSession).toHaveBeenCalledTimes(1);
    expect(patchSession).toHaveBeenCalledWith("s-idle", expect.objectContaining({ archivedAt: expect.any(Number) }));
  });
});
