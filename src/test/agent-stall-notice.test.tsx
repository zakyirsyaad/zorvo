import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { AgentStallNotice } from "../components/chat/AgentStallNotice";
import type { ChatMessage } from "../types";

const question: ChatMessage = { id: "u-1", role: "user", content: "Reply with just the word OK.", timestamp: 1 };

function reply(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: "a-1", role: "agent", content: "", timestamp: 2, ...overrides };
}

describe("AgentStallNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing for the first minute, then that the agent has sent nothing", () => {
    render(<AgentStallNotice agentName="Gemini CLI" messages={[question]} />);

    act(() => void vi.advanceTimersByTime(59_000));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => void vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status")).toHaveTextContent("Gemini CLI hasn't sent anything for 1 minute.");
  });

  it("says the agent may be stuck, as a quiet notice, not an alert", () => {
    render(<AgentStallNotice agentName="Qwen Code" messages={[question]} />);
    act(() => void vi.advanceTimersByTime(121_000));
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Qwen Code hasn't sent anything for 2 minutes. It may be stuck.");
    // The words in fg-secondary on surface-1, as drawn; only the clock carries the attention colour.
    expect(notice.querySelector("span")?.className).toContain("text-fg-secondary");
    expect(notice.className).not.toContain("bg-attention-surface");
  });

  it("starts counting again when the agent sends something, and hides the notice", () => {
    const { rerender } = render(<AgentStallNotice agentName="Gemini CLI" messages={[question]} />);
    act(() => void vi.advanceTimersByTime(61_000));
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(<AgentStallNotice agentName="Gemini CLI" messages={[question, reply({ content: "O" })]} />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => void vi.advanceTimersByTime(59_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays quiet while a tool runs, however long it takes", () => {
    const building = reply({ tools: [{ id: "t", name: "pnpm build", kind: "execute", status: "running" }] });
    render(<AgentStallNotice agentName="Claude Code" messages={[question, building]} />);

    act(() => void vi.advanceTimersByTime(10 * 60_000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the agent's failed requests at once, with the error it reported", () => {
    render(
      <AgentStallNotice
        agentName="Qwen Code"
        messages={[question]}
        failures={{ count: 3, source: "qwen-lifecycle", model: "deepseek-v4.1-flash-1017", detail: "429 Your token-plan quota has been exhausted." }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Qwen Code's requests to deepseek-v4.1-flash-1017 failed 3 times in a row. Last error: 429 Your token-plan quota has been exhausted.",
    );
  });

  it("offers Stop, which stops the turn", () => {
    const onStop = vi.fn();
    render(<AgentStallNotice agentName="Qwen Code" messages={[question]} failures={{ count: 2, source: "qwen-lifecycle" }} onStop={onStop} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(onStop).toHaveBeenCalledOnce();
  });
});
