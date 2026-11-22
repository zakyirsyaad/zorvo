import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";

const prompt = () => screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;

describe("ComposerDock while a turn runs", () => {
  it("shows Stop and a Queue message control when queueing is on", () => {
    render(<ComposerDock isThinking onStop={() => {}} queueing onSendMessage={() => {}} />);
    expect(screen.getByRole("button", { name: "Stop agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Queue message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
  });

  it("queues with the button and with Enter, and empties the box", () => {
    const onSend = vi.fn();
    render(<ComposerDock isThinking onStop={() => {}} queueing onSendMessage={onSend} />);
    fireEvent.change(prompt(), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue message" }));
    expect(onSend).toHaveBeenLastCalledWith("first");
    expect(prompt().value).toBe("");
    fireEvent.change(prompt(), { target: { value: "second" } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(onSend).toHaveBeenLastCalledWith("second");
  });

  it("disables the queue control when sending is disabled", () => {
    render(<ComposerDock isThinking onStop={() => {}} queueing sendDisabled note="Five messages are waiting. Remove one to add another." onSendMessage={() => {}} />);
    fireEvent.change(prompt(), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Queue message" })).toBeDisabled();
    expect(screen.getByText("Five messages are waiting. Remove one to add another.")).toBeInTheDocument();
  });

  it("keeps today's Stop only without queueing (review comments, a popout)", () => {
    const onSend = vi.fn();
    render(<ComposerDock isThinking onStop={() => {}} onSendMessage={onSend} />);
    expect(screen.queryByRole("button", { name: "Queue message" })).toBeNull();
    fireEvent.change(prompt(), { target: { value: "x" } });
    fireEvent.keyDown(prompt(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("says Send message again once the turn ends", () => {
    render(<ComposerDock queueing onStop={() => {}} onSendMessage={() => {}} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("titles the queue control with the agent's name, or says the turn", () => {
    const { rerender } = render(<ComposerDock isThinking onStop={() => {}} queueing agentName="Qwen Code" onSendMessage={() => {}} />);
    expect(screen.getByRole("button", { name: "Queue message" })).toHaveAttribute("title", "Sent when Qwen Code finishes.");
    rerender(<ComposerDock isThinking onStop={() => {}} queueing onSendMessage={() => {}} />);
    expect(screen.getByRole("button", { name: "Queue message" })).toHaveAttribute("title", "Sent when the turn ends.");
  });
});
