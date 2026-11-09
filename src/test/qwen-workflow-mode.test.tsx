import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { toConfigOptions, type AcpSessionInfo } from "../hooks/useAcpSessions";
import { acpControls } from "../lib/composer-controls";
import { changesToApply } from "../lib/acp-draft";
import { OptionDropdown } from "../components/composer/OptionDropdown";

/** Qwen Code's Workflow option, as its ACP session answer reports it (0.26.3). */
const workflowOption = (meta: Record<string, unknown>) => ({
  id: "workflow_mode",
  name: "Workflow mode",
  description: "Prefer Workflow orchestration for this session",
  type: "select",
  currentValue: "off",
  options: [
    { value: "off", name: "Off" },
    { value: "on", name: "On" },
  ],
  _meta: { "qwen.workflowMode": meta },
});

const session = (raw: unknown): AcpSessionInfo => ({
  acpSessionId: "acp-1",
  isBusy: false,
  canFork: false,
  canReopen: false,
  commands: [],
  models: null,
  modes: null,
  configOptions: toConfigOptions([raw]),
});

const noActions = { setMode: vi.fn(), setModel: vi.fn(), setConfigOption: vi.fn() };

describe("Qwen Code's Workflow mode when workflows are off in its settings", () => {
  it("marks On as unavailable, saying where to turn workflows on", () => {
    const [option] = toConfigOptions([workflowOption({ available: false, effective: false, reason: "workflow_unavailable" })]);

    expect(option.options.find((c) => c.value === "off")?.unavailable).toBeUndefined();
    expect(option.options.find((c) => c.value === "on")?.unavailable).toBe("Turn on workflows in Qwen Code's settings first.");
  });

  it("marks On with a plainer reason for any other refusal", () => {
    const [option] = toConfigOptions([workflowOption({ available: false, effective: false, reason: "initializing" })]);

    expect(option.options.find((c) => c.value === "on")?.unavailable).toBe("Qwen Code cannot turn this on in this session.");
  });

  it("leaves both choices open once Qwen says Workflow mode is available", () => {
    const [option] = toConfigOptions([workflowOption({ available: true, effective: false })]);

    expect(option.options.every((c) => c.unavailable === undefined)).toBe(true);
  });

  it("ignores the same metadata on any other option", () => {
    const [option] = toConfigOptions([{ ...workflowOption({ available: false }), id: "fast" }]);

    expect(option.options.every((c) => c.unavailable === undefined)).toBe(true);
  });

  it("draws On disabled with the reason, so picking it sends nothing", () => {
    const info = session(workflowOption({ available: false, reason: "workflow_unavailable" }));
    const [workflow] = acpControls(info, noActions).extras ?? [];
    const onSelect = vi.fn();
    render(
      <OptionDropdown label="Workflow mode" icon={null} options={workflow.options} selected="off" isOpen onToggle={() => {}} onSelect={onSelect} />,
    );

    const on = screen.getByRole("option", { name: /On/ });
    expect(on).toBeDisabled();
    expect(within(on).getByText("Turn on workflows in Qwen Code's settings first.")).toBeTruthy();
    fireEvent.click(on);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /Off/ })).toBeEnabled();
  });

  it("does not apply a remembered On the agent cannot turn on", () => {
    const info = session(workflowOption({ available: false, reason: "workflow_unavailable" }));

    expect(changesToApply(info, { config: { workflow_mode: "on" } }, false)).toEqual([]);
  });
});
