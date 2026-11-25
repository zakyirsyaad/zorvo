import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageRow, type MessageRowProps } from "../components/chat/MessageRow";
import type { NextStepView } from "../components/chat/NextStepBox";
import type { ChatMessage } from "../types";

const reply: ChatMessage = { id: "a-1", role: "agent", content: "Done.", timestamp: 1, isComplete: true, endedNormally: true, nextStep: { recap: "Fixed it." } };
const view: NextStepView = { messageId: "a-1", facts: { changes: { files: 1, added: 3, removed: 0 } }, isSending: false, onPress: vi.fn() };

function renderRow(message: ChatMessage, nextStep: NextStepView | null | undefined) {
  const props: MessageRowProps = {
    message,
    agentName: "Claude Code",
    isLast: true,
    isCurrentTurn: false,
    showActions: true,
    copied: false,
    speaking: false,
    readAloudSupported: false,
    onCopy: vi.fn(),
    onToggleReadAloud: vi.fn(),
    nextStep,
  };
  render(<MessageRow {...props} />);
}

describe("the next step under a reply", () => {
  it("draws the active box under the reply it belongs to", () => {
    renderRow(reply, view);
    expect(screen.getByRole("region", { name: "Next step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled();
  });

  it("draws an earlier box inert", () => {
    renderRow({ ...reply, id: "a-0" }, view);
    expect(screen.getByRole("region", { name: "Next step" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Commit" })).toBeNull();
  });

  it("draws nothing for a turn that did not end normally", () => {
    renderRow({ ...reply, endedNormally: undefined }, view);
    expect(screen.queryByRole("region", { name: "Next step" })).toBeNull();
  });
});
