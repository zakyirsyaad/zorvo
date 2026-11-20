import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { ComputerUseGroup } from "../components/settings/ComputerUseGroup";

const status = (extra: Record<string, unknown> = {}) => ({
  available: true,
  inApplications: true,
  driver: "ready",
  screenRecording: "not-allowed",
  accessibility: "allowed",
  afterUpdate: false,
  restartHint: false,
  ...extra,
});

const commands = () => invoke.mock.calls.map(([command]) => command as string);

function show(isOn: boolean) {
  const handlers = { onChange: vi.fn(), onRestart: vi.fn(), onError: vi.fn() };
  render(<ComputerUseGroup isOn={isOn} {...handlers} />);
  return handlers;
}

describe("the computer use group", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "computer_use_open_pane" ? undefined : status()),
    );
  });

  it("reads the status when it shows and asks macOS nothing", async () => {
    show(true);
    expect(await screen.findByText("Screen Recording")).toBeInTheDocument();
    expect(commands()).toEqual(["computer_use_status"]);
  });

  it("asks macOS for the permissions only when the user turns the switch on", async () => {
    const { onChange } = show(false);
    await waitFor(() => expect(commands()).toEqual(["computer_use_status"]));
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(commands()).toContain("computer_use_request_permissions"));
  });

  it("asks macOS nothing when the switch is turned off", async () => {
    const { onChange } = show(true);
    await screen.findByText("Screen Recording");
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(commands().filter((c) => c === "computer_use_status")).toHaveLength(2));
    expect(commands()).not.toContain("computer_use_request_permissions");
  });

  it("opens the pane by name and reads the status again", async () => {
    show(true);
    fireEvent.click(await screen.findByRole("button", { name: "Open System Settings for Screen Recording" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("computer_use_open_pane", { pane: "screen" }));
    await waitFor(() => expect(commands().filter((c) => c === "computer_use_status")).toHaveLength(2));
  });

  it("reads again when the window gets focus back", async () => {
    show(true);
    await screen.findByText("Screen Recording");
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(commands().filter((c) => c === "computer_use_status")).toHaveLength(2));
  });

  it("reports a status it could not read and keeps the switch usable", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("boom")));
    const { onError } = show(false);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Zorvo could not read the computer use permissions."));
    expect(screen.getByRole("switch")).toBeEnabled();
  });
});
