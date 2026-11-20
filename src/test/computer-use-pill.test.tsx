import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

type Listener = (event: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: Listener) => {
    listeners.set(event, cb);
    return Promise.resolve(() => listeners.delete(event));
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { ComputerUsePill, parseActivity } from "../components/computer-use/ComputerUsePill";
import { readWindowMode } from "../lib/window-mode";

const USING = { sessionId: "s-1", agentName: "Qwen Code", app: "Notes", fullScreen: false };

afterEach(() => {
  listeners.clear();
  invoke.mockReset();
});

const emit = (payload: unknown) => act(() => listeners.get("computer-use-activity")?.({ payload }));

describe("the computer-use pill", () => {
  it("is the page of index.html?pill=1", () => {
    expect(readWindowMode("?pill=1")).toEqual({ kind: "pill" });
    expect(readWindowMode("?pill=0")).toEqual({ kind: "main" });
  });

  it("says who uses which app, from the newest action known when it loads", async () => {
    invoke.mockResolvedValue(USING);
    render(<ComputerUsePill />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Qwen Code is using Notes"));
    expect(invoke).toHaveBeenCalledWith("computer_use_pill_state");
  });

  it("follows each action, and says when the screen is controlled", async () => {
    invoke.mockResolvedValue(null);
    render(<ComputerUsePill />);
    await waitFor(() => expect(listeners.has("computer-use-activity")).toBe(true));
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();

    emit(USING);
    expect(screen.getByRole("status")).toHaveTextContent("Qwen Code is using Notes");
    emit({ ...USING, agentName: "Codex", fullScreen: true });
    expect(screen.getByRole("status")).toHaveTextContent("Codex is controlling your screen");
  });

  it("stops that session's computer use", async () => {
    invoke.mockResolvedValue(null);
    render(<ComputerUsePill />);
    await waitFor(() => expect(listeners.has("computer-use-activity")).toBe(true));
    emit(USING);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(invoke).toHaveBeenCalledWith("computer_use_revoke", { sessionId: "s-1" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("drops an action that is not whole and shows odd characters as text", () => {
    expect(parseActivity({ sessionId: "s-1", agentName: "Qwen Code" })).toBeNull();
    expect(parseActivity({ ...USING, app: "Notes‮" })?.app).not.toContain("‮");
  });
});
