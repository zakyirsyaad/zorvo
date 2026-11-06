import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import { OptionDropdown, type DropdownOption } from "../components/composer/OptionDropdown";
import type { ComposerControl } from "../lib/composer-controls";
import type { FolderControl } from "../components/composer/FolderPicker";

/** What the running app showed on 2026-11-06: draft menus cut off at the top, and model names hidden by their tag. */
const control = (labels: string[]): ComposerControl => ({
  options: labels.map((label) => ({ value: label, label })),
  selected: labels[0],
  onChange: () => {},
});

const draftFolder: FolderControl = {
  folders: [{ name: "developer", path: "/w/developer" }],
  selectedPath: "/w/developer",
  onSelect: vi.fn(),
};

const panelOf = (chip: HTMLElement) => chip.closest("div.relative")!.querySelector("[role=listbox], [role=dialog], [role=menu]")!;

describe("which way the composer's menus open", () => {
  it("opens a draft's menus downward, where the column has room", () => {
    render(
      <ComposerDock
        onSendMessage={() => {}}
        folder={draftFolder}
        agent={control(["claude-acp", "qwen-code"])}
        controls={{ model: control(["Opus", "Sonnet"]), permission: control(["Default", "Plan"]), effort: control(["Low", "High"]), extras: [{ ...control(["Off", "On"]), id: "fast", label: "Fast mode" }] }}
      />,
    );
    for (const name of [/^Agent:/, /^Model:/, /^Permission mode:/, /^Effort:/]) {
      const chip = screen.getByRole("button", { name });
      fireEvent.click(chip);
      expect(panelOf(chip)).toHaveClass("top-full");
      expect(panelOf(chip)).not.toHaveClass("bottom-full");
    }
    const more = screen.getByRole("button", { name: "More options" });
    fireEvent.click(more);
    expect(screen.getByRole("menu", { name: "More options" })).toHaveClass("top-full");
  });

  it("opens a running session's menus upward, from the bottom of the window", () => {
    render(<ComposerDock onSendMessage={() => {}} controls={{ model: control(["Opus", "Sonnet"]) }} />);
    const chip = screen.getByRole("button", { name: /^Model:/ });
    fireEvent.click(chip);
    expect(panelOf(chip)).toHaveClass("bottom-full");
  });
});

describe("model names with a provider tag", () => {
  const TAG = "[ModelStudio Token Plan for Global/Intl]";
  const models: DropdownOption[] = [
    { value: "max", label: `${TAG} qwen3.7-max` },
    { value: "plus", label: `${TAG} qwen3.6-plus` },
    { value: "kimi", label: "[OpenRouter] kimi-k2" },
    { value: "plain", label: "local-model" },
  ];
  const open = () =>
    render(<OptionDropdown label="Model" options={models} selected="max" isOpen onToggle={() => {}} onSelect={() => {}} />);

  it("names each row by its model, and groups the rows under their tag", () => {
    open();
    expect(screen.getByRole("option", { name: "qwen3.7-max" })).toHaveAttribute("title", `${TAG} qwen3.7-max`);
    const studio = screen.getByRole("group", { name: "ModelStudio Token Plan for Global/Intl" });
    expect(within(studio).getAllByRole("option").map((option) => option.textContent)).toEqual(["qwen3.7-max", "qwen3.6-plus"]);
    expect(within(studio).getByText("ModelStudio Token Plan for Global/Intl").parentElement).toHaveClass("text-caption", "text-fg-muted");
    expect(within(screen.getByRole("group", { name: "OpenRouter" })).getByRole("option", { name: "kimi-k2" })).toBeInTheDocument();
    // A model without a tag stays a plain row, outside every group.
    expect(screen.getByRole("option", { name: "local-model" }).closest("[role=group]")).toBeNull();
  });

  it("still finds a model by its tag", () => {
    const many: DropdownOption[] = Array.from({ length: 12 }, (_, n) => ({ value: `m${n}`, label: `${TAG} qwen-${n}` }));
    render(<OptionDropdown label="Model" options={[...many, { value: "k", label: "[OpenRouter] kimi-k2" }]} selected="m0" isOpen onToggle={() => {}} onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search model" }), { target: { value: "openrouter" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["kimi-k2"]);
  });
});

describe("a risky mode's line", () => {
  it("ends the agent's description before adding its own sentence", () => {
    render(
      <OptionDropdown
        label="Permission mode"
        options={[{ value: "yolo", label: "YOLO", description: "Automatically approve all tools", risky: true }]}
        selected="yolo"
        isOpen
        onToggle={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Automatically approve all tools. Lets the agent act without asking.")).toBeInTheDocument();
  });
});

describe("the draft's agent dropdown outside a repository", () => {
  it("shows each agent's logo on its row, as its chip does", () => {
    render(<ComposerDock onSendMessage={() => {}} folder={draftFolder} agent={control(["claude-acp", "qwen-code"])} />);
    fireEvent.click(screen.getByRole("button", { name: /^Agent:/ }));
    for (const option of screen.getAllByRole("option")) {
      expect(option.querySelector("[data-option-icon]")).not.toBeNull();
    }
  });
});
