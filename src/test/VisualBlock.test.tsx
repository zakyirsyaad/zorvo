import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VisualBlock } from "../components/chat/VisualBlock";
import { fakeTauriInvoke } from "./setup";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const PART = { kind: "visual" as const, id: "v-0123456789abcdef", title: "Path of a visual", visualKind: "svg" as const };
const READ = { entry: { id: PART.id, title: PART.title, kind: "svg", bytes: 9, shownAt: 1 }, document: "<!doctype html><svg></svg>" };

let near: ((isNear: boolean) => void)[] = [];
const originalObserver = globalThis.IntersectionObserver;

function mockRead(read: () => unknown | Promise<unknown>) {
  const spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd, args) => (cmd === "visual_read" ? Promise.resolve().then(read) : fakeTauriInvoke(cmd, args)));
  return () => spy.mock.calls.filter(([cmd]) => cmd === "visual_read").map(([, args]) => args);
}

beforeEach(() => {
  near = [];
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      near.push((isNear) => callback([{ isIntersecting: isNear } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  globalThis.IntersectionObserver = originalObserver;
});

const comeNear = (isNear = true) => act(() => near.forEach((tell) => tell(isNear)));

describe("VisualBlock", () => {
  it("reads the visual only once it is near the screen", async () => {
    const reads = mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    expect(reads()).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("Loading visual");
    comeNear();
    await screen.findByTitle("Path of a visual");
    expect(reads()).toEqual([{ sessionId: "s-1", id: PART.id }]);
  });

  it("shows the title, who made it, and the frame", async () => {
    mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    const frame = await screen.findByTitle("Path of a visual");
    expect(frame.getAttribute("srcdoc")).toBe(READ.document);
    expect(screen.getByText("Path of a visual")).not.toBeNull();
    expect(screen.getByText("Claude Code made this visual")).not.toBeNull();
  });

  it("says a visual is gone and offers nothing else", async () => {
    mockRead(() => Promise.reject("That visual is no longer available."));
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    expect(await screen.findByText("This visual is no longer available.")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers Try again after a failed read and reads again", async () => {
    let fail = true;
    const reads = mockRead(() => (fail ? Promise.reject("EIO /Users/test") : READ));
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    expect(await screen.findByText("Zorvo could not show this visual.")).not.toBeNull();
    expect(screen.queryByText(/EIO/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTitle("Path of a visual");
    expect(reads()).toHaveLength(2);
  });

  it("folds to its header and back", async () => {
    mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    await screen.findByTitle("Path of a visual");
    const fold = screen.getByRole("button", { name: "Fold visual" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(screen.queryByTitle("Path of a visual")).toBeNull();
    const unfold = screen.getByRole("button", { name: "Unfold visual" });
    expect(unfold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(unfold);
    expect(screen.getByTitle("Path of a visual")).not.toBeNull();
  });

  it("shows only the title and one line where there is no main window", () => {
    const reads = mockRead(() => READ);
    render(<VisualBlock part={PART} agentName="Claude Code" />);
    comeNear();
    expect(screen.getByText("Path of a visual")).not.toBeNull();
    expect(screen.getByText("Shown in the main window.")).not.toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(reads()).toEqual([]);
  });

  it("unmounts the frame when it leaves the screen and keeps its height", async () => {
    mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    const frame = await screen.findByTitle<HTMLIFrameElement>("Path of a visual");
    Object.defineProperty(frame.contentDocument!.body, "scrollHeight", { configurable: true, value: 300 });
    fireEvent.load(frame);
    comeNear(false);
    await waitFor(() => expect(document.querySelector("iframe")).toBeNull());
    expect(screen.getByTestId("visual-placeholder").style.height).toBe("300px");
    comeNear();
    expect((await screen.findByTitle<HTMLIFrameElement>("Path of a visual")).style.height).toBe("300px");
  });

  it("expands into a dialog named by the title, with the same sandbox", async () => {
    mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    await screen.findByTitle("Path of a visual");
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const dialog = screen.getByRole("dialog", { name: "Path of a visual" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const frame = dialog.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame?.getAttribute("srcdoc")).toBe(READ.document);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("closes the dialog on Escape and gives focus back to Expand", async () => {
    mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    await screen.findByTitle("Path of a visual");
    const expand = screen.getByRole("button", { name: "Expand" });
    fireEvent.click(expand);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(expand);
  });

  it("closes the dialog from its Close button", async () => {
    mockRead(() => READ);
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    comeNear();
    await screen.findByTitle("Path of a visual");
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
