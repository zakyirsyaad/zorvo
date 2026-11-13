import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MessageRow, type MessageRowProps } from "../components/chat/MessageRow";
import { SelectionToolbar } from "../components/chat/SelectionToolbar";
import type { ChatMessage } from "../components/ChatCanvas";
import type { ActionCard } from "../types";

const HOUR_AGO = Date.now() - 60 * 60 * 1000;

function renderRow(message: ChatMessage, overrides: Partial<MessageRowProps> = {}) {
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
    onFork: vi.fn(),
    onRewind: vi.fn(),
    onToggleReadAloud: vi.fn(),
    ...overrides,
  };
  render(<MessageRow {...props} />);
  return screen.getByTestId(`chat-message-${message.id}`);
}

const mine: ChatMessage = { id: "u-1", role: "user", content: "Show the status as words.", timestamp: HOUR_AGO };
const reply: ChatMessage = { id: "a-1", role: "agent", content: "Updating the row now.", timestamp: HOUR_AGO, isComplete: true };

describe("messages, as drawn", () => {
  it("draws your message as a 12px-radius bubble, with no time under it", () => {
    const row = renderRow(mine);
    const bubble = within(row).getByText("Show the status as words.").closest("[data-selectable-text]") as HTMLElement;
    expect(bubble).toHaveClass("px-3.5", "py-2.5", "rounded-xl", "border-border", "bg-surface-2", "text-body", "text-fg", "max-w-[80%]");
    expect(within(row).queryByText("1 hour ago")).toBeNull();
    // The time is not lost: the bubble's tooltip says it.
    expect(bubble.getAttribute("title")).toBe("1 hour ago");
    expect(within(row).getByRole("button", { name: "Copy message" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Rewind to here" })).toBeInTheDocument();
  });

  it("heads the agent's reply with its tile, its name at 12px/500 and the time in fg-subtle", () => {
    const row = renderRow(reply);
    const name = within(row).getByText("Claude Code");
    expect(name).toHaveClass("text-ui-sm", "font-medium", "text-fg");
    expect(name.previousElementSibling).toHaveClass("size-[22px]", "bg-chip");
    expect(within(row).getByText("1 hour ago")).toHaveClass("text-caption", "text-fg-subtle");
    const header = name.parentElement as HTMLElement;
    expect(header).toHaveClass("gap-2", "mb-2");
  });

  it("fills an ended reply with surface-2 on hover, with its actions as 24px secondary icons", () => {
    const row = renderRow(reply);
    const body = row.querySelector("[data-message-body]") as HTMLElement;
    expect(body).toHaveClass("group-hover:bg-surface-2", "p-3", "-mx-3", "rounded-[10px]");
    const actions = within(row).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(actions).toEqual(["Copy message", "Fork from here"]);
    for (const button of within(row).getAllByRole("button")) {
      expect(button).toHaveClass("h-7", "w-7", "text-fg-secondary");
    }
  });

  it("puts no hover fill on a reply whose card still waits for an answer", () => {
    const card: ActionCard = {
      id: "c-1",
      sessionId: "s-1",
      title: "Permission requested",
      prompt: "Edit src/main.ts",
      status: "pending",
      timestamp: HOUR_AGO,
      requestId: 1,
      options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
    };
    const row = renderRow({ ...reply, isComplete: false, actionCard: card }, { showActions: false });
    expect(row.querySelector(".group-hover\\:bg-surface-2")).toBeNull();
    expect(screen.getByTestId("action-card-c-1").className).not.toContain("bg-surface-1");
  });
});

describe("the Reply toolbar, as drawn", () => {
  it("is a 2px-padded panel with a 28px Reply in fg", () => {
    render(<SelectionToolbar selection={{ text: "status words", isCode: false, rect: null }} onReply={vi.fn()} />);
    const toolbar = screen.getByRole("toolbar", { name: "Selected text" });
    expect(toolbar).toHaveClass("p-0.5", "rounded-lg", "border-border", "bg-surface-3", "shadow-popover");
    const reply = within(toolbar).getByRole("button", { name: "Reply" });
    expect(reply).toHaveClass("h-7", "font-normal");
    // The canvas draws Reply at 13px, so the label carries the size a 28px button no longer has.
    expect(within(reply).getByText("Reply")).toHaveClass("text-ui", "text-fg");
  });
});
