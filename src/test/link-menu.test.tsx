import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LinkMenuLayer } from "../components/LinkMenuLayer";
import { menuPlacement, openableLinkAt } from "../lib/link-menu";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

function link(href: string, text = "the docs"): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  anchor.textContent = text;
  document.body.append(anchor);
  return anchor;
}

function rightClick(target: Element, point = { clientX: 120, clientY: 80 }): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...point });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("openableLinkAt", () => {
  it("finds the web or mail link around a right-clicked node", () => {
    const web = link("https://example.com/docs");
    const mail = link("mailto:team@example.com");
    expect(openableLinkAt(web.firstChild)).toEqual({ anchor: web, href: "https://example.com/docs" });
    expect(openableLinkAt(mail)?.href).toBe("mailto:team@example.com");
  });

  it("ignores anything that is not an http, https or mailto link", () => {
    expect(openableLinkAt(link("javascript:alert(1)"))).toBeNull();
    expect(openableLinkAt(link("file:///etc/hosts"))).toBeNull();
    expect(openableLinkAt(link("#section"))).toBeNull();
    expect(openableLinkAt(document.createElement("div"))).toBeNull();
    expect(openableLinkAt(null)).toBeNull();
  });
});

describe("menuPlacement", () => {
  const viewport = { width: 800, height: 600 };
  const menu = { width: 240, height: 120 };

  it("opens at the pointer when there is room", () => {
    expect(menuPlacement({ x: 100, y: 80 }, menu, viewport)).toEqual({ left: 100, top: 80 });
  });

  it("stays inside the window near its right and bottom edges", () => {
    expect(menuPlacement({ x: 780, y: 590 }, menu, viewport)).toEqual({ left: 552, top: 472 });
  });
});

describe("LinkMenuLayer", () => {
  it("replaces WebKit's menu on a link with Open in browser and Copy link", () => {
    render(<LinkMenuLayer />);
    const anchor = link("https://example.com/docs");

    expect(rightClick(anchor)).toBe(true);

    const menu = screen.getByRole("menu", { name: "Link" });
    expect(screen.getByRole("menuitem", { name: "Open in browser" })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeDefined();
    expect(menu.textContent).toContain("example.com/docs");
  });

  it("opens the link in the browser, never in Zorvo's window", () => {
    const spy = vi.spyOn(internals(), "invoke");
    render(<LinkMenuLayer />);
    rightClick(link("https://example.com/docs"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Open in browser" }));

    expect(spy).toHaveBeenCalledWith("open_external_url", { url: "https://example.com/docs" }, undefined);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("copies the address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<LinkMenuLayer />);
    rightClick(link("mailto:team@example.com"));

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    });

    expect(writeText).toHaveBeenCalledWith("mailto:team@example.com");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves through its items with the arrow keys and closes on Escape, back on the link", () => {
    render(<LinkMenuLayer />);
    const anchor = link("https://example.com/docs");
    rightClick(anchor);

    const inApp = screen.getByRole("menuitem", { name: "Open in Zorvo's browser" });
    const open = screen.getByRole("menuitem", { name: "Open in browser" });
    const copy = screen.getByRole("menuitem", { name: "Copy link" });
    expect(document.activeElement).toBe(inApp);
    fireEvent.keyDown(inApp, { key: "ArrowDown" });
    expect(document.activeElement).toBe(open);
    fireEvent.keyDown(open, { key: "ArrowDown" });
    expect(document.activeElement).toBe(copy);
    fireEvent.keyDown(copy, { key: "ArrowDown" });
    expect(document.activeElement).toBe(inApp);

    fireEvent.keyDown(open, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("closes on Escape even after focus left its items", () => {
    render(<LinkMenuLayer />);
    const anchor = link("https://example.com/docs");
    rightClick(anchor);
    (document.activeElement as HTMLElement).blur();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("goes back to the link on Tab, so Tab moves on from there", () => {
    render(<LinkMenuLayer />);
    const anchor = link("https://example.com/docs");
    rightClick(anchor);

    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Open in browser" }), { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it("goes to the last item on ArrowUp when no item has focus", () => {
    render(<LinkMenuLayer />);
    rightClick(link("https://example.com/docs"));
    const menu = screen.getByRole("menu", { name: "Link" });
    (document.activeElement as HTMLElement).blur();

    fireEvent.keyDown(menu, { key: "ArrowUp" });

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy link" }));
  });

  it("names the address as the menu's description, not as one of its items", () => {
    render(<LinkMenuLayer />);
    rightClick(link("https://example.com/docs"));

    const menu = screen.getByRole("menu", { name: "Link" });
    const description = document.getElementById(menu.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("example.com/docs");
    expect(description?.getAttribute("aria-hidden")).toBe("true");
  });

  it("closes on a click outside", () => {
    render(<LinkMenuLayer />);
    rightClick(link("https://example.com/docs"));

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open while the chat scrolls under it", () => {
    render(<LinkMenuLayer />);
    rightClick(link("https://example.com/docs"));

    act(() => {
      document.body.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByRole("menu", { name: "Link" })).toBeDefined();
  });

  it("leaves other right-clicks alone", () => {
    render(<LinkMenuLayer />);
    const plain = document.createElement("p");
    plain.textContent = "plain text";
    document.body.append(plain);

    expect(rightClick(plain)).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps WebKit's menu off a link it cannot open, without offering anything", () => {
    render(<LinkMenuLayer />);

    expect(rightClick(link("javascript:alert(1)"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
