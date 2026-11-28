import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackgroundAgentsNotice } from "../components/chat/BackgroundAgentsNotice";
import type { AgentTask } from "../lib/agent-tasks";

const MIN = 60_000;
const working = (id: string, lastActivityAt: number): AgentTask => ({
  id, label: id, description: "", status: "working", isBackground: true, activities: [], startedAt: 0, lastActivityAt,
});

describe("BackgroundAgentsNotice", () => {
  it("says one agent has been quiet, with no button", () => {
    render(<BackgroundAgentsNotice agentName="Qwen Code" tasks={[working("a", 0)]} asOf={55 * MIN} />);
    expect(screen.getByText("A background agent of Qwen Code has not reported anything for 55 minutes.")).toBeTruthy();
    expect(screen.getByText("It may be waiting on the model or running a long tool. Send a message to check.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts several and gives the longest time", () => {
    render(<BackgroundAgentsNotice agentName="Qwen Code" tasks={[working("a", 0), working("b", 20 * MIN), working("c", 59 * MIN)]} asOf={60 * MIN} />);
    expect(screen.getByText("2 of Qwen Code's background agents have not reported anything for 60 minutes.")).toBeTruthy();
  });

  it("keeps its live region's text the same while the minutes change, and never leaves the count to sighted users alone", () => {
    const { rerender } = render(<BackgroundAgentsNotice agentName="Qwen Code" tasks={[working("a", 0)]} asOf={55 * MIN} />);
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Qwen Code's background agents have gone quiet.");
    const before = live.textContent;
    rerender(<BackgroundAgentsNotice agentName="Qwen Code" tasks={[working("a", 0)]} asOf={56 * MIN} />);
    expect(screen.getByRole("status").textContent).toBe(before);
    expect(screen.getByRole("status")).not.toHaveTextContent("minutes");
    // The sentence with the count is in the page, outside the live region and not hidden.
    const sentence = screen.getByText("A background agent of Qwen Code has not reported anything for 56 minutes.");
    expect(screen.getByRole("status")).not.toContainElement(sentence);
    expect(sentence.closest("[aria-hidden='true']")).toBeNull();
  });

  it("does not name the agent when it is not known", () => {
    render(<BackgroundAgentsNotice tasks={[working("a", 0)]} asOf={55 * MIN} />);
    expect(screen.getByRole("status")).toHaveTextContent("Background agents have gone quiet.");
    expect(screen.getByText("A background agent has not reported anything for 55 minutes.")).toBeTruthy();
  });

  it("shows nothing while no agent is quiet", () => {
    render(<BackgroundAgentsNotice agentName="Qwen Code" tasks={[working("a", 58 * MIN)]} asOf={60 * MIN} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the notice in the chat", () => {
  const reply = { id: "m-1", role: "agent" as const, content: "Done.", timestamp: 1, isComplete: true };
  const tasks = { asOf: 55 * MIN, tasks: [working("a", 0)], more: 0 };

  it("shows under an idle session and gives way to the stall notice while a turn runs", async () => {
    const { ChatCanvas } = await import("../components/ChatCanvas");
    const { rerender } = render(<ChatCanvas messages={[reply]} agentName="Qwen Code" agentTasks={tasks} />);
    expect(screen.getByText("A background agent of Qwen Code has not reported anything for 55 minutes.")).toBeTruthy();
    rerender(<ChatCanvas messages={[reply]} agentName="Qwen Code" agentTasks={tasks} isWorking />);
    expect(screen.queryByText(/background agent of Qwen Code/)).toBeNull();
  });

  it("is not shown while a permission card waits for the user", async () => {
    const { ChatCanvas } = await import("../components/ChatCanvas");
    const waiting = {
      ...reply,
      isComplete: false,
      actionCard: {
        id: "c1", sessionId: "s-1", title: "Run it?", prompt: "Run it?", status: "pending", timestamp: 1, requestId: 1,
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      },
    } as unknown as typeof reply;
    render(<ChatCanvas messages={[waiting]} agentName="Qwen Code" agentTasks={tasks} />);
    expect(screen.queryByText(/background agent of Qwen Code/)).toBeNull();
  });

  it("counts only the agents the overview card shows, not one a foreground subagent already shows", async () => {
    const { ChatCanvas } = await import("../components/ChatCanvas");
    const foreground = { id: "call_1", name: "Explore", status: "running", steps: [] };
    const message = { ...reply, isComplete: false, tools: [foreground] } as unknown as typeof reply;
    const dup = { ...working("dup", 0), toolUseId: "call_1" };
    render(<ChatCanvas messages={[message]} agentName="Qwen Code" agentTasks={{ asOf: 55 * MIN, tasks: [dup], more: 0 }} />);
    expect(screen.queryByText(/background agent/)).toBeNull();
  });

  it("shows nothing without tasks", async () => {
    const { ChatCanvas } = await import("../components/ChatCanvas");
    render(<ChatCanvas messages={[reply]} agentName="Qwen Code" agentTasks={null} />);
    expect(screen.queryByText(/background agent/)).toBeNull();
  });
});
