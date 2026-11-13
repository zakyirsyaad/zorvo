import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useElementHeight } from "../hooks/useElementHeight";

type Watcher = { callback: () => void; target: Element | null; isDisconnected: boolean };

/** A ResizeObserver the test drives: it records what is watched and reports when told to. */
function stubResizeObserver(): Watcher[] {
  const watchers: Watcher[] = [];
  class FakeResizeObserver {
    private readonly watcher: Watcher;
    constructor(callback: ResizeObserverCallback) {
      this.watcher = { callback: () => callback([], this as unknown as ResizeObserver), target: null, isDisconnected: false };
      watchers.push(this.watcher);
    }
    observe = (target: Element) => {
      this.watcher.target = target;
    };
    unobserve = () => {};
    disconnect = () => {
      this.watcher.isDisconnected = true;
    };
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return watchers;
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const height = useElementHeight(ref);
  return (
    <div ref={ref} data-testid="box">
      {height}
    </div>
  );
}

function setHeight(element: HTMLElement, height: number) {
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
}

afterEach(() => vi.unstubAllGlobals());

describe("useElementHeight", () => {
  it("is 0 until the element is measured, then follows each report", () => {
    const watchers = stubResizeObserver();
    render(<Probe />);
    const box = screen.getByTestId("box");
    expect(box).toHaveTextContent("0");
    expect(watchers).toHaveLength(1);
    expect(watchers[0].target).toBe(box);

    setHeight(box, 46);
    act(() => watchers[0].callback());
    expect(box).toHaveTextContent("46");

    setHeight(box, 256);
    act(() => watchers[0].callback());
    expect(box).toHaveTextContent("256");
  });

  it("stops watching when the component goes away", () => {
    const watchers = stubResizeObserver();
    const { unmount } = render(<Probe />);
    unmount();
    expect(watchers[0].isDisconnected).toBe(true);
  });
});
