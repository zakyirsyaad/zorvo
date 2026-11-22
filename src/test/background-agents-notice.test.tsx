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
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("A background agent of Qwen Code has not reported anything for 55 minutes.");
    expect(notice).toHaveTextContent("They may be waiting on the model. Send a message to check, or stop them from Qwen Code.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts several and gives the longest time", () => {
    render(<BackgroundAgentsNotice agentName="Qwen Code" tasks={[working("a", 0), working("b", 20 * MIN), working("c", 59 * MIN)]} asOf={60 * MIN} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 of Qwen Code's background agents have not reported anything for 60 minutes.");
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
    expect(screen.getByRole("status")).toHaveTextContent("A background agent of Qwen Code has not reported anything for 55 minutes.");
    rerender(<ChatCanvas messages={[reply]} agentName="Qwen Code" agentTasks={tasks} isWorking />);
    expect(screen.queryByText(/background agent of Qwen Code/)).toBeNull();
  });

  it("shows nothing without tasks", async () => {
    const { ChatCanvas } = await import("../components/ChatCanvas");
    render(<ChatCanvas messages={[reply]} agentName="Qwen Code" agentTasks={null} />);
    expect(screen.queryByText(/background agent/)).toBeNull();
  });
});
