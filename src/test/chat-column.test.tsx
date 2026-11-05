import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatCanvas, type ChatMessage } from "../components/ChatCanvas";
import { HistoryElsewhereNote } from "../components/chat/HistoryElsewhereNote";

const SRC = join(__dirname, "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const reply: ChatMessage = { id: "m-1", role: "agent", content: "Done.", timestamp: 1, isComplete: true };

describe("the chat column, as drawn", () => {
  it("pads the canvas 32px at the top, 24px at the sides and 16px at the bottom, with 24px between messages", () => {
    render(<ChatCanvas messages={[reply]} header={<p>head</p>} footer={<p>foot</p>} />);
    const canvas = screen.getByTestId("chat-canvas-container");
    expect(canvas).toHaveClass("pt-8", "px-6", "pb-4", "space-y-6");
    expect(screen.getByText("head").parentElement).toHaveClass("max-w-chat");
    expect(screen.getByText("foot").parentElement).toHaveClass("max-w-chat");
    expect(screen.getByTestId("chat-message-m-1")).toHaveClass("max-w-chat");
  });

  it("keeps every part of the column 680px wide", () => {
    const files = [
      "components/ChatCanvas.tsx",
      "components/chat/MessageRow.tsx",
      "components/chat/ReplyExtras.tsx",
      "components/chat/AgentStallNotice.tsx",
      "components/FailedTurnBanner.tsx",
      "components/ComposerDock.tsx",
      "components/RemovedAgentPanel.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toContain("max-w-3xl");
      expect(source, file).toContain("max-w-chat");
    }
  });

  it("defines the column, the selection colour and the terminal text as tokens", () => {
    const css = read("styles/globals.css");
    expect(css).toContain("--container-chat: 680px;");
    expect(css).toContain("--color-selection: rgba(161, 161, 170, 0.32);");
    expect(css).toContain("--color-terminal-fg: #d4d4d8;");
    expect(css).toMatch(/::selection\s*\{[^}]*var\(--color-selection\)/);
  });

  it("says an imported session's history stays in the agent as a quiet line, not a card", () => {
    render(<HistoryElsewhereNote agentName="Claude Code" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Earlier messages stay in Claude Code.");
    expect(note).toHaveClass("text-ui-sm", "text-fg-muted");
    expect(note.closest(".rounded-xl")).toBeNull();
  });
});
