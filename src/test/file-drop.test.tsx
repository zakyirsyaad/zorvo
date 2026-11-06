import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";

type DragHandler = (event: { payload: { type: string; paths?: string[] } }) => void;
let dragHandler: DragHandler = () => {};

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: DragHandler) => {
      dragHandler = handler;
      return Promise.resolve(() => {});
    },
  }),
}));

import App from "../App";
import { fakeTauriInvoke, type FakeTauriStore } from "./setup";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function tauriInternals(): TauriInternals {
  return (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;
}

/** The paths of the files attached to the message, in order. */
function attachedPaths(): (string | null)[] {
  const list = screen.getByRole("list", { name: "Attachments" });
  return within(list).getAllByRole("listitem").map((item) => item.getAttribute("title"));
}

async function typeInPrompt(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: text } });
  });
}

describe("Dropping files onto the window", () => {
  it("shows where files will go while they are dragged, and attaches dropped files to the message", async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      dragHandler({ payload: { type: "enter", paths: ["/Users/test/shot.png"] } });
    });
    expect(screen.getByText("Drop files to add them to your message")).toBeDefined();

    await act(async () => {
      dragHandler({ payload: { type: "drop", paths: ["/Users/test/shot.png", "/Users/test/my notes.md"] } });
    });

    expect(screen.queryByText("Drop files to add them to your message")).toBeNull();
    expect(attachedPaths()).toEqual(["/Users/test/shot.png", "/Users/test/my notes.md"]);
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("puts the drop area on the main area's still frame, so a scrolled draft still shows it over what is on screen", async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      dragHandler({ payload: { type: "enter", paths: ["/Users/test/shot.png"] } });
    });

    // The draft's column scrolls; the article around it does not, and the overlay is placed against the article.
    const column = screen.getByRole("textbox", { name: "Prompt" }).closest("[data-main-column]");
    expect(column).not.toBeNull();
    const overlay = screen.getByText("Drop files to add them to your message").closest(".absolute")!;
    expect(overlay.parentElement).toBe(column!.parentElement);
    expect(column!.contains(overlay)).toBe(false);
  });

  it("adds nothing to the message from a compare run's panel, which shows no message", async () => {
    const session = (id: string, profileId: string) => ({
      id,
      name: "Fix the login",
      profileId,
      cwd: "/Users/test/developer/zorvo",
      status: "terminated",
      createdAt: 1,
      transport: "acp",
      compareRunId: "run-1",
    });
    (window as unknown as { __FAKE_TAURI_STORE__: FakeTauriStore }).__FAKE_TAURI_STORE__.state.sessions = [
      session("s-1", "claude-acp"),
      session("s-2", "qwen-code"),
    ] as FakeTauriStore["state"]["sessions"];
    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Fix the login.*2 agents/ }));
    });

    await act(async () => {
      dragHandler({ payload: { type: "drop", paths: ["/Users/test/shot.png"] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Claude Code" }));
    });

    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull();
  });

  it("lists the session folder's files after an @ in the prompt", async () => {
    const spy = vi.spyOn(tauriInternals(), "invoke").mockImplementation((cmd, args) =>
      cmd === "workspace_files" ? Promise.resolve(["src/App.tsx", "README.md"]) : fakeTauriInvoke(cmd, args)
    );
    await act(async () => {
      render(<App />);
    });

    await typeInPrompt("fix @app");

    expect(spy).toHaveBeenCalledWith("workspace_files", { root: "/Users/test/developer/ai-perpetual-trading" }, undefined);
    const files = within(screen.getByRole("listbox", { name: "Files to mention" }));
    expect(files.getAllByRole("option").map((o) => o.getAttribute("data-file"))).toEqual(["src/App.tsx"]);
    spy.mockRestore();
  });

  it("leaves out a dropped file whose name has control characters, and says so", async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      dragHandler({ payload: { type: "drop", paths: ["/Users/test/ok.md", "/Users/test/evil\rname.md"] } });
    });

    expect(attachedPaths()).toEqual(["/Users/test/ok.md"]);
    // A warning, not an error: spoken politely, and drawn without the danger edge.
    expect(screen.queryByRole("alert")).toBeNull();
    const notice = screen.getAllByRole("status").find((status) => status.textContent?.includes("control characters"));
    expect(notice).toBeDefined();
    expect(notice?.className).not.toContain("border-danger");
  });

  it("shows the notice above the message box, not over its Send button", async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      dragHandler({ payload: { type: "drop", paths: ["/Users/test/evil\rname.md"] } });
    });

    // The stack is placed from an anchor at the top edge of the composer area,
    // so its bottom offset starts there and never reaches the Send button.
    const toast = screen.getAllByRole("status").find((status) => status.textContent?.includes("control characters"));
    const anchor = toast?.parentElement?.parentElement;
    expect(anchor).toHaveClass("relative", "h-0");
    // The composer's slot follows it (after the draft's blockers, which sit right above the composer).
    const later: Element[] = [];
    for (let next = anchor?.nextElementSibling; next; next = next.nextElementSibling) later.push(next);
    expect(later.some((sibling) => sibling.contains(screen.getByRole("textbox", { name: "Prompt" })))).toBe(true);
  });
});
