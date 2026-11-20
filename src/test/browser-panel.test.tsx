import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, callback: Listener) => { listeners.set(name, callback); return Promise.resolve(() => listeners.delete(name)); } }));
import { BrowserPanel } from "../components/browser/BrowserPanel";
import { BrowserTools } from "../components/browser/BrowserTools";
import { useBrowserOpening } from "../hooks/useBrowserOpening";
import { requestBrowserOpen } from "../lib/browser";
import { renderHook } from "@testing-library/react";

const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
afterEach(() => { cleanup(); vi.restoreAllMocks(); listeners.clear(); });
const empty = { sessionId: "s1", tabs: [], activeTabId: null };

describe("browser panel", () => {
  it("shows page tabs and keeps browser actions separate from diagnostic tools", async () => {
    const state = { ...empty, tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    vi.spyOn(internals(), "invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Address or search" }) as HTMLInputElement).value).toBe("https://example.com/"));
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: "Browser tabs" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Example" })).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Browser engine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
    expect(screen.queryByText("WebKit")).toBeNull();
    expect(screen.queryByText("Console")).toBeNull();
    expect(screen.getByRole("button", { name: "Select an element to comment on" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browser tools" }));
    for (const name of ["WebKit", "Chromium debug", "Page", "Console", "Network", "Files", "Performance", "Debug"]) {
      expect(screen.getByRole("menuitemradio", { name })).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "New tab" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close Example tab" })).not.toBeNull();
  });
  it("hides the native page when a debug panel replaces it and restores the retained box", async () => {
    const state = { sessionId:"s1", tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    const invoke=vi.spyOn(internals(),"invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Address or search" }) as HTMLInputElement).value).toBe("https://example.com/"));
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
  it("opens search text as a page without starting an agent or background server", async () => {
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(empty);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.list", engine: "webkit" } }, undefined));
    const address = screen.getByRole("textbox", { name: "Address or search" });
    fireEvent.change(address, { target: { value: "google" } });
    await act(async () => { fireEvent.submit(address.closest("form")!); });
    expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.open", engine: "webkit", url: "https://www.google.com/search?q=google" } }, undefined);
    expect(invoke.mock.calls.every(([command]) => command.startsWith("browser_") || command.startsWith("plugin:event"))).toBe(true);
  });
  it("shows and closes the Chromium tab returned for the active session", async () => {
    let opened = false;
    const state = { ...empty, engine: "chromium", tabs: [{ id: "cdp1", url: "https://example.com/", title: "Debug example", loading: false, canGoBack: false, canGoForward: false }], activeTabId: "cdp1" };
    const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async (_command, input) => {
      const args = (input as { args?: { operation: string; engine: string } })?.args;
      if (args?.engine !== "chromium") return empty;
      if (args.operation === "tabs.open") opened = true;
      if (args.operation === "tabs.close") opened = false;
      return opened ? state : { ...empty, engine: "chromium" };
    });
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browser tools" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Chromium debug" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.list", engine: "chromium" } }, undefined));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New tab" })); });
    expect(screen.getByText("Chromium debugging uses a separate browser window.")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Debug example" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close Debug example tab" })); });
    expect(screen.getByText("Enter an address or search to open a page.")).not.toBeNull();
  });
  it("hides the native page while site information is open without replacing its box", async () => {
    const state = { ...empty, tabs:[{id:"t1",url:"https://example.com/",title:"Example",loading:false,canGoBack:false,canGoForward:false}], activeTabId:"t1" };
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(state);
    render(<BrowserPanel sessionId="s1" onError={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Address or search" }) as HTMLInputElement).value).toBe("https://example.com/"));
    const box = document.querySelector("[data-browser-box]");
    fireEvent.click(screen.getByRole("button", { name: "Site information" }));
    expect(screen.getByRole("dialog", { name: "Site information" })).not.toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_bounds", { sessionId: "s1", tabId: "t1", bounds: null, visible: false }, undefined));
    fireEvent.click(screen.getByRole("button", { name: "Site information" }));
    expect(screen.queryByRole("dialog", { name: "Site information" })).toBeNull();
    expect(document.querySelector("[data-browser-box]")).toBe(box);
  });
  it("uses the manual file approval receipt before transferring files", async () => {
    const execute = vi.fn().mockResolvedValue({ requiresFileApproval: { url: "https://example.com/upload", paths: ["/workspace/report.txt"], approvalId: "approval-1" } });
    const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue({ sent: true });
    render(<BrowserTools panel="files" sessionId="s1" engine="chromium" tabId="t1" execute={execute} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Browser tool action" }), { target: { value: "files.upload" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run" })); });
    expect(screen.getByRole("group", { name: "File transfer permission" }).textContent).toContain("/workspace/report.txt");
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Allow once" })); });
    expect(invoke).toHaveBeenCalledWith("browser_manual_file_permission", { sessionId: "s1", approvalId: "approval-1", allow: true }, undefined);
  });
});

it("opens a right-click link through the active session without ACP", async () => {
  const invoke = vi.spyOn(internals(), "invoke").mockResolvedValue(undefined);
  const show = vi.fn();
  renderHook(() => useBrowserOpening({ sessionId: "s1", show, onError: vi.fn() }));
  await act(async () => requestBrowserOpen("https://example.com/"));
  expect(show).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("browser_execute", { sessionId: "s1", args: { operation: "tabs.open", url: "https://example.com/" } }, undefined);
});
