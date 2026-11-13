import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToolsPart } from "../components/chat/ToolsPart";
import { ActionCard } from "../components/ActionCard";
import { SessionTree, type SessionListContext } from "../components/sidebar/SessionList";
import { CONFIRM_DELETE_MS } from "../components/sidebar/SessionMenu";
import { editsOf } from "../lib/acp-events";
import { keepsNativeMenu } from "../lib/context-menu";
import type { ActionCard as ActionCardType, Session, ToolExecution } from "../types";

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("a tool step's focus ring", () => {
  it("is drawn inside each step, flush on its rail; the summary, with no card to clip it, has the usual ring", () => {
    const css = readFileSync(join(__dirname, "..", "styles", "globals.css"), "utf8");
    expect(css).toMatch(/@utility focus-ring-inset\s*\{[^}]*&:focus-visible\s*\{[^}]*outline-offset:\s*-1px/);

    const tool: ToolExecution = { id: "t-1", name: "Read", status: "completed", kind: "read", locations: ["a.ts"], details: [{ kind: "text", text: "x" }] };
    render(<ToolsPart tools={[tool]} isCurrentTurn={false} isTurnOver />);
    const header = screen.getAllByRole("button")[0];
    fireEvent.click(header);
    expect(header.className.split(/\s+/)).toContain("focus-ring");
    const steps = screen.getAllByRole("button").slice(1);
    expect(steps.length).toBeGreaterThan(0);
    for (const button of steps) {
      expect(button).toHaveClass("focus-ring-inset");
      expect(button.className.split(/\s+/)).not.toContain("focus-ring");
    }
  });
});

describe("right-click keeps WebKit's menu only where it helps", () => {
  it("keeps it in a terminal, where xterm puts its own selection and Paste", () => {
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const screenCell = document.createElement("div");
    terminal.append(screenCell);
    document.body.append(terminal);
    expect(keepsNativeMenu(screenCell, window.getSelection())).toBe(true);
  });

  it("keeps it on selected text, but not on chrome while text is selected elsewhere", () => {
    const reply = document.createElement("p");
    reply.textContent = "status words";
    const chrome = document.createElement("div");
    document.body.append(reply, chrome);
    const range = document.createRange();
    range.selectNodeContents(reply);
    window.getSelection()?.addRange(range);

    expect(keepsNativeMenu(reply, window.getSelection())).toBe(true);
    expect(keepsNativeMenu(chrome, window.getSelection())).toBe(false);
  });

  it("does not keep it on a checkbox, which has nothing to paste into", () => {
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(keepsNativeMenu(box, null)).toBe(false);
  });
});

describe("a right-click while Delete? asks", () => {
  it("does not open the menu by itself once the question goes away", () => {
    vi.useFakeTimers();
    const session: Session = {
      id: "s-1",
      name: "A session",
      profileId: "qwen",
      cwd: "/w",
      status: "terminated",
      createdAt: 1,
      transport: "acp",
    };
    const context: SessionListContext = {
      agentNameOf: () => "Qwen Code",
      isSessionBusy: () => false,
      isSessionWaiting: () => false,
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
    };
    render(<SessionTree nodes={[{ session, children: [] }]} label="Sessions" context={context} />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for A session" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("session-row-s-1"));
    act(() => void vi.advanceTimersByTime(CONFIRM_DELETE_MS));

    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("a permission card's files", () => {
  it("keeps a diff too large to count, by its path alone", () => {
    const big = "x".repeat(200_001);
    expect(editsOf([{ type: "diff", path: "a.ts", oldText: "", newText: "one\n" }, { type: "diff", path: "big.ts", oldText: "", newText: big }])).toEqual([
      { path: "a.ts", added: 1, removed: 0 },
      { path: "big.ts" },
    ]);
  });

  it("cuts a long path at its start, so the file's name stays in sight, and lists a file with no counts", () => {
    const path = "/Users/mac/Library/Application Support/xyz.zorvo.desktop/worktrees/agent-fix/src/lib/parser.ts";
    const card: ActionCardType = {
      id: "c-1",
      sessionId: "s-1",
      title: "Permission requested",
      prompt: "Edit 2 files",
      status: "pending",
      timestamp: 1,
      requestId: 1,
      options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      edits: [{ path, added: 2, removed: 1 }, { path: "big.ts" }],
    };
    render(<ActionCard card={card} agentName="Claude Code" onChoose={vi.fn()} />);
    const shown = screen.getByText(path);
    expect(shown.tagName.toLowerCase()).toBe("bdi");
    expect(shown).toHaveAttribute("dir", "ltr");
    expect(shown.parentElement).toHaveClass("truncate", "[direction:rtl]");
    const bigRow = screen.getByText("big.ts").closest("li") as HTMLElement;
    expect(bigRow.textContent).toBe("big.ts");
  });
});
