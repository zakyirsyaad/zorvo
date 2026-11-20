import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComputerUseStatusLine } from "../components/chat/ComputerUseStatusLine";
import type { ComputerUseGrant } from "../lib/computer-use-card";

const GRANT: ComputerUseGrant = {
  sessionId: "s-1",
  apps: [
    { name: "Notes", tier: "full" },
    { name: "Simulator", tier: "full" },
  ],
  fullScreen: false,
};

describe("the computer-use status line", () => {
  it("lists the session's apps and stops computer use", () => {
    const onStop = vi.fn();
    render(<ComputerUseStatusLine grant={GRANT} onStop={onStop} />);
    expect(screen.getByRole("status")).toHaveTextContent("Using Notes, Simulator");
    fireEvent.click(screen.getByRole("button", { name: "Stop computer use" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("says the screen is controlled while full screen runs", () => {
    render(<ComputerUseStatusLine grant={{ ...GRANT, fullScreen: true }} onStop={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Controlling your screen");
  });

  it("keeps an empty status region while the session holds no grant", () => {
    render(<ComputerUseStatusLine grant={undefined} onStop={() => {}} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no Stop where the window cannot stop it", () => {
    render(<ComputerUseStatusLine grant={GRANT} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
