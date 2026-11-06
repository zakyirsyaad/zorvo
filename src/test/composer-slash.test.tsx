import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";

const commands = [
  { name: "init", description: "Create an AGENTS.md for this project" },
  { name: "compress", description: "Summarize the conversation to save context" },
  { name: "review", description: "Review the current changes", hint: "what to focus on" },
];

function prompt(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

function type(text: string) {
  fireEvent.change(prompt(), { target: { value: text } });
}

describe("Composer slash commands", () => {
  it("lists the agent's commands when the prompt starts with a slash, filtered as the user types", () => {
    render(<ComposerDock onSendMessage={() => {}} commands={commands} />);

    type("/");
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("data-command"))).toEqual(["init", "compress", "review"]);

    type("/co");
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("data-command"))).toEqual(["compress"]);
    expect(screen.getByText("Summarize the conversation to save context")).toBeDefined();
  });

  it("heads the list with the agent whose commands they are", () => {
    const { rerender } = render(<ComposerDock onSendMessage={() => {}} commands={commands} agentName="Codex" />);
    type("/");
    expect(screen.getByText("Commands from Codex")).toBeDefined();
    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeDefined();

    rerender(<ComposerDock onSendMessage={() => {}} commands={commands} />);
    expect(screen.getByText("Commands")).toBeDefined();
  });

  it("picks a command with the keyboard, without sending it", () => {
    const onSendMessage = vi.fn();
    render(<ComposerDock onSendMessage={onSendMessage} commands={commands} />);

    type("/");
    fireEvent.keyDown(prompt(), { key: "ArrowDown" });
    fireEvent.keyDown(prompt(), { key: "Enter" });

    expect(prompt().value).toBe("/compress ");
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
  });

  it("picks a command with a click and shows its input hint", () => {
    render(<ComposerDock onSendMessage={() => {}} commands={commands} />);

    type("/re");
    fireEvent.mouseDown(screen.getByRole("option", { name: /review/ }));

    expect(prompt().value).toBe("/review ");
    expect(screen.getByText("what to focus on")).toBeDefined();
  });

  it("closes the menu with Escape and once the command has arguments", () => {
    render(<ComposerDock onSendMessage={() => {}} commands={commands} />);

    type("/");
    fireEvent.keyDown(prompt(), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();

    type("/review the parser");
    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
  });

  it("replies to the agent in the placeholder whether or not it has commands, as the canvas words it", () => {
    const { rerender } = render(<ComposerDock onSendMessage={() => {}} agentName="Claude Code" />);
    expect(prompt().placeholder).toBe("Reply to Claude Code");

    rerender(<ComposerDock onSendMessage={() => {}} agentName="Claude Code" commands={commands} />);
    expect(prompt().placeholder).toBe("Reply to Claude Code");
  });
});
