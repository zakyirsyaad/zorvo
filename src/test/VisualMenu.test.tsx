import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VisualMenu } from "../components/chat/VisualMenu";
import { menuItemsFor } from "../lib/visual-export";
import { fakeTauriInvoke } from "./setup";

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
const internals = () => (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__;

function setup(kind: "svg" | "html", answer: (cmd: string) => unknown | Promise<unknown> = () => true) {
  const spy = vi.spyOn(internals(), "invoke");
  spy.mockClear();
  spy.mockImplementation((cmd, args) =>
    cmd === "visual_export" || cmd === "visual_copy_image" ? Promise.resolve().then(() => answer(cmd)) : fakeTauriInvoke(cmd, args),
  );
  const statuses: string[] = [];
  render(<VisualMenu sessionId="s-1" id="v-0123456789abcdef" kind={kind} sizeOf={() => ({ width: 640, height: 300 })} onStatus={(text) => statuses.push(text)} />);
  const calls = (name: string) => spy.mock.calls.filter(([cmd]) => cmd === name).map(([, args]) => args);
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Visual actions" }));
  return { statuses, calls, open };
}

const names = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

describe("VisualMenu", () => {
  it("offers a copy, the visual's own markup and a picture, in that order", () => {
    expect(menuItemsFor("svg").map((item) => item.label)).toEqual(["Copy as image", "Download as SVG", "Download as PNG"]);
    expect(menuItemsFor("html").map((item) => item.label)).toEqual(["Copy as image", "Download as HTML", "Download as PNG"]);
    const env = setup("svg");
    env.open();
    expect(screen.getByRole("menu", { name: "Visual actions" })).not.toBeNull();
    expect(names()).toEqual(["Copy as image", "Download as SVG", "Download as PNG"]);
  });

  it("offers HTML for an HTML visual", () => {
    const env = setup("html");
    env.open();
    expect(names()).toEqual(["Copy as image", "Download as HTML", "Download as PNG"]);
  });

  it("says on its button whether the menu is open, and closes on Escape with focus back on it", () => {
    const env = setup("svg");
    const button = screen.getByRole("button", { name: "Visual actions" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    env.open();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("saves a picture with ids, a size and a theme, and nothing else", async () => {
    const env = setup("svg");
    env.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download as PNG" }));
    await waitFor(() => expect(env.calls("visual_export")).toHaveLength(1));
    expect(env.calls("visual_export")[0]).toEqual({ sessionId: "s-1", id: "v-0123456789abcdef", format: "png", width: 640, height: 300, theme: "dark" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(env.statuses.at(-1)).toBe("Saved."));
  });

  it("saves the markup in the visual's own format", async () => {
    const env = setup("html");
    env.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download as HTML" }));
    await waitFor(() => expect(env.calls("visual_export")).toHaveLength(1));
    expect(env.calls("visual_export")[0]).toMatchObject({ format: "html" });
  });

  it("says nothing when the save dialog is cancelled", async () => {
    const env = setup("svg", () => false);
    env.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download as SVG" }));
    await waitFor(() => expect(env.calls("visual_export")).toHaveLength(1));
    await waitFor(() => expect(env.statuses.at(-1)).toBe(""));
  });

  it("copies a picture and says so", async () => {
    const env = setup("svg", () => null);
    env.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as image" }));
    await waitFor(() => expect(env.calls("visual_copy_image")).toHaveLength(1));
    expect(env.calls("visual_copy_image")[0]).toEqual({ sessionId: "s-1", id: "v-0123456789abcdef", width: 640, height: 300, theme: "dark" });
    await waitFor(() => expect(env.statuses.at(-1)).toBe("Copied as an image."));
  });

  it("reports a failure in plain words, never the error itself", async () => {
    const env = setup("svg", (cmd) => Promise.reject(cmd === "visual_export" ? "EACCES /Users/test/x.png" : "Zorvo could not copy that visual."));
    env.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Download as PNG" }));
    await waitFor(() => expect(env.statuses.at(-1)).toBe("Zorvo could not save that visual."));
    env.open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy as image" }));
    await waitFor(() => expect(env.statuses.at(-1)).toBe("Zorvo could not copy that visual."));
    expect(env.statuses.join(" ")).not.toContain("EACCES");
  });

  it("keeps the size it sends inside what the backend draws", async () => {
    const spy = vi.spyOn(internals(), "invoke");
    spy.mockClear();
    spy.mockImplementation((cmd, args) => (cmd === "visual_export" ? Promise.resolve(true) : fakeTauriInvoke(cmd, args)));
    render(<VisualMenu sessionId="s-1" id="v-0123456789abcdef" kind="svg" sizeOf={() => ({ width: 120.4, height: 9000 })} onStatus={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Visual actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download as PNG" }));
    await waitFor(() => expect(spy.mock.calls.some(([cmd]) => cmd === "visual_export")).toBe(true));
    const args = spy.mock.calls.find(([cmd]) => cmd === "visual_export")?.[1];
    expect(args).toMatchObject({ width: 200, height: 8000 });
  });
});
