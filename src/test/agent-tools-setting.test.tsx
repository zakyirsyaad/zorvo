import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentToolsSetting } from "../components/settings/AgentToolsSetting";
import { normalizePersistedState } from "../lib/persistence";

describe("the agent tools setting", () => {
  it("reads agentTools as on unless it is false", () => {
    const settingsOf = (settings: Record<string, unknown>) =>
      normalizePersistedState({ version: 2, settings, recentFolders: [], sessions: [] }).settings;
    expect(settingsOf({}).agentTools).toBe(true);
    expect(settingsOf({ agentTools: true }).agentTools).toBe(true);
    expect(settingsOf({ agentTools: "no" }).agentTools).toBe(true);
    expect(settingsOf({ agentTools: false }).agentTools).toBe(false);
  });

  it("shows the switch with its label, its state and when a change applies", () => {
    render(<AgentToolsSetting isOn onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch", { name: "Let agents delegate and open sessions" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveClass("focus-ring");
    expect(
      screen.getByText("An agent asks first in each session. Applies to sessions you start or reopen from now on."),
    ).toBeInTheDocument();
  });

  it("asks to change to the other state", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AgentToolsSetting isOn onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);

    rerender(<AgentToolsSetting isOn={false} onChange={onChange} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});
