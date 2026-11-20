import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, act, fireEvent } from "@testing-library/react";
import { AgentStallNotice } from "../components/chat/AgentStallNotice";
import { useAgentFailures } from "../hooks/useAgentFailures";
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
    // A title in fg over a muted sentence, as drawn; only the clock carries the attention colour.
    expect(notice.querySelector("[data-notice-title]")?.className).toContain("text-fg");
    expect(notice.querySelector("[data-notice-body]")?.className).toContain("text-fg-muted");
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

  it("gives a running tool five minutes, then names it", () => {
    const building = reply({ tools: [{ id: "t", name: "pnpm build", kind: "execute", status: "running" }] });
    render(<AgentStallNotice agentName="Claude Code" messages={[question, building]} />);

    act(() => void vi.advanceTimersByTime(5 * 60_000 - 1_000));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => void vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Claude Code has been running one tool for 5 minutes. pnpm build. It may be stuck.",
    );
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

  it('shows OpenCode retry metadata through the failure hook and clears it when the next step starts', () => {
    const { result } = renderHook(() => useAgentFailures());
    const retry = (attempt: number | null) => ({
      sessionUpdate: 'session_info_update',
      _meta: { 'opencode/retry': attempt === null ? null : {
        attempt, nextRetryAt: '2026-11-20T14:59:05.476Z',
        error: { type: 'provider.internal', message: 'Streaming response failed: [500] Internal server error' },
      } },
    });
    act(() => { result.current.observe('s-1', retry(1)); });
    const { rerender } = render(<AgentStallNotice agentName="OpenCode V2" messages={[question]} failures={result.current.failures['s-1']} />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => { result.current.observe('s-1', retry(2)); });
    rerender(<AgentStallNotice agentName="OpenCode V2" messages={[question]} failures={result.current.failures['s-1']} />);
    expect(screen.getByRole('status')).toHaveTextContent("OpenCode V2's requests failed 2 times in a row. Last error: Streaming response failed: [500] Internal server error.");
    act(() => { result.current.observe('s-1', retry(2)); });
    expect(result.current.failures['s-1'].count).toBe(2);

    act(() => { result.current.observe('s-1', retry(null)); });
    rerender(<AgentStallNotice agentName="OpenCode V2" messages={[question]} failures={result.current.failures['s-1']} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("offers Stop, which stops the turn", () => {
    const onStop = vi.fn();
    render(<AgentStallNotice agentName="Qwen Code" messages={[question]} failures={{ count: 2, source: "qwen-lifecycle" }} onStop={onStop} />);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(onStop).toHaveBeenCalledOnce();
  });

  it("offers End agent once a Stop has gone ten seconds without the turn ending", () => {
    const onEndAgent = vi.fn();
    const globbing = reply({ tools: [{ id: "t", name: "Glob: '**/a.png'", kind: "search", status: "running" }] });
    render(
      <AgentStallNotice
        agentName="Qwen Code"
        messages={[question, globbing]}
        stopAskedAt={Date.now()}
        onStop={vi.fn()}
        onEndAgent={onEndAgent}
      />,
    );

    act(() => void vi.advanceTimersByTime(9_000));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => void vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("status")).toHaveTextContent("Qwen Code hasn't stopped.");
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End agent" }));
    expect(onEndAgent).toHaveBeenCalledTimes(1);
  });

  it("keeps the usual notice when nothing can end the agent", () => {
    render(<AgentStallNotice agentName="Qwen Code" messages={[question]} stopAskedAt={Date.now()} />);
    act(() => void vi.advanceTimersByTime(61_000));
    expect(screen.getByRole("status")).toHaveTextContent("Qwen Code hasn't sent anything for 1 minute.");
  });
});
