import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TopBar } from "../components/TopBar";
import type { PlanEntry } from "../types";

const PLAN: PlanEntry[] = [
  { content: "Read the parser", status: "completed" },
  { content: "Check the tokens", status: "completed" },
  { content: "Split it in two", status: "in_progress" },
  { content: "Run the tests", status: "pending" },
];

describe("the plan in the top bar", () => {
  it("shows the plan as a chip with its progress", () => {
    render(<TopBar plan={PLAN} />);

    const chip = screen.getByRole("button", { name: "Plan, 2 of 4 done" });
    expect(chip.textContent).toBe("Plan 2/4");
  });

  it("opens the steps from the agent", () => {
    render(<TopBar plan={PLAN} planSource="Claude Code" />);

    fireEvent.click(screen.getByRole("button", { name: "Plan, 2 of 4 done" }));
    const dialog = within(screen.getByRole("dialog", { name: "Plan" }));
    expect(dialog.getByText("Plan from Claude Code")).toBeDefined();
    expect(dialog.getByText("2 of 4 done")).toBeDefined();
    expect(dialog.getAllByLabelText("Done")).toHaveLength(2);
    expect(dialog.getAllByLabelText("In progress")).toHaveLength(1);
    expect(dialog.getAllByLabelText("Not started")).toHaveLength(1);
    expect(dialog.getByText("Split it in two")).toBeDefined();
  });

  it("names no agent when it does not know which one", () => {
    render(<TopBar plan={PLAN} />);
    fireEvent.click(screen.getByRole("button", { name: "Plan, 2 of 4 done" }));
    const dialog = within(screen.getByRole("dialog", { name: "Plan" }));
    expect(dialog.queryByText(/Plan from/)).toBeNull();
  });

  it("closes on Escape and keeps focus on the chip", () => {
    render(<TopBar plan={PLAN} />);
    const chip = screen.getByRole("button", { name: "Plan, 2 of 4 done" });
    chip.focus();
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Plan" })).toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(chip);
  });

  it("stays hidden when the session has no plan", () => {
    render(<TopBar />);

    expect(screen.queryByRole("button", { name: /^Plan/ })).toBeNull();
  });

  it("follows a new plan", () => {
    const { rerender } = render(<TopBar plan={PLAN} />);

    rerender(
      <TopBar
        plan={[
          { content: "Read the parser", status: "completed" },
          { content: "Split it in two", status: "completed" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Plan, 2 of 2 done" })).toBeDefined();
  });
});
