import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MessageRow, type MessageRowProps } from "../components/chat/MessageRow";
import type { ChatMessage } from "../types";

const report: ChatMessage = {
  id: "u-1",
  role: "user",
  content: "Tests pass on the branch.",
  timestamp: 1,
  delegationReport: { agentName: "Codex", agentId: "codex-acp" },
};

function renderRow(message: ChatMessage) {
  const props: MessageRowProps = {
    message,
    agentName: "Claude Code",
    agentProfileId: "claude-acp",
    isLast: true,
    isCurrentTurn: false,
    showActions: true,
    copied: false,
    speaking: false,
    readAloudSupported: false,
    onCopy: vi.fn(),
    onToggleReadAloud: vi.fn(),
  };
  render(<MessageRow {...props} />);
  return screen.getByTestId(`chat-message-${message.id}`);
}

describe("a delegation report in the chat", () => {
  it("a report that names its worker reads From Codex (worker-2), escaped", () => {
    const row = renderRow({ ...report, delegationReport: { agentName: "Codex", agentId: "codex-acp", handle: "worker-2" } });
    expect(within(row).getByText("From Codex (worker-2)")).toBeInTheDocument();
    const escaped = renderRow({
      ...report,
      id: "u-2",
      delegationReport: { agentName: "Codex", agentId: "codex-acp", handle: "w\u202e1" },
    });
    expect(escaped.textContent).not.toContain("\u202e");
  });

  it("a worker report reads Worker reports with one line per worker, the state as a word", () => {
    const row = renderRow({
      id: "u-9",
      role: "user",
      content: "Reports from your workers.",
      timestamp: 1,
      workerReport: {
        workers: [
          { agentName: "Codex", agentId: "codex-acp", handle: "worker-1", state: "succeeded" },
          { agentName: "Qwen Code", handle: "worker-2", state: "errored" },
          { agentName: "Pi", handle: "w\u202e3", state: "did-not-report" },
          { agentName: "Pi", handle: "worker-4", state: "working" },
        ],
      },
    });
    expect(within(row).getByText("Worker reports")).toBeInTheDocument();
    expect(within(row).getByText("worker-1")).toBeInTheDocument();
    expect(within(row).getByText("Succeeded")).toBeInTheDocument();
    expect(within(row).getByText("Stopped on an error")).toBeInTheDocument();
    expect(within(row).getByText("Did not report")).toBeInTheDocument();
    expect(within(row).getByText("Qwen Code")).toBeInTheDocument();
    expect(row.textContent).not.toContain("\u202e");
    expect(within(row).queryByText("worker-4")).toBeNull();
    expect(within(row).getByText("Reports from your workers.")).toBeInTheDocument();
  });

  it("two rows with one handle both show", () => {
    const row = renderRow({
      id: "u-10",
      role: "user",
      content: "r",
      timestamp: 1,
      workerReport: {
        workers: [
          { agentName: "Codex", handle: "worker-1", state: "succeeded" },
          { agentName: "Pi", handle: "worker-1", state: "failed" },
        ],
      },
    });
    expect(within(row).getAllByText("worker-1")).toHaveLength(2);
  });

  it("a delegation report reads From Codex", () => {
    const row = renderRow(report);
    const label = within(row).getByText("From Codex");
    expect(label).toHaveClass("text-ui-sm", "font-medium", "text-fg");
    const header = label.parentElement as HTMLElement;
    // 10px above the bubble, as the agent's own header sits above its reply.
    expect(header).toHaveClass("mb-2", "gap-2");

    // The logo is decorative: the name next to it says whose it is.
    const logo = header.querySelector("img") as HTMLImageElement | null;
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("width", "14");
    expect(logo).toHaveAttribute("height", "14");

    // Your bubble itself is unchanged.
    const bubble = within(row).getByText("Tests pass on the branch.").closest("[data-selectable-text]") as HTMLElement;
    expect(bubble).toHaveClass(
      "ml-auto",
      "max-w-[80%]",
      "rounded-[14px]",
      "bg-chip",
      "px-3.5",
      "py-2.5",
      "text-body",
      "text-fg",
    );

    // The header sits above the bubble, not inside it.
    expect(bubble.contains(header)).toBe(false);
    expect(bubble.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("leaves a message without a mark without a From line", () => {
    const row = renderRow({ ...report, id: "u-2", delegationReport: undefined });
    expect(within(row).queryByText(/^From /)).toBeNull();
  });

  it("a task another session's agent gave reads Task from Claude Code", () => {
    const row = renderRow({
      id: "u-2",
      role: "user",
      content: "Review the parser change.",
      timestamp: 2,
      delegationTask: { agentName: "Claude Code", agentId: "claude-acp" },
    });
    const label = within(row).getByText("Task from Claude Code");
    expect(label).toHaveClass("text-ui-sm", "font-medium", "text-fg");
    expect(within(row).queryByText(/^From /)).toBeNull();
  });
});
