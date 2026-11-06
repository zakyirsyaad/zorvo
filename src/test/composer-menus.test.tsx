import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OptionDropdown, type DropdownOption } from "../components/composer/OptionDropdown";
import { SlashCommandMenu } from "../components/composer/SlashCommandMenu";
import { MentionMenu } from "../components/composer/MentionMenu";

/** The composer's menus as the `ComposerMenus` artboard draws them. */
function openDropdown(label: string, options: DropdownOption[], extra: Partial<Parameters<typeof OptionDropdown>[0]> = {}) {
  render(
    <OptionDropdown
      label={label}
      options={options}
      selected={options[0].value}
      isOpen
      onToggle={() => {}}
      onSelect={vi.fn()}
      {...extra}
    />,
  );
}

describe("the mode menu", () => {
  const modes: DropdownOption[] = [
    { value: "default", label: "Ask before edits", description: "Asks you before it changes a file or runs a command." },
    { value: "plan", label: "Plan" },
    { value: "accept", label: "Accept edits", description: "Edits files without asking.", risky: true },
  ];

  it("is headed Mode", () => {
    openDropdown("Permission mode", modes, { heading: "Mode" });
    const heading = screen.getByText("Mode");
    expect(heading.parentElement).toHaveClass("text-caption", "font-medium", "text-fg-muted");
  });

  it("puts a risky mode's shield after its name, and says so on its subtle line", () => {
    openDropdown("Permission mode", modes, { heading: "Mode" });
    const option = screen.getByRole("option", { name: /Accept edits/ });
    const name = within(option).getByText("Accept edits");
    const shield = within(option).getByRole("img", { name: "Lets the agent act without asking" });
    expect(name.compareDocumentPosition(shield) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shield).toHaveClass("text-status-attention");
    expect(within(option).getByText("Edits files without asking. Lets the agent act without asking.")).toHaveClass("text-fg-subtle");
    expect(option.querySelector(".text-danger")).toBeNull();
  });

  it("says only the risky line for a risky mode without a description", () => {
    openDropdown("Permission mode", [{ value: "yolo", label: "YOLO", risky: true }]);
    expect(screen.getByText("Lets the agent act without asking.")).toHaveClass("text-fg-subtle");
  });
});

describe("the model menu", () => {
  const names = ["Sonnet", "Sonnet, long context", "Opus", "Haiku", "GPT", "o3", "Mini", "Gemini", "Flash", "Qwen", "Kimi", "GLM", "Grok", "Llama"];
  const models: DropdownOption[] = names.map((label) => ({ value: label, label }));

  it("is 300 wide with a search field, a bold match and a subtle count", () => {
    openDropdown("Model", models);
    expect(screen.getByRole("dialog", { name: "Model" })).toHaveClass("w-75");
    const search = screen.getByRole("searchbox", { name: "Search model" });
    expect(search.closest("label")).toHaveClass("h-7.5");
    fireEvent.change(search, { target: { value: "son" } });
    expect(screen.getByText("2 of 14 models")).toHaveClass("text-caption", "text-fg-subtle", "pt-1.5");
    const mark = screen.getAllByRole("option")[0].querySelector("mark");
    expect(mark).toHaveClass("font-semibold");
  });

  it("keeps a short list without descriptions as wide as its words", () => {
    openDropdown("Effort", [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]);
    expect(screen.getByRole("listbox", { name: "Effort" })).toHaveClass("w-max", "min-w-40", "max-w-80");
  });
});

describe("the slash and mention menus", () => {
  it("stacks a command over its description", () => {
    render(
      <SlashCommandMenu
        commands={[{ name: "review", description: "Review the changes on this branch" }]}
        highlighted={0}
        onPick={() => {}}
        agentName="Claude Code"
      />,
    );
    expect(screen.getByText("Commands from Claude Code")).toBeInTheDocument();
    const option = screen.getByRole("option");
    expect(option).toHaveClass("flex-col", "py-1.75");
    expect(within(option).getByText("/review")).toHaveClass("font-mono", "text-ui-sm", "text-fg");
    expect(within(option).getByText("Review the changes on this branch")).toHaveClass("text-caption", "leading-[15px]", "text-fg-subtle");
  });

  it("gives a file its icon, and its folder in subtle mono", () => {
    render(
      <MentionMenu
        files={["src/components/sidebar/SessionList.tsx"]}
        highlighted={0}
        onPick={() => {}}
        folderName="agent-desktop"
        query="Session"
      />,
    );
    expect(screen.getByText("Files in agent-desktop")).toBeInTheDocument();
    const option = screen.getByRole("option");
    expect(option).toHaveClass("items-start", "gap-2");
    expect(option.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(within(option).getByText("src/components/sidebar")).toHaveClass("font-mono", "text-caption", "text-fg-subtle");
    expect(option.querySelector("mark")).toHaveClass("font-semibold");
  });
});
