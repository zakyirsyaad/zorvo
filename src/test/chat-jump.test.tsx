import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ChatCanvas, type ChatMessage } from "../components/ChatCanvas";

const message = (id: string, content: string): ChatMessage => ({ id, role: "agent", content, timestamp: 1 });
const MESSAGES = [message("m-1", "first"), message("m-2", "second")];

describe("jumping to a message", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    scrollIntoView.mockClear();
  });

  it("brings the message into view and moves focus to it", () => {
    render(<ChatCanvas conversationId="s-1" messages={MESSAGES} jumpTo={{ messageId: "m-1", nonce: 1 }} />);
    const target = document.getElementById("message-m-1");
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(target);
  });

  it("stops following, so new output does not pull the view back", () => {
    const { rerender } = render(<ChatCanvas conversationId="s-1" messages={MESSAGES} jumpTo={{ messageId: "m-1", nonce: 1 }} />);
    const container = screen.getByTestId("chat-canvas-container");
    Object.defineProperty(container, "scrollHeight", { value: 5000, configurable: true });
    container.scrollTop = 100;
    act(() => {
      rerender(
        <ChatCanvas conversationId="s-1" messages={[...MESSAGES, message("m-3", "third")]} jumpTo={{ messageId: "m-1", nonce: 1 }} />,
      );
    });
    expect(container.scrollTop).toBe(100);
  });

  it("jumps again to the same message", () => {
    const { rerender } = render(<ChatCanvas conversationId="s-1" messages={MESSAGES} jumpTo={{ messageId: "m-1", nonce: 1 }} />);
    rerender(<ChatCanvas conversationId="s-1" messages={MESSAGES} jumpTo={{ messageId: "m-1", nonce: 2 }} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a jump", () => {
    render(<ChatCanvas conversationId="s-1" messages={MESSAGES} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
