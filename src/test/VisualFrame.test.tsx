import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MAX_VISUAL_HEIGHT, VISUAL_SANDBOX, VisualFrame } from "../components/chat/VisualFrame";

function bodyHeight(frame: HTMLIFrameElement, value: number) {
  Object.defineProperty(frame.contentDocument!.body, "scrollHeight", { configurable: true, value });
}

describe("VisualFrame", () => {
  it("allows same origin and never scripts", () => {
    render(<VisualFrame document="<!doctype html><p>a</p>" title="Flow" />);
    expect(screen.getByTitle("Flow").getAttribute("sandbox")).toBe("allow-same-origin");
    expect(VISUAL_SANDBOX).toBe("allow-same-origin");
    expect(VISUAL_SANDBOX).not.toContain("allow-scripts");
  });

  it("keeps markup that names a closing frame inside srcdoc", () => {
    const doc = '<!doctype html><p title="a">x</p></iframe><script>1</script>';
    const { container } = render(<VisualFrame document={doc} title="Flow" />);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(screen.getByTitle("Flow").getAttribute("srcdoc")).toBe(doc);
  });

  it("takes the height of its document once loaded", () => {
    const onHeight = vi.fn();
    render(<VisualFrame document="<!doctype html><p>a</p>" title="Flow" onHeight={onHeight} />);
    const frame = screen.getByTitle<HTMLIFrameElement>("Flow");
    bodyHeight(frame, 340);
    fireEvent.load(frame);
    expect(frame.style.height).toBe("340px");
    expect(onHeight).toHaveBeenLastCalledWith(340);
  });

  it("caps a tall document, which then scrolls inside", () => {
    render(<VisualFrame document="<!doctype html><p>a</p>" title="Flow" />);
    const frame = screen.getByTitle<HTMLIFrameElement>("Flow");
    bodyHeight(frame, 5000);
    fireEvent.load(frame);
    expect(frame.style.height).toBe(`${MAX_VISUAL_HEIGHT}px`);
  });

  it("measures again when the frame's width changes", () => {
    const observed: ResizeObserverCallback[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observed.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(<VisualFrame document="<!doctype html><p>a</p>" title="Flow" />);
      const frame = screen.getByTitle<HTMLIFrameElement>("Flow");
      bodyHeight(frame, 200);
      fireEvent.load(frame);
      bodyHeight(frame, 480);
      act(() => observed.forEach((callback) => callback([], {} as ResizeObserver)));
      expect(frame.style.height).toBe("480px");
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("starts at the height it had before", () => {
    render(<VisualFrame document="<!doctype html><p>a</p>" title="Flow" initialHeight={220} />);
    expect(screen.getByTitle<HTMLIFrameElement>("Flow").style.height).toBe("220px");
  });
});
