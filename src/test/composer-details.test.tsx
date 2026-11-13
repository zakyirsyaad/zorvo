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
  it("is a 14px ring before subtle words, its arc as long as the share in use", () => {
    render(<ContextMeter used={38} size={100} />);
    const button = screen.getByRole("button", { name: "Context details" });
    expect(button).toHaveClass("mr-1.5", "text-caption", "text-fg-subtle");
    expect(button.textContent).toBe("38% of context");
    const ring = button.querySelector("svg") as SVGElement;
    expect(ring.getAttribute("class")).toContain("size-3.5");
    expect(ring).toHaveAttribute("aria-hidden", "true");
    expect(ring.parentElement).toBe(screen.getByRole("meter", { name: "Context used" }));
    const [track, arc] = [...ring.querySelectorAll("circle")];
    expect(track.getAttribute("class")).toContain("stroke-surface-hover");
    expect(arc.getAttribute("class")).toContain("stroke-fg-muted");
    // 38% of a circle of radius 6 (37.7 round) is 14.3.
    expect(arc.getAttribute("stroke-dasharray")).toBe("14.3 37.7");
  });

  it("keeps its warning tone, in the words and the arc, once the window is nearly full", () => {
    const { rerender } = render(<ContextMeter used={85} size={100} />);
    const meter = () => screen.getByRole("meter", { name: "Context used" });
    expect(meter()).toHaveClass("text-status-attention");
    expect(meter().querySelectorAll("circle")[1].getAttribute("class")).toContain("stroke-status-attention");
    rerender(<ContextMeter used={96} size={100} />);
    expect(meter()).toHaveClass("text-danger");
    expect(meter().querySelectorAll("circle")[1].getAttribute("class")).toContain("stroke-danger");
  });

  it("draws no ring when the agent does not know the window's size", () => {
    render(<ContextMeter used={12_000} size={0} />);
    const button = screen.getByRole("button", { name: "Context details" });
    expect(button.querySelector("svg")).toBeNull();
    expect(button.textContent).toBe("12K tokens");
    expect(screen.queryByRole("meter")).toBeNull();
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
