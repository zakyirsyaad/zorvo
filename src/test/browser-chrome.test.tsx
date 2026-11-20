import "@testing-library/jest-dom/vitest";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserTabs } from "../components/browser/BrowserTabs";
import { BrowserToolbar, type BrowserOverlay } from "../components/browser/BrowserToolbar";
import type { BrowserTab } from "../lib/browser";

afterEach(cleanup);

const first: BrowserTab = { id: "one", title: "Example", url: "https://example.com/", loading: false, canGoBack: false, canGoForward: false };
const second: BrowserTab = { ...first, id: "two", title: "Second page", url: "https://example.org/" };

function toolbarProps(overrides: Partial<ComponentProps<typeof BrowserToolbar>> = {}): ComponentProps<typeof BrowserToolbar> {
  return {
    tabs: [first], active: first, engine: "webkit", panel: "page", busy: false, overlay: null,
    onOverlay: vi.fn(), onNavigate: vi.fn(), onAction: vi.fn(), onPanel: vi.fn(),
    site: null, siteBusy: false, onClearSite: vi.fn(), onNewTab: vi.fn(),
    zoomFactor: 1, onZoom: vi.fn(), onCopyLink: vi.fn(), onOpenExternal: vi.fn(), onClearHistory: vi.fn(), hasHistory: true,
    ...overrides,
  };
}

function Toolbar({ options = {} }: { options?: Partial<ComponentProps<typeof BrowserToolbar>> }) {
  const [overlay, setOverlay] = useState<BrowserOverlay>(null);
  return <BrowserToolbar {...toolbarProps(options)} overlay={overlay} onOverlay={setOverlay} />;
}

describe("browser page chrome", () => {
  it("puts page actions in the six-item menu and closes it after an action", () => {
    const onZoom = vi.fn();
    const onCopyLink = vi.fn();
    const onOpenExternal = vi.fn();
    const onClearHistory = vi.fn();
    render(<Toolbar options={{ onZoom, onCopyLink, onOpenExternal, onClearHistory }} />);
    const open = () => fireEvent.click(screen.getByRole("button", { name: "Browser options" }));
    open();
    expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual([
      "Zoom in", "Zoom out", "Reset zoom", "Copy link", "Open in browser", "Clear history",
    ]);
    expect(screen.getByRole("menuitem", { name: "Reset zoom" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Zoom in" }));
    expect(onZoom).toHaveBeenCalledWith("in");
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Zoom out" }));
    expect(onZoom).toHaveBeenCalledWith("out");
    for (const [name, callback] of [["Copy link", onCopyLink], ["Open in browser", onOpenExternal], ["Clear history", onClearHistory]] as const) {
      open();
      fireEvent.click(screen.getByRole("menuitem", { name }));
      expect(callback).toHaveBeenCalledOnce();
      expect(screen.queryByRole("menu")).toBeNull();
    }
  });

  it("keeps the WebKit console and debug views in their own tools menu", () => {
    const onPanel = vi.fn();
    render(<Toolbar options={{ onPanel }} />);
    expect(screen.getByRole("tablist", { name: "Browser tabs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Browser tools" }));
    for (const name of ["Page", "Console", "Debug"]) {
      expect(screen.getByRole("menuitemradio", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("menuitem", { name: "Copy link" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Console" }));
    expect(onPanel).toHaveBeenCalledWith("console");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows a reset control for non-default zoom and obeys zoom bounds", () => {
    const onZoom = vi.fn();
    const { rerender } = render(<Toolbar options={{ zoomFactor: 1.5, onZoom }} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset page zoom (150%)" }));
    expect(onZoom).toHaveBeenCalledWith("reset");
    rerender(<Toolbar options={{ zoomFactor: 5 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Browser options" }));
    expect(screen.getByRole("menuitem", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Zoom out" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Browser options" }));
    rerender(<Toolbar options={{ zoomFactor: 0.25 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Browser options" }));
    expect(screen.getByRole("menuitem", { name: "Zoom in" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Zoom out" })).toBeDisabled();
  });

  it("focuses the address of a blank tab and disables actions needing a page", () => {
    render(<Toolbar options={{ active: { ...first, url: "about:blank", title: "" }, hasHistory: false }} />);
    expect(screen.getByRole("textbox", { name: "Web address" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Web address" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Site information" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Browser options" }));
    for (const name of ["Zoom in", "Zoom out", "Reset zoom", "Copy link", "Open in browser", "Clear history"]) {
      expect(screen.getByRole("menuitem", { name })).toBeDisabled();
    }
  });

  it("switches and closes tabs independently, and opens a tab from the plus button", () => {
    const onAction = vi.fn();
    const onNewTab = vi.fn();
    render(<Toolbar options={{ tabs: [first, second], onAction, onNewTab }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Second page" }));
    expect(onAction).toHaveBeenCalledWith({ operation: "tabs.focus", tabId: "two" });
    const close = screen.getByRole("button", { name: "Close Example tab" });
    expect(close.closest('[role="tab"]')).toBeNull();
    fireEvent.click(close);
    expect(onAction).toHaveBeenCalledWith({ operation: "tabs.close", tabId: "one" });
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it("moves focus with the selected tab and restores it after keyboard closing", () => {
    function Pages() {
      const [tabs, setTabs] = useState([first, second]);
      const [activeId, setActive] = useState(first.id);
      return <BrowserTabs tabs={tabs} activeId={activeId} busy={false} onSelect={setActive} onNewTab={vi.fn()}
        onClose={id => { const next = tabs.filter(tab => tab.id !== id); setTabs(next); setActive(next[0]?.id ?? ""); }} />;
    }
    render(<Pages />);
    const list = screen.getByRole("tablist");
    const example = screen.getByRole("tab", { name: "Example" });
    example.focus();
    fireEvent.keyDown(example, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Second page" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Second page" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(example).toHaveFocus();
    fireEvent.keyDown(example, { key: "End" });
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    expect(screen.queryByRole("tab", { name: "Second page" })).toBeNull();
    expect(example).toHaveFocus();
    expect(list).toBeInTheDocument();
    fireEvent.keyDown(example, { key: "Delete" });
    expect(screen.getByRole("button", { name: "New tab" })).toHaveFocus();
  });

  it("waits for pending close work before focusing the remaining tab", () => {
    const onClose = vi.fn();
    const props = { onClose, onSelect: vi.fn(), onNewTab: vi.fn() };
    const { rerender } = render(<BrowserTabs {...props} tabs={[first, second]} activeId="one" busy={false} />);
    const current = screen.getByRole("tab", { name: "Example" });
    current.focus();
    fireEvent.keyDown(current, { key: "Delete" });
    expect(onClose).toHaveBeenCalledWith("one");
    const scroll = vi.fn();
    Object.defineProperty(screen.getByRole("tab", { name: "Second page" }), "scrollIntoView", { value: scroll, configurable: true });

    rerender(<BrowserTabs {...props} tabs={[second]} activeId="two" busy />);
    const remaining = screen.getByRole("tab", { name: "Second page" });
    expect(remaining).toBeDisabled();
    expect(remaining).not.toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    rerender(<BrowserTabs {...props} tabs={[second]} activeId="two" busy={false} />);
    expect(remaining).toHaveFocus();
  });

  it("focuses a keyboard-selected tab after its asynchronous activation finishes", () => {
    const onSelect = vi.fn();
    const props = { tabs: [first, second], onSelect, onClose: vi.fn(), onNewTab: vi.fn() };
    const { rerender } = render(<BrowserTabs {...props} activeId="one" busy={false} />);
    const current = screen.getByRole("tab", { name: "Example" });
    const destination = screen.getByRole("tab", { name: "Second page" });
    current.focus();
    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("two");

    rerender(<BrowserTabs {...props} activeId="one" busy />);
    rerender(<BrowserTabs {...props} activeId="two" busy />);
    expect(destination).not.toHaveFocus();
    rerender(<BrowserTabs {...props} activeId="two" busy={false} />);
    expect(destination).toHaveFocus();
  });

  it("does not take focus back after the user moves away during activation", () => {
    const props = { tabs: [first, second], onSelect: vi.fn(), onClose: vi.fn(), onNewTab: vi.fn() };
    const page = (activeId: string, busy: boolean) => <><BrowserTabs {...props} activeId={activeId} busy={busy} /><button>Elsewhere</button></>;
    const { rerender } = render(page("one", false));
    const current = screen.getByRole("tab", { name: "Example" });
    current.focus();
    fireEvent.keyDown(current, { key: "ArrowRight" });
    rerender(page("one", true));
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    rerender(page("two", true));
    rerender(page("two", false));
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });
});
