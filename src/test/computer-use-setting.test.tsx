import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComputerUseSetting, type ComputerUseSettingProps } from "../components/settings/ComputerUseSetting";
import { announcementOf, blockerOf, parseComputerUseStatus, type ComputerUseStatus } from "../lib/computer-use";

const READY: ComputerUseStatus = {
  available: true,
  inApplications: true,
  driver: "ready",
  screenRecording: "allowed",
  accessibility: "allowed",
  afterUpdate: false,
  restartHint: false,
};

function show(props: Partial<ComputerUseSettingProps> = {}) {
  const handlers = {
    onChange: vi.fn(),
    onCheck: vi.fn(),
    onOpenPane: vi.fn(),
    onAllowAgain: vi.fn(),
    onRestart: vi.fn(),
  };
  render(<ComputerUseSetting isOn status={READY} isChecking={false} {...handlers} {...props} />);
  return handlers;
}

const toggle = () => screen.getByRole("switch", { name: "Let agents use apps on your Mac" });

describe("parseComputerUseStatus", () => {
  it("reads the backend's answer", () => {
    expect(parseComputerUseStatus({ ...READY })).toEqual(READY);
  });

  it("reads anything unclear as not allowed, and refuses an unknown driver state", () => {
    const odd = parseComputerUseStatus({ driver: "ready", screenRecording: "yes", accessibility: true });
    expect(odd).toMatchObject({ available: false, screenRecording: "not-allowed", accessibility: "not-allowed" });
    expect(parseComputerUseStatus({ driver: "fine" })).toBeNull();
    expect(parseComputerUseStatus(null)).toBeNull();
  });
});

describe("the computer use setting", () => {
  it("shows the switch off with its label and description, and no permission rows", () => {
    const { onChange } = show({ isOn: false });
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(toggle()).toHaveClass("focus-ring");
    expect(
      screen.getByText(
        "An agent asks before it uses each app, once per session. What it sees goes to its model provider. Turning this on applies to sessions you start or reopen from now on.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Screen Recording")).not.toBeInTheDocument();
    fireEvent.click(toggle());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows both permissions allowed, with Check again and no way to System Settings", () => {
    const { onCheck, onChange } = show();
    expect(toggle()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Screen Recording")).toBeInTheDocument();
    expect(screen.getByText("Accessibility")).toBeInTheDocument();
    expect(screen.getAllByText("Allowed")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Open System Settings/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheck).toHaveBeenCalled();
    fireEvent.click(toggle());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("offers System Settings for the permission that is not allowed", () => {
    const { onOpenPane } = show({ status: { ...READY, screenRecording: "not-allowed" } });
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open System Settings for Screen Recording" }));
    expect(onOpenPane).toHaveBeenCalledWith("screen");
    expect(screen.queryByRole("button", { name: "Open System Settings for Accessibility" })).not.toBeInTheDocument();
  });

  it("says to restart after Screen Recording was asked for", () => {
    const { onRestart } = show({ status: { ...READY, screenRecording: "not-allowed", restartHint: true } });
    expect(
      screen.getByText(
        "After you allow Screen Recording, restart Zorvo. If Zorvo is not in the list, add it with the + button.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart Zorvo" }));
    expect(onRestart).toHaveBeenCalled();
  });

  it("offers Allow again after an update took both permissions", () => {
    const status = { ...READY, screenRecording: "not-allowed", accessibility: "not-allowed", afterUpdate: true } as const;
    const { onAllowAgain } = show({ status });
    expect(screen.getByText("macOS no longer recognizes Zorvo's permission after the update.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow again" }));
    expect(onAllowAgain).toHaveBeenCalled();
  });

  it("says to restart to finish an update, and shows no permission rows", () => {
    const { onRestart } = show({ status: { ...READY, driver: "update-pending" } });
    expect(screen.getByText("Restart Zorvo to finish the update.")).toBeInTheDocument();
    expect(screen.queryByText("Screen Recording")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart Zorvo" }));
    expect(onRestart).toHaveBeenCalled();
  });

  it("says the driver was changed, with nothing to press", () => {
    show({ status: { ...READY, driver: "changed" } });
    expect(
      screen.getByText("Zorvo's computer use driver was changed. Reinstall Zorvo to use computer use."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the switch off and disabled outside Applications, even when the setting is saved on", () => {
    show({ status: { ...READY, inApplications: false } });
    expect(toggle()).toBeDisabled();
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Move Zorvo to Applications to use computer use.")).toBeInTheDocument();
  });

  it("says nothing about a blocker while the switch is off", () => {
    show({ isOn: false, status: { ...READY, driver: "changed" } });
    expect(screen.queryByText(/driver was changed/)).not.toBeInTheDocument();
  });

  it("is not drawn off macOS", () => {
    const { container } = render(
      <ComputerUseSetting
        isOn={false}
        status={{ ...READY, available: false }}
        isChecking={false}
        onChange={vi.fn()}
        onCheck={vi.fn()}
        onOpenPane={vi.fn()}
        onAllowAgain={vi.fn()}
        onRestart={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the switch until the backend has answered", () => {
    show({ status: null, isChecking: true });
    expect(toggle()).toBeInTheDocument();
    expect(screen.queryByText("Screen Recording")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking computer use.");
  });

  it("disables Check again while a check runs", () => {
    show({ isChecking: true });
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  });
});

describe("what the group announces", () => {
  it("names the state in few words", () => {
    expect(announcementOf(READY, true, false)).toBe("Computer use is ready.");
    expect(announcementOf(READY, false, false)).toBe("Computer use is off.");
    expect(announcementOf({ ...READY, accessibility: "not-allowed" }, true, false)).toBe("Accessibility not allowed.");
    expect(
      announcementOf({ ...READY, accessibility: "not-allowed", screenRecording: "not-allowed" }, true, false),
    ).toBe("Screen Recording and Accessibility not allowed.");
  });

  it("puts what blocks computer use first", () => {
    expect(blockerOf({ ...READY, inApplications: false, driver: "changed" })).toBe("not-in-applications");
    expect(blockerOf({ ...READY, driver: "missing" })).toBe("driver-missing");
    expect(blockerOf(READY)).toBeNull();
  });
});
