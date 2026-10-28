import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { OptionDropdown, type DropdownOption } from "../components/composer/OptionDropdown";
import { ComposerDock } from "../components/ComposerDock";
import { acpControls } from "../lib/composer-controls";
import { CLAUDE, CODEX } from "./fixtures/agent-shapes";

function renderDropdown(options: DropdownOption[], extra: Partial<Parameters<typeof OptionDropdown>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <OptionDropdown
      label="Permission mode"
      icon={null}
      options={options}
      selected={options[0].value}
      isOpen
      onToggle={() => {}}
      onSelect={onSelect}
      {...extra}
    />,
  );
  return onSelect;
}

describe("OptionDropdown rows", () => {
  const options: DropdownOption[] = [
    { value: "default", label: "Default", description: "Prompts for approval" },
    { value: "yolo", label: "YOLO", description: "Auto-approves all tools", risky: true },
    { value: "plan", label: "Plan" },
  ];

  it("shows a description under the label and none for a choice without one", () => {
    renderDropdown(options);

    expect(within(screen.getByRole("option", { name: /Default/ })).getByText("Prompts for approval")).toBeTruthy();
    expect(within(screen.getByRole("option", { name: /YOLO/ })).getByText("Auto-approves all tools")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Plan" }).textContent).toBe("Plan");
  });

  it("marks only the risky row, with an accessible name, before it is picked", () => {
    renderDropdown(options);

    const marks = screen.getAllByRole("img", { name: "Lets the agent act without asking" });
    expect(marks).toHaveLength(1);
    expect(screen.getByRole("option", { name: /YOLO/ }).contains(marks[0])).toBe(true);
  });

  it("selects with a click and leaves the rows keyboard-reachable buttons", () => {
    const onSelect = renderDropdown(options);

    const rows = screen.getAllByRole("option");
    expect(rows.every((row) => row.tagName === "BUTTON")).toBe(true);
    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith("yolo");
  });

  it("puts the description in the chip's tooltip, falling back to the setting's own", () => {
    const { rerender } = render(
      <OptionDropdown label="Mode" icon={null} options={options} selected="yolo" isOpen={false} onToggle={() => {}} onSelect={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Mode: YOLO" }).getAttribute("title")).toBe("YOLO: Auto-approves all tools");

    rerender(
      <OptionDropdown label="Mode" icon={null} options={options} selected="plan" isOpen={false} onToggle={() => {}} onSelect={() => {}} description="How careful the agent is" />,
    );
    expect(screen.getByRole("button", { name: "Mode: Plan" }).getAttribute("title")).toBe("Plan: How careful the agent is");
  });

  it("writes the label on the chip only when asked", () => {
    render(
      <OptionDropdown label="Fast mode" icon={null} options={[{ value: "off", label: "Off" }]} selected="off" isOpen={false} onToggle={() => {}} onSelect={() => {}} showLabel />,
    );
    expect(screen.getByRole("button", { name: "Fast mode: Off" }).textContent).toBe("Fast modeOff");
  });
});

describe("OptionDropdown search", () => {
  const personas: DropdownOption[] = Array.from({ length: 30 }, (_, i) => ({
    value: `agent-${i}`,
    label: i === 17 ? "security-reviewer" : `persona ${i}`,
    description: i === 17 ? "Finds vulnerabilities" : undefined,
  }));

  it("offers no search for a short list", () => {
    renderDropdown(personas.slice(0, 5));
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("filters a long list by label or description, and Enter takes the first match", () => {
    const onSelect = renderDropdown(personas, { label: "Agent" });
    const search = screen.getByRole("searchbox", { name: "Search agent" });

    fireEvent.change(search, { target: { value: "VULNER" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["security-reviewerFinds vulnerabilities"]);

    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("agent-17");

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeTruthy();
  });
});

describe("OptionDropdown search focus", () => {
  const many: DropdownOption[] = Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `Choice ${i}` }));

  it("ignores Enter on an empty search, so nothing changes by accident", () => {
    const onSelect = renderDropdown(many, { label: "Agent" });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("gives focus back to the chip when a menu with a search field closes", () => {
    const props = { label: "Agent", icon: null, options: many, selected: "v0", onToggle: () => {}, onSelect: () => {} };
    const { rerender } = render(<OptionDropdown {...props} isOpen />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));

    rerender(<OptionDropdown {...props} isOpen={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agent: Choice 0" }));
  });
});

describe("the composer's option chips", () => {
  it("shows Codex's collaboration mode and switches it", () => {
    const setConfigOption = vi.fn();
    const controls = acpControls(CODEX, { setMode: vi.fn(), setModel: vi.fn(), setConfigOption });
    render(<ComposerDock controls={controls} onSendMessage={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Collaboration mode: Default" }));
    fireEvent.click(screen.getByRole("option", { name: /Plan/ }));

    expect(setConfigOption).toHaveBeenCalledWith("collaboration_mode", "plan");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows Claude's fast mode and agent chips, and the permission chip warns once a risky mode is selected", () => {
    const risky = { ...CLAUDE, modes: { ...CLAUDE.modes!, currentModeId: "bypassPermissions" } };
    const controls = acpControls(risky, { setMode: vi.fn(), setModel: vi.fn(), setConfigOption: vi.fn() });
    render(<ComposerDock controls={controls} onSendMessage={() => {}} />);

    expect(screen.getByRole("button", { name: "Fast mode: Off" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agent: Default" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Model: Default (Opus)" })).toBeTruthy();
    expect(screen.getByTestId("risky-permission-icon")).toBeTruthy();
  });
});
