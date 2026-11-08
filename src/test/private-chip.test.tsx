import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useState } from "react";
import { PrivateChip } from "../components/private/PrivateChip";
import { PrivateModelMenu } from "../components/private/PrivateModelMenu";
import { ComposerDock } from "../components/ComposerDock";
import { usePrivateDraft, type PrivateDraftDeps } from "../hooks/usePrivateDraft";
import type { ModelPrice, PrivateStatus } from "../lib/private-credits";

const MODELS: ModelPrice[] = [
  { id: "Qwen/Qwen3.8-27B", inputPerM: 0.04, outputPerM: 1.35 },
  { id: "moonshotai/Kimi-K3", inputPerM: 3.3, outputPerM: 16.5 },
];

const READY: PrivateStatus = {
  device: "ready",
  keyReady: true,
  keyError: null,
  balance: { credits: 1240, usedCredits: 0, keyReady: true, updatedAt: "2026-11-07T10:00:00Z" },
  balanceError: null,
  lastBalance: null,
  recoverySaved: true,
  recoveryPrompted: true,
  pendingTopup: null,
};

const AGENT = { options: [{ value: "qwen-code", label: "Qwen Code" }], selected: "qwen-code", onChange: vi.fn() };
const MODEL_CONTROL = {
  options: [
    { value: "qwen-max", label: "Qwen Max" },
    { value: "qwen-flash", label: "Qwen Flash" },
  ],
  selected: "qwen-max",
  onChange: vi.fn(),
};

describe("PrivateChip", () => {
  it("shows a Retry button beside an on chip whose models failed, and only then", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<PrivateChip kind="on" onToggle={vi.fn()} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<PrivateChip kind="on" onToggle={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("is a toggle that says whether it is on", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<PrivateChip kind="off" onToggle={onToggle} />);
    const chip = screen.getByRole("button", { name: "Private · TEE" });
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<PrivateChip kind="on" onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Private · TEE" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["Private sessions run Qwen Code only for now.", "Private sessions run one agent."])(
    "a disabled chip announces why (%s) and does nothing",
    (reason) => {
      const onToggle = vi.fn();
      render(<PrivateChip kind="disabled" reason={reason} onToggle={onToggle} />);
      const chip = screen.getByRole("button", { name: "Private · TEE" });

      expect(chip).toHaveAttribute("aria-disabled", "true");
      expect(chip).toHaveAccessibleDescription(reason);
      expect(screen.getByText(reason)).toBeInTheDocument();
      fireEvent.click(chip);
      expect(onToggle).not.toHaveBeenCalled();
    },
  );
});

function Menu({ onSelect }: { onSelect: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(MODELS[0].id);
  return (
    <PrivateModelMenu
      models={MODELS}
      selected={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect(id);
        setIsOpen(false);
      }}
      isOpen={isOpen}
      onToggle={() => setIsOpen((open) => !open)}
      onClose={() => setIsOpen(false)}
    />
  );
}

describe("PrivateModelMenu", () => {
  it("lists the private models with their prices and turn cost, and says why others are missing", () => {
    render(<Menu onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Private model: Qwen 3.8 27B" }));

    const list = screen.getByRole("listbox", { name: "Private models" });
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Qwen 3.8 27B$0.04 / $1.35 · ≈ 0.3 credit a turn",
      "Kimi K3$3.30 / $16.50 · ≈ 10 credits a turn",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Private models · run in a TEE")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Claude, GPT and Gemini aren't offered here: they don't run in a TEE. Turn estimates come from real coding tasks.",
      ),
    ).toBeInTheDocument();
  });

  it("selects a model and shows it on the chip", () => {
    const onSelect = vi.fn();
    render(<Menu onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Private model: Qwen 3.8 27B" }));
    fireEvent.click(screen.getByRole("option", { name: /Kimi K3/ }));

    expect(onSelect).toHaveBeenCalledWith("moonshotai/Kimi-K3");
    expect(screen.getByRole("button", { name: "Private model: Kimi K3" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Private models" })).toBeNull();
  });

  it("closes on Escape", () => {
    render(<Menu onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Private model: Qwen 3.8 27B" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Private models" })).toBeNull();
  });
});

/** The draft as App wires it: the hook's chip, menu and credits line into the composer. */
function Draft({ credits, controls = { model: MODEL_CONTROL } }: { credits: PrivateDraftDeps["credits"]; controls?: { model?: typeof MODEL_CONTROL } }) {
  const draft = usePrivateDraft({ credits, agentIds: ["qwen-code"] });
  return (
    <ComposerDock
      controls={draft.isOn ? {} : controls}
      agent={AGENT}
      privateDraft={draft}
      sendDisabled={draft.blocksSend}
      sendLabel={draft.isOn ? "Start private session" : undefined}
      note={draft.note}
      onSendMessage={vi.fn()}
    />
  );
}

function fakeCredits(patch: Partial<PrivateDraftDeps["credits"]> = {}): PrivateDraftDeps["credits"] {
  return {
    status: READY,
    models: MODELS,
    loadCatalog: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    ...patch,
  };
}

describe("the Private chip in the draft", () => {
  it("an off chip leaves the draft as it was: the agent's model chip, no private menu, no catalog load", () => {
    const credits = fakeCredits();
    render(<Draft credits={credits} />);

    expect(screen.getByRole("button", { name: "Private · TEE" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Model: Qwen Max" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Private model/ })).toBeNull();
    expect(screen.queryByText(/credits left/)).toBeNull();
    expect(credits.loadCatalog).not.toHaveBeenCalled();
  });

  it("turning it on loads the catalog exactly once and puts the private model menu in the model chip's place", async () => {
    const credits = fakeCredits();
    render(<Draft credits={credits} />);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Private · TEE" })));

    expect(credits.loadCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Private · TEE" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Private model: Qwen 3.8 27B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Model: Qwen Max" })).toBeNull();
    expect(screen.getByText("1,240 credits left")).toBeInTheDocument();
  });

  it("an on chip without credits blocks Send and points it at the reason", async () => {
    render(<Draft credits={fakeCredits({ status: { ...READY, balance: null } })} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Private · TEE" })));
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "review" } });

    const send = screen.getByRole("button", { name: "Start private session" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Add credits to start a private session");
  });
});

describe("usePrivateDraft and the catalog", () => {
  it("never loads the catalog before the chip is turned on", () => {
    const credits = fakeCredits({ models: null });
    const { rerender } = renderHook((ids: string[]) => usePrivateDraft({ credits, agentIds: ids }), {
      initialProps: ["qwen-code"],
    });
    rerender(["claude-acp"]);
    rerender([]);
    expect(credits.loadCatalog).not.toHaveBeenCalled();
  });
});
