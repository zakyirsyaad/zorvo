import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserPanel } from "../components/browser/BrowserPanel";

vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("runs page zoom, copies and opens the actual URL, and clears only saved visits", async () => {
  const page = { id: "t1", url: "https://example.com/", title: "Example", loading: false, canGoBack: false, canGoForward: false, zoomFactor: 1 };
  let state = { sessionId: "s1", tabs: [page], activeTabId: "t1" };
  let visits = [{ url: page.url, title: page.title, visitedAt: 123 }];
  const invoke = vi.spyOn(internals(), "invoke").mockImplementation(async (command, input) => {
    if (command === "browser_history") return visits;
    if (command === "browser_history_clear") { visits = []; return []; }
    if (command === "browser_zoom") { page.zoomFactor = input?.action === "reset" ? 1 : 1.25; return { zoomFactor: page.zoomFactor }; }
    if (command === "browser_new_tab") {
      state = { ...state, tabs: [...state.tabs, { ...page, id: "t2", url: "about:blank", title: "New tab", zoomFactor: 1 }], activeTabId: "t2" };
    }
    return state;
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const onError = vi.fn();
  render(<BrowserPanel sessionId="s1" onError={onError} />);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Example" })).not.toBeNull());
  const choose = async (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Browser options" }));
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name })); });
  };
  await choose("Zoom in");
  expect(invoke).toHaveBeenCalledWith("browser_zoom", { sessionId: "s1", tabId: "t1", action: "in" }, undefined);
  await waitFor(() => expect(screen.getByRole("button", { name: "Reset page zoom (125%)" })).not.toBeNull());
  await choose("Reset zoom");
  expect(invoke).toHaveBeenCalledWith("browser_zoom", { sessionId: "s1", tabId: "t1", action: "reset" }, undefined);
  await choose("Copy link");
  expect(writeText).toHaveBeenCalledWith(page.url);
  await choose("Open in browser");
  expect(invoke).toHaveBeenCalledWith("open_external_url", { url: page.url }, undefined);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New tab" })); });
  expect(invoke).toHaveBeenCalledWith("browser_new_tab", { sessionId: "s1" }, undefined);
  await waitFor(() => expect(screen.getByRole("tab", { name: "New tab" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByText("Recent pages")).not.toBeNull();
  await choose("Clear history");
  expect(invoke).toHaveBeenCalledWith("browser_history_clear", {}, undefined);
  expect(screen.queryByText("Recent pages")).toBeNull();
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(invoke.mock.calls.some(([command]) => command === "browser_site_clear")).toBe(false);
  expect(onError).not.toHaveBeenCalled();
});
