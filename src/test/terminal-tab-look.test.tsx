import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createPtyOutputStore } from "../lib/pty-output-store";
import type { WorkspaceTerminals, WorkspaceTerminalTab } from "../hooks/useWorkspaceTerminals";
import type { TerminalViewProps } from "../components/TerminalView";
import { XTERM_OPTIONS } from "../lib/xterm-options";

// Each view's onResize, by tab, so a test can report a size the way xterm's fit does.
const { resizers } = vi.hoisted(() => ({ resizers: new Map<string, (cols: number, rows: number) => void>() }));

vi.mock("../components/TerminalView", () => ({
  TerminalView: function FakeTerminalView(props: TerminalViewProps) {
    resizers.set(props.sessionId, props.onResize);
    return <div data-testid={`view-${props.sessionId}`} aria-label={props.label} />;
  },
}));

import { TerminalDrawer } from "../components/terminal/TerminalDrawer";

const tab = (id: string, number: number): WorkspaceTerminalTab => ({ id, folderPath: "/w/agent-desktop", number, status: "live", shell: "zsh" });

function renderDrawer(tabs: WorkspaceTerminalTab[]) {
  const terminals: WorkspaceTerminals = {
    output: createPtyOutputStore(),
    tabsFor: () => tabs,
    liveCount: tabs.length,
    open: vi.fn(async () => null),
    close: vi.fn(),
    closeFolder: vi.fn(),
    send: vi.fn(),
    resize: vi.fn(),
  };
  render(<TerminalDrawer folderPath="/w/agent-desktop" folderName="agent-desktop" terminals={terminals} startingFor={null} onStartShell={vi.fn(async () => null)} />);
  return terminals;
}

describe("the terminal tab as drawn", () => {
  it("the strip is 36px on the terminal background", () => {
    renderDrawer([tab("shell-1", 1)]);
    expect(screen.getByRole("region", { name: "Terminal" })).toHaveClass("bg-terminal-bg");
    expect(screen.getByRole("tablist", { name: "Terminals" }).parentElement).toHaveClass("h-9", "border-terminal-surface");
  });

  it("tabs read the shell, and the selected one shows its folder in mono", () => {
    renderDrawer([tab("shell-1", 1), tab("shell-2", 2)]);
    const second = screen.getByRole("tab", { name: "zsh 2" });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveClass("bg-terminal-surface", "text-terminal-fg-strong");
    expect(screen.getByText("agent-desktop", { selector: "span" })).toHaveClass("font-mono", "text-terminal-fg-subtle");
    expect(screen.getByRole("tab", { name: "zsh" })).toHaveClass("text-terminal-fg-muted");
  });

  it("New terminal is 24px with a 12px icon", () => {
    renderDrawer([tab("shell-1", 1)]);
    const add = screen.getByRole("button", { name: "New terminal" });
    expect(add).toHaveClass("h-6", "w-6");
    expect(add.querySelector("svg")).toHaveAttribute("width", "12");
  });

  it("the size readout follows the selected tab and is empty before a fit", () => {
    renderDrawer([tab("shell-1", 1), tab("shell-2", 2)]);
    expect(screen.queryByText(/×/)).toBeNull();

    act(() => resizers.get("shell-2")!(80, 38));
    expect(screen.getByText("80 × 38")).toBeInTheDocument();

    act(() => fireEvent.click(screen.getByRole("tab", { name: "zsh" })));
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it("passes the size on to the shell", () => {
    const terminals = renderDrawer([tab("shell-1", 1)]);
    act(() => resizers.get("shell-1")!(100, 30));
    expect(terminals.resize).toHaveBeenCalledWith("shell-1", 100, 30);
  });

  it("the strip draws focus rings in the terminal's own fixed grey, so they show in light mode", () => {
    renderDrawer([tab("shell-1", 1)]);
    expect(screen.getByRole("tablist", { name: "Terminals" }).parentElement).toHaveClass(
      "[--color-focus-ring:var(--color-terminal-fg-muted)]",
    );
  });

  it("xterm draws 18px rows with a block cursor", () => {
    expect(XTERM_OPTIONS.lineHeight).toBe(1.5);
    expect(XTERM_OPTIONS.cursorStyle).toBe("block");
  });
});
