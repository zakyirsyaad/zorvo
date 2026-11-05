import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";
import { closeInspector, inspectorButton, openInspectorTab } from "./inspector-helpers";
import App from "../App";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

function fakeStore(): FakeTauriStore {
  return (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__;
}

const stat = (path: string, added: number, removed: number) => ({ path, oldPath: null, kind: "modified", added, removed, isBinary: false });

function seedWithChanges() {
  fakeStore().state.sessions = [
    { id: "s-a", name: "Alpha work", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 1, transport: "acp" },
  ];
  return vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) => {
    if (cmd === "session_changes") return Promise.resolve([{ path: "src/app.ts", oldPath: null, kind: "modified" }]);
    if (cmd === "session_diff_stats") return Promise.resolve([stat("src/app.ts", 12, 3)]);
    if (cmd === "session_diff_targets") return Promise.resolve({ base: null });
    if (cmd === "workspace_terminal_open") return Promise.resolve({ id: "shell-1", folder: String(args?.path) });
    if (cmd === "workspace_terminal_close") return Promise.resolve(undefined);
    return fakeTauriInvoke(cmd, args);
  });
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

const inspector = () => screen.queryByRole("region", { name: "Inspector" });
const callsTo = (spy: { mock: { calls: unknown[][] } }, name: string) => spy.mock.calls.filter(([cmd]) => cmd === name);

describe("The inspector in the app", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the inspector from the top bar on Changes, and closes it", async () => {
    seedWithChanges();
    await renderApp();
    expect(inspector()).toBeNull();

    await click(inspectorButton());
    expect(inspectorButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: /^Changes/ })).toHaveAttribute("aria-selected", "true");
    expect(within(inspector() as HTMLElement).getByRole("complementary", { name: "Changes panel" })).toBeInTheDocument();

    await closeInspector();
    expect(inspector()).toBeNull();
    expect(inspectorButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the full diff from the diff chip, leaving the inspector closed", async () => {
    seedWithChanges();
    await renderApp();

    // The Changes tab cannot show committed work or comments yet, so the chip opens the review itself.
    await click(await within(screen.getAllByRole("banner")[0]).findByRole("button", { name: /12 lines added, 3 removed/ }));

    expect(screen.getByRole("complementary", { name: "Diff view" })).toBeInTheDocument();
    expect(inspector()).toBeNull();
  });

  it("gives focus back to the Inspector button when it closes from its own button", async () => {
    seedWithChanges();
    await renderApp();
    await openInspectorTab("Files");

    await closeInspector();

    expect(document.activeElement).toBe(inspectorButton());
  });

  it("opens a clicked file in the Files tab, widening the inspector, and goes back to the tree", async () => {
    const spy = seedWithChanges();
    const original = spy.getMockImplementation()!;
    spy.mockImplementation((cmd, args) => {
      if (cmd === "list_directory") return Promise.resolve([{ name: "README.md", relativePath: "README.md", isDir: false }]);
      if (cmd === "read_workspace_file") return Promise.resolve({ kind: "text", text: "# Zorvo\n", size: 8 });
      return original(cmd, args);
    });
    await renderApp();
    await openInspectorTab("Files");
    expect(inspector()?.style.width).toBe("380px");

    await click(await screen.findByRole("button", { name: /^README\.md/ }));
    expect(await screen.findByRole("region", { name: "Contents of README.md" })).toHaveTextContent("# Zorvo");
    expect(inspector()?.style.width).toBe("560px");
    expect(callsTo(spy, "open_path")).toHaveLength(0);

    await click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByRole("tree", { name: /^Files in/ })).toBeInTheDocument();
    expect(inspector()?.style.width).toBe("380px");
  });

  it("adds selected lines of the open file to the message box", async () => {
    const spy = seedWithChanges();
    const original = spy.getMockImplementation()!;
    spy.mockImplementation((cmd, args) => {
      if (cmd === "list_directory") return Promise.resolve([{ name: "notes.txt", relativePath: "notes.txt", isDir: false }]);
      if (cmd === "read_workspace_file") return Promise.resolve({ kind: "text", text: "one\ntwo\n", size: 8 });
      return original(cmd, args);
    });
    await renderApp();
    await openInspectorTab("Files");
    await click(await screen.findByRole("button", { name: /^notes\.txt/ }));

    const body = await screen.findByRole("region", { name: "Contents of notes.txt" });
    const code = (line: number) => body.querySelector(`[data-line="${line}"]`)!.lastElementChild!;
    const range = document.createRange();
    range.setStart(code(1), 0);
    range.setEnd(code(2), code(2).childNodes.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(body);
    await click(screen.getByRole("button", { name: "Add lines 1–2 to prompt" }));

    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("`notes.txt` lines 1–2:\n\n```\none\ntwo\n```");
  });

  it("keeps the shell when you leave the Terminal tab or close the inspector", async () => {
    const spy = seedWithChanges();
    await renderApp();

    await openInspectorTab("Terminal");
    await openInspectorTab("Files");
    await closeInspector();
    await openInspectorTab("Terminal");

    expect(callsTo(spy, "workspace_terminal_open")).toHaveLength(1);
    expect(callsTo(spy, "workspace_terminal_close")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Terminal" })).toBeInTheDocument();
  });

  it("closes the inspector when its tab no longer applies", async () => {
    seedWithChanges();
    await renderApp();
    await click(screen.getAllByText("Alpha work")[0]);
    await openInspectorTab("Activity");
    expect(inspector()).not.toBeNull();

    // A new-session draft has no session, so it has no activity to show.
    await click(screen.getByRole("button", { name: "New session" }));
    expect(inspector()).toBeNull();
  });

  it("opens the full review from Changes in the chat's place, and Shrink brings the chat back", async () => {
    seedWithChanges();
    await renderApp();
    await openInspectorTab("Changes");

    await click(await within(inspector() as HTMLElement).findByRole("button", { name: /Open the diff/ }));

    // The diff and the inspector never squeeze the chat between them.
    expect(screen.getByRole("complementary", { name: "Diff view" })).toBeInTheDocument();
    expect(inspector()).toBeNull();
    const chat = screen.getByRole("textbox", { name: "Prompt", hidden: true }).closest("article") as HTMLElement;
    expect(chat.classList.contains("hidden")).toBe(true);
    await click(screen.getByRole("button", { name: "Shrink diff view" }));
    expect(chat.classList.contains("hidden")).toBe(false);
    await click(screen.getByRole("button", { name: "Expand diff view" }));
    expect(chat.classList.contains("hidden")).toBe(true);

    await click(screen.getByRole("button", { name: "Close diff view" }));
    expect(screen.queryByRole("complementary", { name: "Diff view" })).toBeNull();
    expect(chat.classList.contains("hidden")).toBe(false);
  });

  it("shows the chat of another session in the same folder, with the review beside it", async () => {
    seedWithChanges();
    fakeStore().state.sessions = [
      ...(fakeStore().state.sessions ?? []),
      { id: "s-b", name: "Beta work", profileId: "claude-code", cwd: "/Users/test/developer/zorvo", status: "terminated", createdAt: 2, transport: "acp" },
    ];
    await renderApp();
    await click(screen.getAllByText("Alpha work")[0]);
    await click(await within(screen.getAllByRole("banner")[0]).findByRole("button", { name: /12 lines added, 3 removed/ }));
    const chat = () => screen.getByRole("textbox", { name: "Prompt", hidden: true }).closest("article") as HTMLElement;
    expect(chat().classList.contains("hidden")).toBe(true);

    await click(within(screen.getByRole("list", { name: "Workspaces" })).getByText("Beta work"));

    expect(chat().classList.contains("hidden")).toBe(false);
    expect(screen.getByRole("complementary", { name: "Diff view" })).toBeInTheDocument();
  });

  it("closes the diff when the inspector opens", async () => {
    seedWithChanges();
    await renderApp();
    await openInspectorTab("Changes");
    await click(await within(inspector() as HTMLElement).findByRole("button", { name: /Open the diff/ }));
    expect(screen.getByRole("complementary", { name: "Diff view" })).toBeInTheDocument();

    await click(inspectorButton());

    expect(inspector()).not.toBeNull();
    expect(screen.queryByRole("complementary", { name: "Diff view" })).toBeNull();
  });
});
