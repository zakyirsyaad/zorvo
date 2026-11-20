import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ArtifactCardRow } from "../components/chat/ArtifactCardRow";
import { MessageRow } from "../components/chat/MessageRow";
import type { ChatMessage } from "../types";

const CARD = { artifactId: "a-0123456789abcdef", title: "Session list performance", version: 2 };

describe("the artifact card", () => {
  it("names the page and its version, and opens that version", () => {
    const onOpen = vi.fn();
    render(<ArtifactCardRow card={CARD} state="open" onOpen={onOpen} />);

    expect(screen.getByText("Session list performance")).toBeTruthy();
    expect(screen.getByText("Version 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Session list performance, version 2" }));
    expect(onOpen).toHaveBeenCalledWith(CARD);
  });

  it("reads Removed, with no button, once the artifact is deleted", () => {
    render(<ArtifactCardRow card={CARD} state="removed" onOpen={vi.fn()} />);
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws a canvas card in the chat", () => {
    const onOpen = vi.fn();
    const canvas = { kind: "canvas" as const, canvasKey: "c-0123456789abcdef", title: "Checkout", artboards: 12 };
    const { container } = render(<ArtifactCardRow card={canvas} state="open" onOpen={onOpen} />);
    expect(container.querySelector('[data-mark="canvas"]')).not.toBeNull();

    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("Canvas · 12 artboards")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the canvas Checkout" }));
    expect(onOpen).toHaveBeenCalledWith(canvas);
  });

  it("has no button where nothing can open it", () => {
    render(<ArtifactCardRow card={CARD} state="open" />);
    expect(screen.getByText("Session list performance")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a message that showed a page", () => {
  const message: ChatMessage = { id: "m-1", role: "agent", content: "", timestamp: 1, isComplete: true, artifactCard: CARD };
  const row = (extra: Partial<Parameters<typeof MessageRow>[0]> = {}) => (
    <MessageRow
      message={message}
      agentName="Claude Code"
      isLast
      isCurrentTurn={false}
      showActions={false}
      copied={false}
      speaking={false}
      readAloudSupported={false}
      onCopy={() => undefined}
      onToggleReadAloud={() => undefined}
      {...extra}
    />
  );

  it("carries the card, open while its artifact exists", () => {
    const onOpenArtifact = vi.fn();
    render(row({ artifactIds: new Set([CARD.artifactId]), onOpenArtifact }));
    fireEvent.click(screen.getByRole("button", { name: /Open Session list performance/ }));
    expect(onOpenArtifact).toHaveBeenCalledWith(CARD);
  });

  it("marks the card Removed when the artifact is not among the session's", () => {
    render(row({ artifactIds: new Set(), onOpenArtifact: vi.fn() }));
    expect(screen.getByText("Removed")).toBeTruthy();
  });
});
