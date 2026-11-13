import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ComposerDock } from "../components/ComposerDock";
import { DelegateDialog, type DelegateAgentChoice } from "../components/delegation/DelegateDialog";
import { DelegationStatusLine } from "../components/delegation/DelegationStatusLine";
import { DelegatedFromLine } from "../components/delegation/DelegatedFromLine";
import type { DelegationView } from "../hooks/useDelegation";
import type { ComposerControl, ComposerControls } from "../lib/composer-controls";
import { makeProfile } from "./fixtures/agents";
import { NO_CHOICES } from "../lib/acp-draft";

const claude = makeProfile({ id: "claude-acp", name: "Claude Code" });
const qwen = makeProfile({ id: "qwen-code", name: "Qwen Code" });
const codex = makeProfile({ id: "codex-acp", name: "Codex" });
const kimi = makeProfile({ id: "kimi-cli", name: "Kimi CLI" });

const AGENTS: readonly DelegateAgentChoice[] = [
  { profile: claude, status: "ready" },
  { profile: qwen, status: "ready" },
  { profile: codex, status: "ready" },
];

function renderDialog(overrides: Partial<Parameters<typeof DelegateDialog>[0]> = {}) {
  const onDelegate = vi.fn();
  const onCancel = vi.fn();
  render(
    <DelegateDialog
      agents={AGENTS}
      sourceAgentName="Claude Code"
      isSourceRunning
      controlsFor={() => ({ agentName: "Qwen Code" })}
      onDelegate={onDelegate}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onDelegate, onCancel };
}

function control(options: ComposerControl["options"], selected: string | undefined): ComposerControl {
  return { options, selected, onChange: vi.fn() };
}

const CHIP_CONTROLS: ComposerControls = {
  model: control(
    [
      { value: "gpt-5.5-codex", label: "gpt-5.5-codex" },
      { value: "gpt-5", label: "gpt-5" },
    ],
    "gpt-5.5-codex",
  ),
  effort: control(
    [
      { value: "high", label: "High" },
      { value: "low", label: "Low" },
    ],
    "high",
  ),
  permission: control(
    [
      { value: "auto", label: "Auto review" },
      { value: "ask", label: "Ask before edits" },
      { value: "yolo", label: "YOLO", risky: true },
    ],
    "auto",
  ),
};

function view(overrides: Partial<DelegationView> = {}): DelegationView {
  return {
    role: "source",
    otherSessionId: "s-b",
    otherName: "Codex: fix the login",
    agentName: "Codex",
    task: "fix the login",
    state: "working",
    workingSince: 1_000,
    reportedAt: null,
    ...overrides,
  };
}

describe("the delegate dialog", () => {
  it("shows an error for an empty task and does not delegate", () => {
    const { onDelegate, onCancel } = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Delegate to another agent" });
    // Focus moves into the dialog when it opens.
    expect(dialog).toHaveFocus();
    // A short window scrolls the card rather than pushing its actions out of reach.
    expect(dialog).toHaveClass("max-h-[calc(100vh-2rem)]", "overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));

    const error = screen.getByText("Write the task first.");
    expect(error).toHaveClass("text-caption", "text-danger");
    expect(onDelegate).not.toHaveBeenCalled();
    const textarea = screen.getByRole("textbox", { name: "Task" });
    expect(textarea.getAttribute("aria-describedby")).toContain(error.id);

    fireEvent.change(textarea, { target: { value: "Fix the login bug" } });
    expect(screen.queryByText("Write the task first.")).toBeNull();

    // Escape closes without delegating.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDelegate).not.toHaveBeenCalled();
  });

  it("an agent that is not installed cannot be picked", () => {
    const agents: readonly DelegateAgentChoice[] = [...AGENTS, { profile: kimi, status: "not-installed" }];
    renderDialog({ agents });

    const radio = screen.getByRole("radio", { name: /Kimi CLI/ });
    expect(radio).toBeDisabled();
    expect(radio).not.toBeChecked();
    const status = screen.getByText("Not installed");
    expect(status).toHaveClass("text-fg-subtle");
    expect(radio).toHaveAttribute("aria-describedby", status.id);
    const row = status.closest("label");
    // The dialog's row: 36px, a 6px radius, 10px in from the sides.
    expect(row).toHaveClass("h-9", "rounded-md", "px-2.5");
    expect(row).toHaveClass("opacity-55");

    fireEvent.click(radio);
    expect(radio).not.toBeChecked();
  });

  it("picks the first ready agent other than the source's", () => {
    renderDialog();
    expect(screen.getByRole("radio", { name: /Qwen Code/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Claude Code/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Codex/ })).not.toBeChecked();
  });

  it("prefills the agent and task from Change", () => {
    renderDialog({ initialAgentId: "codex-acp", initialTask: "Implement step 2 of the plan" });
    expect(screen.getByRole("radio", { name: /Codex/ })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Task" })).toHaveValue("Implement step 2 of the plan");
  });

  it("keeps Shift+Tab and Tab inside the dialog while its card holds focus", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Delegate to another agent" });
    expect(dialog).toHaveFocus();

    // The card itself is the first control for Tab and the last for Shift+Tab.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Delegate" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("shows the picked agent's chips and passes the picks on Delegate", () => {
    const { onDelegate } = renderDialog({
      controlsFor: () => ({ agentName: "Codex", controls: CHIP_CONTROLS, modeKind: "modes" }),
    });
    expect(screen.getByText("Codex starts on")).toHaveClass("font-medium");
    expect(screen.getByRole("button", { name: "Effort: High" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Model: gpt-5.5-codex" }));
    fireEvent.click(screen.getByRole("option", { name: "gpt-5" }));
    expect(screen.getByRole("button", { name: "Model: gpt-5" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Permission mode: Auto review" }));
    fireEvent.click(screen.getByRole("option", { name: /YOLO/ }));
    // A risky mode keeps its shield after the name, as the composer draws it.
    expect(screen.getByTestId("risky-permission-icon")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Fix the login bug" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));

    expect(onDelegate).toHaveBeenCalledWith("qwen-code", "Fix the login bug", {
      modelId: "gpt-5",
      modeId: "yolo",
      config: {},
    });
  });

  it("a config-mode agent sends no modeId, and its mode pick travels through the control", () => {
    const setModeConfig = vi.fn();
    const controls: ComposerControls = {
      permission: {
        options: [
          { value: "default", label: "Default" },
          { value: "bypassPermissions", label: "Bypass permissions", risky: true },
        ],
        // What draftInfo shows: the safe mode the session will start in, not the agent's configured one.
        selected: "default",
        onChange: setModeConfig,
      },
    };
    const { onDelegate } = renderDialog({
      sourceAgentName: "Codex",
      controlsFor: () => ({ agentName: "Claude Code", controls, modeKind: "config" }),
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Fix the login bug" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));

    // The chip's value is not a modeId: for a config-mode agent the mode is a config option,
    // so the safe mode reaches it as a config change rather than being skipped as "picked".
    expect(onDelegate).toHaveBeenCalledWith("claude-acp", "Fix the login bug", { config: {} });

    fireEvent.click(screen.getByRole("button", { name: "Permission mode: Default" }));
    fireEvent.click(screen.getByRole("option", { name: /Bypass permissions/ }));

    // A config pick goes through the control's onChange, which App records in the dialog's accumulator.
    expect(setModeConfig).toHaveBeenCalledWith("bypassPermissions");
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));
    expect(onDelegate).toHaveBeenLastCalledWith("claude-acp", "Fix the login bug", { config: {} });
  });

  it("an agent with unknown options shows Default and asks only when it opens", () => {
    const onOpen = vi.fn();
    renderDialog({
      controlsFor: () => ({ agentName: "Codex", onOpen, status: "asking" }),
    });

    expect(onOpen).not.toHaveBeenCalled();
    const chip = screen.getByRole("button", { name: "Starts on: Default" });
    fireEvent.click(chip);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Asking Codex for its models…")).toBeInTheDocument();
  });

  it("an agent whose controls are empty shows Default, and opening it asks", () => {
    const onOpen = vi.fn();
    renderDialog({
      controlsFor: () => ({ agentName: "Codex", controls: {}, onOpen }),
    });

    expect(onOpen).not.toHaveBeenCalled();
    const chip = screen.getByRole("button", { name: "Starts on: Default" });
    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("Escape closes an open chip and keeps the dialog, and with no chip open closes the dialog", () => {
    const { onCancel } = renderDialog({
      controlsFor: () => ({ agentName: "Codex", controls: CHIP_CONTROLS }),
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Fix the login bug" },
    });

    const chip = screen.getByRole("button", { name: "Model: gpt-5.5-codex" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delegate to another agent" })).toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("textbox", { name: "Task" })).toHaveValue("Fix the login bug");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("says reports wait in the composer when the source is not running", () => {
    const { unmount } = render(
      <DelegateDialog
        agents={AGENTS}
        sourceAgentName="Claude Code"
        isSourceRunning={false}
        controlsFor={() => ({ agentName: "Qwen Code" })}
        onDelegate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Claude Code isn't running, so its reports wait in its composer\./),
    ).toBeInTheDocument();
    unmount();

    renderDialog({ isSourceRunning: true });
    expect(screen.queryByText(/isn't running/)).toBeNull();
  });
});

describe("the delegation status line", () => {
  it("names the working agent and opens it", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <DelegationStatusLine view={view()} now={131_000} onOpen={onOpen} canAct />,
    );

    expect(screen.getByText("Codex is working on the task you delegated")).toHaveClass(
      "text-ui",
      "text-fg-secondary",
    );
    expect(screen.getByText("2m 10s")).toHaveClass("text-caption", "text-fg-subtle");
    const dot = document.querySelector("[data-delegation-dot]");
    expect(dot).toHaveClass("size-1.5", "bg-status-running", "ring-4", "ring-status-running/20");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("s-b");

    // The status region stays mounted with no text while there is no line.
    rerender(
      <DelegationStatusLine view={view({ state: "reported" })} now={131_000} onOpen={onOpen} canAct />,
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("the status region stays mounted, empty and out of layout while its line is hidden", () => {
    const { rerender } = render(
      <DelegationStatusLine
        view={view({ role: "delegate", state: "working" })}
        now={131_000}
        onOpen={vi.fn()}
        canAct
        hidden
      />,
    );

    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    // No line means no column: the region is taken out of the flow rather than drawing an empty row.
    expect(region).toHaveClass("sr-only");
    expect(region).not.toHaveClass("mx-auto");

    rerender(
      <DelegationStatusLine
        view={view({
          role: "delegate",
          otherSessionId: "s-a",
          otherName: "Fix login bug",
          agentName: "Claude Code",
          state: "source-working",
          workingSince: 123_000,
        })}
        delegateAgentName="Codex"
        now={131_000}
        onOpen={vi.fn()}
        canAct
        hidden={false}
      />,
    );

    const shown = screen.getByRole("status");
    expect(shown).toHaveTextContent("Claude Code is working on Codex's report");
    expect(shown).toHaveClass("mx-auto", "w-full", "max-w-chat");
    expect(shown).not.toHaveClass("sr-only");
  });

  it("the status line says a failed turn", () => {
    render(
      <DelegationStatusLine
        view={view({ state: "failed", workingSince: null })}
        now={131_000}
        onOpen={vi.fn()}
        canAct
      />,
    );
    expect(screen.getByText("Codex's turn failed")).toHaveClass("text-ui", "text-fg-secondary");
    const alert = document.querySelector("[data-delegation-alert]");
    expect(alert).toHaveClass("text-danger");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("the status line says Codex needs your answer", () => {
    render(
      <DelegationStatusLine
        view={view({ state: "needs-answer", workingSince: null })}
        now={131_000}
        onOpen={vi.fn()}
        canAct
      />,
    );
    expect(screen.getByText("Codex needs your answer")).toHaveClass("text-ui", "text-fg-secondary");
    const dot = document.querySelector("[data-delegation-dot]");
    expect(dot).toHaveClass("bg-status-attention");
    expect(dot).not.toHaveClass("ring-4");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("B's status line names A working on its report", () => {
    const onOpen = vi.fn();
    render(
      <DelegationStatusLine
        view={view({
          role: "delegate",
          otherSessionId: "s-a",
          otherName: "Fix login bug",
          agentName: "Claude Code",
          state: "source-working",
          workingSince: 123_000,
        })}
        delegateAgentName="Codex"
        now={131_000}
        onOpen={onOpen}
        canAct
      />,
    );

    expect(document.querySelector("[data-delegation-dot]")).toHaveClass(
      "bg-status-running",
      "ring-4",
      "ring-status-running/20",
    );
    expect(screen.getByText("Claude Code is working on Codex's report")).toBeInTheDocument();
    expect(screen.getByText("8s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("s-a");
  });
});

describe("the delegated-from quiet line", () => {
  it("opens the source, and has no Open when the source is gone", () => {
    const onOpen = vi.fn();
    const delegateView = view({
      role: "delegate",
      otherSessionId: "s-a",
      otherName: "Fix login bug",
      agentName: "Claude Code",
    });
    const { rerender } = render(
      <DelegatedFromLine view={delegateView} onOpen={onOpen} canAct />,
    );

    const line = screen.getByRole("note");
    expect(line).toHaveTextContent("Delegated from Fix login bug · Claude Code");
    expect(line).toHaveClass("text-caption", "text-fg-muted");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("s-a");

    rerender(
      <DelegatedFromLine
        view={{ ...delegateView, state: "source-gone", otherSessionId: null, otherName: "", agentName: "" }}
        onOpen={onOpen}
        canAct
      />,
    );
    expect(screen.getByText("The session that delegated this is gone.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();

    rerender(<DelegatedFromLine view={{ ...delegateView, state: "ended" }} onOpen={onOpen} canAct />);
    expect(screen.getByText("Delegated from Fix login bug · ended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("lines without canAct have no Open", () => {
    render(
      <>
        <DelegationStatusLine view={view()} now={131_000} onOpen={vi.fn()} canAct={false} />
        <DelegatedFromLine
          view={view({
            role: "delegate",
            otherSessionId: "s-a",
            otherName: "Fix login bug",
            agentName: "Claude Code",
          })}
          onOpen={vi.fn()}
          canAct={false}
        />
      </>,
    );
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });
});

describe("the composer's delegation summary", () => {
  it("Change reports the composer's current attachments", async () => {
    const onChange = vi.fn();
    render(
      <ComposerDock
        onSendMessage={vi.fn()}
        onAttach={async () => ["/tmp/spec.md"]}
        attachAsFiles
        delegationSummary={{ text: "Codex starts on its defaults.", onChange }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    });
    expect(await screen.findByRole("button", { name: "Remove spec.md" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    // The dialog carries them, so Delegate's first message keeps the attachment.
    expect(onChange).toHaveBeenCalledWith(["/tmp/spec.md"]);
  });
});

describe("DelegateDialog for an agent that already has a delegate", () => {
  const withDelegate: readonly DelegateAgentChoice[] = [
    { profile: claude, status: "ready" },
    { profile: qwen, status: "ready" },
    { profile: codex, status: "ready", hasDelegate: true },
  ];

  it("says where the task goes instead of offering what a new session starts on", () => {
    const { onDelegate } = renderDialog({
      agents: withDelegate,
      controlsFor: () => ({ agentName: "Codex", controls: CHIP_CONTROLS }),
    });
    fireEvent.click(screen.getByRole("radio", { name: /Codex/ }));

    expect(screen.getByText("Goes to the Codex session this session already delegated to.")).toBeDefined();
    expect(screen.queryByText("Codex starts on")).toBeNull();
    expect(screen.queryByRole("button", { name: /Model/ })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), { target: { value: "Now add tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));
    // The existing session keeps its own model and mode: no pick goes with the task.
    expect(onDelegate).toHaveBeenCalledWith("codex-acp", "Now add tests", NO_CHOICES);
  });

  it("still offers the chips for an agent without one", () => {
    renderDialog({
      agents: withDelegate,
      controlsFor: () => ({ agentName: "Qwen Code", controls: CHIP_CONTROLS }),
    });
    fireEvent.click(screen.getByRole("radio", { name: /Qwen Code/ }));
    expect(screen.getByText("Qwen Code starts on")).toBeDefined();
  });
});
