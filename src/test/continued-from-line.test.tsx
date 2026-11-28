import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContinuedFromLine } from "../components/chat/ContinuedFromLine";
import { MessageRow, type MessageRowProps } from "../components/chat/MessageRow";
import type { ChatMessage } from "../types";

describe("ContinuedFromLine", () => {
  it("names the agent and links the source session", () => {
    const onOpenSource = vi.fn();
    render(<ContinuedFromLine agentName="Claude Code" sourceName="Fix login bug" onOpenSource={onOpenSource} />);

    expect(screen.getByRole("note")).toHaveTextContent("Continued with Claude Code from Fix login bug");
    fireEvent.click(screen.getByRole("button", { name: "Fix login bug" }));
    expect(onOpenSource).toHaveBeenCalled();
  });

  it("a deleted source reads as text with no link", () => {
    render(<ContinuedFromLine agentName="Claude Code" sourceName={null} />);

    expect(screen.getByRole("note")).toHaveTextContent("Continued with Claude Code from a deleted session");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the line in the chat", () => {
  const props = (message: ChatMessage): MessageRowProps => ({
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
    continuedFromOf: () => ({ agentName: "Claude Code", sourceName: "Fix login bug" }),
  });

  it("shows above a message marked continuedFrom", () => {
    const message = { id: "u-1", role: "user", content: "Fix it", timestamp: 1, continuedFrom: { sessionId: "s-1", agentId: "qwen-code" } } as ChatMessage;
    render(<MessageRow {...props(message)} />);

    expect(screen.getByRole("note")).toHaveTextContent("Continued with Claude Code from Fix login bug");
  });

  it("is absent above an unmarked message", () => {
    const message = { id: "u-2", role: "user", content: "Hi", timestamp: 1 } as ChatMessage;
    render(<MessageRow {...props(message)} />);

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
