import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SessionAgentPicker, type SessionAgentPickerProps } from "../components/composer/SessionAgentPicker";
import type { SwitchTarget } from "../lib/agent-switch";

const row = (id: string, name: string, over: Partial<SwitchTarget> = {}): SwitchTarget => ({
  id,
  name,
  isSource: false,
  status: "ready",
  word: "Ready",
  isDisabled: false,
  ...over,
});

const TARGETS: SwitchTarget[] = [
  row("qwen-code", "Qwen Code", { isSource: true, word: "This session" }),
  row("claude-acp", "Claude Code"),
  row("kimi", "Kimi CLI", { status: "not-installed", word: "Not installed", isDisabled: true }),
];

function Harness(props: Omit<SessionAgentPickerProps, "isOpen" | "onToggle" | "onClose">) {
  const [isOpen, setIsOpen] = useState(false);
  return <SessionAgentPicker {...props} isOpen={isOpen} onToggle={() => setIsOpen((open) => !open)} onClose={() => setIsOpen(false)} />;
}

const renderPicker = (over: Partial<SessionAgentPickerProps> = {}) => {
  const onPick = vi.fn();
  render(<Harness targets={TARGETS} pickedId="qwen-code" isPrivate={false} onPick={onPick} {...over} />);
  return onPick;
};

describe("SessionAgentPicker", () => {
  it("names the picked agent on a menu button", () => {
    renderPicker({ pickedId: "claude-acp" });

    const trigger = screen.getByRole("button", { name: "Agent: Claude Code" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  });

  it("lists the agents as radio rows with the pick checked, its header and footer", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Agent: Qwen Code" }));

    const rows = screen.getAllByRole("menuitemradio");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    expect(rows[1]).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Continue in a new session with")).toBeInTheDocument();
    expect(screen.getByText("This conversation goes with it. This session stays as it is.")).toBeInTheDocument();
    expect(rows[0]).toHaveFocus();
  });

  it("a private session's header says outside the TEE and the other rows end in an ellipsis", () => {
    renderPicker({ isPrivate: true });

    fireEvent.click(screen.getByRole("button", { name: "Agent: Qwen Code" }));

    expect(screen.getByText("Continue outside the TEE with")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Claude Code…/ })).toBeInTheDocument();
  });

  it("picks a row and leaves a disabled one alone", () => {
    const onPick = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Agent: Qwen Code" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Kimi CLI/ }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Claude Code/ }));

    expect(onPick).toHaveBeenCalledWith("claude-acp");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("with a reason the trigger is disabled and described by it", () => {
    renderPicker({ disabledReason: "Send or clear the review comments first." });

    const trigger = screen.getByRole("button", { name: "Agent: Qwen Code" });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAccessibleDescription("Send or clear the review comments first.");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
