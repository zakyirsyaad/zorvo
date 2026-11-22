import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ChatCanvas, type ChatMessage } from "../components/ChatCanvas";
import { VisualBlock } from "../components/chat/VisualBlock";
import { copyForkVisuals } from "../lib/visual-fork";
import { fakeTauriInvoke } from "./setup";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

const PART = { kind: "visual" as const, id: "v-0123456789abcdef", title: "Path of a visual", visualKind: "svg" as const };
const READ = { entry: { id: PART.id, title: PART.title, kind: "svg", bytes: 9, shownAt: 1 }, document: "<!doctype html><svg></svg>" };

describe("a reply that holds only a visual", () => {
  it("is drawn", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "draw", timestamp: 1 },
      { id: "a", role: "agent", content: "", timestamp: 2, parts: [PART] },
    ];
    render(<ChatCanvas messages={messages} visualSessionId="s-1" />);
    expect(screen.getByText("Path of a visual")).not.toBeNull();
  });
});

describe("a fork", () => {
  it("copies the visuals its messages name, and nothing when it names none", async () => {
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockClear();
    spy.mockImplementation((cmd, args) => (cmd === "visual_copy_session" ? Promise.resolve(1) : fakeTauriInvoke(cmd, args)));
    const copies = () => spy.mock.calls.filter(([cmd]) => cmd === "visual_copy_session").map(([, args]) => args);
    await copyForkVisuals("s-1", "s-2", [{ id: "u", role: "user", content: "x", timestamp: 1 }]);
    expect(copies()).toEqual([]);
    await copyForkVisuals("s-1", "s-2", [{ id: "a", role: "agent", content: "", timestamp: 2, parts: [PART] }]);
    expect(copies()).toEqual([{ fromSessionId: "s-1", toSessionId: "s-2", ids: [PART.id] }]);
  });

  it("goes on when the copy fails", async () => {
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockImplementation((cmd, args) => (cmd === "visual_copy_session" ? Promise.reject("EIO") : fakeTauriInvoke(cmd, args)));
    await expect(copyForkVisuals("s-1", "s-2", [{ id: "a", role: "agent", content: "", timestamp: 2, parts: [PART] }])).resolves.toEqual({});
  });

  it("returns where the fork's copies are, by visual id, and only well-formed answers", async () => {
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockClear();
    spy.mockImplementation((cmd, args) => {
      if (cmd === "visual_copy_session") return Promise.resolve(1);
      if (cmd === "visual_paths") return Promise.resolve([{ id: PART.id, path: "/data/v.svg" }, { id: 7 }, "x"]);
      return fakeTauriInvoke(cmd, args);
    });
    await expect(copyForkVisuals("s-1", "s-2", [{ id: "a", role: "agent", content: "", timestamp: 2, parts: [PART] }])).resolves.toEqual({ [PART.id]: "/data/v.svg" });
    expect(spy.mock.calls.filter(([cmd]) => cmd === "visual_paths").map(([, args]) => args)).toEqual([{ sessionId: "s-2", ids: [PART.id] }]);
  });
});

describe("a block that leaves the screen while its read is in flight", () => {
  let near: ((isNear: boolean) => void)[] = [];
  const original = globalThis.IntersectionObserver;
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
    globalThis.IntersectionObserver = original;
  });
  const tell = (isNear: boolean) => act(() => near.forEach((callback) => callback(isNear)));

  it("still shows the visual when it comes back, with one read", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockClear();
    spy.mockImplementation((cmd, args) => (cmd === "visual_read" ? new Promise((resolve) => (answer = resolve)) : fakeTauriInvoke(cmd, args)));
    render(<VisualBlock sessionId="s-1" part={PART} agentName="Claude Code" />);
    tell(true);
    tell(false);
    await act(async () => answer(READ));
    tell(true);
    await waitFor(() => expect(screen.queryByTitle("Path of a visual")).not.toBeNull());
    expect(spy.mock.calls.filter(([cmd]) => cmd === "visual_read")).toHaveLength(1);
  });
});
