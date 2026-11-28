import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, callback: Listener) => { listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name)); } }));
import { BrowserPanel } from "../components/browser/BrowserPanel";

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
afterEach(() => { cleanup(); vi.restoreAllMocks(); listeners.clear(); });
const empty = { sessionId: "s1", tabs: [], activeTabId: null };

describe("browser panel", () => {
  it("shows page tabs and keeps browser actions separate from diagnostic tools", async () => {
    const state = { ...empty, tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    vi.spyOn(internals(), "invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Web address" }) as HTMLInputElement).value).toBe("https://example.com/"));
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: "Browser tabs" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Example" })).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Browser engine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
    expect(screen.queryByText("WebKit")).toBeNull();
    expect(screen.queryByText("Console")).toBeNull();
    expect(screen.getByRole("button", { name: "Select an element to comment on" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browser tools" }));
    for (const name of ["Page", "Console", "Debug"]) {
      expect(screen.getByRole("menuitemradio", { name })).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "New tab" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close Example tab" })).not.toBeNull();
  });
  it("hides the native page when a debug panel replaces it and restores the retained box", async () => {
    const state = { sessionId:"s1", tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    const invoke=vi.spyOn(internals(),"invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Web address" }) as HTMLInputElement).value).toBe("https://example.com/"));
    const box=document.querySelector("[data-browser-box]");
    fireEvent.click(screen.getByRole("button",{name:"Browser tools"}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith("browser_bounds",{sessionId:"s1",tabId:"t1",bounds:null,visible:false},undefined));
    fireEvent.click(screen.getByRole("menuitemradio",{name:"Console"}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledWith("browser_bounds",{sessionId:"s1",tabId:"t1",bounds:null,visible:false},undefined));
    expect(document.querySelector("[data-browser-box]")).toBe(box);
    expect(box?.classList.contains("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Back to page"}));
    expect(document.querySelector("[data-browser-box]")).toBe(box);
    expect(box?.classList.contains("hidden")).toBe(false);
  });
  it("rejects search text locally without sending it to a provider", async () => {
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(empty);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.list", engine: "webkit" } }, undefined));
    const address = screen.getByRole("textbox", { name: "Web address" });
    fireEvent.change(address, { target: { value: "google" } });
    await act(async () => { fireEvent.submit(address.closest("form")!); });
    expect(screen.getByRole("alert").textContent).toContain("Search is not configured");
    expect(invoke.mock.calls.some(([,args]) => (args?.args as {operation?:string})?.operation === "tabs.open")).toBe(false);
    expect(invoke.mock.calls.every(([command]) => command.startsWith("browser_") || command.startsWith("plugin:event"))).toBe(true);
  });
  it("hides the native page while site information is open without replacing its box", async () => {
    const state = { ...empty, tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Web address" }) as HTMLInputElement).value).toBe("https://example.com/"));
    const box = document.querySelector("[data-browser-box]");
    fireEvent.click(screen.getByRole("button", { name: "Site information" }));
    expect(screen.getByRole("dialog", { name: "Site information" })).not.toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", { sessionId: "s1", tabId: "t1", bounds: null, visible: false }, undefined));
    fireEvent.click(screen.getByRole("button", { name: "Site information" }));
    expect(screen.queryByRole("dialog", { name: "Site information" })).toBeNull();
    expect(document.querySelector("[data-browser-box]")).toBe(box);
  });
});
