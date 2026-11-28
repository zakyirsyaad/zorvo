import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContinueOutsideTeeDialog } from "../components/private/ContinueOutsideTeeDialog";

const claude = { id: "claude-acp", name: "Claude Code" };
const codex = { id: "codex-acp", name: "Codex" };

describe("ContinueOutsideTeeDialog", () => {
  it("an agent already picked is named and asks no pick", () => {
    const onConfirm = vi.fn();
    render(<ContinueOutsideTeeDialog agents={[claude]} isPicked onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText("Claude Code gets the conversation so far, outside the TEE.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onConfirm).toHaveBeenCalledWith("claude-acp");
  });

  it("Cancel calls onCancel and never onConfirm", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ContinueOutsideTeeDialog agents={[claude]} isPicked onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("with several agents keeps the radio list", () => {
    const onConfirm = vi.fn();
    render(<ContinueOutsideTeeDialog agents={[claude, codex]} onCancel={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onConfirm).toHaveBeenCalledWith("codex-acp");
  });
});
