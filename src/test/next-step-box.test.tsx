import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextStepBox } from "../components/chat/NextStepBox";
import type { NextStepFacts } from "../lib/next-step";

const FACTS: NextStepFacts = { branch: "feat/status-words", changes: { files: 2, added: 42, removed: 11 } };
const STEP = { recap: "Session rows show their status in words.", ask: "Commit this and open a pull request?", pick: "create_pr" as const, replies: ["Not yet"] };

function active(over: Partial<{ facts: NextStepFacts; blockedReason: string; isSending: boolean }> = {}) {
  const onPress = vi.fn();
  return { onPress, view: { messageId: "m-1", facts: FACTS, isSending: false, onPress, ...over } };
}

describe("NextStepBox", () => {
  it("shows the agent's recap, Zorvo's facts, the question and the pick first", () => {
    const { view } = active();
    render(<NextStepBox step={STEP} agentName="Claude Code" view={view} />);
    const box = screen.getByRole("region", { name: "Next step" });
    expect(box.textContent).toContain("Next step");
    expect(box.textContent).toContain("Session rows show their status in words.");
    expect(box.textContent).toContain("feat/status-words");
    expect(box.textContent).toContain("2 files +42 −11");
    expect(box.textContent).toContain("Not committed");
    expect(box.textContent).toContain("Commit this and open a pull request?");
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Create PR", "Commit", "Not yet"]);
    const pick = screen.getByText("Claude Code suggests Create PR");
    expect(buttons[0].getAttribute("aria-describedby")).toBe(pick.id);
  });

  it("sends the pressed button through onPress", () => {
    const { view, onPress } = active();
    render(<NextStepBox step={STEP} agentName="Claude Code" view={view} />);
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(onPress).toHaveBeenCalledWith({ kind: "reply", label: "Not yet", message: "Not yet" });
  });

  it("is Zorvo's alone when the agent left no step", () => {
    const { view } = active();
    render(<NextStepBox agentName="Qwen Code" view={view} />);
    const box = screen.getByRole("region", { name: "Next step" });
    expect(box.textContent).toContain("Qwen Code finished");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Commit", "Create PR"]);
    expect(screen.queryByText(/suggests/)).toBeNull();
  });

  it("draws nothing with no step and no facts", () => {
    const { view } = active({ facts: {} });
    const { container } = render(<NextStepBox agentName="Qwen Code" view={view} />);
    expect(container.innerHTML).toBe("");
  });

  it("disables the message buttons when Send is blocked, and says why", () => {
    const pr = { number: 325, url: "https://github.com/o/r/pull/325", state: "open", checks: { passing: 4, failing: 0, pending: 5 } };
    const { view } = active({ facts: { ...FACTS, pr }, blockedReason: "Sign in to Claude Code to send." });
    render(<NextStepBox step={STEP} agentName="Claude Code" view={view} />);
    expect((screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Not yet" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Open PR" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Sign in to Claude Code to send.")).toBeTruthy();
  });

  it("shows an earlier turn's box inert, with the answer", () => {
    render(<NextStepBox step={{ ...STEP, answered: { label: "Create PR", at: 1 } }} agentName="Claude Code" view={null} />);
    const box = screen.getByRole("region", { name: "Next step" });
    expect(box.textContent).not.toContain("feat/status-words");
    expect(screen.getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(box.textContent).toContain("You answered Create PR");
  });

  it("shows the words only in a popout", () => {
    render(<NextStepBox step={STEP} agentName="Claude Code" view={undefined} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Answer in the main window.")).toBeTruthy();
    expect(screen.getByText("Commit this and open a pull request?")).toBeTruthy();
  });

  it("names the checks of a pull request", () => {
    const pr = { number: 326, url: "u", state: "open", checks: { passing: 4, failing: 0, pending: 5 } };
    const { view } = active({ facts: { pr } });
    render(<NextStepBox agentName="Claude Code" view={view} />);
    expect(screen.getByText("PR #326 · Open")).toBeTruthy();
    expect(screen.getByText("4 of 9 checks done")).toBeTruthy();
  });

  it("spells out control and bidi characters and keeps line breaks", () => {
    const { view } = active();
    render(<NextStepBox step={{ recap: "Line one\nLine \u202e two", ask: "Ok \u202e?", replies: ["No \u202e"] }} agentName="Claude Code" view={view} />);
    const box = screen.getByRole("region", { name: "Next step" });
    expect(box.textContent).not.toContain("\u202e");
    expect(box.textContent).toContain("Line one\nLine");
    expect(box.textContent).toContain("\\u202E");
  });
});
