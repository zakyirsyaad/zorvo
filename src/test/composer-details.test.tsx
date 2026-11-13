import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import { ContextMeter } from "../components/composer/ContextMeter";

/** The composer's small parts as the `Main` artboard and the audit draw them. */
describe("the composer's placeholder", () => {
  it("replies to the session's agent by name", () => {
    render(<ComposerDock onSendMessage={vi.fn()} agentName="Codex" />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveAttribute("placeholder", "Reply to Codex");
  });

  it("replies to the agent when it has no name", () => {
    render(<ComposerDock onSendMessage={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveAttribute("placeholder", "Reply to the agent");
  });
});

describe("the context meter", () => {
  it("is plain subtle text, with no ring", () => {
    render(<ContextMeter used={38} size={100} />);
    const button = screen.getByRole("button", { name: "Context details" });
    expect(button).toHaveClass("mr-2", "text-caption", "text-fg-subtle");
    expect(button.querySelector("svg")).toBeNull();
    expect(button.textContent).toBe("38% of context");
  });

  it("keeps its warning tone once the window is nearly full", () => {
    render(<ContextMeter used={85} size={100} />);
    expect(screen.getByRole("meter", { name: "Context used" })).toHaveClass("text-status-attention");
  });
});

describe("an image attachment's remove button", () => {
  it("is an 18px circle inside the thumbnail", async () => {
    const onAttach = vi.fn().mockResolvedValue(["/Users/me/shot.png"]);
    render(<ComposerDock onSendMessage={vi.fn()} onAttach={onAttach} attachAsFiles />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    });
    await screen.findByRole("img", { name: "shot.png" });
    const remove = screen.getByRole("button", { name: "Remove shot.png" });
    expect(remove).toHaveClass("absolute", "right-1", "top-1", "size-4.5", "rounded-full", "border", "border-border");
    expect(remove.parentElement?.tagName.toLowerCase()).toBe("li");
    expect(remove.parentElement).toHaveClass("relative");
  });
});
